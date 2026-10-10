/*
 * Plateforme — restaurants : menu du jour (plats, portions, visibilité, publication),
 * préparation en cuisine et bilan de la journée
 */
'use strict';

A.f.menuDate = null;
const menuDu = (d) => A.menus.find((m) => m.date === d) || null;
const itemsDu = (m) => (m ? A.menu_items.filter((i) => i.menu_id === m.id).sort((a, b) => (a.ordre || 0) - (b.ordre || 0)) : []);
const restantItem = (i) => (i.quantite === null || i.quantite === undefined || i.quantite === '' ? null : Math.max(0, Number(i.quantite) - (Number(i.reserve) || 0)));
const libJour = (k) => (k === dayKey() ? "Aujourd'hui" : k === DB.addDays(dayKey(), 1) ? 'Demain' : k === DB.addDays(dayKey(), -1) ? 'Hier' : toDate(k).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }));

PAGES.menu = {
  title: 'Menu du jour',
  render() {
    if (!A.v4) return `<div class="note-box">${ic('database')}<div><b>Mise à jour de la base requise.</b> Exécutez <code>supabase/migration_v4_plateforme.sql</code>.</div></div>`;
    const d = A.f.menuDate || (A.f.menuDate = dayKey());
    const m = menuDu(d);
    const items = itemsDu(m);
    const deja = new Set(items.map((i) => i.produit_id));
    const disponibles = A.produits.filter((p) => p.actif && !deja.has(p.id));
    const cmds = A.commandes.filter((c) => (c.menu_date || '') === d && c.statut !== 'annulee');
    const precedent = A.menus.filter((x) => x.date < d && itemsDu(x).length).sort((a, b) => b.date.localeCompare(a.date))[0];

    // Préparation : portions par plat selon l'étape des commandes
    const parPlat = {};
    cmds.forEach((c) => (c.lignes || []).forEach((l) => {
      const g = parPlat[l.produit_id] || (parPlat[l.produit_id] = { nom: l.nom, total: 0, prep: 0, pretes: 0, remises: 0 });
      const q = Number(l.quantite);
      g.total += q;
      if (c.statut === 'en_attente' || c.statut === 'preparation') g.prep += q;
      else if (c.statut === 'prete') g.pretes += q;
      else g.remises += q;
    }));
    const remis = cmds.filter(isLivree);

    const tete = `<div class="page-head"><div><h1>Menu du jour</h1><p class="muted">Composez le menu, fixez les portions disponibles, puis publiez : vos clients abonnés sont prévenus.</p></div></div>
      <div class="menu-nav">
        <button class="icon-btn" data-act="menu-jour" data-k="${DB.addDays(d, -1)}" title="Jour précédent">${ic('chevron-left')}</button>
        <label class="menu-date">${ic('calendar-days')}<b>${esc(libJour(d))}</b><span class="small muted">${fDate(d)}</span><input type="date" id="menu-date" value="${d}"></label>
        <button class="icon-btn" data-act="menu-jour" data-k="${DB.addDays(d, 1)}" title="Jour suivant">${ic('chevron-right')}</button>
        ${d !== dayKey() ? `<button class="btn ghost sm" data-act="menu-jour" data-k="${dayKey()}">Aujourd'hui</button>` : ''}
      </div>`;

    if (!m) {
      return tete + `<div class="card"><div class="empty" style="padding:34px 10px"><span class="big">${ic('utensils-crossed')}</span>
        <h3>Pas encore de menu pour ${esc(libJour(d).toLowerCase())}</h3><p>Créez-le à partir de vos plats, ou reprenez un menu précédent.</p>
        <div class="btn-row" style="justify-content:center;margin-top:16px">
          <button class="btn primary" data-act="menu-creer">${ic('plus')} Créer le menu</button>
          ${precedent ? `<button class="btn soft" data-act="menu-copier" data-src="${esc(precedent.id)}">${ic('copy')} Reprendre le menu du ${fDate(precedent.date)}</button>` : ''}
        </div>
        ${!A.produits.some((p) => p.actif) ? `<p class="small muted" style="margin-top:14px">Ajoutez d'abord vos plats dans « Plats & carte ».</p>` : ''}</div></div>`;
    }

    const totalPortions = sum(items.filter((i) => i.quantite !== null && i.quantite !== undefined), 'quantite');
    const totalReserve = sum(items, 'reserve');
    return tete + `
      <div class="menu-etat ${m.publie ? 'on' : ''}">
        <div class="me-ic">${ic(m.publie ? 'radio' : 'eye-off')}</div>
        <div class="me-txt"><b>${m.publie ? 'Menu en ligne' : 'Brouillon : pas encore visible par les clients'}</b>
          <span class="small">${m.publie ? `Publié ${m.publie_at ? 'à ' + toDate(m.publie_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : ''} · ${items.filter((i) => i.visible).length} plat(s) visible(s)` : `${items.length} plat(s) prêts à être publiés`}</span></div>
        <div class="btn-row">
          ${m.publie
            ? `${DB.pushDisponible() ? `<button class="btn soft sm" data-act="menu-renotif">${ic('bell-ring')} Prévenir à nouveau</button>` : ''}<button class="btn ghost sm" data-act="menu-retirer">${ic('eye-off')} Retirer</button>`
            : `<button class="btn primary" data-act="menu-publier" ${items.length ? '' : 'disabled'}>${ic('send')} Publier${DB.pushDisponible() ? ' et prévenir les clients' : ''}</button>`}
        </div>
      </div>
      <div class="field" style="margin:14px 0"><label>Message affiché avec le menu (facultatif)</label><input id="menu-note" maxlength="160" value="${esc(m.note || '')}" placeholder="Ex. Livraison à partir de 12h · Commandes jusqu'à 14h"></div>

      <div class="kpis">
        ${kpi('Commandes', cmds.length, 'receipt', '', false, `${cmds.filter((c) => c.statut === 'en_attente').length} à accepter`, 0, go('commandes', { f: 'en_attente' }))}
        ${kpi('Portions commandées', totalReserve, 'chef-hat', 'mango', false, totalPortions ? `${num(sum(items.filter((i) => restantItem(i) !== null), restantItem))} restante(s) sur les plats limités` : 'Portions sans limite', 1)}
        ${kpi('Encaissé (remis)', sum(remis, (c) => PAYE(c)), 'wallet', 'leaf', true, `${remis.length} commande(s) remise(s)`, 2)}
        ${kpi("Chiffre d'affaires", sum(cmds, 'total'), 'coins', 'caramel', true, 'Toutes commandes du jour', 3)}
      </div>

      <div class="card" style="margin-bottom:18px">
        <div class="card-head"><h3>Plats du menu</h3><span class="small muted">Laissez la quantité vide pour ne pas limiter</span></div>
        ${items.length ? `<div class="menu-items">${items.map((i, k) => {
          const p = prod(i.produit_id) || { nom: 'Plat supprimé', prix: 0 };
          const r = restantItem(i);
          const pct = i.quantite ? Math.min(100, ((i.reserve || 0) / i.quantite) * 100) : 0;
          return `<div class="mi ${i.visible ? '' : 'masque'} ${r === 0 ? 'epuise' : ''}" style="--i:${k}">
            <div class="thumb">${prodVisual(p)}</div>
            <div class="mi-info"><b>${esc(p.nom)}</b><span class="small muted">${money(p.prix)}</span>
              ${i.quantite ? `<div class="bar ${r === 0 ? 'bad' : r <= 3 ? 'warn' : 'leaf'}"><i style="width:${pct}%"></i></div>` : ''}</div>
            <div class="mi-qte"><small>Portions</small>
              <div class="stepper"><button type="button" data-act="mi-pas" data-id="${esc(i.id)}" data-d="-1">${ic('minus')}</button><input type="number" min="0" inputmode="numeric" data-qte="${esc(i.id)}" value="${i.quantite ?? ''}" placeholder="∞"><button type="button" data-act="mi-pas" data-id="${esc(i.id)}" data-d="1">${ic('plus')}</button></div></div>
            <div class="mi-stat"><small>Commandées</small><b>${num(i.reserve || 0)}</b></div>
            <div class="mi-stat"><small>Restantes</small><b class="${r === 0 ? 'amt-out' : ''}">${r === null ? '∞' : num(r)}</b></div>
            <label class="switch" title="Visible par les clients"><input type="checkbox" data-act="mi-visible" data-id="${esc(i.id)}" ${i.visible ? 'checked' : ''}><span></span></label>
            <button class="icon-btn flat" data-act="mi-suppr" data-id="${esc(i.id)}" title="Retirer du menu">${ic('trash-2')}</button>
          </div>`;
        }).join('')}</div>` : '<p class="muted">Aucun plat pour le moment : ajoutez-en ci-dessous.</p>'}
        ${disponibles.length ? `<div class="mi-ajout">
          <select id="mi-plat" class="input">${disponibles.map((p) => `<option value="${esc(p.id)}">${esc(p.nom)} · ${money(p.prix)}</option>`).join('')}</select>
          <input id="mi-q" class="input" type="number" min="0" inputmode="numeric" placeholder="Portions (∞)">
          <button class="btn soft" data-act="mi-ajout">${ic('plus')} Ajouter</button>
          ${disponibles.length > 1 ? `<button class="btn ghost" data-act="mi-tous">Tous les plats</button>` : ''}
        </div>` : (A.produits.some((p) => p.actif) ? '' : `<p class="small muted" style="margin-top:10px">Créez vos plats dans « Plats & carte ».</p>`)}
      </div>

      <div class="card">
        <div class="card-head"><h3>Préparation en cuisine</h3><span class="small muted">${esc(libJour(d))}</span></div>
        ${Object.keys(parPlat).length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Plat</th><th class="num">À préparer</th><th class="num">Prêtes</th><th class="num">Remises</th><th class="num">Total</th></tr></thead><tbody>
          ${Object.values(parPlat).sort((a, b) => b.prep - a.prep).map((g, k) => `<tr style="--i:${k}"><td><b>${esc(g.nom)}</b></td><td class="num"><b class="${g.prep ? 'amt-out' : ''}">${num(g.prep)}</b></td><td class="num">${num(g.pretes)}</td><td class="num">${num(g.remises)}</td><td class="num">${num(g.total)}</td></tr>`).join('')}
        </tbody><tfoot><tr><td>Total</td><td class="num">${num(sum(Object.values(parPlat), 'prep'))}</td><td class="num">${num(sum(Object.values(parPlat), 'pretes'))}</td><td class="num">${num(sum(Object.values(parPlat), 'remises'))}</td><td class="num">${num(sum(Object.values(parPlat), 'total'))}</td></tr></tfoot></table></div>`
        : '<p class="muted">Aucune commande pour ce jour.</p>'}
      </div>`;
  },
  after() {
    const di = $('#menu-date'); if (di) di.onchange = () => { if (di.value) { A.f.menuDate = di.value; renderPage(false); } };
    const note = $('#menu-note');
    if (note) note.onchange = () => run(null, async () => { await DB.update('menus', menuDu(A.f.menuDate).id, { note: note.value.trim() }); toast('Message enregistré'); await refreshAfter(); });
    $$('[data-qte]').forEach((inp) => {
      inp.onchange = () => run(null, async () => {
        const i = A.menu_items.find((x) => x.id === inp.dataset.qte);
        let q = inp.value === '' ? null : Math.max(0, parseInt(inp.value, 10) || 0);
        if (q !== null && q < (i.reserve || 0)) { toast(`${i.reserve} portion(s) déjà commandées : minimum ${i.reserve}.`, 'warn'); q = i.reserve; }
        await DB.update('menu_items', i.id, { quantite: q });
        await refreshAfter();
      });
    });
  },
};

Object.assign(ACT, {
  'menu-jour': (el) => { A.f.menuDate = el.dataset.k; renderPage(false); },
  'menu-creer': (el) => run(el, async () => {
    await DB.insert('menus', { date: A.f.menuDate, publie: false, note: '' });
    toast('Menu créé : ajoutez vos plats'); await refreshAfter();
  }),
  'menu-copier': (el) => run(el, async () => {
    const src = A.menus.find((m) => m.id === el.dataset.src);
    const m = await DB.insert('menus', { date: A.f.menuDate, publie: false, note: src.note || '' });
    for (const i of itemsDu(src)) {
      if (!prod(i.produit_id)?.actif) continue;
      await DB.insert('menu_items', { menu_id: m.id, produit_id: i.produit_id, quantite: i.quantite ?? null, reserve: 0, visible: i.visible, ordre: i.ordre || 0 });
    }
    toast(`Menu du ${fDate(src.date)} repris`); await refreshAfter();
  }),
  'mi-ajout': (el) => run(el, async () => {
    const m = menuDu(A.f.menuDate);
    const pid = $('#mi-plat').value, qv = $('#mi-q').value;
    await DB.insert('menu_items', { menu_id: m.id, produit_id: pid, quantite: qv === '' ? null : Math.max(0, parseInt(qv, 10) || 0), reserve: 0, visible: true, ordre: itemsDu(m).length });
    await refreshAfter();
  }),
  'mi-tous': (el) => run(el, async () => {
    const m = menuDu(A.f.menuDate);
    const deja = new Set(itemsDu(m).map((i) => i.produit_id));
    let n = itemsDu(m).length;
    for (const p of A.produits.filter((x) => x.actif && !deja.has(x.id))) {
      await DB.insert('menu_items', { menu_id: m.id, produit_id: p.id, quantite: null, reserve: 0, visible: true, ordre: n++ });
    }
    await refreshAfter();
  }),
  'mi-pas': (el) => run(null, async () => {
    const i = A.menu_items.find((x) => x.id === el.dataset.id);
    const base = i.quantite === null || i.quantite === undefined ? (i.reserve || 0) : Number(i.quantite);
    const q = Math.max(i.reserve || 0, base + Number(el.dataset.d));
    await DB.update('menu_items', i.id, { quantite: q });
    await refreshAfter();
  }),
  'mi-visible': (el) => {
    setTimeout(() => run(null, async () => {
      await DB.update('menu_items', el.dataset.id, { visible: el.checked });
      toast(el.checked ? 'Plat visible par les clients' : 'Plat masqué');
      await refreshAfter();
    }));
  },
  'mi-suppr': async (el) => {
    const i = A.menu_items.find((x) => x.id === el.dataset.id);
    const p = prod(i.produit_id);
    if (!(await confirmBox(`Retirer <b>${esc(p?.nom || 'ce plat')}</b> du menu ?${i.reserve ? `<br><span class="small muted">${i.reserve} portion(s) déjà commandées restent dans les commandes.</span>` : ''}`, { ok: 'Retirer', danger: true }))) return;
    await run(null, async () => { await DB.remove('menu_items', i.id); await refreshAfter(); });
  },
  'menu-publier': (el) => run(el, async () => {
    const m = menuDu(A.f.menuDate);
    if (!itemsDu(m).some((i) => i.visible)) throw new Error('Ajoutez au moins un plat visible avant de publier.');
    await DB.update('menus', m.id, { publie: true, publie_at: m.publie_at || iso() });
    confetti();
    toast(DB.pushDisponible() ? 'Menu publié : vos clients abonnés sont prévenus' : 'Menu publié');
    await refreshAfter();
  }),
  'menu-retirer': async (el) => {
    if (!(await confirmBox('Retirer ce menu de la vente ? Les clients ne pourront plus commander dessus.', { ok: 'Retirer' }))) return;
    await run(el, async () => { await DB.update('menus', menuDu(A.f.menuDate).id, { publie: false }); toast('Menu retiré'); await refreshAfter(); });
  },
  'menu-renotif': (el) => run(el, async () => {
    const m = menuDu(A.f.menuDate);
    const plats = itemsDu(m).filter((i) => i.visible).map((i) => prod(i.produit_id)?.nom).filter(Boolean).join(', ');
    const r = await DB.sendPush({ cible: 'boutique_clients', titre: `${A.boutique.nom} : ${m.date === dayKey() ? 'le menu du jour est en ligne' : 'menu du ' + fDate(m.date)}`, corps: plats.slice(0, 160), url: `/?b=${A.boutique.slug}`, tag: 'menu-' + m.id });
    toast(r && r.envoyes ? `Notification envoyée à ${r.envoyes} appareil(s)` : 'Aucun client abonné pour le moment', r && r.envoyes ? 'ok' : 'warn');
  }),
});
