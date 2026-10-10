/*
 * Plateforme — pages de l'administrateur : vue d'ensemble, demandes de boutique,
 * toutes les boutiques, réglages (frais de création, lien Wave…)
 */
'use strict';

const STATUTS_BQ = {
  en_attente: ['En attente', 'warn', 'hourglass'],
  active: ['Active', 'ok', 'badge-check'],
  refusee: ['Refusée', 'bad', 'circle-x'],
  suspendue: ['Suspendue', 'bad', 'pause-circle'],
};
const pillBq = (s) => { const [l, c, i] = STATUTS_BQ[s] || [s, '', 'info']; return `<span class="pill ${c}">${ic(i)} ${l}</span>`; };
const bqById = (id) => A.toutes.find((b) => b.id === id);
A.statsPf = null;

PAGES.plateforme = {
  title: "Vue d'ensemble",
  render() {
    const bq = A.toutes;
    const actives = bq.filter((b) => b.statut === 'active');
    const attente = bq.filter((b) => b.statut === 'en_attente');
    const revenus = sum(bq.filter((b) => b.paiement_valide), 'paiement_montant');
    const st = A.statsPf || [];
    const stat = (id) => st.find((x) => x.id === id) || {};
    return `<div class="page-head"><div><h1>${esc(PLATEFORME.nom || 'Plateforme')}</h1><p class="muted">Toutes les boutiques et restaurants de la plateforme.</p></div>
      <a class="btn ghost" href="${urlBoutique()}" target="_blank" rel="noopener">${ic('external-link')} Voir la vitrine</a></div>
      ${attente.length ? `<div class="alerts"><div class="alert info"><span class="ai">${ic('inbox')}</span><span class="at"><b>${attente.length}</b> demande(s) de boutique à traiter.</span><button class="btn sm ghost" data-act="goto" data-page="demandes">Voir</button></div></div>` : ''}
      <div class="kpis">
        ${kpi('Boutiques actives', actives.length, 'store', '', false, `${actives.filter((b) => b.type === 'restaurant').length} restaurant(s)`, 0, go('boutiques'))}
        ${kpi('Demandes en attente', attente.length, 'inbox', 'mango', false, `${attente.filter((b) => b.paiement_valide).length} paiement(s) confirmé(s)`, 1, go('demandes'))}
        ${kpi('Frais de création encaissés', revenus, 'wallet', 'leaf', true, `${bq.filter((b) => b.paiement_valide).length} paiement(s) validé(s)`, 2)}
        ${kpi('Commandes (30 j)', sum(st, 'commandes'), 'receipt', 'caramel', false, `${money(sum(st, 'ca'))} de ventes`, 3)}
      </div>
      <div class="card-head"><h3>Activité des boutiques (30 derniers jours)</h3>${A.statsPf ? '' : '<span class="small muted">Chargement…</span>'}</div>
      ${actives.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Boutique</th><th class="hide-mobile">Type</th><th class="num">Commandes</th><th class="num">Ventes</th><th class="num hide-mobile">Clients</th><th class="num hide-mobile">Produits</th><th></th></tr></thead><tbody>
        ${actives.map((b, i) => { const s = stat(b.id); return `<tr style="--i:${i}"><td><div class="cell-prod">${logoBoutique(b)}<div><b>${esc(b.nom)}</b><br><span class="small muted">${esc(b.ville || '')}</span></div></div></td>
          <td class="hide-mobile">${b.type === 'restaurant' ? 'Restaurant' : 'Boutique'}</td><td class="num">${num(s.commandes || 0)}</td><td class="num">${money(s.ca || 0)}</td>
          <td class="num hide-mobile">${num(s.clients || 0)}</td><td class="num hide-mobile">${num(s.produits || 0)}</td>
          <td class="num"><button class="btn soft sm" data-act="pf-gerer" data-id="${esc(b.id)}">${ic('settings-2')} Gérer</button></td></tr>`; }).join('')}
      </tbody></table></div>` : '<p class="muted">Aucune boutique active pour le moment.</p>'}`;
  },
  async after() {
    if (A.statsPf) return;
    try { A.statsPf = await DB.statsPlateforme(); if (A.page === 'plateforme') renderPage(false); } catch (e) { A.statsPf = []; }
  },
};

function carteDemande(b, i) {
  const id = esc(b.id);
  return `<div class="client-card demande ${b.statut}" style="--i:${i}">
    <div class="ch">${logoBoutique(b)}<div class="nm"><b>${esc(b.nom)}</b><span class="small muted">${b.type === 'restaurant' ? 'Restaurant' : 'Vente de produits'}${b.ville ? ' · ' + esc(b.ville) : ''} · ${fDate(b.created_at)}</span></div>${pillBq(b.statut)}</div>
    ${b.description ? `<p class="small" style="color:var(--ink2)">${esc(b.description)}</p>` : ''}
    <div class="cstats">
      <div><small>Responsable</small><b>${esc(b.responsable || '—')}</b></div>
      <div><small>Téléphone</small><b>${esc(b.telephone || '—')}</b></div>
      <div><small>E-mail</small><b class="small">${esc(b.email || '—')}</b></div>
    </div>
    <div class="pay-check ${b.paiement_valide ? 'ok' : ''}">
      <span class="pc-ic">${ic(b.paiement_valide ? 'badge-check' : 'receipt')}</span>
      <div style="flex:1;min-width:0"><b>${money(b.paiement_montant)}</b> · réf. <b>${esc(b.paiement_ref || '—')}</b>
        <span class="small muted" style="display:block">${b.paiement_valide ? `Paiement confirmé le ${fDate(b.paiement_valide_at)}` : 'Vérifiez ce paiement dans votre application Wave.'}</span></div>
      <label class="switch" title="Paiement reçu"><input type="checkbox" data-act="pf-paye" data-id="${id}" ${b.paiement_valide ? 'checked' : ''}><span></span></label>
    </div>
    ${b.motif_refus ? `<p class="small" style="color:var(--danger)">Motif du refus : ${esc(b.motif_refus)}</p>` : ''}
    <div class="oc-actions">
      ${b.statut !== 'active' ? `<button class="btn leaf sm main" data-act="pf-valider" data-id="${id}" ${b.paiement_valide ? '' : 'disabled title="Confirmez d\'abord le paiement"'}>${ic('check')} Valider et mettre en ligne</button>` : ''}
      ${b.telephone ? `<a class="btn ghost sm" href="${esc(waLink(b.telephone, `Bonjour ${b.responsable || ''}, à propos de votre boutique « ${b.nom} » sur ${PLATEFORME.nom || 'la plateforme'} :`))}" target="_blank" rel="noopener">${ic('message-circle')} WhatsApp</a>` : ''}
      ${b.statut === 'en_attente' ? `<button class="btn ghost sm" data-act="pf-refuser" data-id="${id}">${ic('x')} Refuser</button>` : ''}
    </div>
  </div>`;
}

PAGES.demandes = {
  title: 'Demandes de boutique',
  render() {
    const attente = A.toutes.filter((b) => b.statut === 'en_attente').sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    const refusees = A.toutes.filter((b) => b.statut === 'refusee');
    return `<div class="page-head"><div><h1>Demandes de boutique</h1><p class="muted">Vérifiez le paiement des frais de création (${money(PLATEFORME.prix_creation || 0)}), puis validez : la boutique est mise en ligne et son gérant accède à son espace.</p></div></div>
      ${attente.length ? `<div class="cards">${attente.map(carteDemande).join('')}</div>`
        : `<div class="card"><div class="empty" style="padding:34px"><span class="big">${ic('inbox')}</span><h3>Aucune demande en attente</h3><p>Partagez le lien de création : <b>${esc(urlBoutique())}#/creer</b></p></div></div>`}
      ${refusees.length ? `<div class="card-head" style="margin-top:26px"><h3>Demandes refusées</h3></div><div class="cards">${refusees.map(carteDemande).join('')}</div>` : ''}`;
  },
};

PAGES.boutiques = {
  title: 'Boutiques',
  render() {
    const q = norm(A.f.q);
    const f = A.f.bqStatut || 'tous';
    const list = A.toutes.filter((b) => f === 'tous' || b.statut === f).filter((b) => !q || norm(`${b.nom} ${b.ville || ''} ${b.email || ''}`).includes(q));
    return `<div class="page-head"><div><h1>Boutiques</h1><p class="muted">Gérez n'importe quelle boutique, suspendez-la ou réactivez-la.</p></div></div>
      <div class="toolbar">
        <div class="seg scroll">${[['tous', 'Toutes'], ['active', 'Actives'], ['en_attente', 'En attente'], ['suspendue', 'Suspendues'], ['refusee', 'Refusées']].map(([k, l]) => { const n = k === 'tous' ? A.toutes.length : A.toutes.filter((b) => b.statut === k).length; return `<button class="${f === k ? 'on' : ''}" data-act="pf-filtre" data-k="${k}">${l}${n ? `<span class="count">${n}</span>` : ''}</button>`; }).join('')}</div>
        <label class="search field" style="margin:0">${ic('search')}<input class="input" placeholder="Nom, ville, e-mail…" data-inp="adm-q" value="${esc(A.f.q)}"></label>
      </div>
      <div class="cards">${list.map((b, i) => `<div class="client-card" style="--i:${i}">
        <div class="ch">${logoBoutique(b)}<div class="nm"><b>${esc(b.nom)}</b><span class="small muted">${b.type === 'restaurant' ? 'Restaurant' : 'Boutique'} · /?b=${esc(b.slug)}</span></div>${pillBq(b.statut)}</div>
        <div class="small muted">${esc(b.email || '')}${b.telephone ? ' · ' + esc(b.telephone) : ''}${b.validee_at ? ` · en ligne depuis le ${fDate(b.validee_at)}` : ''}</div>
        <div class="droits-chips">${OPTIONS_BQ.map(([k, l]) => `<span class="pill ${optionBq(b, k) ? 'ok' : ''}">${optionBq(b, k) ? ic('check') : ic('x')} ${l}</span>`).join('')}</div>
        <div class="oc-actions">
          ${b.statut === 'active' || b.statut === 'suspendue' ? `<button class="btn soft sm" data-act="pf-gerer" data-id="${esc(b.id)}">${ic('settings-2')} Gérer</button>` : ''}
          ${b.statut === 'active' ? `<a class="btn ghost sm" href="${esc(lienBoutique(b.slug))}" target="_blank" rel="noopener">${ic('external-link')}</a>` : ''}
          <button class="btn ghost sm" data-act="pf-acces" data-id="${esc(b.id)}">${ic('sliders-horizontal')} Accès</button>
          ${b.statut === 'active' ? `<button class="btn ghost sm" data-act="pf-statut" data-id="${esc(b.id)}" data-s="suspendue">${ic('pause')} Suspendre</button>` : ''}
          ${b.statut === 'suspendue' ? `<button class="btn leaf sm" data-act="pf-statut" data-id="${esc(b.id)}" data-s="active">${ic('play')} Réactiver</button>` : ''}
          ${b.statut === 'en_attente' || b.statut === 'refusee' ? `<button class="btn ghost sm" data-act="goto" data-page="demandes">${ic('inbox')} Voir la demande</button>` : ''}
        </div></div>`).join('') || `<div class="empty"><span class="big">${ic('store')}</span><h3>Aucune boutique</h3></div>`}</div>`;
  },
};

PAGES.reglages = {
  title: 'Réglages de la plateforme',
  render() {
    const p = PLATEFORME;
    return `<div class="page-head"><div><h1>Réglages de la plateforme</h1><p class="muted">Nom affiché sur la vitrine, frais de création des boutiques et paiement.</p></div></div>
      <div class="settings-grid">
        <div class="card"><div class="card-head"><h3>Vitrine</h3></div>
          <div class="field"><label>Nom de la plateforme</label><input id="pf-nom" maxlength="40" value="${esc(p.nom || '')}"></div>
          <div class="field"><label>Slogan</label><textarea id="pf-slogan" maxlength="160">${esc(p.slogan || '')}</textarea></div>
          <div class="field"><label>WhatsApp de contact</label><input id="pf-wa" type="tel" value="${esc(p.whatsapp || '')}" placeholder="77 123 45 67"></div>
        </div>
        <div class="card"><div class="card-head"><h3>Création de boutique</h3></div>
          <div class="row"><div class="field"><label>Frais de création</label><input id="pf-prix" type="number" min="0" step="500" value="${esc(p.prix_creation ?? 0)}"></div>
            <div class="field"><label>Devise</label><input id="pf-devise" maxlength="8" value="${esc(p.devise || 'FCFA')}"></div></div>
          <div class="field"><label>Lien de paiement Wave</label><input id="pf-wave" type="url" value="${esc(p.wave_lien || '')}" placeholder="https://pay.wave.com/m/…?amount={montant}">
            <span class="hint">Affiché sur la page « Créer ma boutique ». <code>{montant}</code> est remplacé par les frais de création.</span></div>
          <p class="small muted">Lien à partager aux futurs commerçants : <b>${esc(urlBoutique())}#/creer</b></p>
        </div>
        <div class="card"><div class="card-head"><h3>Notifications</h3></div>
          <p class="small muted" style="margin-bottom:12px">Soyez prévenu(e) à chaque nouvelle demande de boutique, même application fermée.</p>
          <button class="btn primary sm" data-act="pf-push">${ic('bell-ring')} Activer sur cet appareil</button>
        </div>
      </div>
      <div class="save-bar"><button class="btn primary lg" data-act="pf-sauver">${ic('save')} Enregistrer</button></div>`;
  },
};

async function rechargerPlateforme() {
  A.toutes = await DB.toutesBoutiques();
  A.me = await DB.mesBoutiques().catch(() => A.me);
  A.statsPf = null;
  updateNav(); renderPage(false);
}

Object.assign(ACT, {
  'pf-gerer': (el) => run(null, async () => {
    stopAdmin();
    localStorage.setItem(LS_BQ_ADMIN, el.dataset.id);
    A.page = 'dashboard';
    history.replaceState(null, '', location.pathname + location.search + '#/admin');
    await startAdmin();
  }),
  'pf-filtre': (el) => { A.f.bqStatut = el.dataset.k; renderPage(false); },
  // Accès d'une boutique : validation des clients, crédit, livraison, points de vente
  'pf-acces': (el) => {
    const b = bqById(el.dataset.id) || (A.boutique?.id === el.dataset.id ? A.boutique : null);
    modal({
      title: `Accès de ${esc(b.nom)}`,
      body: `<p class="muted small" style="margin-bottom:12px">Ces réglages s'appliquent immédiatement à la boutique et à ses clients.</p>
        <div class="droits-list">${OPTIONS_BQ.filter(([k]) => k !== 'livraison' || b.type === 'restaurant').map(([k, l, d]) => `<label class="check toggle-line"><span class="switch"><input type="checkbox" data-opt="${k}" ${optionBq(b, k) ? 'checked' : ''}><span></span></span><span><b>${l}</b><br><span class="small muted">${d}</span></span></label>`).join('')}</div>`,
      foot: `<button class="btn ghost" data-close>Annuler</button><button class="btn primary" id="ac-ok">${ic('check')} Enregistrer</button>`,
      onMount: (m, close) => {
        $('#ac-ok', m).onclick = (e) => run(e.currentTarget, async () => {
          const options = { ...(b.options || {}) };
          $$('[data-opt]', m).forEach((c) => { options[c.dataset.opt] = c.checked; });
          const r = await DB.majBoutique(b.id, { options });
          if (A.boutique?.id === b.id) A.boutique = { ...A.boutique, ...r };
          close(); toast('Accès enregistrés');
          if (A.me.super) A.toutes = await DB.toutesBoutiques();
          renderShell(); renderPage(false);
        });
      },
    });
  },
  'pf-paye': (el) => {
    setTimeout(() => run(null, async () => {
      await DB.majBoutique(el.dataset.id, { paiement_valide: el.checked, paiement_valide_at: el.checked ? iso() : null });
      toast(el.checked ? 'Paiement confirmé : vous pouvez valider la boutique' : 'Paiement marqué comme non reçu');
      await rechargerPlateforme();
    }));
  },
  'pf-valider': (el) => run(el, async () => {
    const b = bqById(el.dataset.id);
    await DB.validerBoutique(b.id);
    confetti();
    toast(`${b.nom} est en ligne`);
    await rechargerPlateforme();
    if (b.telephone) {
      const msg = `Bonjour ${b.responsable || ''}, bonne nouvelle : votre ${b.type === 'restaurant' ? 'restaurant' : 'boutique'} « ${b.nom} » est en ligne sur ${PLATEFORME.nom || 'la plateforme'} !\n\nVotre page : ${lienBoutique(b.slug)}\nVotre espace de gestion : ${urlBoutique()}admin.html (avec votre e-mail et votre mot de passe).`;
      if (await confirmBox(`Prévenir ${esc(b.responsable || b.nom)} sur WhatsApp ?`, { ok: 'Envoyer le message' })) window.open(waLink(b.telephone, msg), '_blank', 'noopener');
    }
  }),
  'pf-refuser': (el) => {
    const b = bqById(el.dataset.id);
    modal({
      title: `Refuser « ${esc(b.nom)} » ?`,
      body: `<div class="field"><label>Motif (affiché au demandeur)</label><textarea id="pf-motif" maxlength="300" placeholder="Ex. Paiement introuvable, merci de nous contacter."></textarea></div>`,
      foot: `<button class="btn ghost" data-close>Annuler</button><button class="btn danger" id="pf-ref-ok">Refuser</button>`,
      onMount: (m, close) => {
        $('#pf-ref-ok', m).onclick = (e) => run(e.currentTarget, async () => {
          await DB.majBoutique(b.id, { statut: 'refusee', motif_refus: $('#pf-motif', m).value.trim() || null });
          close(); toast('Demande refusée'); await rechargerPlateforme();
        });
      },
    });
  },
  'pf-statut': async (el) => {
    const b = bqById(el.dataset.id), s = el.dataset.s;
    if (s === 'suspendue' && !(await confirmBox(`Suspendre <b>${esc(b.nom)}</b> ? Sa page n'est plus visible et son gérant n'a plus accès à son espace.`, { ok: 'Suspendre', danger: true }))) return;
    await run(null, async () => { await DB.majBoutique(b.id, { statut: s }); toast(s === 'active' ? 'Boutique réactivée' : 'Boutique suspendue'); await rechargerPlateforme(); });
  },
  'pf-sauver': (el) => run(el, async () => {
    const s = {
      nom: $('#pf-nom').value.trim() || 'Mon Marché', slogan: $('#pf-slogan').value.trim(), whatsapp: $('#pf-wa').value.trim(),
      prix_creation: Math.max(0, Math.round(+$('#pf-prix').value || 0)), devise: $('#pf-devise').value.trim() || 'FCFA', wave_lien: $('#pf-wave').value.trim(),
    };
    if (s.wave_lien && !/^https?:\/\//i.test(s.wave_lien)) throw new Error('Le lien Wave doit commencer par https://');
    await DB.savePlateforme(s);
    PLATEFORME = { ...PLATEFORME, ...s };
    toast('Réglages enregistrés');
    renderShell(); renderPage(false);
  }),
  'pf-push': (el) => run(el, async () => {
    if (!DB.pushDisponible()) throw new Error('Notifications disponibles uniquement en mode en ligne.');
    const sub = await subscribePush();
    await DB.savePushAdmin(sub, 'super');
    toast('Vous serez prévenu(e) des nouvelles demandes');
  }),
});
