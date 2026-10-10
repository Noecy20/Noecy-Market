/*
^ * Plateforme — espace de gestion : caisse, crédits & dettes, paramètres
 */
'use strict';

/* ---------- Caisse (grand livre par compte) ---------- */
const GL_CATS = {
  vente: 'Vente', acompte: 'Avance client', recouvrement: 'Remboursement crédit', fabrication: 'Fabrication', achat: 'Achat',
  rendu: 'Argent rendu', annulation: 'Annulation', transfert: 'Transfert', prelevement: 'Prélèvement personnel',
  apport: 'Apport', transport: 'Transport', emballage: 'Emballage', charges: 'Factures / charges', autre: 'Autre',
};
const GL_AUTO = ['vente', 'acompte', 'recouvrement', 'fabrication', 'achat', 'rendu', 'annulation'];

PAGES.caisse = {
  title: 'Caisse',
  render() {
    const start = dayKey(periodStart(A.f.gl));
    const filtreCompte = (e) => A.f.glCompte === 'tous' || (e.compte || 'especes') === A.f.glCompte;
    const all = A.ecritures.filter(filtreCompte)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.created_at).localeCompare(String(b.created_at)));
    const signe = (e) => (e.type === 'entree' ? 1 : -1) * Number(e.montant);
    let solde = sum(all.filter((e) => e.date < start), signe);
    const ouverture = solde;
    const q = norm(A.f.q);
    const rows = all.filter((e) => e.date >= start).map((e) => { solde += signe(e); return { ...e, solde }; })
      .filter((e) => (A.f.glType === 'tous' || e.type === A.f.glType) && (!q || norm(e.libelle + ' ' + (GL_CATS[e.categorie] || '')).includes(q)));
    const horsT = rows.filter((e) => e.categorie !== 'transfert');
    const ent = sum(horsT.filter((e) => e.type === 'entree'), 'montant'), sor = sum(horsT.filter((e) => e.type === 'sortie'), 'montant');
    const s = soldes();
    A._glRows = rows;
    return `
    <div class="page-head"><div><h1>Caisse</h1><p class="muted">L'argent réellement reçu et sorti, compte par compte. Seuls les paiements que vous avez validés y entrent.</p></div>
      <div class="head-actions"><button class="btn danger" data-act="gl-depense">${ic('arrow-up-right')} Dépense</button><button class="btn leaf" data-act="gl-entree">${ic('arrow-down-left')} Entrée</button><button class="btn ghost" data-act="gl-transfert">${ic('arrow-left-right')} Transfert</button></div></div>
    <div class="ledger-sum">
      <div class="compte-card especes" data-act="f-glcompte" data-k="especes"><span class="ci">${ic('banknote')}</span><div><small>Espèces</small><b data-count="${Math.round(s.especes)}" data-money>0</b></div></div>
      <div class="compte-card wave" data-act="f-glcompte" data-k="wave"><span class="ci">${ic('waves')}</span><div><small>Wave</small><b data-count="${Math.round(s.wave)}" data-money>0</b></div></div>
      <div class="compte-card total" data-act="f-glcompte" data-k="tous"><span class="ci">${ic('landmark')}</span><div><small>Total caisse</small><b data-count="${Math.round(s.especes + s.wave)}" data-money>0</b></div></div>
    </div>
    <div class="toolbar">
      <div class="seg scroll">${[['tous', 'Tous les comptes'], ['especes', 'Espèces'], ['wave', 'Wave']].map(([k, l]) => `<button class="${A.f.glCompte === k ? 'on' : ''}" data-act="f-glcompte" data-k="${k}">${l}</button>`).join('')}</div>
      <div class="seg scroll">${[['7', '7 j'], ['30', '30 j'], ['mois', 'Ce mois'], ['tout', 'Tout']].map(([k, l]) => `<button class="${A.f.gl === k ? 'on' : ''}" data-act="f-gl" data-k="${k}">${l}</button>`).join('')}</div>
      <div class="seg">${[['tous', 'Tout'], ['entree', 'Entrées'], ['sortie', 'Sorties']].map(([k, l]) => `<button class="${A.f.glType === k ? 'on' : ''}" data-act="f-gltype" data-k="${k}">${l}</button>`).join('')}</div>
      <label class="search field" style="margin:0">${ic('search')}<input class="input" placeholder="Libellé…" data-inp="adm-q" value="${esc(A.f.q)}"></label>
      <button class="btn ghost sm" data-act="gl-csv">${ic('download')} CSV</button>
    </div>
    <div class="period-sum small"><span>Ouverture <b>${money(ouverture)}</b></span><span class="amt-in">Entrées ${money(ent)}</span><span class="amt-out">Sorties ${money(sor)}</span><span>Solde <b>${money(solde)}</b></span></div>
    ${rows.length ? `<div class="table-wrap"><table class="tbl">
      <thead><tr><th>Date</th><th>Libellé</th><th>Compte</th><th class="hide-mobile">Catégorie</th><th class="num">Entrée</th><th class="num">Sortie</th><th class="num hide-mobile">Solde</th><th></th></tr></thead>
      <tbody>${rows.slice().reverse().map((e, i) => `<tr style="--i:${Math.min(i, 30)}">
        <td class="nowrap">${fDate(e.date)}</td><td>${esc(e.libelle)}</td>
        <td><span class="pill ${e.compte === 'wave' ? 'wave' : ''}">${compteLbl(e.compte)}</span></td>
        <td class="hide-mobile"><span class="pill">${esc(GL_CATS[e.categorie] || e.categorie || '—')}</span></td>
        <td class="num amt-in">${e.type === 'entree' ? money(e.montant) : ''}</td>
        <td class="num amt-out">${e.type === 'sortie' ? money(e.montant) : ''}</td>
        <td class="num hide-mobile"><b>${money(e.solde)}</b></td>
        <td class="num">${GL_AUTO.includes(e.categorie) ? '' : `<button class="icon-btn flat" data-act="gl-suppr" data-id="${esc(e.id)}" title="Supprimer">${ic('trash-2')}</button>`}</td></tr>`).join('')}</tbody>
    </table></div>` : `<div class="card"><div class="empty" style="padding:30px"><span class="big">${ic('book-open')}</span><h3>Aucun mouvement</h3><p>Les paiements validés, achats et dépenses s'enregistrent ici automatiquement.</p></div></div>`}`;
  },
};

function mouvementForm(type) {
  const dep = type === 'sortie';
  const cats = dep ? ['prelevement', 'achat', 'transport', 'emballage', 'charges', 'autre'] : ['apport', 'vente', 'autre'];
  let compte = 'especes';
  modal({
    title: dep ? 'Dépense / argent pris dans la caisse' : 'Entrée d\'argent',
    body: `<div class="seg seg-full" id="mv-c" style="margin-bottom:14px">${Object.entries(COMPTES).map(([k, v]) => `<button type="button" data-c="${k}" class="${k === compte ? 'on' : ''}">${ic(v.icon)} ${dep ? 'Pris en' : 'Reçu en'} ${v.label.toLowerCase()}</button>`).join('')}</div>
      <div class="field"><label>${dep ? 'Pour quoi faire ? *' : 'Origine *'}</label><input id="mv-l" maxlength="120" placeholder="${dep ? 'Ex. Courses maison, taxi, recharge…' : 'Ex. Apport personnel, vente au marché…'}"></div>
      <div class="row"><div class="field"><label>Montant *</label><input id="mv-m" type="number" min="1" step="1" inputmode="numeric"></div>
      <div class="field"><label>Date</label><input id="mv-d" type="date" value="${dayKey()}"></div></div>
      <div class="field"><label>Catégorie</label><select id="mv-cat">${cats.map((k) => `<option value="${k}">${GL_CATS[k]}</option>`).join('')}</select></div>
      ${dep ? `<p class="small muted">Disponible en ${compteLbl(compte).toLowerCase()} : <b id="mv-dispo">${money(soldes()[compte])}</b></p>` : ''}`,
    foot: `<button class="btn ghost" data-close>Annuler</button><button class="btn ${dep ? 'danger' : 'leaf'}" id="mv-ok">Enregistrer</button>`,
    onMount: (el, close) => {
      $('#mv-c', el).onclick = (e) => {
        const b = e.target.closest('[data-c]'); if (!b) return;
        compte = b.dataset.c;
        $$('#mv-c button', el).forEach((x) => x.classList.toggle('on', x === b));
        const d = $('#mv-dispo', el); if (d) { d.textContent = money(soldes()[compte]); d.parentElement.firstChild.textContent = `Disponible en ${compteLbl(compte).toLowerCase()} : `; }
      };
      setTimeout(() => $('#mv-l', el).focus(), 300);
      $('#mv-ok', el).onclick = (e) => run(e.currentTarget, async () => {
        const libelle = $('#mv-l', el).value.trim(), montant = Math.round(Number($('#mv-m', el).value));
        if (!libelle) throw new Error(dep ? 'Dites ce que vous avez pris l\'argent pour faire.' : 'Indiquez l\'origine.');
        if (!(montant > 0)) throw new Error('Montant invalide.');
        await DB.insert('ecritures', { date: $('#mv-d', el).value || dayKey(), libelle, type, categorie: $('#mv-cat', el).value, compte, montant, ref: null });
        close(); toast(dep ? 'Dépense enregistrée' : 'Entrée enregistrée'); await refreshAfter();
      });
    },
  });
}

Object.assign(ACT, {
  'f-gl': (el) => { A.f.gl = el.dataset.k; renderPage(false); },
  'f-gltype': (el) => { A.f.glType = el.dataset.k; renderPage(false); },
  'f-glcompte': (el) => { A.f.glCompte = el.dataset.k; renderPage(false); },
  'gl-depense': () => mouvementForm('sortie'),
  'gl-entree': () => mouvementForm('entree'),
  'gl-transfert': () => {
    const s = soldes();
    modal({
      title: 'Transfert entre comptes',
      body: `<p class="muted small" style="margin-bottom:12px">Ex. retrait Wave en espèces, ou dépôt d'espèces sur Wave. Le total de la caisse ne change pas.</p>
        <div class="row"><div class="field"><label>De</label><select id="tr-de">${Object.entries(COMPTES).map(([k, v]) => `<option value="${k}">${v.label} (${money(s[k])})</option>`).join('')}</select></div>
        <div class="field"><label>Vers</label><select id="tr-vers">${Object.entries(COMPTES).map(([k, v], i) => `<option value="${k}" ${i === 1 ? 'selected' : ''}>${v.label}</option>`).join('')}</select></div></div>
        <div class="row"><div class="field"><label>Montant *</label><input id="tr-m" type="number" min="1" step="1"></div><div class="field"><label>Frais (facultatif)</label><input id="tr-f" type="number" min="0" step="1" placeholder="0"></div></div>`,
      foot: `<button class="btn ghost" data-close>Annuler</button><button class="btn primary" id="tr-ok">Transférer</button>`,
      onMount: (el, close) => {
        $('#tr-ok', el).onclick = (e) => run(e.currentTarget, async () => {
          const de = $('#tr-de', el).value, vers = $('#tr-vers', el).value;
          const m = Math.round(Number($('#tr-m', el).value)), frais = Math.round(Number($('#tr-f', el).value) || 0);
          if (de === vers) throw new Error('Choisissez deux comptes différents.');
          if (!(m > 0)) throw new Error('Montant invalide.');
          const ref = 'tr-' + Date.now();
          await DB.insert('ecritures', { date: dayKey(), libelle: `Transfert vers ${compteLbl(vers)}`, type: 'sortie', categorie: 'transfert', compte: de, montant: m, ref });
          await DB.insert('ecritures', { date: dayKey(), libelle: `Transfert depuis ${compteLbl(de)}`, type: 'entree', categorie: 'transfert', compte: vers, montant: m, ref });
          if (frais > 0) await DB.insert('ecritures', { date: dayKey(), libelle: 'Frais de transfert', type: 'sortie', categorie: 'charges', compte: de, montant: frais, ref });
          close(); toast('Transfert enregistré'); await refreshAfter();
        });
      },
    });
  },
  'gl-csv': () => {
    downloadCSV(`caisse-noecy-${dayKey()}.csv`, [['Date', 'Libellé', 'Compte', 'Catégorie', 'Entrée', 'Sortie', 'Solde'],
      ...(A._glRows || []).map((e) => [e.date, e.libelle, compteLbl(e.compte), GL_CATS[e.categorie] || e.categorie, e.type === 'entree' ? e.montant : '', e.type === 'sortie' ? e.montant : '', e.solde])]);
  },
  'gl-suppr': async (el) => {
    const e0 = A.ecritures.find((x) => x.id === el.dataset.id);
    const lies = e0.categorie === 'transfert' && e0.ref ? A.ecritures.filter((x) => x.ref === e0.ref) : [e0];
    if (!(await confirmBox(lies.length > 1 ? 'Supprimer ce transfert (les deux mouvements) ?' : 'Supprimer ce mouvement ?', { ok: 'Supprimer', danger: true }))) return;
    await run(null, async () => { for (const x of lies) await DB.remove('ecritures', x.id); await refreshAfter(); });
  },
});

/* ---------- Crédits & dettes ---------- */
PAGES.relances = {
  title: 'Crédits & dettes',
  render() {
    const credits = A.commandes.filter((c) => c.statut === 'credit');
    const parClient = {};
    credits.forEach((c) => {
      const k = c.client_id || c.client_nom;
      const d = c.confirmed_at || c.created_at;
      const g = parClient[k] || (parClient[k] = { nom: c.client_nom, cl: client(c.client_id), cmds: [], du: 0, plusVieux: d });
      g.cmds.push(c); g.du += reste(c);
      if (d < g.plusVieux) g.plusVieux = d;
    });
    const groupes = Object.values(parClient).sort((a, b) => b.du - a.du);
    const dettes = A.commandes.filter((c) => nousDevons(c) > 0).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    return `
    <div class="page-head"><div><h1>Crédits & dettes</h1><p class="muted">Qui vous doit de l'argent, et à qui vous en devez.</p></div></div>
    <div class="kpis kpis-3">
      ${kpi('Les clients vous doivent', sum(groupes, 'du'), 'hand-coins', 'danger', true, `${groupes.length} client(s)`, 0)}
      ${kpi('Vous devez aux clients', sum(dettes, nousDevons), 'undo-2', 'caramel', true, `${dettes.length} commande(s)`, 1)}
      ${kpi('Commandes à crédit', credits.length, 'receipt', '', false, 'Rappel automatique chaque jour', 2)}
    </div>
    <div class="card-head"><h3>Ils vous doivent</h3></div>
    ${groupes.length ? `<div class="cards" style="margin-bottom:28px">${groupes.map((g, i) => {
      const j = daysSince(g.plusVieux);
      const k = esc(g.cl?.id || g.nom);
      return `<div class="client-card" style="--i:${i}">
        <div class="ch"><span class="avatar">${esc(initials(g.nom))}</span><div class="nm"><b>${esc(g.nom)}</b><span class="small muted">${g.cl?.telephone ? esc(g.cl.telephone) : 'Pas de téléphone'}</span></div>
          <span class="pill ${j >= 7 ? 'bad' : j >= 3 ? 'warn' : 'info'}">${ic('clock')} ${j} j</span></div>
        <div class="big-amount">${money(g.du)}</div>
        <ul class="oc-lines">${g.cmds.map((c) => `<li><span>${esc(c.numero)} · ${fDate(c.confirmed_at || c.created_at)}</span><span>reste ${money(reste(c))}</span></li>`).join('')}</ul>
        <div class="oc-actions">
          ${g.cl ? `<button class="btn leaf sm" data-act="cli-rembourser" data-id="${esc(g.cl.id)}">${ic('banknote')} Remboursement reçu</button>` : g.cmds.map((c) => `<button class="btn leaf sm" data-act="cmd-encaisser" data-id="${esc(c.id)}">${ic('banknote')} Encaisser ${esc(c.numero)}</button>`).join('')}
          ${g.cl && DB.mode !== 'local' ? `<button class="btn soft sm" data-act="rel-push" data-id="${esc(g.cl.id)}" title="Notification sur son téléphone">${ic('bell-ring')} Notifier</button>` : ''}
          ${g.cl?.telephone ? `<a class="btn ghost sm" href="${esc(relanceLink({ ...g.cmds[0], statut: 'credit', total: g.du, montant_paye: 0, rendu: 0, numero: g.cmds.map((c) => c.numero).join(', ') }, g.cl))}" target="_blank" rel="noopener">${ic('message-circle')} WhatsApp</a>` : ''}
          <button class="btn ghost sm" data-act="rel-copy" data-k="${k}" title="Copier le message">${ic('copy')}</button>
        </div></div>`;
    }).join('')}</div>` : `<div class="card" style="margin-bottom:28px"><div class="empty" style="padding:30px"><span class="big">${ic('party-popper')}</span><h3>Aucun crédit en cours</h3><p>Tout le monde est à jour !</p></div></div>`}
    <div class="card-head"><h3>Vous leur devez</h3><span class="small muted">Monnaie non rendue, avances, remboursements</span></div>
    ${dettes.length ? `<div class="cards">${dettes.map((c, i) => {
      const ar = aRendre(c), pp = prepaye(c);
      return `<div class="client-card owe" style="--i:${i}">
        <div class="ch"><span class="avatar">${esc(initials(c.client_nom))}</span><div class="nm"><b>${esc(c.client_nom)}</b><span class="small muted">${esc(c.numero)} · ${fDate(c.created_at)}</span></div>${pillCmd(c.statut)}</div>
        <div class="big-amount owe">${money(ar + pp)}</div>
        <p class="small">${ar > 0 ? (c.statut === 'annulee' ? 'Commande annulée déjà payée : argent à rembourser.' : 'Monnaie non rendue / trop perçu.') : `Avance reçue pour une marchandise pas encore remise${c.date_reservation ? ` (prévue le ${fDate(c.date_reservation)})` : ''}.`}</p>
        <div class="oc-actions">
          ${ar > 0 ? `<button class="btn mango sm" data-act="cmd-rendre" data-id="${esc(c.id)}">${ic('undo-2')} Rendre l'argent</button>` : `<button class="btn leaf sm" data-act="cmd-livrer" data-id="${esc(c.id)}">${ic('check')} Remettre la marchandise</button>`}
        </div></div>`;
    }).join('')}</div>` : `<div class="card"><p class="muted">Vous ne devez rien à personne.</p></div>`}`;
  },
};

function messageRelance(clientKey) {
  const cmds = A.commandes.filter((c) => c.statut === 'credit' && (c.client_id === clientKey || c.client_nom === clientKey));
  const du = sum(cmds, reste);
  const msg = (SETTINGS.message_relance || '').replace(/\{nom\}/g, cmds[0]?.client_nom || '').replace(/\{montant\}/g, money(du)).replace(/\{numero\}/g, cmds.map((c) => c.numero).join(', '));
  return { msg, du };
}

Object.assign(ACT, {
  'rel-copy': (el) => {
    const { msg, du } = messageRelance(el.dataset.k);
    const wl = waveLink(du);
    const txt = msg + (wl ? `\n\nPaiement Wave : ${wl}` : '');
    (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => toast('Message copié'), () => toast(txt, 'info', 8000));
  },
  'rel-push': (el) => run(el, async () => {
    const { msg } = messageRelance(el.dataset.id);
    const r = await DB.sendPush({ cible: 'client', client_id: el.dataset.id, titre: `Rappel ${A.boutique.nom}`, corps: msg, url: '/', tag: 'rappel' });
    toast(r && r.envoyes ? 'Notification envoyée' : "Ce client n'a pas activé les notifications : utilisez WhatsApp.", r && r.envoyes ? 'ok' : 'warn', 5000);
  }),
});

/* ---------- Paramètres ---------- */
PAGES.parametres = {
  title: 'Paramètres',
  render() {
    const s = SETTINGS;
    return `
    <div class="page-head"><div><h1>Paramètres</h1><p class="muted">Boutique, paiement Wave, notifications, catégories et sauvegardes.</p></div></div>
    ${DB.mode === 'local' ? `<div class="note-box" style="margin-bottom:16px">${ic('info')}<div><b>Mode local (démo).</b> Les données sont enregistrées uniquement dans ce navigateur : vos clients ne peuvent pas encore commander depuis leur téléphone. Suivez le fichier <b>README.md</b> pour passer en ligne.</div></div>`
      : `<div class="note-box ok" style="margin-bottom:16px">${ic('cloud')}<div><b>En ligne.</b> Vos données sont partagées avec la boutique en temps réel (Supabase).</div></div>`}
    <div class="settings-grid">
      <div class="card"><div class="card-head"><h3>Notifications</h3><span id="push-etat" class="pill">…</span></div>
        <p class="small muted" style="margin-bottom:12px">Recevez les nouvelles commandes et les nouveaux clients sur ce téléphone, même quand l'application est fermée. Chaque matin à 9 h : résumé du jour, et rappel automatique aux clients qui ont un crédit depuis plus d'un jour.</p>
        <div class="btn-row">
          <button class="btn primary sm" data-act="admin-push" id="push-btn">${ic('bell-ring')} Activer sur cet appareil</button>
          <button class="btn ghost sm" data-act="admin-push-test">${ic('send')} Tester</button>
          <button class="btn ghost sm" data-act="admin-guide">${ic('circle-help')} Guide</button>
          <button class="btn ghost sm" data-act="admin-notif-local">${ic('monitor')} Notifications du navigateur</button>
        </div>
        ${isIOS && !isStandalone() ? `<p class="note-box info small" style="margin-top:12px">${ic('smartphone')}<span>Sur iPhone : touchez <b>Partager</b> puis <b>« Sur l'écran d'accueil »</b>, ouvrez l'app depuis l'icône, puis revenez ici activer les notifications.</span></p>` : ''}
        ${DB.mode === 'local' ? '<p class="small muted" style="margin-top:10px">En mode local, seules les notifications du navigateur (onglet ouvert) sont possibles.</p>' : ''}
      </div>
      <div class="card"><div class="card-head"><h3>Ma ${estResto() ? 'page restaurant' : 'boutique'}</h3><span class="pill info">${estResto() ? 'Restaurant' : 'Vente de produits'}</span></div>
        <label class="dropzone" id="bq-dz"><div class="prev" id="bq-prev">${A.boutique.logo ? `<img src="${esc(A.boutique.logo)}" class="pv">` : ic('image')}</div>
          <div><b>Logo</b><p class="small muted">Image carrée de préférence (compressée automatiquement).</p>${A.boutique.logo ? '<button type="button" class="btn ghost sm" id="bq-rm" style="margin-top:6px">Retirer</button>' : ''}</div>
          <input type="file" accept="image/*" id="bq-file"></label>
        <div class="row" style="margin-top:12px"><div class="field"><label>Nom</label><input id="s-nom" maxlength="60" value="${esc(A.boutique.nom)}"></div>
          <div class="field"><label>Couleur principale</label><input type="color" id="bq-couleur" value="${esc(A.boutique.couleur || '#6d1b4f')}" class="color-big"></div></div>
        <div class="field"><label>Ville / quartier</label><input id="bq-ville" maxlength="60" value="${esc(A.boutique.ville || '')}"></div>
        <div class="field"><label>Présentation (affichée sur la vitrine)</label><textarea id="bq-desc" maxlength="400">${esc(A.boutique.description || '')}</textarea></div>
        <div class="field"><label>Lien à partager à vos clients</label><div class="copy-line"><input class="input" readonly value="${esc(lienBoutique(A.boutique.slug))}"><button type="button" class="btn soft sm" data-act="bq-copier">${ic('copy')} Copier</button></div></div>
      </div>
      <div class="card"><div class="card-head"><h3>Accès de la boutique</h3><span class="small muted">${A.me.super ? 'Réglables dans Plateforme → Boutiques' : 'Décidés par la plateforme'}</span></div>
        <div class="acces-liste">${OPTIONS_BQ.map(([k, l, d, i]) => `<div class="acces ${optionBq(A.boutique, k) ? 'on' : ''}"><span class="ac-ic">${ic(i)}</span><span><b>${l}</b><small>${d}</small></span><span class="pill ${optionBq(A.boutique, k) ? 'ok' : ''}">${optionBq(A.boutique, k) ? 'Activé' : 'Désactivé'}</span></div>`).join('')}</div>
        ${A.me.super ? `<button class="btn soft sm" style="margin-top:12px" data-act="pf-acces" data-id="${esc(A.boutique.id)}">${ic('sliders-horizontal')} Modifier les accès</button>` : ''}
      </div>
      <div class="card"><div class="card-head"><h3>Accueil & contact</h3></div>
        <div class="field"><label>Slogan (page d'accueil)</label><textarea id="s-slogan" maxlength="200">${esc(s.slogan)}</textarea></div>
        <div class="row"><div class="field"><label>WhatsApp de la boutique</label><input id="s-wa" type="tel" value="${esc(s.whatsapp)}" placeholder="77 123 45 67"></div>
        <div class="field"><label>Devise</label><input id="s-dev" value="${esc(s.devise)}" maxlength="8"></div></div>
        <div class="field"><label>Seuil d'alerte stock par défaut</label><input id="s-seuil" type="number" min="0" value="${esc(s.seuil_defaut)}"></div>
      </div>
      <div class="card"><div class="card-head"><h3>Paiement Wave & relances</h3></div>
        <div class="field"><label>Lien de paiement Wave</label><input id="s-wave" type="url" value="${esc(s.wave_lien)}" placeholder="https://pay.wave.com/m/M_xxxxx/c/sn/">
          <span class="hint">Dans l'app Wave Business : « Encaisser » → « Partager le lien ». Pour pré-remplir le montant, ajoutez <code>{montant}</code>, ex. <code>…/c/sn/?amount={montant}</code>.</span></div>
        ${s.wave_lien ? `<a class="btn wave sm" href="${esc(waveLink(1000))}" target="_blank" rel="noopener">Tester le lien (1 000)</a>` : ''}
        <div class="field" style="margin-top:14px"><label>Message de relance (notification et WhatsApp)</label><textarea id="s-rel">${esc(s.message_relance)}</textarea><span class="hint">Variables : {nom}, {montant}, {numero}. Le ton est libre, ex. « Ça dure hein, où est l'argent ? ».</span></div>
      </div>
      <div class="card"><div class="card-head"><h3>Catégories</h3><button class="btn soft sm" data-act="cat-add">${ic('plus')} Ajouter</button></div>
        <div id="cats">${A.categories.map((c) => `<div class="cat-row" data-id="${esc(c.id)}"><span class="cat-ic" style="--c:${esc(c.couleur || '#6d1b4f')}">${ic(c.icone || 'shopping-bag')}</span><select class="input" data-f="icone">${ICONES.map(([k, l]) => `<option value="${k}" ${k === c.icone ? 'selected' : ''}>${l}</option>`).join('')}</select><input class="input" data-f="nom" value="${esc(c.nom)}"><input type="color" data-f="couleur" value="${esc(c.couleur || '#6d1b4f')}"><button class="icon-btn flat" data-act="cat-suppr" data-id="${esc(c.id)}">${ic('trash-2')}</button></div>`).join('')}</div>
        <p class="hint small muted">Les catégories vides n'apparaissent pas dans la boutique.</p>
      </div>
      <div class="card"><div class="card-head"><h3>Sécurité & sauvegarde</h3></div>
        ${DB.mode === 'local' ? `<div class="row"><div class="field"><label>Ancien code</label><input id="s-pin0" type="password" inputmode="numeric" maxlength="8"></div><div class="field"><label>Nouveau code</label><input id="s-pin1" type="password" inputmode="numeric" maxlength="8"></div></div>
          <button class="btn ghost sm" data-act="pin-change">${ic('lock')} Changer le code</button><hr style="border:0;border-top:1px solid var(--line);margin:18px 0">` : ''}
        <p class="small muted" style="margin-bottom:10px">Téléchargez régulièrement une sauvegarde complète de vos données.</p>
        <div class="btn-row">
          <button class="btn ghost sm" data-act="backup">${ic('download')} Sauvegarder (JSON)</button>
          ${DB.mode === 'local' ? `<label class="btn ghost sm" style="cursor:pointer">${ic('upload')} Restaurer<input type="file" accept=".json,application/json" id="restore" hidden></label>` : ''}
        </div>
      </div>
    </div>
    <div class="save-bar"><button class="btn primary lg" data-act="settings-save">${ic('save')} Enregistrer les paramètres</button></div>`;
  },
  async after() {
    // Logo de la boutique
    A._logo = undefined;
    const fi = $('#bq-file');
    if (fi) {
      const poser = async (f) => { if (!f || !f.type.startsWith('image/')) return; try { A._logo = await compressImage(f, 320, 0.85); $('#bq-prev').innerHTML = `<img src="${A._logo}" class="pv">`; } catch (e) { toast(e.message, 'err'); } };
      fi.onchange = () => poser(fi.files[0]);
      const dz = $('#bq-dz');
      dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
      dz.addEventListener('dragleave', () => dz.classList.remove('over'));
      dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('over'); poser(e.dataTransfer.files[0]); });
      const rm = $('#bq-rm'); if (rm) rm.onclick = (e) => { e.preventDefault(); e.stopPropagation(); A._logo = null; $('#bq-prev').innerHTML = ic('image'); rm.remove(); icons(); };
    }
    $$('#cats .cat-row').forEach((row) => {
      const prev = $('.cat-ic', row);
      $('[data-f=icone]', row).onchange = (e) => { prev.innerHTML = ic(e.target.value); icons(); };
      $('[data-f=couleur]', row).oninput = (e) => prev.style.setProperty('--c', e.target.value);
    });
    const r = $('#restore');
    if (r) r.onchange = () => {
      const f = r.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = async () => {
        if (!(await confirmBox('Restaurer cette sauvegarde ? Les données actuelles de ce navigateur seront remplacées.', { ok: 'Restaurer', danger: true }))) return;
        await run(null, async () => { await DB.importAll(JSON.parse(rd.result)); toast('Sauvegarde restaurée'); await refreshAfter(); });
      };
      rd.readAsText(f);
    };
    const etat = $('#push-etat');
    if (etat) {
      const st = DB.pushDisponible() ? await pushState() : (('Notification' in window) && Notification.permission === 'granted' ? 'local' : 'unsupported');
      const lib = { on: ['Activées', 'ok'], off: ['Désactivées', ''], denied: ['Bloquées', 'bad'], unsupported: ['Non disponibles', ''], local: ['Navigateur seulement', 'info'] }[st];
      etat.textContent = lib[0]; etat.className = 'pill ' + lib[1];
      if (st === 'on') $('#push-btn').innerHTML = `${ic('refresh-cw')} Réactiver`;
      icons();
    }
  },
};

Object.assign(ACT, {
  'admin-push': (el) => run(el, async () => {
    if (!DB.pushDisponible()) throw new Error('Notifications push disponibles uniquement en mode en ligne.');
    const sub = await subscribePush();
    await DB.savePushAdmin(sub, 'admin');
    if (A.me.super) await DB.savePushAdmin(sub, 'super');
    toast('Notifications activées sur cet appareil');
    renderPage(false);
  }),
  'admin-guide': () => guideNotifications({ role: A.me.super && !A.boutique ? 'super' : 'gerant', activer: DB.pushDisponible() ? () => ACT['admin-push']($('[data-act="admin-push"]')) : null }),
  'admin-push-test': (el) => run(el, async () => {
    if (!DB.pushDisponible()) {
      if (('Notification' in window) && Notification.permission === 'granted') { await localNotify(A.boutique?.nom || PLATEFORME.nom || 'Notifications', 'Les notifications du navigateur fonctionnent.', '/admin.html'); return; }
      throw new Error('Activez d\'abord les notifications.');
    }
    const r = await DB.sendPush({ type: 'test' });
    toast(r && r.envoyes ? `Notification envoyée (${r.envoyes} appareil(s))` : 'Aucun appareil abonné : activez d\'abord les notifications.', r && r.envoyes ? 'ok' : 'warn');
  }),
  'admin-notif-local': (el) => run(el, async () => {
    if (!('Notification' in window)) throw new Error('Ce navigateur ne gère pas les notifications.');
    const p = await Notification.requestPermission();
    if (p !== 'granted') throw new Error('Notifications refusées par le navigateur.');
    await localNotify(A.boutique?.nom || PLATEFORME.nom || 'Notifications', 'Vous serez prévenue tant que l\'onglet reste ouvert.', '/admin.html');
    renderPage(false);
  }),
  'settings-save': (el) => run(el, async () => {
    const s = {
      nom_boutique: $('#s-nom').value.trim() || A.boutique.nom,
      slogan: $('#s-slogan').value.trim(),
      whatsapp: $('#s-wa').value.trim(),
      devise: $('#s-dev').value.trim() || 'FCFA',
      seuil_defaut: Math.max(0, parseInt($('#s-seuil').value, 10) || 0),
      wave_lien: $('#s-wave').value.trim(),
      message_relance: $('#s-rel').value.trim(),
    };
    if (s.wave_lien && !/^https?:\/\//i.test(s.wave_lien)) throw new Error('Le lien Wave doit commencer par https://');
    await DB.saveSettings(s);
    // Fiche publique de la boutique (vitrine)
    const fiche = { nom: s.nom_boutique, couleur: $('#bq-couleur').value, ville: $('#bq-ville').value.trim(), description: $('#bq-desc').value.trim() };
    if (A._logo !== undefined) fiche.logo = A._logo;
    A.boutique = await DB.majBoutique(A.boutique.id, fiche);
    A._logo = undefined;
    renderShell();
    for (const row of $$('#cats .cat-row')) {
      const c = A.categories.find((x) => x.id === row.dataset.id);
      const patch = { icone: $('[data-f=icone]', row).value || 'shopping-bag', nom: $('[data-f=nom]', row).value.trim() || 'Catégorie', couleur: $('[data-f=couleur]', row).value };
      if (c && (c.icone !== patch.icone || c.nom !== patch.nom || c.couleur !== patch.couleur)) await DB.update('categories', c.id, patch);
    }
    toast('Paramètres enregistrés');
    await refreshAfter();
  }),
  'bq-copier': () => {
    const l = lienBoutique(A.boutique.slug);
    (navigator.clipboard ? navigator.clipboard.writeText(l) : Promise.reject()).then(() => toast('Lien copié'), () => toast(l, 'info', 8000));
  },
  'cat-add': (el) => run(el, async () => {
    await DB.insert('categories', { nom: 'Nouvelle catégorie', icone: 'shopping-bag', couleur: '#a02a6e', ordre: A.categories.length + 1 });
    await refreshAfter();
  }),
  'cat-suppr': async (el) => {
    const c = A.categories.find((x) => x.id === el.dataset.id);
    const n = A.produits.filter((p) => p.categorie_id === c.id).length;
    if (n) return toast(`${n} produit(s) utilisent cette catégorie : changez-les d'abord.`, 'warn', 4500);
    if (!(await confirmBox(`Supprimer la catégorie <b>${esc(c.nom)}</b> ?`, { ok: 'Supprimer', danger: true }))) return;
    await run(null, async () => { await DB.remove('categories', c.id); await refreshAfter(); });
  },
  'pin-change': (el) => run(el, async () => {
    const n = $('#s-pin1').value.trim();
    if (!/^\d{4,8}$/.test(n)) throw new Error('Le nouveau code doit contenir 4 à 8 chiffres.');
    await DB.changePin($('#s-pin0').value.trim(), n);
    $('#s-pin0').value = ''; $('#s-pin1').value = '';
    toast('Code modifié');
  }),
  'backup': (el) => run(el, async () => {
    const data = await DB.exportAll();
    downloadFile(`noecy-sauvegarde-${dayKey()}.json`, JSON.stringify(data, null, 2), 'application/json');
  }),
});
