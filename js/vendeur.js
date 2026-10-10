/*
 * Noecy Market — espace vendeur (point de vente)
 * Le vendeur vend la marchandise du stock Noecy : ses ventes et son argent sont à lui.
 */
'use strict';

let CURRENT = 'vendeur'; // lu par modal() dans core.js
const LS_V = 'noecy_vendeur';
const V = { session: null, data: null, tab: 'vendre', ticket: {}, prix: {}, filtre: 'tous', q: '', periode: 'jour', poll: null };

const sessionV = () => { try { return JSON.parse(localStorage.getItem(LS_V)); } catch (e) { return null; } };
const droit = (k) => !!(V.data?.vendeur?.droits || {})[k];
const prodV = (id) => V.data.produits.find((p) => p.id === id);
const prixLigne = (id) => (droit('prix') && V.prix[id] !== undefined && V.prix[id] !== '' ? Math.max(0, Number(V.prix[id])) : prodV(id)?.prix || 0);
const ticketTotal = () => Object.entries(V.ticket).reduce((s, [id, q]) => s + prixLigne(id) * q, 0);
const ticketNb = () => Object.values(V.ticket).reduce((s, q) => s + q, 0);
const maxV = (p) => (p.suivi_stock ? Math.max(0, p.dispo ?? 0) : 99);

async function chargerV() {
  V.data = await DB.vendeurData(V.session.id, V.session.token);
  SETTINGS = { ...SETTINGS, ...(V.data.parametres || {}) };
  CATS = V.data.categories || [];
}

async function startV() {
  try { await DB.init(); } catch (e) { $('#app').innerHTML = `<div class="empty" style="padding-top:120px"><h3>Impossible de démarrer</h3><p>${esc(e.message)}</p></div>`; return; }
  V.session = sessionV();
  if (!V.session) return renderLoginV();
  try { await chargerV(); }
  catch (e) {
    toast(e.message, 'err', 5000);
    localStorage.removeItem(LS_V);
    return renderLoginV();
  }
  renderV();
  clearInterval(V.poll);
  V.poll = setInterval(rafraichirV, 20000);
}

async function rafraichirV() {
  if (document.hidden || !V.session) return;
  try { await chargerV(); } catch (e) {
    if (/Session|désactivé/.test(e.message)) { toast(e.message, 'err', 6000); localStorage.removeItem(LS_V); clearInterval(V.poll); renderLoginV(); }
    return;
  }
  // Le stock a pu changer : on ajuste le ticket
  Object.keys(V.ticket).forEach((id) => { const p = prodV(id); if (!p) delete V.ticket[id]; else if (V.ticket[id] > maxV(p)) V.ticket[id] = maxV(p); });
  if (!$('.modal-wrap')) renderPageV(false);
}

/* ---------- Connexion ---------- */
function renderLoginV() {
  document.body.className = 'admin';
  $('#app').innerHTML = `<div class="login">
    <div class="blob" style="width:340px;height:340px;background:#1c9a69;right:-80px;top:-60px"></div>
    <div class="blob" style="width:300px;height:300px;background:#f6a609;left:-80px;bottom:-60px;animation-delay:-6s"></div>
    <form class="login-card" id="vl-form">
      <div class="brand" style="justify-content:center"><span class="brand-logo vd-logo">N</span><span class="brand-name">Noecy <b>Vendeur</b></span></div>
      <h2>Espace vendeur</h2>
      <p class="sub">Connectez-vous avec votre numéro et le code donné par Noecy Market</p>
      <div class="field"><label>Téléphone</label><input id="vl-tel" type="tel" required autocomplete="tel" placeholder="77 123 45 67"></div>
      <div class="field"><label>Code</label><input id="vl-code" class="pin-input" type="password" inputmode="numeric" maxlength="6" required placeholder="••••" autocomplete="current-password"></div>
      <button class="btn primary lg block" type="submit">Se connecter ${ic('arrow-right')}</button>
    </form></div>`;
  icons();
  setTimeout(() => $('#vl-tel')?.focus(), 300);
  $('#vl-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const card = $('#vl-form');
    run(e.submitter, async () => {
      try {
        const r = await DB.vendeurLogin($('#vl-tel').value.trim(), $('#vl-code').value.trim());
        localStorage.setItem(LS_V, JSON.stringify({ id: r.id, token: r.token }));
      } catch (err) { card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake'); throw err; }
      toast('Bienvenue');
      await startV();
    });
  });
}

/* ---------- Coque ---------- */
const TABS_V = [['vendre', 'Vendre', 'shopping-cart'], ['ventes', 'Mes ventes', 'receipt'], ['caisse', 'Ma caisse', 'wallet']];

function renderV() {
  document.body.className = 'admin vendeur-app';
  const v = V.data.vendeur;
  $('#app').innerHTML = `<div class="vd">
    <header class="vd-top">
      <div class="brand"><span class="brand-logo vd-logo">N</span><span class="brand-name">Noecy <b>Vendeur</b></span></div>
      <nav class="vd-tabs" id="vd-tabs"></nav>
      <div class="vd-user"><span class="avatar sm">${esc(initials(v.nom))}</span><span class="hide-sm"><b>${esc(v.nom)}</b></span>
        <button class="icon-btn flat" data-act="v-logout" title="Se déconnecter">${ic('log-out')}</button></div>
    </header>
    <main id="vd-page" class="vd-page"></main>
    <button class="ticket-bar" id="ticket-bar" data-act="v-ticket"><span id="tb-txt"></span><span class="go">Encaisser ${ic('arrow-right')}</span></button>
  </div>`;
  renderPageV();
}

function renderTabsV() {
  $('#vd-tabs').innerHTML = TABS_V.map(([k, l, i]) => `<button class="${V.tab === k ? 'on' : ''}" data-act="v-tab" data-k="${k}">${ic(i)}<span>${l}</span></button>`).join('');
}

function renderPageV(animate = true) {
  if (!$('#vd-page')) return;
  renderTabsV();
  const y = scrollY;
  const page = $('#vd-page');
  page.innerHTML = V.tab === 'ventes' ? pageVentesV() : V.tab === 'caisse' ? pageCaisseV() : pageVendreV();
  if (animate) { page.classList.remove('enter'); void page.offsetWidth; page.classList.add('enter'); window.scrollTo({ top: 0 }); countUp(page); }
  else { page.classList.remove('enter'); window.scrollTo({ top: y }); $$('[data-count]', page).forEach((x) => { x.textContent = x.hasAttribute('data-money') ? money(+x.dataset.count) : num(+x.dataset.count); }); }
  icons();
  majTicketBar();
}

function majTicketBar() {
  const b = $('#ticket-bar');
  if (!b) return;
  const n = ticketNb();
  b.classList.toggle('show', n > 0 && V.tab === 'vendre');
  $('#tb-txt').textContent = `${n} article${n > 1 ? 's' : ''} · ${money(ticketTotal())}`;
}

/* ---------- Vendre ---------- */
function pageVendreV() {
  const q = norm(V.q);
  const cats = CATS.filter((c) => V.data.produits.some((p) => p.categorie_id === c.id));
  const list = V.data.produits
    .filter((p) => V.filtre === 'tous' || p.categorie_id === V.filtre)
    .filter((p) => !q || norm(p.nom).includes(q))
    .sort((a, b) => (maxV(b) > 0) - (maxV(a) > 0) || a.nom.localeCompare(b.nom));
  return `
    <div class="vd-tools">
      <label class="search field" style="margin:0">${ic('search')}<input class="input" placeholder="Chercher un article…" data-inp="v-q" value="${esc(V.q)}"></label>
      <div class="chips"><button class="chip ${V.filtre === 'tous' ? 'on' : ''}" data-act="v-filtre" data-f="tous">Tout</button>${cats.map((c) => `<button class="chip ${V.filtre === c.id ? 'on' : ''}" data-act="v-filtre" data-f="${esc(c.id)}">${ic(c.icone || 'shopping-bag')} ${esc(c.nom)}</button>`).join('')}</div>
    </div>
    <div class="vd-grid">${list.map((p, i) => {
      const m = maxV(p), q = V.ticket[p.id] || 0;
      const etat = !p.suivi_stock ? '<span class="pill ok">Disponible</span>' : m <= 0 ? '<span class="pill bad">Épuisé</span>' : p.stock !== null && p.stock !== undefined ? `<span class="pill ${m <= 5 ? 'warn' : 'ok'}">${p.stock} en stock</span>` : '<span class="pill ok">Disponible</span>';
      return `<button class="vd-tile ${m <= 0 ? 'out' : ''} ${q ? 'in' : ''}" style="--i:${Math.min(i, 20)}" data-act="v-add" data-id="${esc(p.id)}" ${m <= 0 ? 'disabled' : ''}>
        <div class="vd-media">${prodVisual(p)}${q ? `<span class="vd-q">${q}</span>` : ''}</div>
        <div class="vd-info"><b>${esc(p.nom)}</b><span class="price">${money(p.prix)}</span>${etat}</div>
      </button>`;
    }).join('') || `<div class="empty"><span class="big">${ic('search-x')}</span><h3>Aucun article</h3></div>`}</div>`;
}

function ticketHtml() {
  const lignes = Object.entries(V.ticket).filter(([id]) => prodV(id));
  if (!lignes.length) return `<div class="empty"><span class="big">${ic('shopping-cart')}</span><h3>Ticket vide</h3><p>Touchez les articles pour les ajouter.</p></div>`;
  return `${lignes.map(([id, q]) => {
    const p = prodV(id);
    return `<div class="cart-line">
      <div class="thumb">${prodVisual(p)}</div>
      <div class="info"><b>${esc(p.nom)}</b>${droit('prix')
        ? `<label class="prix-edit">Prix <input type="number" min="0" step="25" inputmode="numeric" data-prix="${esc(id)}" value="${esc(V.prix[id] ?? p.prix)}"></label>`
        : `<span class="small muted">${money(p.prix)}</span>`}</div>
      <div class="stepper"><button type="button" data-tq="-" data-id="${esc(id)}">${ic('minus')}</button><span>${q}</span><button type="button" data-tq="+" data-id="${esc(id)}">${ic('plus')}</button></div>
      <div class="lt" data-lt="${esc(id)}">${money(prixLigne(id) * q)}</div></div>`;
  }).join('')}
  <div class="total-row big" style="margin-top:12px"><span>Total</span><span class="grad-text" id="tk-total">${money(ticketTotal())}</span></div>
  <h4 class="cart-h">Client <span class="small muted">${droit('credit') ? '(obligatoire pour un crédit)' : '(facultatif)'}</span></h4>
  <div class="row"><div class="field"><input id="tk-nom" placeholder="Nom du client" maxlength="80"></div><div class="field"><input id="tk-tel" type="tel" placeholder="Téléphone" maxlength="30"></div></div>
  <h4 class="cart-h">Paiement reçu</h4>
  <div class="row pay-fields">
    <div class="field"><label>${ic('banknote', 'sm')} Espèces</label><input id="tk-esp" type="number" min="0" step="1" inputmode="numeric" placeholder="0"></div>
    <div class="field"><label>${ic('waves', 'sm')} Wave</label><input id="tk-wave" type="number" min="0" step="1" inputmode="numeric" placeholder="0"></div>
  </div>
  <div class="pm-sum" id="tk-sum"></div>
  <div class="field"><input id="tk-note" placeholder="Note (facultatif)" maxlength="300"></div>`;
}

function ouvrirTicket() {
  modal({
    title: `${ic('receipt')} Ticket de vente`, size: 'drawer',
    body: `<div id="tk-body">${ticketHtml()}</div>`,
    foot: `<button class="btn ghost" data-act="v-vider">${ic('trash-2')} Vider</button><button class="btn primary lg" id="tk-ok" style="flex:1">${ic('check')} Valider la vente</button>`,
    onMount: (el, close) => {
      let auto = true; // les espèces suivent le total tant que le vendeur n'a rien saisi
      const recap = () => {
        const tot = ticketTotal();
        const esp = $('#tk-esp', el), wav = $('#tk-wave', el);
        if (!esp) return;
        if (auto) esp.value = tot || '';
        const r = (+esp.value || 0) + (+wav.value || 0), d = r - tot;
        $('#tk-total', el).textContent = money(tot);
        $('#tk-sum', el).innerHTML = `<div class="total-row"><span class="muted">À payer</span><b>${money(tot)}</b></div><div class="total-row"><span class="muted">Reçu</span><b>${money(r)}</b></div>`
          + (d > 0 ? `<div class="total-row"><span>Monnaie à rendre</span><b class="amt-in">${money(d)}</b></div>` : d < 0 ? `<div class="total-row"><span>${droit('credit') ? 'Reste en crédit' : 'Manque'}</span><b class="amt-out">${money(-d)}</b></div>` : '');
      };
      const rerender = () => { $('#tk-body', el).innerHTML = ticketHtml(); icons(); recap(); majTicketBar(); };
      el.addEventListener('input', (e) => {
        if (e.target.id === 'tk-esp' || e.target.id === 'tk-wave') { if (e.isTrusted) auto = false; recap(); }
        if (e.target.dataset.prix) {
          V.prix[e.target.dataset.prix] = e.target.value;
          const id = e.target.dataset.prix; const lt = $(`[data-lt="${CSS.escape(id)}"]`, el); if (lt) lt.textContent = money(prixLigne(id) * V.ticket[id]);
          recap(); majTicketBar();
        }
      });
      el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-tq]');
        if (!b) return;
        const p = prodV(b.dataset.id);
        const n = (V.ticket[p.id] || 0) + (b.dataset.tq === '+' ? 1 : -1);
        if (n > maxV(p)) { toast(`Stock disponible : ${maxV(p)}`, 'warn'); return; }
        if (n <= 0) delete V.ticket[p.id]; else V.ticket[p.id] = n;
        rerender();
      });
      recap();
      $('#tk-ok', el).onclick = (e) => run(e.currentTarget, async () => {
        if (!ticketNb()) throw new Error('Ajoutez au moins un article.');
        const tot = ticketTotal();
        const esp = Math.round(+$('#tk-esp', el).value || 0), wav = Math.round(+$('#tk-wave', el).value || 0);
        const nom = $('#tk-nom', el).value.trim();
        if (esp + wav < tot && !droit('credit')) throw new Error(`Il manque ${money(tot - esp - wav)} : vous ne pouvez pas vendre à crédit.`);
        if (esp + wav < tot && nom.length < 2) throw new Error('Pour une vente à crédit, indiquez le nom du client.');
        // La monnaie rendue est retirée des espèces en priorité
        let e2 = esp, w2 = wav; const trop = esp + wav - tot;
        if (trop > 0) { const de = Math.min(e2, trop); e2 -= de; w2 -= trop - de; }
        const cmd = await DB.vendeurVente(V.session.id, V.session.token, {
          lignes: Object.entries(V.ticket).map(([produit_id, quantite]) => ({ produit_id, quantite, prix: droit('prix') ? prixLigne(produit_id) : undefined })),
          client_nom: nom, client_tel: $('#tk-tel', el).value.trim(),
          paiements: [['especes', e2], ['wave', w2]].filter(([, m]) => m > 0).map(([compte, montant]) => ({ compte, montant })),
          note: $('#tk-note', el).value.trim(),
        });
        V.ticket = {}; V.prix = {};
        close();
        confetti();
        toast(cmd.statut === 'payee' ? `Vente ${cmd.numero} enregistrée${trop > 0 ? ` · rendez ${money(trop)}` : ''}` : `Vente ${cmd.numero} à crédit enregistrée`, 'ok', 5000);
        await chargerV(); renderPageV(false);
      });
    },
  });
}

/* ---------- Mes ventes ---------- */
function debutPeriodeV() {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  if (V.periode === '7') d.setDate(d.getDate() - 6);
  else if (V.periode === '30') d.setDate(d.getDate() - 29);
  else if (V.periode === 'tout') return new Date(0);
  return d;
}
const resteV = (c) => (c.statut === 'credit' ? Math.max(0, c.total - ((c.montant_paye || 0) - (c.rendu || 0))) : 0);

function pageVentesV() {
  const since = debutPeriodeV();
  const toutes = V.data.ventes;
  const ventes = toutes.filter((c) => toDate(c.created_at) >= since);
  const ok = ventes.filter((c) => c.statut !== 'annulee');
  const credits = toutes.filter((c) => c.statut === 'credit');
  return `
    <div class="vd-head"><h1>Mes ventes</h1>
      <div class="seg">${[['jour', "Aujourd'hui"], ['7', '7 jours'], ['30', '30 jours'], ['tout', 'Tout']].map(([k, l]) => `<button class="${V.periode === k ? 'on' : ''}" data-act="v-periode" data-k="${k}">${l}</button>`).join('')}</div></div>
    <div class="kpis vd-kpis">
      <div class="kpi"><div class="ki">${ic('coins')}</div><div class="kl">Ventes</div><div class="kv" data-count="${Math.round(sum(ok, 'total'))}" data-money>0</div></div>
      <div class="kpi leaf"><div class="ki">${ic('receipt')}</div><div class="kl">Nombre de ventes</div><div class="kv" data-count="${ok.length}">0</div></div>
      <div class="kpi mango"><div class="ki">${ic('package')}</div><div class="kl">Articles vendus</div><div class="kv" data-count="${sum(ok, (c) => sum(c.lignes || [], 'quantite'))}">0</div></div>
      <div class="kpi danger"><div class="ki">${ic('hand-coins')}</div><div class="kl">Crédits en cours</div><div class="kv" data-count="${Math.round(sum(credits, resteV))}" data-money>0</div></div>
    </div>
    <div class="cards">${ventes.length ? ventes.map((c, i) => `<div class="order-card st-${c.statut}" style="--i:${Math.min(i, 20)}">
      <div class="oc-head"><div><b>${esc(c.numero)}</b> ${pillCmd(c.statut)}</div><span class="small muted">${fDateTime(c.created_at)}</span></div>
      <div class="oc-client">${ic('user')} ${esc(c.client_nom)} ${c.client_telephone ? `<span class="small muted">· ${esc(c.client_telephone)}</span>` : ''}</div>
      <ul class="oc-lines">${(c.lignes || []).map((l) => `<li><span>${l.quantite} × ${esc(l.nom)}</span><span>${money(l.prix * l.quantite)}</span></li>`).join('')}</ul>
      <div class="oc-foot"><span class="small muted">${(c.paiements || []).map((p) => `${compteLbl(p.compte)} ${money(p.montant)}`).join(' · ') || 'Rien encaissé'}</span><span class="oc-total">${money(c.total)}</span></div>
      ${c.statut === 'credit' ? `<div class="owe-line" style="background:var(--danger-soft);color:var(--danger)">${ic('hand-coins', 'sm')} Reste à payer : <b>${money(resteV(c))}</b></div>` : ''}
      ${(c.statut === 'credit' && (droit('encaisser') || c.client_telephone)) || (c.statut !== 'annulee' && droit('annuler')) ? `<div class="oc-actions">
        ${c.statut === 'credit' && droit('encaisser') ? `<button class="btn leaf sm" data-act="v-encaisser" data-id="${esc(c.id)}">${ic('banknote')} Encaisser</button>` : ''}
        ${c.statut === 'credit' && c.client_telephone ? `<a class="btn ghost sm" href="${esc(waLink(c.client_telephone, `Bonjour ${c.client_nom}, petit rappel : il reste ${money(resteV(c))} à régler pour vos achats. Merci !`))}" target="_blank" rel="noopener">${ic('message-circle')} Relancer</a>` : ''}
        ${c.statut !== 'annulee' && droit('annuler') ? `<button class="btn ghost sm icon-only" data-act="v-annuler" data-id="${esc(c.id)}" title="Annuler">${ic('x')}</button>` : ''}
      </div>` : ''}
    </div>`).join('') : `<div class="empty"><span class="big">${ic('receipt')}</span><h3>Aucune vente sur la période</h3></div>`}</div>`;
}

/* ---------- Ma caisse ---------- */
function pageCaisseV() {
  const ecr = V.data.ecritures;
  const solde = (k) => sum(ecr.filter((e) => (e.compte || 'especes') === k), (e) => (e.type === 'entree' ? 1 : -1) * Number(e.montant));
  const esp = solde('especes'), wav = solde('wave');
  return `
    <div class="vd-head"><h1>Ma caisse</h1><p class="muted">L'argent de vos ventes, compte par compte.</p></div>
    <div class="ledger-sum">
      <div class="compte-card especes"><span class="ci">${ic('banknote')}</span><div><small>Espèces</small><b data-count="${Math.round(esp)}" data-money>0</b></div></div>
      <div class="compte-card wave"><span class="ci">${ic('waves')}</span><div><small>Wave</small><b data-count="${Math.round(wav)}" data-money>0</b></div></div>
      <div class="compte-card total"><span class="ci">${ic('landmark')}</span><div><small>Total</small><b data-count="${Math.round(esp + wav)}" data-money>0</b></div></div>
    </div>
    ${ecr.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Libellé</th><th>Compte</th><th class="num">Montant</th></tr></thead><tbody>
      ${ecr.map((e, i) => `<tr style="--i:${Math.min(i, 30)}"><td class="nowrap">${fDate(e.date)}</td><td>${esc(e.libelle)}</td><td><span class="pill ${e.compte === 'wave' ? 'wave' : ''}">${compteLbl(e.compte)}</span></td><td class="num ${e.type === 'entree' ? 'amt-in' : 'amt-out'}">${e.type === 'entree' ? '+' : '−'} ${money(e.montant)}</td></tr>`).join('')}
    </tbody></table></div>` : `<div class="card"><div class="empty" style="padding:30px"><span class="big">${ic('wallet')}</span><h3>Aucun mouvement</h3><p>L'argent de vos ventes apparaîtra ici.</p></div></div>`}`;
}

/* ---------- Actions ---------- */
Object.assign(ACT, {
  'v-tab': (el) => { V.tab = el.dataset.k; renderPageV(); },
  'v-filtre': (el) => { V.filtre = el.dataset.f; renderPageV(false); },
  'v-periode': (el) => { V.periode = el.dataset.k; renderPageV(false); },
  'v-add': (el) => {
    const p = prodV(el.dataset.id);
    const n = (V.ticket[p.id] || 0) + 1;
    if (n > maxV(p)) return toast(`Stock disponible : ${maxV(p)}`, 'warn');
    V.ticket[p.id] = n;
    renderPageV(false);
    const bar = $('#ticket-bar'); bar.classList.remove('bump'); void bar.offsetWidth; bar.classList.add('bump');
  },
  'v-ticket': () => ouvrirTicket(),
  'v-vider': () => { V.ticket = {}; V.prix = {}; $('.modal-wrap [data-close]')?.click(); renderPageV(false); },
  'v-logout': async () => {
    if (!(await confirmBox('Se déconnecter de l\'espace vendeur ?', { ok: 'Se déconnecter' }))) return;
    localStorage.removeItem(LS_V); V.session = null; clearInterval(V.poll); renderLoginV();
  },
  'v-encaisser': (el) => {
    const c = V.data.ventes.find((x) => x.id === el.dataset.id);
    const du = resteV(c);
    modal({
      title: 'Encaisser un remboursement',
      body: `<p class="muted" style="margin-bottom:12px">${esc(c.numero)} · ${esc(c.client_nom)} · reste ${money(du)}</p>
        <div class="row"><div class="field"><label>${ic('banknote', 'sm')} Espèces</label><input id="ve-esp" type="number" min="0" inputmode="numeric" value="${Math.round(du)}"></div>
        <div class="field"><label>${ic('waves', 'sm')} Wave</label><input id="ve-wave" type="number" min="0" inputmode="numeric" placeholder="0"></div></div>`,
      foot: `<button class="btn ghost" data-close>Annuler</button><button class="btn leaf" id="ve-ok">${ic('check')} Enregistrer</button>`,
      onMount: (m, close) => {
        $('#ve-ok', m).onclick = (e) => run(e.currentTarget, async () => {
          const esp = Math.round(+$('#ve-esp', m).value || 0), wav = Math.round(+$('#ve-wave', m).value || 0);
          if (esp + wav > du) throw new Error(`Le client ne doit que ${money(du)}.`);
          const r = await DB.vendeurEncaisser(V.session.id, V.session.token, c.id, [['especes', esp], ['wave', wav]].filter(([, x]) => x > 0).map(([compte, montant]) => ({ compte, montant })));
          close(); toast(r.statut === 'payee' ? 'Vente entièrement réglée' : 'Remboursement enregistré');
          await chargerV(); renderPageV(false);
        });
      },
    });
  },
  'v-annuler': async (el) => {
    const c = V.data.ventes.find((x) => x.id === el.dataset.id);
    const paye = (c.montant_paye || 0) - (c.rendu || 0);
    if (!(await confirmBox(`Annuler la vente <b>${esc(c.numero)}</b> ?<br><span class="small muted">Les articles retournent dans le stock Noecy${paye > 0 ? ` et ${money(paye)} sont rendus au client (sortie de votre caisse)` : ''}.</span>`, { ok: 'Annuler la vente', danger: true }))) return;
    await run(null, async () => { await DB.vendeurAnnuler(V.session.id, V.session.token, c.id); toast('Vente annulée'); await chargerV(); renderPageV(false); });
  },
});
INP['v-q'] = debounce((el) => {
  V.q = el.value;
  const pos = el.selectionStart;
  renderPageV(false);
  const n = $('[data-inp="v-q"]'); if (n) { n.focus(); n.setSelectionRange(pos, pos); }
}, 200);

startV();
