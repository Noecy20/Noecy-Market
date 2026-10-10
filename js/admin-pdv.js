/*
 * Noecy Market — espace gérante : points de vente (vendeurs)
 * Un vendeur vend la marchandise du stock Noecy pour son propre compte.
 */
'use strict';

const DROITS = [
  ['credit', 'Vendre à crédit', 'Le client peut payer plus tard (son nom est alors obligatoire).'],
  ['encaisser', 'Encaisser les crédits', 'Enregistrer les remboursements de ses clients.'],
  ['annuler', 'Annuler une vente', 'Les articles reviennent dans le stock Noecy.'],
  ['prix', 'Changer le prix de vente', 'Vendre à un autre prix que celui de la boutique.'],
  ['voir_stock', 'Voir les quantités en stock', 'Sinon il voit seulement « disponible » ou « épuisé ».'],
];
const vendeur = (id) => A.vendeurs.find((v) => v.id === id);
const urlVendeur = () => urlBoutique() + 'vendeur.html';

function statsVendeur(v, since = new Date(0)) {
  const ventes = A.cmdAll.filter((c) => c.vendeur_id === v.id && c.statut !== 'annulee');
  const periode = ventes.filter((c) => confirmedAt(c) >= since);
  const ecr = A.ecrAll.filter((e) => e.vendeur_id === v.id);
  const solde = (k) => sum(ecr.filter((e) => (e.compte || 'especes') === k), (e) => (e.type === 'entree' ? 1 : -1) * Number(e.montant));
  return {
    nb: periode.length,
    ca: sum(periode, 'total'),
    articles: sum(periode, (c) => sum(c.lignes || [], 'quantite')),
    cout: sum(periode, 'cout_revient'),
    credits: sum(ventes.filter((c) => c.statut === 'credit'), reste),
    especes: solde('especes'), wave: solde('wave'),
    derniere: ventes.map((c) => c.created_at).sort().pop(),
  };
}

PAGES.pointsvente = {
  title: 'Points de vente',
  render() {
    const head = `<div class="page-head"><div><h1>Points de vente</h1><p class="muted">Vos vendeurs vendent la marchandise de votre stock pour leur propre compte : leurs ventes et leur argent sont à eux, le stock Noecy baisse à chaque vente.</p></div>
      <button class="btn primary" data-act="pdv-edit">${ic('user-plus')} Nouveau vendeur</button></div>`;
    if (!A.v3) return head + `<div class="note-box">${ic('database')}<div><b>Mise à jour de la base requise.</b> Exécutez <code>supabase/migration_v3_vendeurs.sql</code> dans Supabase (SQL Editor) pour activer les points de vente.</div></div>`;
    const since = periodStart(A.periode);
    const tous = A.vendeurs.map((v) => ({ v, st: statsVendeur(v, since) }));
    const ventes = A.cmdAll.filter((c) => c.vendeur_id && confirmedAt(c) >= since).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const actives = ventes.filter((c) => c.statut !== 'annulee');
    return head + `
    <div class="toolbar"><div class="seg">${[['7', '7 jours'], ['30', '30 jours'], ['mois', 'Ce mois'], ['tout', 'Tout']].map(([k, l]) => `<button class="${A.periode === k ? 'on' : ''}" data-act="pdv-periode" data-p="${k}">${l}</button>`).join('')}</div></div>
    <div class="kpis">
      ${kpi('Ventes des points de vente', sum(actives, 'total'), 'store', '', true, `${actives.length} vente(s) · argent des vendeurs`, 0)}
      ${kpi('Articles sortis du stock', sum(actives, (c) => sum(c.lignes || [], 'quantite')), 'package-minus', 'mango', false, 'Pris dans le stock Noecy', 1, go('inventaire', { inv: 'produits' }))}
      ${kpi('Coût de la marchandise', sum(actives, 'cout_revient'), 'factory', 'caramel', true, 'Donnée aux points de vente', 2, go('rentabilite'))}
      ${kpi('Crédits des vendeurs', sum(tous, (x) => x.st.credits), 'hand-coins', 'danger', true, 'Leurs clients leur doivent', 3)}
    </div>
    ${tous.length ? `<div class="cards" style="margin-bottom:26px">${tous.map(({ v, st }, i) => {
      const id = esc(v.id);
      const dr = v.droits || {};
      return `<div class="client-card vendeur-card ${v.actif ? '' : 'off'}" style="--i:${i}">
        <div class="ch"><span class="avatar">${esc(initials(v.nom))}</span><div class="nm"><b>${esc(v.nom)}</b><span class="small muted">${esc(v.telephone || 'Pas de téléphone')}${st.derniere ? ` · dernière vente ${fDate(st.derniere)}` : ''}</span></div>
          <label class="switch" title="${v.actif ? 'Accès actif' : 'Accès désactivé'}"><input type="checkbox" data-act="pdv-actif" data-id="${id}" ${v.actif ? 'checked' : ''}><span></span></label></div>
        <div class="cstats"><div><small>Ventes</small><b>${money(st.ca)}</b></div><div><small>Articles</small><b>${num(st.articles)}</b></div><div><small>Crédits</small><b style="color:${st.credits ? 'var(--danger)' : 'inherit'}">${money(st.credits)}</b></div></div>
        <div class="small muted">Sa caisse : espèces ${money(st.especes)} · Wave ${money(st.wave)}</div>
        <div class="droits-chips">${DROITS.filter(([k]) => dr[k]).map(([, l]) => `<span class="pill">${l}</span>`).join('') || '<span class="small muted">Vente au comptant uniquement</span>'}</div>
        ${!v.code_hash && !v.a_code ? `<div class="dup">${ic('key-round')} Pas encore de code : définissez-le pour qu'il puisse se connecter.</div>` : ''}
        <div class="oc-actions">
          <button class="btn soft sm" data-act="pdv-hist" data-id="${id}">${ic('history')} Ventes</button>
          <button class="btn ghost sm" data-act="pdv-edit" data-id="${id}">${ic('pencil')} Droits</button>
          <button class="btn ghost sm" data-act="pdv-code" data-id="${id}">${ic('key-round')} Code</button>
        </div></div>`;
    }).join('')}</div>` : `<div class="card" style="margin-bottom:26px"><div class="empty" style="padding:30px"><span class="big">${ic('store')}</span><h3>Aucun point de vente</h3><p>Créez un vendeur : il pourra vendre votre stock depuis son téléphone.</p><button class="btn primary" style="margin-top:14px" data-act="pdv-edit">${ic('user-plus')} Nouveau vendeur</button></div></div>`}
    <div class="card-head"><h3>Dernières ventes des points de vente</h3><span class="small muted">${ventes.length}</span></div>
    ${ventes.length ? `<div class="table-wrap"><table class="tbl">
      <thead><tr><th>Date</th><th>Vendeur</th><th>Articles</th><th class="hide-mobile">Client</th><th>Statut</th><th class="num">Total</th></tr></thead>
      <tbody>${ventes.slice(0, 40).map((c, i) => `<tr style="--i:${Math.min(i, 30)}"><td class="nowrap">${fDateTime(c.created_at)}</td><td><b>${esc(vendeur(c.vendeur_id)?.nom || '—')}</b></td>
        <td class="small">${(c.lignes || []).map((l) => `${l.quantite}× ${esc(l.nom)}`).join(', ')}</td><td class="hide-mobile">${esc(c.client_nom)}</td><td>${pillCmd(c.statut)}</td><td class="num">${money(c.total)}</td></tr>`).join('')}</tbody>
    </table></div>` : '<p class="muted">Aucune vente sur la période.</p>'}`;
  },
};

function vendeurForm(v) {
  const isNew = !v;
  v = v || { nom: '', telephone: '', droits: { credit: true, encaisser: true }, actif: true };
  const dr = v.droits || {};
  modal({
    title: isNew ? 'Nouveau vendeur' : `Droits de ${esc(v.nom)}`,
    body: `<div class="row"><div class="field"><label>Nom *</label><input id="vf-nom" maxlength="60" value="${esc(v.nom)}" placeholder="Ex. Amir"></div>
      <div class="field"><label>Téléphone * (sert à se connecter)</label><input id="vf-tel" type="tel" maxlength="30" value="${esc(v.telephone || '')}" placeholder="77 123 45 67"></div></div>
      <div class="field"><label>${isNew ? 'Code PIN * (4 à 6 chiffres)' : 'Nouveau code PIN (laisser vide pour ne pas changer)'}</label><input id="vf-code" class="pin-input" inputmode="numeric" maxlength="6" value="${isNew ? String(Math.floor(1000 + Math.random() * 9000)) : ''}"></div>
      <h4 class="cart-h">Ce qu'il a le droit de faire</h4>
      <p class="small muted" style="margin-bottom:10px">Il peut toujours vendre au comptant (espèces ou Wave).</p>
      <div class="droits-list">${DROITS.map(([k, l, d]) => `<label class="check toggle-line"><span class="switch"><input type="checkbox" data-droit="${k}" ${dr[k] ? 'checked' : ''}><span></span></span><span><b>${l}</b><br><span class="small muted">${d}</span></span></label>`).join('')}</div>
      <label class="check"><span class="switch"><input type="checkbox" id="vf-actif" ${v.actif ? 'checked' : ''}><span></span></span> Accès actif</label>`,
    foot: `${isNew ? '' : `<button class="btn ghost danger-txt" id="vf-suppr">${ic('trash-2')} Supprimer</button>`}<button class="btn ghost" data-close>Annuler</button><button class="btn primary" id="vf-ok">${ic('check')} Enregistrer</button>`,
    onMount: (el, close) => {
      const sup = $('#vf-suppr', el);
      if (sup) sup.onclick = async () => {
        const nb = A.cmdAll.filter((c) => c.vendeur_id === v.id).length;
        if (nb) { toast(`${v.nom} a ${nb} vente(s) : désactivez plutôt son accès pour garder l'historique.`, 'warn', 5000); return; }
        if (!(await confirmBox(`Supprimer le vendeur <b>${esc(v.nom)}</b> ?`, { ok: 'Supprimer', danger: true }))) return;
        await run(null, async () => { await DB.remove('vendeurs', v.id); close(); await refreshAfter(); });
      };
      $('#vf-ok', el).onclick = (e) => run(e.currentTarget, async () => {
        const nom = $('#vf-nom', el).value.trim(), telephone = $('#vf-tel', el).value.trim(), code = $('#vf-code', el).value.trim();
        if (nom.length < 2) throw new Error('Nom obligatoire.');
        if (telDigits(telephone).length < 8) throw new Error('Téléphone obligatoire : il sert à se connecter.');
        if (isNew && !/^\d{4,6}$/.test(code)) throw new Error('Le code PIN doit contenir 4 à 6 chiffres.');
        if (code && !/^\d{4,6}$/.test(code)) throw new Error('Le code PIN doit contenir 4 à 6 chiffres.');
        const doublon = A.vendeurs.find((x) => x.id !== v.id && telDigits(x.telephone).slice(-9) === telDigits(telephone).slice(-9));
        if (doublon) throw new Error(`Ce numéro est déjà utilisé par ${doublon.nom}.`);
        const droits = {};
        $$('[data-droit]', el).forEach((c) => { droits[c.dataset.droit] = c.checked; });
        const data = { nom, telephone, droits, actif: $('#vf-actif', el).checked };
        const r = isNew ? await DB.insert('vendeurs', { ...data, token: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) }) : await DB.update('vendeurs', v.id, data);
        if (code) await DB.adminVendeurCode(r.id, code);
        close();
        toast(isNew ? `${nom} est créé` : 'Vendeur mis à jour');
        await refreshAfter();
        if (isNew) envoyerAcces({ ...r, telephone }, code);
      });
    },
  });
}

// Message WhatsApp avec le lien de l'espace vendeur et son code
function envoyerAcces(v, code) {
  if (!v.telephone) return;
  const msg = `Bonjour ${v.nom}, voici ton espace vendeur ${SETTINGS.nom_boutique} :\n${urlVendeur()}\n\nConnexion : ton numéro de téléphone${code ? ` + le code ${code}` : ' + ton code'}.\nAjoute la page sur l'écran d'accueil de ton téléphone pour l'ouvrir comme une application.`;
  window.open(waLink(v.telephone, msg), '_blank', 'noopener');
}

function historiqueVendeur(v) {
  const ventes = A.cmdAll.filter((c) => c.vendeur_id === v.id).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const st = statsVendeur(v);
  const prods = {};
  ventes.filter((c) => c.statut !== 'annulee').forEach((c) => (c.lignes || []).forEach((l) => { prods[l.nom] = (prods[l.nom] || 0) + Number(l.quantite); }));
  const top = Object.entries(prods).sort((a, b) => b[1] - a[1]);
  modal({
    title: `${ic('store')} ${esc(v.nom)}`, size: 'wide',
    body: `<div class="hist-stats">
        <div><small>Ventes (total)</small><b>${money(st.ca)}</b></div>
        <div><small>Nombre de ventes</small><b>${st.nb}</b></div>
        <div><small>Articles pris dans le stock</small><b>${num(st.articles)}</b></div>
        <div><small>Coût de la marchandise</small><b>${money(st.cout)}</b></div>
        <div><small>Crédits de ses clients</small><b style="color:${st.credits ? 'var(--danger)' : 'inherit'}">${money(st.credits)}</b></div>
        <div><small>Sa caisse</small><b>${money(st.especes + st.wave)}</b></div>
      </div>
      ${top.length ? `<div class="hist-prefs"><span class="small muted">Articles vendus</span>${top.map(([n, q]) => `<span class="pill info">${esc(n)} × ${num(q)}</span>`).join('')}</div>` : ''}
      <div style="margin-top:14px">${ventes.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Articles</th><th class="hide-mobile">Client</th><th>Statut</th><th class="num">Total</th></tr></thead><tbody>
        ${ventes.map((c, i) => `<tr style="--i:${Math.min(i, 30)}"><td class="nowrap">${fDateTime(c.created_at)}</td><td class="small">${(c.lignes || []).map((l) => `${l.quantite}× ${esc(l.nom)}${l.prix !== prod(l.produit_id)?.prix ? ` <span class="muted">(${num(l.prix)})</span>` : ''}`).join(', ')}</td><td class="hide-mobile">${esc(c.client_nom)}${c.client_telephone ? `<br><span class="small muted">${esc(c.client_telephone)}</span>` : ''}</td><td>${pillCmd(c.statut)}${c.statut === 'credit' ? `<br><span class="small" style="color:var(--danger)">reste ${money(reste(c))}</span>` : ''}</td><td class="num">${money(c.total)}</td></tr>`).join('')}
      </tbody></table></div>` : '<p class="muted">Aucune vente pour le moment.</p>'}</div>`,
    foot: `${v.telephone ? `<button class="btn ghost" id="vh-acces">${ic('send')} Renvoyer l'accès</button>` : ''}<button class="btn primary" data-close>Fermer</button>`,
    onMount: (el) => { const b = $('#vh-acces', el); if (b) b.onclick = () => envoyerAcces(v, ''); },
  });
}

Object.assign(ACT, {
  'pdv-periode': (el) => { A.periode = el.dataset.p; renderPage(false); },
  'pdv-edit': (el) => vendeurForm(el.dataset.id ? vendeur(el.dataset.id) : null),
  'pdv-hist': (el) => historiqueVendeur(vendeur(el.dataset.id)),
  'pdv-actif': (el) => {
    setTimeout(() => run(null, async () => {
      await DB.update('vendeurs', el.dataset.id, { actif: el.checked });
      toast(el.checked ? 'Accès réactivé' : 'Accès désactivé : il ne peut plus vendre');
      await refreshAfter();
    }));
  },
  'pdv-code': (el) => {
    const v = vendeur(el.dataset.id);
    const propose = String(Math.floor(1000 + Math.random() * 9000));
    modal({
      title: `Code PIN de ${esc(v.nom)}`,
      body: `<p class="muted" style="margin-bottom:12px">Il se connecte sur <b>vendeur.html</b> avec son numéro (${esc(v.telephone || '—')}) et ce code. Changer le code le déconnecte de ses autres appareils.</p>
        <div class="field"><label>Nouveau code (4 à 6 chiffres)</label><input id="pc-code" class="pin-input" inputmode="numeric" maxlength="6" value="${propose}"></div>`,
      foot: `<button class="btn ghost" data-close>Annuler</button><button class="btn primary" id="pc-ok">Enregistrer${v.telephone ? ' et envoyer' : ''}</button>`,
      onMount: (m, close) => {
        $('#pc-ok', m).onclick = (e) => run(e.currentTarget, async () => {
          const code = $('#pc-code', m).value.trim();
          await DB.adminVendeurCode(v.id, code);
          close(); toast('Code enregistré');
          envoyerAcces(v, code);
          await refreshAfter();
        });
      },
    });
  },
});
