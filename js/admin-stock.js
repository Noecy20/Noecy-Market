/*
^ * Plateforme — espace de gestion : produits, stock & achats, rentabilité
 */
'use strict';

const CAISSE_OPTS = (sel = 'especes') => `${Object.entries(COMPTES).map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>Payé en ${v.label.toLowerCase()}</option>`).join('')}<option value="" ${sel === '' ? 'selected' : ''}>Hors caisse (argent personnel, don…)</option>`;

/* ---------- Produits ---------- */
PAGES.produits = {
  title: 'Produits',
  render() {
    const q = norm(A.f.q);
    const list = A.produits.filter((p) => A.f.cat === 'tous' || p.categorie_id === A.f.cat).filter((p) => !q || norm(p.nom).includes(q))
      .sort((a, b) => (b.actif - a.actif) || a.nom.localeCompare(b.nom));
    return `
    <div class="page-head"><div><h1>Produits</h1><p class="muted">Ajoutez, modifiez et mettez en avant vos articles.</p></div>
      <button class="btn primary" data-act="prod-edit">${ic('plus')} Nouveau produit</button></div>
    <div class="toolbar">
      <div class="seg scroll"><button class="${A.f.cat === 'tous' ? 'on' : ''}" data-act="f-cat" data-k="tous">Tout</button>${A.categories.map((c) => `<button class="${A.f.cat === c.id ? 'on' : ''}" data-act="f-cat" data-k="${esc(c.id)}">${esc(c.nom)}</button>`).join('')}</div>
      <label class="search field" style="margin:0">${ic('search')}<input class="input" placeholder="Rechercher…" data-inp="adm-q" value="${esc(A.f.q)}"></label>
    </div>
    <div class="cards">${list.length ? list.map((p, i) => {
      const cat = catOf(p.categorie_id);
      const cu = suivi(p) ? avgCost(p.id) : 0;
      const marge = p.prix - cu;
      const mini = suivi(p)
        ? `<div><small>Stock</small><b style="color:${p.stock <= 0 ? 'var(--danger)' : p.stock <= seuilOf(p) ? '#b77400' : 'inherit'}">${p.stock}</b></div><div><small>Coût / unité</small><b>${cu ? money(cu) : '—'}</b></div><div><small>Marge / unité</small><b style="color:${cu ? (marge >= 0 ? 'var(--leaf)' : 'var(--danger)') : 'inherit'}">${cu ? money(marge) : '—'}</b></div>`
        : `<div><small>Stock</small><b>Non compté</b></div><div><small>Achats</small><b>${money(achatsVrac(p.id))}</b></div><div><small>Ventes</small><b>${money(ventesProduit(p.id).ca)}</b></div>`;
      return `<div class="ap-card ${p.actif ? '' : 'inactive'}" style="--i:${i}">
        <div class="media">${prodVisual(p)}<div class="tags">${cat ? `<span class="pill">${ic(cat.icone || 'shopping-bag', 'sm')} ${esc(cat.nom)}</span>` : ''}${suivi(p) ? '' : '<span class="pill info">En vrac</span>'}${p.actif ? '' : '<span class="pill">Masqué</span>'}</div></div>
        <div class="body">
          <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start"><h3>${esc(p.nom)}</h3><span class="price">${money(p.prix)}</span></div>
          <div class="mini">${mini}</div>
          <div class="acts">
            <label class="switch" title="Visible en boutique"><input type="checkbox" data-act="prod-toggle" data-id="${esc(p.id)}" ${p.actif ? 'checked' : ''}><span></span></label><span class="small muted" style="flex:1">${p.actif ? 'En boutique' : 'Masqué'}</span>
            <button class="icon-btn flat" data-act="prod-edit" data-id="${esc(p.id)}" title="Modifier">${ic('pencil')}</button>
            <button class="icon-btn flat" data-act="prod-suppr" data-id="${esc(p.id)}" title="Supprimer">${ic('trash-2')}</button>
          </div>
        </div></div>`;
    }).join('') : `<div class="empty"><span class="big">${ic('package')}</span><h3>Aucun produit</h3><p>Créez votre premier article.</p></div>`}</div>`;
  },
};

function ventesProduit(pid) {
  let q = 0, ca = 0;
  A.commandes.filter(isLivree).forEach((c) => (c.lignes || []).forEach((l) => { if (l.produit_id === pid) { q += Number(l.quantite); ca += l.prix * l.quantite; } }));
  return { q, ca };
}

Object.assign(ACT, {
  'f-cat': (el) => { A.f.cat = el.dataset.k; renderPage(false); },
  'prod-toggle': (el) => {
    setTimeout(() => run(null, async () => {
      const actif = el.checked;
      await DB.update('produits', el.dataset.id, { actif });
      toast(actif ? 'Produit visible en boutique' : 'Produit masqué');
      await refreshAfter();
    }));
  },
  'prod-edit': (el) => productForm(el.dataset.id ? prod(el.dataset.id) : null),
  'prod-suppr': async (el) => {
    const p = prod(el.dataset.id);
    const used = A.fabrications.some((f) => f.produit_id === p.id) || A.achats.some((a) => a.produit_id === p.id) || A.commandes.some((c) => (c.lignes || []).some((l) => l.produit_id === p.id));
    if (used) {
      if (await confirmBox(`<b>${esc(p.nom)}</b> a un historique (ventes, achats ou fabrications). Il est préférable de le <b>masquer</b> de la boutique pour garder vos statistiques.`, { ok: 'Masquer le produit' })) {
        await run(null, async () => { await DB.update('produits', p.id, { actif: false }); await refreshAfter(); });
      }
      return;
    }
    if (!(await confirmBox(`Supprimer <b>${esc(p.nom)}</b> ?`, { ok: 'Supprimer', danger: true }))) return;
    await run(null, async () => { await DB.remove('produits', p.id); toast('Produit supprimé'); await refreshAfter(); });
  },
});

function productForm(p) {
  const isNew = !p;
  // Restaurant : les plats ne sont pas comptés en stock (les portions se règlent dans le menu du jour)
  p = p || { nom: '', categorie_id: A.categories[0]?.id || '', prix: '', unite: '', description: '', photo: '', stock: 0, seuil_alerte: SETTINGS.seuil_defaut || 5, actif: true, suivi_stock: !estResto() };
  let photo = p.photo || '';
  modal({
    title: isNew ? (estResto() ? 'Nouveau plat' : 'Nouveau produit') : `Modifier · ${esc(p.nom)}`, size: 'wide',
    body: `<form id="pf" autocomplete="off">
      <label class="dropzone" id="pf-dz"><div class="prev" id="pf-prev">${photo ? `<img src="${esc(photo)}" class="pv">` : ic('camera')}</div>
        <div><b>Photo du produit</b><p class="small muted">Cliquez ou glissez une image (compressée automatiquement).</p>
        ${photo ? '<button type="button" class="btn ghost sm" id="pf-rm" style="margin-top:8px">Retirer la photo</button>' : ''}</div>
        <input type="file" accept="image/*" id="pf-file"></label>
      <div class="row" style="margin-top:14px">
        <div class="field"><label>Nom *</label><input id="pf-nom" required maxlength="80" value="${esc(p.nom)}" placeholder="Ex. Jus de Bissap"></div>
        <div class="field"><label>Catégorie</label><select id="pf-cat">${A.categories.map((c) => `<option value="${esc(c.id)}" ${c.id === p.categorie_id ? 'selected' : ''}>${esc(c.nom)}</option>`).join('')}</select></div>
      </div>
      <div class="row">
        <div class="field"><label>Prix de vente * (${esc(SETTINGS.devise)})</label><input id="pf-prix" type="number" min="0" step="1" required value="${esc(p.prix)}"></div>
        <div class="field"><label>Format / unité</label><input id="pf-unite" maxlength="40" value="${esc(p.unite || '')}" placeholder="Bouteille 50 cl, sachet…"></div>
      </div>
      <label class="check toggle-line"><span class="switch"><input type="checkbox" id="pf-suivi" ${suivi(p) ? 'checked' : ''}><span></span></span>
        <span><b>Compter le stock</b><br><span class="small muted">Désactivez pour les articles achetés en vrac et non comptés (ex. caramels) : le bénéfice = ventes − achats.</span></span></label>
      <div class="row" id="pf-stockbox">
        <div class="field"><label>Seuil d'alerte stock</label><input id="pf-seuil" type="number" min="0" step="1" value="${esc(p.seuil_alerte ?? 5)}"></div>
        ${isNew ? `<div class="field"><label>Stock initial</label><input id="pf-stock" type="number" min="0" step="1" value="0"><span class="hint">Mieux : « Stock & achats » → Fabrication.</span></div>` : '<div></div>'}
      </div>
      <div class="field"><label>Description</label><textarea id="pf-desc" maxlength="600" placeholder="Ingrédients, goût, conservation…">${esc(p.description || '')}</textarea></div>
      <label class="check"><span class="switch"><input type="checkbox" id="pf-actif" ${p.actif ? 'checked' : ''}><span></span></span> Visible dans la boutique</label>
    </form>`,
    foot: `<button class="btn ghost" data-close>Annuler</button><button class="btn primary" id="pf-ok">${ic('check')} Enregistrer</button>`,
    onMount: (el, close) => {
      const dz = $('#pf-dz', el), fi = $('#pf-file', el);
      const setPhoto = async (file) => {
        if (!file || !file.type.startsWith('image/')) return;
        try {
          photo = await compressImage(file);
          $('#pf-prev', el).innerHTML = `<img src="${photo}" class="pv">`;
        } catch (err) { toast(err.message, 'err'); }
      };
      fi.onchange = () => setPhoto(fi.files[0]);
      dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
      dz.addEventListener('dragleave', () => dz.classList.remove('over'));
      dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('over'); setPhoto(e.dataTransfer.files[0]); });
      const rm = $('#pf-rm', el);
      if (rm) rm.onclick = (e) => { e.preventDefault(); e.stopPropagation(); photo = ''; $('#pf-prev', el).innerHTML = ic('camera'); rm.remove(); icons(); };
      const syncSuivi = () => $('#pf-stockbox', el).classList.toggle('hidden', !$('#pf-suivi', el).checked);
      $('#pf-suivi', el).onchange = syncSuivi; syncSuivi();
      $('#pf-ok', el).onclick = (e) => run(e.currentTarget, async () => {
        const data = {
          nom: $('#pf-nom', el).value.trim(),
          categorie_id: $('#pf-cat', el).value || null,
          prix: Number($('#pf-prix', el).value),
          unite: $('#pf-unite', el).value.trim(),
          seuil_alerte: Math.max(0, parseInt($('#pf-seuil', el).value, 10) || 0),
          description: $('#pf-desc', el).value.trim(),
          actif: $('#pf-actif', el).checked,
          photo,
        };
        if (A.v2) data.suivi_stock = $('#pf-suivi', el).checked;
        if (data.nom.length < 2) throw new Error('Le nom est obligatoire.');
        if (!(data.prix >= 0) || $('#pf-prix', el).value === '') throw new Error('Indiquez un prix de vente.');
        if (isNew) {
          data.stock = data.suivi_stock === false ? 0 : Math.max(0, parseInt($('#pf-stock', el).value, 10) || 0);
          await DB.insert('produits', data);
        } else await DB.update('produits', p.id, data);
        close();
        toast(isNew ? 'Produit créé' : 'Produit mis à jour');
        await refreshAfter();
      });
    },
  });
}

/* ---------- Stock & achats ---------- */
const SUGG = {
  'cat-jus': ['Glace', 'Eau', 'Bouteilles', 'Gaz', 'Transport'],
  'cat-chips': ['Huile', 'Sachets', 'Gaz', 'Transport'],
  'cat-sucre': ['Emballages', 'Gaz', 'Transport'],
};
const coutUnitMat = (m) => (m && m.stock > 0 ? m.valeur / m.stock : 0);
const fmtQ = (n) => (Math.round(Number(n) * 100) / 100).toLocaleString('fr-FR');

PAGES.inventaire = {
  title: 'Stock & achats',
  render() {
    const tabs = [['produits', 'Produits'], ['matieres', 'Matières premières'], ['historique', 'Historique']];
    let corps = '';
    if (A.f.inv === 'matieres') corps = this.matieres();
    else if (A.f.inv === 'historique') corps = this.historique();
    else corps = this.produits();
    return `
    <div class="page-head"><div><h1>Stock & achats</h1><p class="muted">Achetez vos matières une fois, utilisez-les sur plusieurs fabrications : le coût de revient se calcule seul.</p></div>
      <div class="head-actions"><button class="btn ghost" data-act="achat-new">${ic('shopping-basket')} Achat</button><button class="btn primary" data-act="fab-new">${ic('factory')} Fabrication</button></div></div>
    <div class="toolbar"><div class="seg scroll">${tabs.map(([k, l]) => `<button class="${A.f.inv === k ? 'on' : ''}" data-act="f-inv" data-k="${k}">${l}</button>`).join('')}</div></div>
    ${corps}`;
  },
  produits() {
    const prods = A.produits.slice().sort((a, b) => (b.actif - a.actif) || (suivi(b) - suivi(a)) || (a.stock - seuilOf(a)) - (b.stock - seuilOf(b)));
    const comptes = prods.filter(suivi);
    return `<div class="table-wrap"><table class="tbl">
      <thead><tr><th>Produit</th><th>Stock</th><th class="hide-mobile">Niveau</th><th class="num">Coût / unité</th><th class="num hide-mobile">Valeur</th><th></th></tr></thead>
      <tbody>${prods.map((p, i) => {
        const id = esc(p.id);
        if (!suivi(p)) {
          return `<tr style="--i:${i};${p.actif ? '' : 'opacity:.55'}">
            <td><div class="cell-prod"><div class="thumb">${prodVisual(p)}</div><div><b>${esc(p.nom)}</b><br><span class="small muted">En vrac · non compté</span></div></div></td>
            <td><span class="pill info">Vrac</span></td><td class="hide-mobile"></td>
            <td class="num small muted">Achats ${money(achatsVrac(p.id))}</td><td class="num hide-mobile">—</td>
            <td class="num nowrap"><button class="btn soft sm" data-act="achat-new" data-produit="${id}">${ic('shopping-basket')} Achat</button></td></tr>`;
        }
        const s = seuilOf(p), lvl = Math.min(100, (p.stock / Math.max(1, s * 3)) * 100);
        const cls = p.stock <= 0 ? 'bad' : p.stock <= s ? 'warn' : 'leaf';
        return `<tr style="--i:${i};${p.actif ? '' : 'opacity:.55'}">
          <td><div class="cell-prod"><div class="thumb">${prodVisual(p)}</div><div><b>${esc(p.nom)}</b><br><span class="small muted">Seuil d'alerte : ${s}</span></div></div></td>
          <td><span class="stock-num" style="color:${cls === 'bad' ? 'var(--danger)' : cls === 'warn' ? '#b77400' : 'inherit'}">${p.stock}</span></td>
          <td class="hide-mobile"><div class="bar ${cls} stock-bar"><i style="width:${lvl}%"></i></div></td>
          <td class="num">${avgCost(p.id) ? money(avgCost(p.id)) : '—'}</td>
          <td class="num hide-mobile">${money(p.stock * p.prix)}</td>
          <td class="num nowrap"><button class="btn soft sm" data-act="fab-new" data-id="${id}">${ic('plus')} <span class="hide-sm">Fabriquer</span></button> <button class="btn ghost sm" data-act="stock-adj" data-id="${id}" title="Inventaire">${ic('clipboard-check')}</button></td>
        </tr>`;
      }).join('')}</tbody>
      <tfoot><tr><td>Total (produits comptés)</td><td>${num(sum(comptes, 'stock'))}</td><td class="hide-mobile"></td><td></td><td class="num hide-mobile">${money(sum(comptes, (p) => p.stock * p.prix))}</td><td></td></tr></tfoot>
    </table></div>`;
  },
  matieres() {
    if (!A.v2) return `<div class="card"><p class="muted">Disponible après la mise à jour de la base (migration v2).</p></div>`;
    const mats = A.matieres.slice().sort((a, b) => a.nom.localeCompare(b.nom));
    return `<div class="toolbar"><span class="grow small muted">${mats.length} matière(s) · valeur en stock ${money(sum(mats, 'valeur'))}</span><button class="btn soft" data-act="mat-edit">${ic('plus')} Nouvelle matière</button></div>
    ${mats.length ? `<div class="table-wrap"><table class="tbl">
      <thead><tr><th>Matière</th><th>Reste</th><th class="num">Coût / unité</th><th class="num hide-mobile">Valeur</th><th></th></tr></thead>
      <tbody>${mats.map((m, i) => {
        const bas = m.seuil > 0 && m.stock <= m.seuil;
        const id = esc(m.id);
        return `<tr style="--i:${i}">
          <td><b>${esc(m.nom)}</b>${bas ? ' <span class="pill warn">À racheter</span>' : ''}<br><span class="small muted">Unité : ${esc(m.unite || 'unité')}</span></td>
          <td><span class="stock-num" style="font-size:18px;color:${m.stock <= 0 ? 'var(--danger)' : bas ? '#b77400' : 'inherit'}">${fmtQ(m.stock)}</span> <span class="small muted">${esc(m.unite || '')}</span></td>
          <td class="num">${m.stock > 0 ? money(coutUnitMat(m)) : '—'}</td>
          <td class="num hide-mobile">${money(m.valeur)}</td>
          <td class="num nowrap"><button class="btn soft sm" data-act="achat-new" data-matiere="${id}">${ic('shopping-basket')} <span class="hide-sm">Acheter</span></button>
            <button class="icon-btn flat" data-act="mat-adj" data-id="${id}" title="Ajuster la quantité">${ic('clipboard-check')}</button>
            <button class="icon-btn flat" data-act="mat-edit" data-id="${id}" title="Modifier">${ic('pencil')}</button>
            <button class="icon-btn flat" data-act="mat-suppr" data-id="${id}" title="Supprimer">${ic('trash-2')}</button></td></tr>`;
      }).join('')}</tbody></table></div>`
      : `<div class="card"><div class="empty" style="padding:30px"><span class="big">${ic('wheat')}</span><h3>Aucune matière première</h3><p>Ajoutez ce que vous achetez pour fabriquer : sucre, fleurs de bissap, bananes, huile, bouteilles…</p><button class="btn primary" style="margin-top:14px" data-act="achat-new">${ic('shopping-basket')} Enregistrer un achat</button></div></div>`}`;
  },
  historique() {
    const fabs = A.fabrications.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.created_at).localeCompare(String(a.created_at)));
    const achats = A.achats.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.created_at).localeCompare(String(a.created_at)));
    return `
    <div class="card-head"><h3>Fabrications</h3><span class="small muted">${fabs.length} lot(s) · coût ${money(sum(fabs, 'cout_total'))}</span></div>
    ${fabs.length ? `<div class="table-wrap" style="margin-bottom:26px"><table class="tbl">
      <thead><tr><th>Date</th><th>Produit</th><th class="num">Qté</th><th>Utilisé / dépensé</th><th class="num">Coût</th><th class="num hide-mobile">Coût / u</th><th class="num">Bénéfice attendu</th><th></th></tr></thead>
      <tbody>${fabs.map((f, i) => {
        const p = prod(f.produit_id);
        const cu = f.quantite ? f.cout_total / f.quantite : 0;
        const ben = (p?.prix || 0) * f.quantite - f.cout_total;
        const det = [...(f.matieres || []).map((m) => `${esc(m.nom)} ${fmtQ(m.quantite)} ${esc(m.unite || '')} <span class="muted">(${num(m.cout)})</span>`), ...(f.depenses || []).map((d) => `${esc(d.libelle)} <span class="muted">(${num(d.montant)})</span>`)].join(', ');
        return `<tr style="--i:${i}"><td class="nowrap">${fDate(f.date)}</td><td><b>${esc(p?.nom || 'Produit supprimé')}</b></td><td class="num">${num(f.quantite)}</td>
          <td class="small">${det || '—'}</td><td class="num">${money(f.cout_total)}</td><td class="num hide-mobile">${money(cu)}</td>
          <td class="num ${ben >= 0 ? 'amt-in' : 'amt-out'}">${money(ben)}</td>
          <td class="num"><button class="icon-btn flat" data-act="fab-suppr" data-id="${esc(f.id)}" title="Supprimer">${ic('trash-2')}</button></td></tr>`;
      }).join('')}</tbody></table></div>` : `<p class="muted" style="margin-bottom:26px">Aucune fabrication enregistrée.</p>`}
    <div class="card-head"><h3>Achats</h3><span class="small muted">${achats.length} achat(s) · ${money(sum(achats, 'montant'))}</span></div>
    ${achats.length ? `<div class="table-wrap"><table class="tbl">
      <thead><tr><th>Date</th><th>Article</th><th class="num">Quantité</th><th class="num">Montant</th><th class="hide-mobile">Payé avec</th><th></th></tr></thead>
      <tbody>${achats.map((a, i) => {
        const m = matiere(a.matiere_id), p = prod(a.produit_id);
        return `<tr style="--i:${i}"><td class="nowrap">${fDate(a.date)}</td><td><b>${esc(m?.nom || p?.nom || 'Article supprimé')}</b>${p ? ' <span class="pill info">Revente</span>' : ''}${a.note ? `<br><span class="small muted">${esc(a.note)}</span>` : ''}</td>
          <td class="num">${a.quantite ? `${fmtQ(a.quantite)} ${esc(m?.unite || '')}` : '—'}</td><td class="num">${money(a.montant)}</td>
          <td class="hide-mobile">${a.compte ? `<span class="pill">${compteLbl(a.compte)}</span>` : '<span class="small muted">Hors caisse</span>'}</td>
          <td class="num"><button class="icon-btn flat" data-act="achat-suppr" data-id="${esc(a.id)}" title="Supprimer">${ic('trash-2')}</button></td></tr>`;
      }).join('')}</tbody></table></div>` : `<p class="muted">Aucun achat enregistré.</p>`}`;
  },
};

/* Achat : matière première ou produit acheté pour être revendu */
function achatForm({ matiereId = null, produitId = null } = {}) {
  if (!A.v2) return toast('Exécutez d\'abord la migration v2 de la base.', 'warn', 4500);
  let type = produitId ? 'revente' : 'matiere';
  const mats = A.matieres.slice().sort((a, b) => a.nom.localeCompare(b.nom));
  const prods = A.produits.filter((p) => p.actif || p.id === produitId);
  modal({
    title: 'Enregistrer un achat',
    body: `<div class="seg seg-full" id="ac-type" style="margin-bottom:14px">
        <button type="button" data-t="matiere" class="${type === 'matiere' ? 'on' : ''}">${ic('wheat')} Matière première</button>
        <button type="button" data-t="revente" class="${type === 'revente' ? 'on' : ''}">${ic('repeat')} Article à revendre</button></div>
      <div id="ac-mat">
        <div class="field"><label>Matière</label><select id="ac-m">${mats.map((m) => `<option value="${esc(m.id)}" ${m.id === matiereId ? 'selected' : ''}>${esc(m.nom)} (${esc(m.unite || 'unité')})</option>`).join('')}<option value="__new" ${mats.length ? '' : 'selected'}>+ Nouvelle matière…</option></select></div>
        <div class="row" id="ac-newbox"><div class="field"><label>Nom de la matière</label><input id="ac-nom" placeholder="Ex. Sucre"></div><div class="field"><label>Unité</label><input id="ac-unite" placeholder="kg, litre, sachet, bouteille…" value="kg"></div></div>
      </div>
      <div id="ac-rev" class="hidden">
        <div class="field"><label>Produit</label><select id="ac-p">${prods.map((p) => `<option value="${esc(p.id)}" ${p.id === produitId ? 'selected' : ''}>${esc(p.nom)}${suivi(p) ? '' : ' (vrac)'}</option>`).join('')}</select>
          <span class="hint" id="ac-p-hint"></span></div>
      </div>
      <div class="row">
        <div class="field"><label id="ac-q-lbl">Quantité achetée</label><input id="ac-q" type="number" min="0" step="any" inputmode="decimal" placeholder="Ex. 5"></div>
        <div class="field"><label>Prix payé (total) *</label><input id="ac-mt" type="number" min="0" step="1" inputmode="numeric" placeholder="Ex. 2000"></div>
      </div>
      <div class="row">
        <div class="field"><label>Payé avec</label><select id="ac-c">${CAISSE_OPTS()}</select></div>
        <div class="field"><label>Date</label><input id="ac-d" type="date" value="${dayKey()}"></div>
      </div>
      <div class="field"><label>Note</label><input id="ac-note" maxlength="200" placeholder="Fournisseur, marché… (facultatif)"></div>`,
    foot: `<button class="btn ghost" data-close>Annuler</button><button class="btn primary" id="ac-ok">${ic('check')} Enregistrer l'achat</button>`,
    onMount: (el, close) => {
      const sync = () => {
        $$('#ac-type button', el).forEach((b) => b.classList.toggle('on', b.dataset.t === type));
        $('#ac-mat', el).classList.toggle('hidden', type !== 'matiere');
        $('#ac-rev', el).classList.toggle('hidden', type !== 'revente');
        $('#ac-newbox', el).classList.toggle('hidden', $('#ac-m', el).value !== '__new');
        const p = prod($('#ac-p', el).value);
        const vrac = type === 'revente' && p && !suivi(p);
        $('#ac-q-lbl', el).textContent = type === 'revente' ? (vrac ? 'Quantité (facultatif)' : 'Nombre d\'unités achetées *') : 'Quantité achetée *';
        $('#ac-p-hint', el).textContent = type !== 'revente' || !p ? '' : vrac
          ? 'Article non compté : la dépense sera déduite des ventes pour calculer le bénéfice.'
          : `Les unités seront ajoutées au stock de ${p.nom}.`;
      };
      $('#ac-type', el).onclick = (e) => { const b = e.target.closest('[data-t]'); if (b) { type = b.dataset.t; sync(); } };
      $('#ac-m', el).onchange = sync; $('#ac-p', el).onchange = sync;
      sync();
      $('#ac-ok', el).onclick = (e) => run(e.currentTarget, async () => {
        const q = Number($('#ac-q', el).value) || 0;
        const mt = Math.round(Number($('#ac-mt', el).value) || 0);
        const compte = $('#ac-c', el).value || null;
        const date = $('#ac-d', el).value || dayKey();
        const note = $('#ac-note', el).value.trim();
        if (!(mt > 0)) throw new Error('Indiquez le prix payé.');
        let libelle;
        if (type === 'matiere') {
          if (!(q > 0)) throw new Error('Indiquez la quantité achetée.');
          let m = matiere($('#ac-m', el).value);
          if (!m) {
            const nom = $('#ac-nom', el).value.trim();
            if (nom.length < 2) throw new Error('Nom de la matière obligatoire.');
            m = await DB.insert('matieres', { nom, unite: $('#ac-unite', el).value.trim() || 'unité', stock: 0, valeur: 0, seuil: 0 });
          }
          await DB.update('matieres', m.id, { stock: Number(m.stock) + q, valeur: Number(m.valeur) + mt });
          const a = await DB.insert('achats', { matiere_id: m.id, produit_id: null, date, quantite: q, montant: mt, compte, note });
          libelle = `Achat ${m.nom} (${fmtQ(q)} ${m.unite || ''})`;
          if (compte) await DB.insert('ecritures', { date, libelle, type: 'sortie', categorie: 'achat', compte, montant: mt, ref: a.id });
        } else {
          const p = prod($('#ac-p', el).value);
          if (!p) throw new Error('Choisissez le produit.');
          if (suivi(p)) {
            // Article compté acheté tout fait : traité comme une fabrication (coût de revient + stock)
            if (!(q > 0)) throw new Error('Indiquez le nombre d\'unités achetées.');
            const f = await DB.insert('fabrications', { produit_id: p.id, date, quantite: Math.round(q), depenses: [{ libelle: 'Achat pour revente', montant: mt }], matieres: [], cout_total: mt, note });
            await DB.update('produits', p.id, { stock: (p.stock || 0) + Math.round(q) });
            libelle = `Achat ${p.nom} pour revente (${Math.round(q)})`;
            if (compte) await DB.insert('ecritures', { date, libelle, type: 'sortie', categorie: 'achat', compte, montant: mt, ref: f.id });
          } else {
            const a = await DB.insert('achats', { matiere_id: null, produit_id: p.id, date, quantite: q, montant: mt, compte, note });
            libelle = `Achat ${p.nom} pour revente`;
            if (compte) await DB.insert('ecritures', { date, libelle, type: 'sortie', categorie: 'achat', compte, montant: mt, ref: a.id });
          }
        }
        close(); toast('Achat enregistré'); await refreshAfter();
      });
    },
  });
}

function matiereForm(m) {
  const isNew = !m;
  m = m || { nom: '', unite: 'kg', seuil: 0 };
  modal({
    title: isNew ? 'Nouvelle matière première' : `Modifier · ${esc(m.nom)}`,
    body: `<div class="row"><div class="field"><label>Nom *</label><input id="mf-nom" maxlength="60" value="${esc(m.nom)}" placeholder="Ex. Fleurs de bissap"></div>
      <div class="field"><label>Unité</label><input id="mf-unite" maxlength="20" value="${esc(m.unite || '')}" placeholder="kg, litre, sachet…"></div></div>
      <div class="field"><label>Alerte quand il reste moins de</label><input id="mf-seuil" type="number" min="0" step="any" value="${esc(m.seuil || 0)}"><span class="hint">0 = pas d'alerte</span></div>
      ${isNew ? `<p class="small muted">Pour ajouter du stock avec son prix, utilisez « Achat ».</p>` : ''}`,
    foot: `<button class="btn ghost" data-close>Annuler</button><button class="btn primary" id="mf-ok">Enregistrer</button>`,
    onMount: (el, close) => {
      $('#mf-ok', el).onclick = (e) => run(e.currentTarget, async () => {
        const data = { nom: $('#mf-nom', el).value.trim(), unite: $('#mf-unite', el).value.trim() || 'unité', seuil: Math.max(0, Number($('#mf-seuil', el).value) || 0) };
        if (data.nom.length < 2) throw new Error('Nom obligatoire.');
        if (isNew) await DB.insert('matieres', { ...data, stock: 0, valeur: 0 }); else await DB.update('matieres', m.id, data);
        close(); toast('Matière enregistrée'); await refreshAfter();
      });
    },
  });
}

/* Fabrication : matières utilisées (déjà payées) + autres dépenses payées pour ce lot */
function fabForm(pid) {
  const prods = A.produits.filter((p) => suivi(p) && (p.actif || p.id === pid));
  if (!prods.length) return toast("Créez d'abord un produit dont le stock est compté.", 'warn');
  const mats = A.matieres.filter((m) => m.stock > 0).sort((a, b) => a.nom.localeCompare(b.nom));
  let used = mats.length ? [{ id: '', q: '' }] : [];
  let deps = [];
  modal({
    title: 'Nouvelle fabrication', size: 'wide',
    body: `<div class="row3">
        <div class="field"><label>Produit</label><select id="fb-p">${prods.map((p) => `<option value="${esc(p.id)}" ${p.id === pid ? 'selected' : ''}>${esc(p.nom)}</option>`).join('')}</select></div>
        <div class="field"><label>Quantité fabriquée *</label><input id="fb-q" type="number" min="1" step="1" inputmode="numeric" placeholder="Ex. 40"></div>
        <div class="field"><label>Date</label><input id="fb-d" type="date" value="${dayKey()}"></div>
      </div>
      <h4 class="cart-h">Matières utilisées <span class="small muted">(déjà achetées)</span></h4>
      ${A.v2 ? (mats.length ? '<div id="fb-mats"></div><button type="button" class="btn ghost sm" id="fb-addm">' + ic('plus') + ' Ajouter une matière</button>'
        : `<p class="small muted">Aucune matière en stock. Enregistrez vos achats (sucre, fleurs, bananes…) pour les réutiliser sur plusieurs fabrications.</p>`) : '<p class="small muted">Disponible après la migration v2.</p>'}
      <h4 class="cart-h">Autres dépenses payées pour ce lot</h4>
      <div class="sugg" id="fb-sugg"></div>
      <div id="fb-deps"></div>
      <div class="row" style="align-items:end">
        <button type="button" class="btn ghost sm" id="fb-add" style="justify-self:start">${ic('plus')} Ajouter une dépense</button>
        <div class="field" style="margin:0"><label>Ces dépenses ont été</label><select id="fb-c">${CAISSE_OPTS()}</select></div>
      </div>
      <div class="recap" id="fb-recap"></div>
      <div class="field" style="margin-top:14px"><label>Note</label><input id="fb-note" maxlength="200" placeholder="Facultatif"></div>`,
    foot: `<button class="btn ghost" data-close>Annuler</button><button class="btn primary" id="fb-ok">${ic('check')} Enregistrer la fabrication</button>`,
    onMount: (el, close) => {
      const lignesMat = () => used.map((u) => {
        const m = matiere(u.id); const q = Number(u.q) || 0;
        return m && q > 0 ? { m, q, cout: Math.round(coutUnitMat(m) * q) } : null;
      }).filter(Boolean);
      const renderMats = () => {
        const box = $('#fb-mats', el); if (!box) return;
        box.innerHTML = used.map((u, i) => {
          const m = matiere(u.id);
          return `<div class="dep-line mat-line">
            <select class="input" data-mi="${i}" data-k="id"><option value="">Choisir…</option>${mats.map((x) => `<option value="${esc(x.id)}" ${x.id === u.id ? 'selected' : ''}>${esc(x.nom)} — reste ${fmtQ(x.stock)} ${esc(x.unite || '')}</option>`).join('')}</select>
            <input class="input" data-mi="${i}" data-k="q" type="number" min="0" step="any" inputmode="decimal" placeholder="${m ? esc(m.unite || 'Qté') : 'Qté'}" value="${esc(u.q)}">
            <button type="button" class="icon-btn flat" data-rmm="${i}" title="Retirer">${ic('x')}</button></div>`;
        }).join('');
        icons(); recap();
      };
      const renderDeps = () => {
        $('#fb-deps', el).innerHTML = deps.map((d, i) => `<div class="dep-line">
          <input class="input" data-i="${i}" data-k="libelle" placeholder="Ex. Gaz" value="${esc(d.libelle)}">
          <input class="input" data-i="${i}" data-k="montant" type="number" min="0" step="1" inputmode="numeric" placeholder="Montant" value="${esc(d.montant)}">
          <button type="button" class="icon-btn flat" data-rm="${i}" title="Retirer">${ic('x')}</button></div>`).join('');
        icons(); recap();
      };
      const renderSugg = () => {
        const p = prod($('#fb-p', el).value);
        $('#fb-sugg', el).innerHTML = (SUGG[p?.categorie_id] || ['Emballages', 'Gaz', 'Transport']).map((s) => `<button type="button" data-s="${esc(s)}">+ ${esc(s)}</button>`).join('');
      };
      const recap = () => {
        const p = prod($('#fb-p', el).value);
        const q = parseInt($('#fb-q', el).value, 10) || 0;
        const cMat = sum(lignesMat(), 'cout');
        const cDep = sum(deps, (d) => Number(d.montant) || 0);
        const tot = cMat + cDep;
        const cu = q ? tot / q : 0;
        const ben = q * (p?.prix || 0) - tot;
        $('#fb-recap', el).innerHTML = `
          <div><small>Matières utilisées</small><b>${money(cMat)}</b></div>
          <div><small>Autres dépenses</small><b>${money(cDep)}</b></div>
          <div><small>Coût par unité</small><b>${q ? money(cu) : '—'}</b></div>
          <div><small>Marge par unité</small><b class="${q ? ((p?.prix || 0) - cu >= 0 ? 'pos' : 'neg') : ''}">${q ? money((p?.prix || 0) - cu) : '—'}</b></div>
          <div style="grid-column:1/-1"><small>Bénéfice si tout est vendu (${money(p?.prix || 0)} × ${q})</small><b class="${ben >= 0 ? 'pos' : 'neg'}" style="font-size:24px">${money(ben)}</b></div>`;
      };
      el.addEventListener('input', (e) => {
        const t = e.target;
        if (t.dataset.i !== undefined) { deps[+t.dataset.i][t.dataset.k] = t.value; recap(); }
        if (t.dataset.mi !== undefined) { used[+t.dataset.mi][t.dataset.k] = t.value; if (t.dataset.k === 'id') renderMats(); else recap(); }
        if (t.id === 'fb-q') recap();
      });
      el.addEventListener('change', (e) => { if (e.target.dataset.mi !== undefined && e.target.dataset.k === 'id') { used[+e.target.dataset.mi].id = e.target.value; renderMats(); } });
      el.addEventListener('click', (e) => {
        const s = e.target.closest('[data-s]');
        if (s) {
          const empty = deps.findIndex((d) => !d.libelle);
          if (empty >= 0) deps[empty].libelle = s.dataset.s; else deps.push({ libelle: s.dataset.s, montant: '' });
          renderDeps();
          const idx = empty >= 0 ? empty : deps.length - 1;
          $(`[data-i="${idx}"][data-k="montant"]`, el)?.focus();
        }
        const r = e.target.closest('[data-rm]');
        if (r) { deps.splice(+r.dataset.rm, 1); renderDeps(); }
        const rm = e.target.closest('[data-rmm]');
        if (rm) { used.splice(+rm.dataset.rmm, 1); renderMats(); }
      });
      $('#fb-add', el).onclick = () => { deps.push({ libelle: '', montant: '' }); renderDeps(); };
      const addm = $('#fb-addm', el); if (addm) addm.onclick = () => { used.push({ id: '', q: '' }); renderMats(); };
      $('#fb-p', el).onchange = () => { renderSugg(); recap(); };
      renderSugg(); renderMats(); renderDeps();
      setTimeout(() => $('#fb-q', el).focus(), 350);
      $('#fb-ok', el).onclick = (e) => run(e.currentTarget, async () => {
        const p = prod($('#fb-p', el).value);
        const q = parseInt($('#fb-q', el).value, 10);
        if (!p) throw new Error('Choisissez un produit.');
        if (!q || q <= 0) throw new Error('Indiquez la quantité fabriquée.');
        const lm = lignesMat();
        for (const l of lm) if (l.q > Number(l.m.stock) + 1e-9) throw new Error(`Il ne reste que ${fmtQ(l.m.stock)} ${l.m.unite || ''} de ${l.m.nom}.`);
        const depenses = deps.filter((d) => d.libelle.trim() || Number(d.montant)).map((d) => ({ libelle: d.libelle.trim() || 'Dépense', montant: Math.round(Number(d.montant) || 0) }));
        const matieres = lm.map((l) => ({ matiere_id: l.m.id, nom: l.m.nom, unite: l.m.unite, quantite: l.q, cout: l.cout }));
        const coutDep = sum(depenses, 'montant');
        const cout = coutDep + sum(matieres, 'cout');
        const date = $('#fb-d', el).value || dayKey();
        const compte = $('#fb-c', el).value || null;
        const f = await DB.insert('fabrications', { produit_id: p.id, date, quantite: q, depenses, ...(A.v2 ? { matieres } : {}), cout_total: cout, note: $('#fb-note', el).value.trim() });
        for (const l of lm) {
          await DB.update('matieres', l.m.id, { stock: Math.max(0, Number(l.m.stock) - l.q), valeur: Math.max(0, Number(l.m.valeur) - l.cout) });
        }
        await DB.update('produits', p.id, { stock: (p.stock || 0) + q });
        if (compte && coutDep > 0) {
          await DB.insert('ecritures', { date, libelle: `Dépenses fabrication ${p.nom} (${q} unités)`, type: 'sortie', categorie: 'fabrication', compte, montant: coutDep, ref: f.id });
        }
        close();
        toast(`+${q} ${p.nom} en stock`);
        await refreshAfter();
      });
    },
  });
}

Object.assign(ACT, {
  'f-inv': (el) => { A.f.inv = el.dataset.k; renderPage(false); },
  'fab-new': (el) => fabForm(el.dataset.id),
  'achat-new': (el) => achatForm({ matiereId: el.dataset.matiere, produitId: el.dataset.produit }),
  'mat-edit': (el) => matiereForm(el.dataset.id ? matiere(el.dataset.id) : null),
  'mat-suppr': async (el) => {
    const m = matiere(el.dataset.id);
    if (!(await confirmBox(`Supprimer la matière <b>${esc(m.nom)}</b> ? L'historique des achats est conservé.`, { ok: 'Supprimer', danger: true }))) return;
    await run(null, async () => { await DB.remove('matieres', m.id); await refreshAfter(); });
  },
  'mat-adj': (el) => {
    const m = matiere(el.dataset.id);
    modal({
      title: `Ajuster · ${esc(m.nom)}`,
      body: `<p class="muted" style="margin-bottom:14px">Quantité théorique : <b>${fmtQ(m.stock)} ${esc(m.unite || '')}</b>. Indiquez ce qu'il reste vraiment (perte, erreur, utilisation hors fabrication).</p>
        <div class="field"><label>Quantité réelle (${esc(m.unite || '')})</label><input id="ma-q" type="number" min="0" step="any" value="${fmtQ(m.stock).replace(/\s/g, '').replace(',', '.')}"></div>`,
      foot: `<button class="btn ghost" data-close>Annuler</button><button class="btn primary" id="ma-ok">Mettre à jour</button>`,
      onMount: (mm, close) => {
        $('#ma-ok', mm).onclick = (e) => run(e.currentTarget, async () => {
          const q = Math.max(0, Number($('#ma-q', mm).value) || 0);
          // On garde le même coût unitaire
          await DB.update('matieres', m.id, { stock: q, valeur: Math.round(coutUnitMat(m) * q) });
          close(); toast('Quantité mise à jour'); await refreshAfter();
        });
      },
    });
  },
  'achat-suppr': async (el) => {
    const a = A.achats.find((x) => x.id === el.dataset.id);
    const m = matiere(a.matiere_id);
    if (!(await confirmBox(`Supprimer cet achat (${money(a.montant)}) ?${m ? `<br><span class="small muted">${fmtQ(a.quantite)} ${esc(m.unite || '')} seront retirés de ${esc(m.nom)}.</span>` : ''}`, { ok: 'Supprimer', danger: true }))) return;
    await run(null, async () => {
      if (m) await DB.update('matieres', m.id, { stock: Math.max(0, Number(m.stock) - Number(a.quantite)), valeur: Math.max(0, Number(m.valeur) - Number(a.montant)) });
      for (const e of A.ecritures.filter((x) => x.ref === a.id)) await DB.remove('ecritures', e.id);
      await DB.remove('achats', a.id);
      toast('Achat supprimé'); await refreshAfter();
    });
  },
  'fab-suppr': async (el) => {
    const f = A.fabrications.find((x) => x.id === el.dataset.id);
    const p = prod(f.produit_id);
    if (!(await confirmBox(`Supprimer ce lot (${f.quantite} × ${esc(p?.nom || '')}) ?<br><span class="small muted">${f.quantite} unité(s) seront retirées du stock, les matières utilisées seront remises et la dépense retirée de la caisse.</span>`, { ok: 'Supprimer', danger: true }))) return;
    await run(null, async () => {
      if (p) await DB.update('produits', p.id, { stock: Math.max(0, p.stock - f.quantite) });
      for (const u of f.matieres || []) {
        const m = matiere(u.matiere_id);
        if (m) await DB.update('matieres', m.id, { stock: Number(m.stock) + Number(u.quantite), valeur: Number(m.valeur) + Number(u.cout) });
      }
      for (const e of A.ecritures.filter((x) => x.ref === f.id)) await DB.remove('ecritures', e.id);
      await DB.remove('fabrications', f.id);
      toast('Fabrication supprimée'); await refreshAfter();
    });
  },
  'stock-adj': (el) => {
    const p = prod(el.dataset.id);
    modal({
      title: `Inventaire · ${esc(p.nom)}`,
      body: `<p class="muted" style="margin-bottom:14px">Stock théorique : <b>${p.stock}</b>. Comptez vos articles et saisissez la quantité réelle.</p>
        <div class="field"><label>Quantité réellement comptée</label><input id="sa-q" type="number" min="0" step="1" value="${p.stock}"></div>
        <div class="field"><label>Motif</label><select id="sa-m"><option>Inventaire</option><option>Casse / perte</option><option>Consommation personnelle</option><option>Cadeau / dégustation</option><option>Correction d'erreur</option></select></div>
        <p id="sa-diff" class="small"></p>`,
      foot: `<button class="btn ghost" data-close>Annuler</button><button class="btn primary" id="sa-ok">Mettre à jour</button>`,
      onMount: (m, close) => {
        const diff = () => { const d = (parseInt($('#sa-q', m).value, 10) || 0) - p.stock; $('#sa-diff', m).innerHTML = d ? `Écart : <b class="${d > 0 ? 'amt-in' : 'amt-out'}">${d > 0 ? '+' : ''}${d}</b>` : 'Aucun écart'; };
        $('#sa-q', m).oninput = diff; diff();
        $('#sa-ok', m).onclick = (e) => run(e.currentTarget, async () => {
          const q = Math.max(0, parseInt($('#sa-q', m).value, 10) || 0);
          await DB.update('produits', p.id, { stock: q });
          close(); toast(`Stock de ${p.nom} : ${q} (${$('#sa-m', m).value})`); await refreshAfter();
        });
      },
    });
  },
});

/* ---------- Rentabilité ---------- */
PAGES.rentabilite = {
  title: 'Rentabilité',
  render() {
    const rows = A.produits.map((p) => {
      const { q: vQ, ca: vCA } = ventesProduit(p.id);
      if (!suivi(p)) {
        const dep = achatsVrac(p.id);
        const ben = vCA - dep;
        return { p, vrac: true, dep, vQ, vCA, benReal: ben, benPot: ben, marge: vCA ? (ben / vCA) * 100 : 0, cu: 0, fabQ: 0 };
      }
      const fabs = A.fabrications.filter((f) => f.produit_id === p.id);
      const fabQ = sum(fabs, 'quantite'), dep = sum(fabs, 'cout_total');
      const cu = fabQ ? dep / fabQ : 0;
      return { p, fabQ, dep, cu, vQ, vCA, benReal: vCA - vQ * cu, benPot: fabQ * p.prix - dep, marge: p.prix && cu ? ((p.prix - cu) / p.prix) * 100 : 0 };
    }).filter((r) => r.fabQ || r.vQ || r.dep || r.p.actif).sort((a, b) => b.benReal - a.benReal);
    const tDep = sum(rows, 'dep'), tCA = sum(rows, 'vCA'), tBen = sum(rows, 'benReal'), tPot = sum(rows, 'benPot');
    return `
    <div class="page-head"><div><h1>Rentabilité</h1><p class="muted">Ce que chaque produit vous coûte et vous rapporte.</p></div></div>
    <div class="kpis">
      ${kpi('Total dépensé (produits)', tDep, 'factory', 'caramel', true, 'Fabrications et achats pour revente', 0)}
      ${kpi("Chiffre d'affaires des ventes", tCA, 'coins', '', true, '', 1)}
      ${kpi('Bénéfice réalisé', tBen, 'piggy-bank', tBen >= 0 ? 'leaf' : 'danger', true, 'Ventes − coût de ce qui a été vendu', 2)}
      ${kpi('Bénéfice potentiel', tPot, 'sparkles', 'mango', true, 'Si tout ce qui a été fabriqué est vendu', 3)}
    </div>
    <div class="cards">${rows.map((r, i) => `<div class="prof-card" style="--i:${i}">
      <div class="ph"><div class="thumb">${prodVisual(r.p)}</div><div><h3>${esc(r.p.nom)}</h3><span class="small muted">Prix ${money(r.p.prix)}${r.vrac ? ' · en vrac' : r.cu ? ` · coût ${money(r.cu)}/u` : ''}</span></div>
        <div class="margin-ring" style="--p:${Math.max(0, Math.min(100, r.marge))}" title="Marge"><span>${r.vrac ? (r.vCA ? pct(r.marge) : '—') : r.cu ? pct(r.marge) : '—'}</span></div></div>
      <div class="prof-grid">
        ${r.vrac ? `<div><small>Achats</small><b>${money(r.dep)}</b></div><div><small>Vendu</small><b>${num(r.vQ)}</b></div>`
          : `<div><small>Fabriqué</small><b>${num(r.fabQ)}</b></div><div><small>Dépensé</small><b>${money(r.dep)}</b></div><div><small>Vendu</small><b>${num(r.vQ)}</b></div>`}
        <div><small>Ventes</small><b>${money(r.vCA)}</b></div>
        <div class="hl ${r.benReal < 0 ? 'neg' : ''}"><small>Bénéfice ${r.vrac ? '(ventes − achats)' : 'réalisé'}</small><b>${money(r.benReal)}</b></div>
        ${r.vrac ? '' : `<div><small>Bénéfice potentiel</small><b>${money(r.benPot)}</b></div>`}
      </div>
      ${!r.vrac && !r.cu ? '<p class="small muted" style="margin-top:10px">Enregistrez une fabrication pour connaître le coût de revient.</p>' : ''}
      ${r.vrac && !r.dep ? '<p class="small muted" style="margin-top:10px">Enregistrez vos achats (ex. 1 000 ou 2 000) dans « Stock & achats » pour calculer le bénéfice.</p>' : ''}
    </div>`).join('') || `<div class="empty"><span class="big">${ic('trending-up')}</span><h3>Pas encore de données</h3></div>`}</div>`;
  },
};
