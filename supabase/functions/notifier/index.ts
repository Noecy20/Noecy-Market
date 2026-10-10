// Plateforme — fonction Edge « notifier »
// Envoie les notifications push (Web Push) à la gérante et aux clients.
//
// Appelée par :
//   - la base de données (déclencheurs + rappel quotidien), avec l'en-tête x-noecy-secret ;
//   - l'espace gérante (bouton « Envoyer un rappel », test), avec la session de la gérante.
//
// Secrets à définir dans Supabase > Edge Functions > Secrets :
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, NOECY_PUSH_SECRET (et VAPID_SUBJECT, facultatif)

import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

const env = (k: string) => Deno.env.get(k) ?? '';
const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));

webpush.setVapidDetails(
  env('VAPID_SUBJECT') || 'mailto:contact@noecy-market.app',
  env('VAPID_PUBLIC_KEY'),
  env('VAPID_PRIVATE_KEY'),
);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

type Abonnement = { id: string; endpoint: string; p256dh: string; auth: string };
type Message = { titre: string; corps: string; url?: string; tag?: string };

const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR').replace(/ | /g, ' ');

async function envoyer(subs: Abonnement[], msg: Message): Promise<number> {
  let ok = 0;
  const payload = JSON.stringify({ titre: msg.titre, corps: msg.corps, url: msg.url || '/', tag: msg.tag });
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400 });
      ok++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      // Abonnement expiré ou révoqué : on le supprime
      if (code === 404 || code === 410) await sb.from('abonnements_push').delete().eq('id', s.id);
      else console.error('push', code, (e as { body?: string }).body ?? e);
    }
  }));
  return ok;
}

// Gérants d'une boutique (et l'administrateur de la plateforme abonné à cette boutique)
async function abonnesAdmins(boutiqueId?: string): Promise<Abonnement[]> {
  let q = sb.from('abonnements_push').select('id,endpoint,p256dh,auth').eq('role', 'admin');
  if (boutiqueId) q = q.eq('boutique_id', boutiqueId);
  const { data } = await q;
  return data ?? [];
}
// Administrateur de la plateforme
async function abonnesSuper(): Promise<Abonnement[]> {
  const { data } = await sb.from('abonnements_push').select('id,endpoint,p256dh,auth').eq('role', 'super');
  return data ?? [];
}
// Tous les clients abonnés d'une boutique (ex. menu du jour publié)
async function abonnesBoutique(boutiqueId: string): Promise<Abonnement[]> {
  const { data } = await sb.from('abonnements_push').select('id,endpoint,p256dh,auth').eq('role', 'client').eq('boutique_id', boutiqueId);
  return data ?? [];
}
async function abonnesClient(clientId: string): Promise<Abonnement[]> {
  const { data } = await sb.from('abonnements_push').select('id,endpoint,p256dh,auth').eq('client_id', clientId);
  return data ?? [];
}

// Compte connecté : administrateur de la plateforme, ou membre de boutiques actives
async function compte(req: Request): Promise<{ super: boolean; boutiques: string[] } | null> {
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!jwt) return null;
  const { data } = await sb.auth.getUser(jwt);
  const user = data?.user;
  if (!user?.email) return null;
  const { data: admins } = await sb.from('admins').select('email');
  const sup = (admins ?? []).some((a: { email: string }) => a.email.toLowerCase() === user.email!.toLowerCase());
  const { data: m } = await sb.from('membres').select('boutique_id, boutiques!inner(statut)').eq('user_id', user.id).eq('boutiques.statut', 'active');
  return { super: sup, boutiques: (m ?? []).map((x: { boutique_id: string }) => x.boutique_id) };
}

async function parametres(boutiqueId: string): Promise<Record<string, unknown>> {
  const { data } = await sb.from('parametres').select('cle,valeur').eq('boutique_id', boutiqueId);
  return Object.fromEntries((data ?? []).map((r: { cle: string; valeur: unknown }) => [r.cle, r.valeur]));
}

const resteDu = (c: { total: number; montant_paye: number; rendu: number }) =>
  Math.max(0, Number(c.total) - (Number(c.montant_paye) - Number(c.rendu || 0)));

function messageRelance(tpl: string, nom: string, montant: string, numeros: string) {
  return tpl.replaceAll('{nom}', nom).replaceAll('{montant}', montant).replaceAll('{numero}', numeros);
}

// Rappel quotidien, boutique par boutique : clients à crédit depuis au moins 1 jour + résumé pour les gérants
async function rappels(): Promise<number> {
  const { data: bqs } = await sb.from('boutiques').select('id,nom').eq('statut', 'active');
  let n = 0;
  const jour = new Date().toISOString().slice(0, 10);
  for (const bq of bqs ?? []) {
    const P = await parametres(bq.id);
    const devise = String(P.devise || 'FCFA');
    const tpl = String(P.message_relance || `Bonjour {nom}, petit rappel de ${bq.nom} : il reste {montant} à régler.`);
    const { data: credits } = await sb.from('commandes')
      .select('numero,client_id,client_nom,total,montant_paye,rendu,confirmed_at').eq('boutique_id', bq.id).eq('statut', 'credit').is('vendeur_id', null);
    const hier = Date.now() - 864e5;
    const parClient: Record<string, { nom: string; du: number; nums: string[] }> = {};
    let totalDu = 0;
    for (const c of credits ?? []) {
      const r = resteDu(c);
      totalDu += r;
      if (!c.client_id || !r || new Date(c.confirmed_at ?? 0).getTime() > hier) continue;
      const g = (parClient[c.client_id] ??= { nom: c.client_nom, du: 0, nums: [] });
      g.du += r; g.nums.push(c.numero);
    }
    for (const [id, g] of Object.entries(parClient)) {
      n += await envoyer(await abonnesClient(id), {
        titre: `Rappel ${bq.nom}`, tag: 'rappel', url: '/',
        corps: messageRelance(tpl, g.nom, `${fmt(g.du)} ${devise}`, g.nums.join(', ')),
      });
    }
    const { count: resas } = await sb.from('commandes').select('id', { count: 'exact', head: true })
      .eq('boutique_id', bq.id).in('statut', ['en_attente', 'reservee']).eq('date_reservation', jour);
    const { count: attente } = await sb.from('commandes').select('id', { count: 'exact', head: true }).eq('boutique_id', bq.id).eq('statut', 'en_attente');
    const morceaux = [];
    if (resas) morceaux.push(`${resas} réservation(s) aujourd'hui`);
    if (attente) morceaux.push(`${attente} commande(s) en attente`);
    if (totalDu) morceaux.push(`${fmt(totalDu)} ${devise} de crédits à recouvrer`);
    if (morceaux.length) {
      n += await envoyer(await abonnesAdmins(bq.id), { titre: `Bonjour · ${bq.nom}`, corps: morceaux.join(' · '), url: '/admin.html', tag: 'resume-' + bq.id });
    }
  }
  return n;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const p = await req.json();
    const secret = env('NOECY_PUSH_SECRET');
    const depuisBase = !!secret && req.headers.get('x-noecy-secret') === secret;
    const qui = depuisBase ? null : await compte(req);
    if (!depuisBase && !qui) return json({ erreur: 'Accès refusé.' }, 401);
    // Un gérant ne peut viser que sa boutique (ou un client de sa boutique)
    const autorise = async (boutiqueId?: string, clientId?: string) => {
      if (depuisBase || qui!.super) return true;
      if (boutiqueId) return qui!.boutiques.includes(boutiqueId);
      if (clientId) {
        const { data } = await sb.from('clients').select('boutique_id').eq('id', clientId).maybeSingle();
        return !!data && qui!.boutiques.includes(data.boutique_id);
      }
      return false;
    };

    let envoyes = 0;
    if (p.type === 'rappels') {
      if (!depuisBase && !qui!.super) return json({ erreur: 'Accès refusé.' }, 403);
      envoyes = await rappels();
    } else if (p.type === 'test') {
      if (!(await autorise(p.boutique_id))) return json({ erreur: 'Accès refusé.' }, 403);
      envoyes = await envoyer(p.boutique_id ? await abonnesAdmins(p.boutique_id) : await abonnesSuper(), { titre: 'Notifications', corps: 'Les notifications fonctionnent sur cet appareil.', url: '/admin.html' });
    } else if (p.cible === 'super') {
      if (!depuisBase && !qui!.super) return json({ erreur: 'Accès refusé.' }, 403);
      envoyes = await envoyer(await abonnesSuper(), p);
    } else if (p.cible === 'admins') {
      if (!(await autorise(p.boutique_id))) return json({ erreur: 'Accès refusé.' }, 403);
      envoyes = await envoyer(await abonnesAdmins(p.boutique_id), p);
    } else if (p.cible === 'boutique_clients' && p.boutique_id) {
      if (!(await autorise(p.boutique_id))) return json({ erreur: 'Accès refusé.' }, 403);
      envoyes = await envoyer(await abonnesBoutique(p.boutique_id), p);
    } else if (p.cible === 'client' && p.client_id) {
      if (!(await autorise(undefined, p.client_id))) return json({ erreur: 'Accès refusé.' }, 403);
      envoyes = await envoyer(await abonnesClient(p.client_id), p);
    } else return json({ erreur: 'Requête invalide.' }, 400);

    return json({ envoyes });
  } catch (e) {
    console.error(e);
    return json({ erreur: String((e as Error).message ?? e) }, 500);
  }
});
