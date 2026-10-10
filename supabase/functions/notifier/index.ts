// Noecy Market — fonction Edge « notifier »
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

async function abonnesAdmins(): Promise<Abonnement[]> {
  const { data } = await sb.from('abonnements_push').select('id,endpoint,p256dh,auth').eq('role', 'admin');
  return data ?? [];
}
async function abonnesClient(clientId: string): Promise<Abonnement[]> {
  const { data } = await sb.from('abonnements_push').select('id,endpoint,p256dh,auth').eq('client_id', clientId);
  return data ?? [];
}

async function estGerante(req: Request): Promise<boolean> {
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!jwt) return false;
  const { data } = await sb.auth.getUser(jwt);
  const email = data?.user?.email?.toLowerCase();
  if (!email) return false;
  const { data: admins } = await sb.from('admins').select('email');
  return (admins ?? []).some((a: { email: string }) => a.email.toLowerCase() === email);
}

async function parametres(): Promise<Record<string, unknown>> {
  const { data } = await sb.from('parametres').select('cle,valeur');
  return Object.fromEntries((data ?? []).map((r: { cle: string; valeur: unknown }) => [r.cle, r.valeur]));
}

const resteDu = (c: { total: number; montant_paye: number; rendu: number }) =>
  Math.max(0, Number(c.total) - (Number(c.montant_paye) - Number(c.rendu || 0)));

function messageRelance(tpl: string, nom: string, montant: string, numeros: string) {
  return tpl.replaceAll('{nom}', nom).replaceAll('{montant}', montant).replaceAll('{numero}', numeros);
}

// Rappel quotidien : clients à crédit depuis au moins 1 jour + résumé pour la gérante
async function rappels(): Promise<number> {
  const P = await parametres();
  const devise = String(P.devise || 'FCFA');
  const tpl = String(P.message_relance || 'Bonjour {nom}, petit rappel : il reste {montant} à régler chez Noecy Market.');
  const { data: credits } = await sb.from('commandes')
    .select('numero,client_id,client_nom,total,montant_paye,rendu,confirmed_at').eq('statut', 'credit');
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
  let n = 0;
  for (const [id, g] of Object.entries(parClient)) {
    n += await envoyer(await abonnesClient(id), {
      titre: 'Rappel Noecy Market', tag: 'rappel', url: '/',
      corps: messageRelance(tpl, g.nom, `${fmt(g.du)} ${devise}`, g.nums.join(', ')),
    });
  }
  const jour = new Date().toISOString().slice(0, 10);
  const { count: resas } = await sb.from('commandes').select('id', { count: 'exact', head: true })
    .in('statut', ['en_attente', 'reservee']).eq('date_reservation', jour);
  const { count: attente } = await sb.from('commandes').select('id', { count: 'exact', head: true }).eq('statut', 'en_attente');
  const morceaux = [];
  if (resas) morceaux.push(`${resas} réservation(s) aujourd'hui`);
  if (attente) morceaux.push(`${attente} commande(s) en attente`);
  if (totalDu) morceaux.push(`${fmt(totalDu)} ${devise} de crédits à recouvrer`);
  if (morceaux.length) {
    n += await envoyer(await abonnesAdmins(), { titre: 'Bonjour Noecy', corps: morceaux.join(' · '), url: '/#/admin', tag: 'resume' });
  }
  return n;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const p = await req.json();
    const secret = env('NOECY_PUSH_SECRET');
    const depuisBase = !!secret && req.headers.get('x-noecy-secret') === secret;
    if (!depuisBase && !(await estGerante(req))) return json({ erreur: 'Accès refusé.' }, 401);

    let envoyes = 0;
    if (p.type === 'rappels') envoyes = await rappels();
    else if (p.type === 'test') envoyes = await envoyer(await abonnesAdmins(), { titre: 'Noecy Market', corps: 'Les notifications fonctionnent sur cet appareil.', url: '/#/admin' });
    else if (p.cible === 'admins') envoyes = await envoyer(await abonnesAdmins(), p);
    else if (p.cible === 'client' && p.client_id) envoyes = await envoyer(await abonnesClient(p.client_id), p);
    else return json({ erreur: 'Requête invalide.' }, 400);

    return json({ envoyes });
  } catch (e) {
    console.error(e);
    return json({ erreur: String((e as Error).message ?? e) }, 500);
  }
});
