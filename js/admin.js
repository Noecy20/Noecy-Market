/*
 * Noecy Market — espace gérante : base, tableau de bord, commandes, clients
 */
'use strict';

const A = {
  ready: false, page: 'dashboard', periode: '30', poll: null, sig: '', charts: {}, v2: true,
  produits: [], categories: [], clients: [], commandes: [], fabrications: [], ecritures: [], matieres: [], achats: [],
  f: { cmd: 'en_attente', cli: 'en_attente', q: '', gl: '30', glType: 'tous', glCompte: 'tous', cat: 'tous', inv: 'produits' },
  seen: null,
};
const prod = (id) => A.produits.find((p) => p.id === id);
const client = (id) => A.clients.find((c) => c.id === id);
const matiere = (id) => A.matieres.find((m) => m.id === id);
const seuilOf = (p) => (p.seuil_alerte ?? SETTINGS.seuil_defaut ?? 5);

/* ---------- Règles d'argent d'une commande ----------
 * statut : en_attente → (reservee) → payee | credit (= livrée, stock déduit) ; annulee
 * montant_paye = total des paiements reçus ; rendu = argent rendu au client
 */
const PAYE = (c) => (Number(c.montant_paye) || 0) - (Number(c.rendu) || 0);
const isLivree = (c) => c.statut === 'payee' || c.statut === 'credit';
const isConfirmed = isLivree;
// Ce que le client nous doit encore (commande livrée)
const reste = (c) => (isLivree(c) ? Math.max(0, (Number(c.total) || 0) - PAYE(c)) : 0);
// Argent que nous devons rendre (monnaie non rendue, commande annulée déjà payée)
const aRendre = (c) => (c.statut === 'annulee' ? Math.max(0, PAYE(c)) : isLivree(c) ? Math.max(0, PAYE(c) - c.total) : 0);
// Marchandise déjà payée mais pas encore remise
const prepaye = (c) => (c.statut === 'en_attente' || c.statut === 'reservee' ? Math.max(0, PAYE(c)) : 0);
const nousDevons = (c) => aRendre(c) + prepaye(c);
const paiementsTxt = (c) => {
  const t = {};
  (c.paiements || []).forEach((p) => { const k = p.compte || p.moyen || 'especes'; t[k] = (t[k] || 0) + Number(p.montant); });
  return Object.entries(t).map(([k, v]) => `${compteLbl(k)} ${money(v)}`).join(' · ');
};

function avgCost(pid) {
  const f = A.fabrications.filter((x) => x.produit_id === pid);
  const q = sum(f, 'quantite');
  return q ? sum(f, 'cout_total') / q : 0;
}
const achatsVrac = (pid, since = null) => sum(A.achats.filter((a) => a.produit_id === pid && (!since || a.date >= since)), 'montant');

async function loadAll() {
  const [s, ...rows] = await Promise.all([
    DB.getSettings(),
    ...DB.TABLES.map((t) => DB.all(t).catch((e) => {
      // Tables ajoutées par la migration v2 : l'app reste utilisable sans elles
      if (t === 'matieres' || t === 'achats') { A.v2 = false; return []; }
      throw e;
    })),
  ]);
  SETTINGS = s;
  DB.TABLES.forEach((t, i) => { A[t] = rows[i] || []; });
  A.categories.sort((a, b) => (a.ordre || 0) - (b.ordre || 0));
  A.ecritures.forEach((e) => { if (!e.compte) e.compte = 'especes'; });
  CATS = A.categories;
}
const adminSig = () => [
  A.commandes.map((c) => c.id + c.statut + c.montant_paye + c.rendu).join(),
  A.clients.map((c) => c.id + c.statut + c.a_code).join(),
  A.produits.map((p) => p.id + p.stock + p.prix + p.actif + p.suivi_stock).join(),
  A.matieres.map((m) => m.id + m.stock).join(),
  A.ecritures.length, A.fabrications.length, A.achats.length, A.categories.length,
].join('#');

async function startAdmin() {
  document.body.className = 'admin';
  try { SETTINGS = await DB.getSettings(); } catch (e) { /* hors ligne */ }
  if (!(await DB.isAdmin())) return renderLogin();
  try { await loadAll(); } catch (e) { toast(e.message, 'err'); return renderLogin(); }
  A.sig = adminSig();
  A.seen = new Set([...A.commandes.map((c) => c.id), ...A.clients.map((c) => c.id)]);
  A.ready = true;
  renderShell();
  renderPage();
  clearInterval(A.poll);
  A.poll = setInterval(adminPoll, 15000);
}
function stopAdmin() { clearInterval(A.poll); A.poll = null; A.ready = false; destroyCharts(); }

async function adminPoll() {
  if (!A.ready) return;
  try { await loadAll(); } catch (e) { return; }
  let news = 0;
  A.commandes.filter((c) => !A.seen.has(c.id)).forEach((c) => {
    news++; A.seen.add(c.id);
    const txt = `${c.client_nom} · ${money(c.total)}${c.date_reservation ? ' · pour le ' + fDate(c.date_reservation) : ''}`;
    toast(`Nouvelle commande ${c.numero} — ${txt}`, 'info', 7000);
    if (DB.mode === 'local' && document.hidden) localNotify(`Nouvelle commande ${c.numero}`, txt, '/#/admin/commandes');
  });
  A.clients.filter((c) => !A.seen.has(c.id)).forEach((c) => {
    news++; A.seen.add(c.id);
    toast(`${c.nom} demande à être validé(e)`, 'info', 7000);
    if (DB.mode === 'local' && document.hidden) localNotify('Nouveau client à valider', c.nom, '/#/admin/clients');
  });
  if (news && !document.hidden) ding();
  const sig = adminSig();
  if (sig !== A.sig) { A.sig = sig; updateNav(); if (!$('.modal-wrap') && !document.hidden) renderPage(false); }
}

async function reload() { await loadAll(); A.sig = adminSig(); A.commandes.forEach((c) => A.seen.add(c.id)); A.clients.forEach((c) => A.seen.add(c.id)); }
async function refreshAfter() { await reload(); updateNav(); renderPage(false); }

/* ---------- Connexion ---------- */
async function renderLogin() {
  const local = DB.mode === 'local';
  $('#app').innerHTML = `<div class="login">
    <div class="blob" style="width:340px;height:340px;background:#f6a609;right:-80px;top:-60px"></div>
    <div class="blob" style="width:300px;height:300px;background:#e0435a;left:-80px;bottom:-60px;animation-delay:-6s"></div>
    <form class="login-card" id="login-form">
      <a class="brand" href="#/"><span class="brand-logo">N</span><span class="brand-name">Noecy <b>Market</b></span></a>
      <h2>Espace gérante</h2>
      <p class="sub">${local ? 'Entrez votre code PIN' : 'Connectez-vous avec votre compte gérante'}</p>
      ${local
        ? `<div class="field"><input class="pin-input" id="l-pin" type="password" inputmode="numeric" pattern="[0-9]{4,8}" maxlength="8" placeholder="••••" required autocomplete="current-password"></div>`
        : `<div class="field"><label>E-mail</label><input id="l-email" type="email" required autocomplete="username"></div>
           <div class="field"><label>Mot de passe</label><input id="l-pass" type="password" required autocomplete="current-password"></div>`}
      <button class="btn primary lg block" type="submit">Se connecter ${ic('arrow-right')}</button>
      <p class="small muted" style="text-align:center;margin-top:16px"><a href="#/" style="color:var(--plum2)">Retour à la boutique</a></p>
    </form></div>`;
  icons();
  setTimeout(() => ($('#l-pin') || $('#l-email'))?.focus(), 300);
  $('#login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const card = $('#login-form');
    run(e.submitter, async () => {
      try {
        if (local) {
          const pin = $('#l-pin').value.trim();
          if (!/^\d{4,8}$/.test(pin)) throw new Error('Le code doit contenir 4 à 8 chiffres.');
          await DB.login(null, pin);
        } else {
          await DB.login($('#l-email').value.trim(), $('#l-pass').value);
        }
      } catch (err) {
        card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
        throw err;
      }
      toast('Bienvenue');
      await startAdmin();
    });
  });
}

/* ---------- Coque ---------- */
const NAV = [
  ['dashboard', 'Tableau de bord', 'layout-dashboard'],
  ['commandes', 'Commandes', 'shopping-cart'],
  ['clients', 'Clients', 'users'],
  ['caisse', 'Caisse', 'wallet'],
  ['produits', 'Produits', 'package'],
  ['inventaire', 'Stock & achats', 'factory'],
  ['rentabilite', 'Rentabilité', 'trending-up'],
  ['relances', 'Crédits & dettes', 'hand-coins'],
  ['parametres', 'Paramètres', 'settings'],
];

function navBadges() {
  return {
    commandes: [A.commandes.filter((c) => c.statut === 'en_attente').length, ''],
    clients: [A.clients.filter((c) => c.statut === 'en_attente').length, ''],
    relances: [A.commandes.filter((c) => c.statut === 'credit' || nousDevons(c) > 0).length, 'red'],
    inventaire: [A.produits.filter((p) => p.actif && suivi(p) && p.stock <= seuilOf(p)).length + A.matieres.filter((m) => m.seuil > 0 && m.stock <= m.seuil).length, 'red'],
  };
}

function renderShell() {
  $('#app').innerHTML = `<div class="adm">
    <aside class="side" id="side">
      <div class="side-brand"><span class="brand-logo">N</span><div><span class="brand-name">Noecy <b>Market</b></span><small>Espace gérante</small></div></div>
      <nav class="nav" id="nav"></nav>
      <div class="side-foot">
        <div class="mode-pill ${DB.mode === 'local' ? '' : 'cloud'}"><i class="d"></i>${DB.mode === 'local' ? 'Mode local (démo)' : 'En ligne · Supabase'}</div>
        <a href="#/" target="_blank">${ic('store')} Voir la boutique</a>
        <button data-act="logout">${ic('log-out')} Déconnexion</button>
      </div>
    </aside>
    <div class="side-scrim" data-act="toggle-side"></div>
    <main class="adm-main">
      <header class="adm-top">
        <button class="icon-btn only-mobile" data-act="toggle-side" aria-label="Menu">${ic('menu')}</button>
        <h2 id="page-title"></h2>
        <div class="tr">
          <button class="icon-btn" data-act="refresh" title="Actualiser">${ic('refresh-cw')}</button>
          <button class="btn primary" data-act="quick-sale">${ic('plus')}<span class="hide-mobile">Nouvelle vente</span></button>
        </div>
      </header>
      <div id="page" class="page"></div>
    </main>
  </div>`;
  updateNav();
  icons();
}

function updateNav() {
  const b = navBadges();
  const nav = $('#nav');
  if (!nav) return;
  nav.innerHTML = NAV.map(([k, l, i]) => {
    const [n, cls] = b[k] || [0, ''];
    return `<a href="#/admin/${k}" class="${A.page === k ? 'on' : ''}">${ic(i)}<span>${l}</span>${n ? `<span class="nb ${cls}">${n}</span>` : ''}</a>`;
  }).join('');
  icons();
}

const PAGES = {};
function renderPage(animate = true) {
  const P = PAGES[A.page] || PAGES.dashboard;
  destroyCharts();
  $('#page-title').textContent = P.title;
  document.title = `${P.title} · Noecy Market`;
  const el = $('#page');
  const y = scrollY;
  const banner = A.v2 ? '' : `<div class="note-box" style="margin-bottom:16px">${ic('database')}<div><b>Mise à jour de la base requise.</b> Exécutez le fichier <code>supabase/migration_v2.sql</code> dans Supabase (SQL Editor) pour activer la caisse par compte, les matières premières, les réservations et les notifications.</div></div>`;
  el.innerHTML = banner + P.render();
  if (animate) { el.classList.remove('enter'); void el.offsetWidth; el.classList.add('enter'); window.scrollTo({ top: 0 }); }
  else { el.classList.remove('enter'); window.scrollTo({ top: y }); }
  icons();
  if (animate) countUp(el); else $$('[data-count]', el).forEach((x) => { x.textContent = x.hasAttribute('data-money') ? money(+x.dataset.count) : num(+x.dataset.count); });
  if (P.after) P.after(animate);
  updateNav();
}

function destroyCharts() { Object.values(A.charts).forEach((c) => { try { c.destroy(); } catch (e) { /* ignore */ } }); A.charts = {}; }

Object.assign(ACT, {
  'toggle-side': () => document.body.classList.toggle('side-open'),
  'logout': async () => {
    await DB.logout(); stopAdmin(); CURRENT = null;
    if (location.hash === '#/admin') route(); else location.hash = '#/admin';
  },
  'refresh': (el) => run(el, async () => { await refreshAfter(); toast('Données à jour'); }),
  'goto': (el) => { if (el.dataset.f) A.f.cmd = el.dataset.f; location.hash = '#/admin/' + el.dataset.page; },
  'periode': (el) => { A.periode = el.dataset.p; renderPage(); },
});
INP['adm-q'] = debounce((el) => {
  A.f.q = el.value;
  const pos = el.selectionStart;
  renderPage(false);
  const n = $('[data-inp="adm-q"]'); if (n) { n.focus(); n.setSelectionRange(pos, pos); }
}, 250);

const kpi = (label, val, icon, cls, isMoney, sub = '', i = 0, page = '') => `<div class="kpi ${cls} ${page ? 'link' : ''}" style="--i:${i}" ${page ? `data-act="goto" data-page="${page}"` : ''}>
  <div class="ki">${ic(icon)}</div><div class="kl">${label}</div>
  <div class="kv" data-count="${Math.round(val)}" ${isMoney ? 'data-money' : ''}>0</div>${sub ? `<div class="ks">${sub}</div>` : ''}</div>`;

/* ---------- Champs de paiement communs (espèces + Wave) ---------- */
function payBlockHtml(dEsp = 0, dWave = 0, { renduChoix = true } = {}) {
  return `<div class="row pay-fields">
      <div class="field"><label>${ic('banknote', 'sm')} Espèces reçues</label><input id="pm-esp" type="number" min="0" step="1" inputmode="numeric" value="${dEsp ? Math.round(dEsp) : ''}" placeholder="0"></div>
      <div class="field"><label>${ic('waves', 'sm')} Wave reçu</label><input id="pm-wave" type="number" min="0" step="1" inputmode="numeric" value="${dWave ? Math.round(dWave) : ''}" placeholder="0"></div>
    </div>
    <div class="pm-sum" id="pm-sum"></div>
    ${renduChoix ? `<div id="pm-rendu" class="pm-rendu hidden">
      <label class="check"><input type="radio" name="pm-r" value="rendue" checked> J'ai rendu la monnaie</label>
      <label class="check"><input type="radio" name="pm-r" value="dette"> Je n'ai pas rendu la monnaie : je dois la différence au client</label>
    </div>` : ''}`;
}

// Branche le calcul en direct ; renvoie une fonction qui donne la liste des paiements [{compte, montant}]
function mountPay(el, getDu, { libReste = 'Reste en crédit', cap = false } = {}) {
  const vals = () => ({ e: Math.max(0, Math.round(+$('#pm-esp', el).value || 0)), w: Math.max(0, Math.round(+$('#pm-wave', el).value || 0)) });
  const upd = () => {
    const du = getDu();
    const { e, w } = vals();
    const recu = e + w, diff = recu - du;
    let h = `<div class="total-row"><span class="muted">À payer</span><b>${money(du)}</b></div>
      <div class="total-row"><span class="muted">Reçu</span><b>${money(recu)}</b></div>`;
    if (diff < 0) h += `<div class="total-row"><span>${libReste}</span><b class="amt-out">${money(-diff)}</b></div>`;
    else if (diff > 0) h += `<div class="total-row"><span>${cap ? 'Montant trop élevé' : 'Trop perçu'}</span><b class="amt-in">${money(diff)}</b></div>`;
    $('#pm-sum', el).innerHTML = h;
    const r = $('#pm-rendu', el); if (r) r.classList.toggle('hidden', !(diff > 0));
  };
  el.addEventListener('input', upd);
  upd();
  return () => {
    let { e, w } = vals();
    const diff = e + w - getDu();
    if (diff > 0 && cap) throw new Error(`Le montant dépasse ce qui est dû (${money(getDu())}).`);
    if (diff > 0 && ($('input[name=pm-r]:checked', el)?.value || 'rendue') === 'rendue') {
      const de = Math.min(e, diff); e -= de; w -= diff - de;
    }
    return [['especes', e], ['wave', w]].filter(([, m]) => m > 0).map(([compte, montant]) => ({ compte, montant }));
  };
}

// Valeurs proposées selon le moyen choisi par le client
function defautsPaiement(c, du) {
  if (c.moyen_paiement === 'wave') return [0, du];
  if (c.moyen_paiement === 'mixte' && c.repartition && !PAYE(c)) {
    const w = Math.min(du, Number(c.repartition.wave) || 0);
    return [Math.max(0, du - w), w];
  }
  if (c.moyen_paiement === 'credit') return [0, 0];
  return [du, 0];
}

/* ---------- Statistiques ---------- */
function periodStart(p) {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  if (p === '7') d.setDate(d.getDate() - 6);
  else if (p === '30') d.setDate(d.getDate() - 29);
  else if (p === 'mois') d.setDate(1);
  else return new Date(0);
  return d;
}
const confirmedAt = (c) => toDate(c.confirmed_at || c.created_at);
const soldes = () => {
  const s = { especes: 0, wave: 0 };
  A.ecritures.forEach((e) => { const k = e.compte || 'especes'; s[k] = (s[k] || 0) + (e.type === 'entree' ? 1 : -1) * Number(e.montant); });
  return s;
};

function soldSince(since) {
  const m = {};
  A.commandes.filter((c) => isLivree(c) && confirmedAt(c) >= since).forEach((c) => {
    (c.lignes || []).forEach((l) => { m[l.produit_id] = (m[l.produit_id] || 0) + Number(l.quantite); });
  });
  return m;
}

function computeStats() {
  const start = periodStart(A.periode);
  const sk = dayKey(start);
  const ventes = A.commandes.filter((c) => isLivree(c) && confirmedAt(c) >= start);
  const ca = sum(ventes, 'total');
  const cout = sum(ventes, 'cout_revient');
  const vrac = sum(A.achats.filter((a) => a.produit_id && a.date >= sk), 'montant');
  const horsTransfert = (e) => e.categorie !== 'transfert';
  const entrees = A.ecritures.filter((e) => e.type === 'entree' && e.date >= sk && horsTransfert(e));
  const sorties = A.ecritures.filter((e) => e.type === 'sortie' && e.date >= sk && horsTransfert(e));
  const credits = A.commandes.filter((c) => c.statut === 'credit');
  const actifs = A.produits.filter((p) => p.actif && suivi(p));
  const articles = sum(ventes, (c) => sum(c.lignes || [], 'quantite'));
  const benef = ca - cout - vrac;

  const nbJours = A.periode === '7' ? 7 : A.periode === 'mois' ? new Date().getDate() : 30;
  const labels = [], serieCA = [], serieEnc = [];
  for (let i = nbJours - 1; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const k = dayKey(d);
    labels.push(d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }));
    serieCA.push(sum(A.commandes.filter((c) => isLivree(c) && dayKey(confirmedAt(c)) === k), 'total'));
    serieEnc.push(sum(A.ecritures.filter((e) => e.type === 'entree' && e.date === k && horsTransfert(e)), 'montant'));
  }

  const parCat = {}, parProd = {}, parClient = {};
  ventes.forEach((c) => {
    (c.lignes || []).forEach((l) => {
      const p = prod(l.produit_id);
      const cid = p?.categorie_id || 'autre';
      parCat[cid] = (parCat[cid] || 0) + l.prix * l.quantite;
      const pp = parProd[l.produit_id] || (parProd[l.produit_id] = { nom: l.nom, q: 0, ca: 0 });
      pp.q += Number(l.quantite); pp.ca += l.prix * l.quantite;
    });
    const k = c.client_id || 'passage:' + c.client_nom;
    const pc = parClient[k] || (parClient[k] = { nom: c.client_nom, n: 0, ca: 0 });
    pc.n++; pc.ca += c.total;
  });
  const today = dayKey();
  const resas = A.commandes.filter((c) => c.date_reservation && c.date_reservation >= today && (c.statut === 'en_attente' || c.statut === 'reservee'))
    .sort((a, b) => String(a.date_reservation).localeCompare(String(b.date_reservation)));

  return {
    ca, cout, benef, marge: ca ? (benef / ca) * 100 : 0, nbVentes: ventes.length, articles,
    encaisse: sum(entrees, 'montant'), depenses: sum(sorties, 'montant'),
    creances: sum(credits, reste), nbCredits: credits.length,
    devons: sum(A.commandes, nousDevons),
    soldes: soldes(),
    valeurStock: sum(actifs, (p) => p.stock * p.prix), unitesStock: sum(actifs, 'stock'),
    panier: ventes.length ? ca / ventes.length : 0,
    serie: { labels, ca: serieCA, enc: serieEnc },
    parCat, topProd: Object.entries(parProd).sort((a, b) => b[1].q - a[1].q).slice(0, 5),
    topClients: Object.values(parClient).sort((a, b) => b.ca - a.ca).slice(0, 5),
    enAttente: A.commandes.filter((c) => c.statut === 'en_attente'),
    clientsAttente: A.clients.filter((c) => c.statut === 'en_attente'),
    resas,
  };
}

/* ---------- Alertes (masquables pour la journée) ---------- */
const LS_ALERTES = 'noecy_alertes_masquees';
function alertesMasquees() {
  try {
    const m = JSON.parse(localStorage.getItem(LS_ALERTES)) || {};
    const t = dayKey();
    return Object.fromEntries(Object.entries(m).filter(([, d]) => d === t));
  } catch (e) { return {}; }
}

function computeAlerts() {
  const out = [];
  const since7 = new Date(); since7.setDate(since7.getDate() - 7);
  const sold7 = soldSince(since7);
  A.produits.filter((p) => p.actif && suivi(p)).forEach((p) => {
    const v = (sold7[p.id] || 0) / 7;
    if (p.stock <= 0) out.push({ k: 'rupture-' + p.id, lvl: 'danger', icon: 'package-x', txt: `<b>${esc(p.nom)}</b> est en rupture de stock.`, page: 'inventaire', btn: 'Fabriquer' });
    else if (v > 0 && p.stock / v <= 3) out.push({ k: 'vite-' + p.id, lvl: 'hot', icon: 'flame', txt: `<b>${esc(p.nom)}</b> part vite : ${num(sold7[p.id])} vendu(s) en 7 jours, plus que <b>${p.stock}</b> en stock (≈ ${Math.max(1, Math.round(p.stock / v))} jour(s)).`, page: 'inventaire', btn: 'Réapprovisionner' });
    else if (p.stock <= seuilOf(p)) out.push({ k: 'bas-' + p.id, lvl: 'warn', icon: 'triangle-alert', txt: `Stock bas : <b>${esc(p.nom)}</b> — ${p.stock} restant(s) (seuil ${seuilOf(p)}).`, page: 'inventaire', btn: 'Voir' });
  });
  A.matieres.filter((m) => m.seuil > 0 && m.stock <= m.seuil).forEach((m) => {
    out.push({ k: 'mat-' + m.id, lvl: 'warn', icon: 'wheat', txt: `Matière bientôt épuisée : <b>${esc(m.nom)}</b> — ${num(m.stock)} ${esc(m.unite || '')} restant(s).`, page: 'inventaire', btn: 'Acheter' });
  });
  const today = dayKey(), dem = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return dayKey(d); })();
  const resaJ = A.commandes.filter((c) => (c.statut === 'en_attente' || c.statut === 'reservee') && c.date_reservation && c.date_reservation <= dem);
  if (resaJ.length) {
    const auj = resaJ.filter((c) => c.date_reservation <= today).length;
    out.push({ k: 'resa', lvl: 'hot', icon: 'calendar-clock', txt: `<b>${resaJ.length}</b> réservation(s) à préparer${auj ? ` dont <b>${auj}</b> pour aujourd'hui` : ' pour demain'}.`, page: 'commandes', f: 'reservee', btn: 'Voir' });
  }
  const att = A.commandes.filter((c) => c.statut === 'en_attente').length;
  if (att) out.push({ k: 'att', lvl: 'info', icon: 'shopping-cart', txt: `<b>${att}</b> commande(s) en attente de validation.`, page: 'commandes', f: 'en_attente', btn: 'Traiter' });
  const cl = A.clients.filter((c) => c.statut === 'en_attente').length;
  if (cl) out.push({ k: 'cli', lvl: 'info', icon: 'user-check', txt: `<b>${cl}</b> client(s) attendent la validation de leur nom.`, page: 'clients', btn: 'Valider' });
  const retard = A.commandes.filter((c) => c.statut === 'credit' && daysSince(c.confirmed_at || c.created_at) >= 7);
  if (retard.length) out.push({ k: 'retard', lvl: 'danger', icon: 'hand-coins', txt: `<b>${retard.length}</b> crédit(s) impayé(s) depuis plus de 7 jours — ${money(sum(retard, reste))}.`, page: 'relances', btn: 'Relancer' });
  const dv = sum(A.commandes, nousDevons);
  if (dv > 0) out.push({ k: 'devons', lvl: 'warn', icon: 'undo-2', txt: `Vous devez <b>${money(dv)}</b> à des clients (monnaie, marchandise payée non remise ou remboursement).`, page: 'relances', btn: 'Voir' });
  const cache = alertesMasquees();
  return out.filter((a) => !cache[a.k]);
}

ACT['alert-hide'] = (el) => {
  const m = alertesMasquees();
  m[el.dataset.k] = dayKey();
  try { localStorage.setItem(LS_ALERTES, JSON.stringify(m)); } catch (e) { /* ignore */ }
  const box = el.closest('.alert');
  box.classList.add('gone');
  setTimeout(() => box.remove(), 350);
};

/* ---------- Tableau de bord ---------- */
PAGES.dashboard = {
  title: 'Tableau de bord',
  render() {
    const s = computeStats();
    const al = computeAlerts();
    A._stats = s;
    const maxQ = Math.max(1, ...s.topProd.map(([, v]) => v.q));
    const maxC = Math.max(1, ...s.topClients.map((v) => v.ca));
    const h = new Date().getHours();
    return `
    <div class="page-head">
      <div><h1>${h < 12 ? 'Bonjour' : h < 18 ? 'Bon après-midi' : 'Bonsoir'} Noecy</h1><p class="muted">Voici l'état de votre boutique — ${new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</p></div>
      <div class="seg">${[['7', '7 jours'], ['30', '30 jours'], ['mois', 'Ce mois'], ['tout', 'Tout']].map(([k, l]) => `<button class="${A.periode === k ? 'on' : ''}" data-act="periode" data-p="${k}">${l}</button>`).join('')}</div>
    </div>
    ${al.length ? `<div class="alerts">${al.map((a, i) => `<div class="alert ${a.lvl}" style="--i:${i}"><span class="ai">${ic(a.icon)}</span><span class="at">${a.txt}</span><button class="btn sm ghost" data-act="goto" data-page="${a.page}" ${a.f ? `data-f="${a.f}"` : ''}>${a.btn}</button><button class="icon-btn flat alert-x" data-act="alert-hide" data-k="${esc(a.k)}" title="Masquer pour aujourd'hui">${ic('x')}</button></div>`).join('')}</div>`
      : `<div class="alerts"><div class="alert ok"><span class="ai">${ic('circle-check')}</span><span class="at">Tout est sous contrôle pour le moment.</span></div></div>`}
    <div class="kpis">
      ${kpi("Chiffre d'affaires", s.ca, 'coins', '', true, `${s.nbVentes} vente(s) · ${num(s.articles)} article(s)`, 0)}
      ${kpi('Encaissé', s.encaisse, 'wallet', 'leaf', true, 'Argent réellement reçu', 1, 'caisse')}
      ${kpi('Bénéfice', s.benef, 'piggy-bank', 'mango', true, `Marge ${pct(s.marge)}`, 2, 'rentabilite')}
      ${kpi('Dépenses', s.depenses, 'receipt', 'caramel', true, 'Achats, fabrication, prélèvements', 3, 'caisse')}
      ${kpi('Caisse', s.soldes.especes + s.soldes.wave, 'landmark', '', true, `Espèces ${money(s.soldes.especes)} · Wave ${money(s.soldes.wave)}`, 4, 'caisse')}
      ${kpi('Crédits clients', s.creances, 'hand-coins', 'danger', true, `${s.nbCredits} commande(s) à crédit`, 5, 'relances')}
      ${kpi('Nous devons', s.devons, 'undo-2', 'caramel', true, 'Monnaie, avances, remboursements', 6, 'relances')}
      ${kpi('Valeur du stock', s.valeurStock, 'boxes', 'leaf', true, `${num(s.unitesStock)} unité(s) · panier moyen ${money(s.panier)}`, 7, 'inventaire')}
    </div>
    <div class="dash-grid">
      <div class="card span2"><div class="card-head"><h3>Évolution des ventes</h3><span class="small muted">Chiffre d'affaires vs encaissé</span></div><div class="chart-box"><canvas id="ch-ventes"></canvas></div></div>
      <div class="card"><div class="card-head"><h3>Ventes par catégorie</h3></div>${Object.keys(s.parCat).length ? '<div class="chart-box sm"><canvas id="ch-cat"></canvas></div>' : `<div class="empty" style="padding:30px 0"><span class="big">${ic('chart-pie')}</span><p>Pas encore de ventes sur la période.</p></div>`}</div>
      <div class="card"><div class="card-head"><h3>Réservations à venir</h3><span class="small muted">${s.resas.length}</span></div>
        ${s.resas.length ? `<ul class="rank">${s.resas.slice(0, 6).map((c) => `<li><span class="pos date-pos"><b>${toDate(c.date_reservation).getDate()}</b><small>${toDate(c.date_reservation).toLocaleDateString('fr-FR', { month: 'short' })}</small></span><div class="rn"><b>${esc(c.client_nom)}</b><span class="small muted">${(c.lignes || []).map((l) => `${l.quantite}× ${esc(l.nom)}`).join(', ')}${c.heure_reservation ? ' · ' + esc(c.heure_reservation) : ''}</span></div><div class="rv">${money(c.total)}</div></li>`).join('')}</ul>
          <button class="btn soft block" style="margin-top:14px" data-act="goto" data-page="commandes" data-f="reservee">Toutes les réservations</button>` : '<p class="muted">Aucune réservation prévue.</p>'}
      </div>
      <div class="card"><div class="card-head"><h3>Meilleurs produits</h3><span class="small muted">Quantités</span></div>
        ${s.topProd.length ? `<ul class="rank">${s.topProd.map(([, v], i) => `<li><span class="pos">${i + 1}</span><div class="rn"><b>${esc(v.nom)}</b><div class="bar"><i style="width:${(v.q / maxQ) * 100}%"></i></div></div><div class="rv">${num(v.q)}<br><span class="small muted">${money(v.ca)}</span></div></li>`).join('')}</ul>` : '<p class="muted">Aucune vente sur la période.</p>'}
      </div>
      <div class="card"><div class="card-head"><h3>Meilleurs clients</h3><span class="small muted">Montant</span></div>
        ${s.topClients.length ? `<ul class="rank">${s.topClients.map((v, i) => `<li><span class="pos">${i + 1}</span><div class="rn"><b>${esc(v.nom)}</b><div class="bar leaf"><i style="width:${(v.ca / maxC) * 100}%"></i></div></div><div class="rv">${money(v.ca)}<br><span class="small muted">${v.n} cmd</span></div></li>`).join('')}</ul>` : '<p class="muted">Aucun client sur la période.</p>'}
      </div>
      <div class="card span3"><div class="card-head"><h3>À traiter</h3></div>
        ${s.enAttente.length || s.clientsAttente.length ? `<ul class="rank cols">
          ${s.clientsAttente.slice(0, 4).map((c) => `<li><span class="avatar sm">${esc(initials(c.nom))}</span><div class="rn"><b>${esc(c.nom)}</b><span class="small muted">Nom à valider</span></div><button class="btn sm leaf" data-act="cli-valider" data-id="${esc(c.id)}">${ic('check')}</button></li>`).join('')}
          ${s.enAttente.slice(0, 6).map((c) => `<li><span class="pos">${ic('receipt')}</span><div class="rn"><b>${esc(c.numero)} · ${esc(c.client_nom)}</b><span class="small muted">${fDateTime(c.created_at)}</span></div><div class="rv">${money(c.total)}</div></li>`).join('')}
        </ul><button class="btn soft block" style="margin-top:14px" data-act="goto" data-page="commandes" data-f="en_attente">Voir les commandes</button>` : '<p class="muted">Rien en attente.</p>'}
      </div>
    </div>`;
  },
  after() {
    if (!window.Chart) return;
    const s = A._stats;
    Chart.defaults.font.family = 'Outfit, sans-serif';
    Chart.defaults.color = '#8a7887';
    const cv = $('#ch-ventes');
    if (cv) {
      const ctx = cv.getContext('2d');
      const g = ctx.createLinearGradient(0, 0, 0, 280);
      g.addColorStop(0, 'rgba(160,42,110,.32)'); g.addColorStop(1, 'rgba(160,42,110,0)');
      A.charts.v = new Chart(ctx, {
        type: 'line',
        data: { labels: s.serie.labels, datasets: [
          { label: "Chiffre d'affaires", data: s.serie.ca, borderColor: '#a02a6e', backgroundColor: g, fill: true, tension: 0.4, pointRadius: 0, pointHoverRadius: 6, pointBackgroundColor: '#a02a6e', borderWidth: 2.5 },
          { label: 'Encaissé', data: s.serie.enc, borderColor: '#f6a609', tension: 0.4, pointRadius: 0, pointHoverRadius: 6, borderWidth: 2, borderDash: [6, 4] },
        ] },
        options: {
          responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
          animation: { duration: 1100, easing: 'easeOutQuart' },
          plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, padding: 16 } }, tooltip: { backgroundColor: '#22131f', padding: 12, cornerRadius: 12, callbacks: { label: (c) => ` ${c.dataset.label} : ${money(c.parsed.y)}` } } },
          scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 7 } }, y: { beginAtZero: true, grid: { color: '#f3eaef' }, border: { display: false }, ticks: { callback: (v) => num(v), maxTicksLimit: 5 } } },
        },
      });
    }
    const cc = $('#ch-cat');
    if (cc) {
      const ids = Object.keys(s.parCat);
      A.charts.c = new Chart(cc, {
        type: 'doughnut',
        data: { labels: ids.map((id) => { const c = catOf(id); return c ? c.nom : 'Autre'; }), datasets: [{ data: ids.map((id) => s.parCat[id]), backgroundColor: ids.map((id, i) => catOf(id)?.couleur || ['#a02a6e', '#f6a609', '#c26a26', '#1c9a69'][i % 4]), borderWidth: 3, borderColor: '#fff', hoverOffset: 10 }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: '68%', animation: { animateRotate: true, duration: 1200 }, plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, padding: 14 } }, tooltip: { backgroundColor: '#22131f', padding: 12, cornerRadius: 12, callbacks: { label: (c) => ` ${money(c.parsed)}` } } } },
      });
    }
  },
};

/* ---------- Services métier : commandes et argent ---------- */
async function checkStock(lignes) {
  for (const l of lignes) {
    const p = prod(l.produit_id);
    if (!p) throw new Error(`Produit introuvable : ${l.nom}`);
    if (suivi(p) && p.stock < l.quantite) throw new Error(`Stock insuffisant pour ${p.nom} : ${p.stock} disponible(s), ${l.quantite} demandé(s). Enregistrez d'abord une fabrication.`);
  }
}

const LIB_PAIEMENT = { vente: 'Vente', acompte: 'Avance', recouvrement: 'Remboursement crédit' };
async function ecrirePaiements(c, pays, categorie) {
  const now = iso(), out = [];
  for (const p of pays) {
    await DB.insert('ecritures', { date: dayKey(), libelle: `${LIB_PAIEMENT[categorie] || 'Paiement'} ${c.numero} – ${c.client_nom}`, type: 'entree', categorie, compte: p.compte, montant: p.montant, ref: c.id });
    out.push({ date: now, montant: p.montant, compte: p.compte });
  }
  return out;
}

// Remise de la commande au client : le stock est déduit (produits comptés uniquement)
async function deliverOrder(c, pays = []) {
  await reload();
  c = A.commandes.find((x) => x.id === c.id) || c;
  if (c.statut !== 'en_attente' && c.statut !== 'reservee') throw new Error('Cette commande a déjà été livrée ou annulée.');
  await checkStock(c.lignes);
  for (const l of c.lignes) {
    const p = prod(l.produit_id);
    if (p && suivi(p)) { p.stock -= l.quantite; await DB.update('produits', p.id, { stock: p.stock }); }
  }
  const cout = sum(c.lignes, (l) => { const p = prod(l.produit_id); return p && suivi(p) ? l.quantite * avgCost(l.produit_id) : 0; });
  const nouv = await ecrirePaiements(c, pays, 'vente');
  const paye = (Number(c.montant_paye) || 0) + sum(pays, 'montant');
  const statut = paye - (Number(c.rendu) || 0) >= c.total ? 'payee' : 'credit';
  const now = iso();
  await DB.update('commandes', c.id, {
    statut, montant_paye: paye, cout_revient: cout, confirmed_at: now, livree_at: now,
    paid_at: statut === 'payee' ? now : null, paiements: [...(c.paiements || []), ...nouv],
  });
  return statut;
}

// Réservation acceptée : rien n'est déduit du stock, une avance est possible
async function acceptReservation(c, pays = []) {
  const nouv = await ecrirePaiements(c, pays, 'acompte');
  await DB.update('commandes', c.id, {
    statut: 'reservee', montant_paye: (Number(c.montant_paye) || 0) + sum(pays, 'montant'), paiements: [...(c.paiements || []), ...nouv],
  });
}

async function addPayments(c, pays) {
  if (!pays.length) throw new Error('Saisissez un montant.');
  const cat = c.statut === 'credit' ? 'recouvrement' : isLivree(c) ? 'vente' : 'acompte';
  const nouv = await ecrirePaiements(c, pays, cat);
  const paye = (Number(c.montant_paye) || 0) + sum(pays, 'montant');
  const patch = { montant_paye: paye, paiements: [...(c.paiements || []), ...nouv] };
  if (isLivree(c)) {
    patch.statut = paye - (Number(c.rendu) || 0) >= c.total ? 'payee' : 'credit';
    patch.paid_at = patch.statut === 'payee' ? iso() : null;
  }
  await DB.update('commandes', c.id, patch);
  return patch.statut || c.statut;
}

// Argent rendu au client (monnaie, remboursement)
async function rendreArgent(c, montant, compte) {
  montant = Math.round(montant);
  if (!(montant > 0)) throw new Error('Montant invalide.');
  await DB.insert('ecritures', { date: dayKey(), libelle: `Argent rendu ${c.numero} – ${c.client_nom}`, type: 'sortie', categorie: 'rendu', compte, montant, ref: c.id });
  await DB.update('commandes', c.id, { rendu: (Number(c.rendu) || 0) + montant });
}

async function cancelOrder(c, rembourserVia = null) {
  if (isLivree(c)) {
    for (const l of c.lignes) {
      const p = prod(l.produit_id);
      if (p && suivi(p)) { p.stock += Number(l.quantite); await DB.update('produits', p.id, { stock: p.stock }); }
    }
  }
  await DB.update('commandes', c.id, { statut: 'annulee' });
  if (rembourserVia && PAYE(c) > 0) await rendreArgent({ ...c, statut: 'annulee' }, PAYE(c), rembourserVia);
}

// Remboursement d'un client : réparti sur ses crédits, du plus ancien au plus récent
async function rembourserClient(clientId, pays) {
  const credits = A.commandes.filter((c) => c.client_id === clientId && c.statut === 'credit')
    .sort((a, b) => String(a.confirmed_at || a.created_at).localeCompare(String(b.confirmed_at || b.created_at)));
  const file = pays.map((p) => ({ ...p }));
  for (const c of credits) {
    let need = reste(c);
    const part = [];
    while (need > 0 && file.length) {
      const f = file[0], m = Math.min(need, f.montant);
      part.push({ compte: f.compte, montant: m });
      f.montant -= m; need -= m;
      if (f.montant <= 0) file.shift();
    }
    if (part.length) await addPayments(c, part);
    if (!file.length) break;
  }
}

/* ---------- Commandes ---------- */
const CMD_TABS = [
  ['en_attente', 'En attente', (c) => c.statut === 'en_attente'],
  ['reservee', 'Réservations', (c) => c.statut === 'reservee' || (c.statut === 'en_attente' && c.date_reservation)],
  ['credit', 'À crédit', (c) => c.statut === 'credit'],
  ['devons', 'Nous devons', (c) => nousDevons(c) > 0],
  ['payee', 'Payées', (c) => c.statut === 'payee'],
  ['annulee', 'Annulées', (c) => c.statut === 'annulee'],
  ['toutes', 'Toutes', () => true],
];

PAGES.commandes = {
  title: 'Commandes',
  render() {
    const q = norm(A.f.q);
    const tab = CMD_TABS.find((t) => t[0] === A.f.cmd) || CMD_TABS[0];
    const list = A.commandes.filter(tab[2])
      .filter((c) => !q || norm(c.numero + ' ' + c.client_nom).includes(q))
      .sort((a, b) => A.f.cmd === 'reservee'
        ? String(a.date_reservation || '9999').localeCompare(String(b.date_reservation || '9999'))
        : String(b.created_at).localeCompare(String(a.created_at)));
    return `
    <div class="page-head"><div><h1>Commandes</h1><p class="muted">Le stock est déduit quand vous remettez la commande. Les avances et la monnaie non rendue sont suivies.</p></div>
      <button class="btn primary" data-act="quick-sale">${ic('plus')} Nouvelle vente</button></div>
    <div class="toolbar">
      <div class="seg scroll">${CMD_TABS.map(([k, l, f]) => { const n = ['en_attente', 'reservee', 'credit', 'devons'].includes(k) ? A.commandes.filter(f).length : 0; return `<button class="${A.f.cmd === k ? 'on' : ''}" data-act="f-cmd" data-k="${k}">${l}${n ? `<span class="count">${n}</span>` : ''}</button>`; }).join('')}</div>
      <label class="search field" style="margin:0">${ic('search')}<input class="input" placeholder="N° ou client…" data-inp="adm-q" value="${esc(A.f.q)}"></label>
    </div>
    <div class="cards">${list.length ? list.map(orderCard).join('') : `<div class="empty"><span class="big">${ic('receipt')}</span><h3>Aucune commande ici</h3></div>`}</div>`;
  },
};

function orderCard(c, i) {
  const cl = client(c.client_id);
  const lines = (c.lignes || []).map((l) => {
    const p = prod(l.produit_id);
    const bad = !isLivree(c) && c.statut !== 'annulee' && p && suivi(p) && p.stock < l.quantite;
    return `<li class="${bad ? 'bad' : ''}"><span>${l.quantite} × ${esc(l.nom)}${bad ? ` <small>(stock : ${p.stock})</small>` : ''}</span><span>${money(l.prix * l.quantite)}</span></li>`;
  }).join('');
  const pay = PAY[c.moyen_paiement];
  const id = esc(c.id);
  const r = reste(c), dv = nousDevons(c), paye = PAYE(c);
  const btn = (act, cls, icon, txt, extra = '') => `<button class="btn ${cls} sm" data-act="${act}" data-id="${id}" ${extra}>${ic(icon)} ${txt}</button>`;
  let actions = [];
  if (c.statut === 'en_attente' || c.statut === 'reservee') {
    actions.push(btn('cmd-livrer', 'leaf', 'check', 'Remettre & encaisser'));
    actions.push(btn('cmd-credit', 'mango', 'hand-coins', 'À crédit'));
    actions.push(c.statut === 'en_attente' ? btn('cmd-reserver', 'soft', 'calendar-check', 'Réserver') : btn('cmd-encaisser', 'soft', 'banknote', 'Avance'));
    actions.push(btn('cmd-annuler', 'ghost icon-only', 'x', '', 'title="Annuler"'));
  } else if (c.statut === 'credit') {
    actions.push(btn('cmd-encaisser', 'leaf', 'banknote', 'Encaisser'));
    if (cl?.telephone) actions.push(`<a class="btn ghost sm" href="${esc(relanceLink(c, cl))}" target="_blank" rel="noopener">${ic('message-circle')} Relancer</a>`);
    actions.push(btn('cmd-annuler', 'ghost icon-only', 'x', '', 'title="Annuler"'));
  } else if (c.statut === 'payee') {
    if (aRendre(c) > 0) actions.push(btn('cmd-rendre', 'mango', 'undo-2', `Rendre ${money(aRendre(c))}`));
    actions.push(btn('cmd-annuler', 'ghost', 'undo-2', 'Annuler la vente'));
  } else {
    if (aRendre(c) > 0) actions.push(btn('cmd-rendre', 'mango', 'undo-2', `Rembourser ${money(aRendre(c))}`));
    else actions.push(btn('cmd-suppr', 'ghost', 'trash-2', 'Supprimer'));
  }
  return `<div class="order-card st-${c.statut}" style="--i:${i}">
    <div class="oc-head"><div><b>${esc(c.numero)}</b> ${pillCmd(c.statut)}</div><span class="small muted">${fDateTime(c.created_at)}</span></div>
    ${c.date_reservation ? `<div class="resa-line">${ic('calendar-days', 'sm')} Pour le <b>${fDate(c.date_reservation)}</b>${c.heure_reservation ? ' · ' + esc(c.heure_reservation) : ''}</div>` : ''}
    <div class="oc-client">${ic('user')} ${esc(c.client_nom)} ${cl?.telephone ? `<span class="small muted">· ${esc(cl.telephone)}</span>` : ''}</div>
    <ul class="oc-lines">${lines}</ul>
    ${c.note ? `<p class="small" style="color:var(--ink2)">Note : ${esc(c.note)}</p>` : ''}
    <div class="oc-foot"><span class="pill ${c.moyen_paiement === 'wave' ? 'wave' : ''}">${pay ? ic(pay.icon) : ''} ${pay?.label || esc(c.moyen_paiement)}${c.moyen_paiement === 'mixte' && c.repartition ? ` · Wave ${money(c.repartition.wave)}` : ''}</span><span class="oc-total">${money(c.total)}</span></div>
    ${paye > 0 ? `<div class="small muted">Reçu : ${paiementsTxt(c)}${c.rendu ? ` · rendu ${money(c.rendu)}` : ''}</div>` : ''}
    ${c.statut === 'credit' ? `<div><div class="total-row small"><span class="muted">Payé ${money(paye)}</span><b style="color:var(--danger)">Reste ${money(r)}</b></div><div class="bar warn"><i style="width:${Math.min(100, (paye / c.total) * 100)}%"></i></div></div>` : ''}
    ${dv > 0 ? `<div class="owe-line">${ic('undo-2', 'sm')} ${aRendre(c) > 0 ? `Vous devez rendre <b>${money(aRendre(c))}</b> au client` : `Avance reçue : <b>${money(prepaye(c))}</b> (marchandise à remettre)`}</div>` : ''}
    <div class="oc-actions">${actions.join('')}</div>
  </div>`;
}

function relanceLink(c, cl) {
  const msg = (SETTINGS.message_relance || DB.DEFAULT_SETTINGS.message_relance)
    .replace(/\{nom\}/g, c.client_nom).replace(/\{montant\}/g, money(reste(c))).replace(/\{numero\}/g, c.numero);
  const wl = waveLink(reste(c));
  return waLink(cl?.telephone, msg + (wl ? `\n\nPaiement Wave : ${wl}` : ''));
}

// Fenêtre de paiement : mode 'livrer' | 'reserver' | 'encaisser'
function paiementModal(c, mode) {
  const du = mode === 'encaisser' && isLivree(c) ? reste(c) : Math.max(0, c.total - PAYE(c));
  const [dE, dW] = mode === 'reserver' ? [0, 0] : defautsPaiement(c, du);
  const titres = { livrer: 'Remettre la commande et encaisser', reserver: 'Accepter la réservation', encaisser: isLivree(c) ? 'Encaisser un remboursement' : 'Encaisser une avance' };
  const libReste = mode === 'livrer' || isLivree(c) ? 'Reste en crédit' : 'Reste à payer à la remise';
  modal({
    title: titres[mode],
    body: `<p class="muted" style="margin-bottom:12px">${esc(c.numero)} · ${esc(c.client_nom)} · Total ${money(c.total)}${PAYE(c) ? ` · déjà payé ${money(PAYE(c))}` : ''}</p>
      ${c.moyen_paiement === 'mixte' && c.repartition ? `<p class="small" style="margin-bottom:10px">Le client a prévu : Wave ${money(c.repartition.wave)} · Espèces ${money(c.repartition.especes)}</p>` : ''}
      ${mode === 'reserver' ? `<p class="small muted" style="margin-bottom:10px">${c.date_reservation ? `Prévue pour le <b>${fDate(c.date_reservation)}</b>. ` : ''}Le stock sera déduit le jour de la remise. Saisissez une avance si le client a déjà payé.</p>` : ''}
      ${payBlockHtml(dE, dW, { renduChoix: mode !== 'reserver' })}`,
    foot: `<button class="btn ghost" data-close>Annuler</button><button class="btn leaf" id="pm-ok">${ic('check')} Valider</button>`,
    onMount: (el, close) => {
      const lire = mountPay(el, () => du, { libReste, cap: mode === 'reserver' });
      $('#pm-ok', el).onclick = (e) => run(e.currentTarget, async () => {
        const pays = lire();
        if (mode === 'livrer') {
          const st = await deliverOrder(c, pays);
          toast(st === 'payee' ? `${c.numero} remise et payée` : `${c.numero} remise — le reste passe en crédit`);
        } else if (mode === 'reserver') {
          await acceptReservation(c, pays);
          toast(`${c.numero} réservée${pays.length ? ' avec avance' : ''}`);
        } else {
          const st = await addPayments(c, pays);
          if (st === 'payee') { confetti(); toast(`${c.numero} entièrement réglée`); } else toast('Paiement enregistré');
        }
        close(); await refreshAfter();
      });
    },
  });
}

function rendreModal(c) {
  const du = aRendre(c);
  modal({
    title: 'Rendre de l\'argent au client',
    body: `<p class="muted" style="margin-bottom:12px">${esc(c.numero)} · ${esc(c.client_nom)} · à rendre ${money(du)}</p>
      <div class="row"><div class="field"><label>Montant rendu</label><input id="rd-m" type="number" min="1" max="${du}" value="${Math.round(du)}"></div>
      <div class="field"><label>Pris dans</label><select id="rd-c">${Object.entries(COMPTES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select></div></div>`,
    foot: `<button class="btn ghost" data-close>Annuler</button><button class="btn primary" id="rd-ok">Enregistrer</button>`,
    onMount: (el, close) => {
      $('#rd-ok', el).onclick = (e) => run(e.currentTarget, async () => {
        const m = Math.round(+$('#rd-m', el).value || 0);
        if (m > du) throw new Error(`Vous ne devez que ${money(du)}.`);
        await rendreArgent(c, m, $('#rd-c', el).value);
        close(); toast('Argent rendu enregistré'); await refreshAfter();
      });
    },
  });
}

const cmdById = (id) => A.commandes.find((x) => x.id === id);
Object.assign(ACT, {
  'f-cmd': (el) => { A.f.cmd = el.dataset.k; renderPage(false); },
  'cmd-livrer': (el) => paiementModal(cmdById(el.dataset.id), 'livrer'),
  'cmd-reserver': (el) => paiementModal(cmdById(el.dataset.id), 'reserver'),
  'cmd-encaisser': (el) => paiementModal(cmdById(el.dataset.id), 'encaisser'),
  'cmd-rendre': (el) => rendreModal(cmdById(el.dataset.id)),
  'cmd-credit': async (el) => {
    const c = cmdById(el.dataset.id);
    const du = Math.max(0, c.total - PAYE(c));
    if (!(await confirmBox(`Remettre <b>${esc(c.numero)}</b> à <b>${esc(c.client_nom)}</b> à crédit ?<br><span class="muted small">Le stock sera déduit et ${money(du)} sera ajouté aux crédits à recouvrer.</span>`, { ok: 'Remettre à crédit' }))) return;
    await run(null, async () => { await deliverOrder(c, []); toast(`${c.numero} remise à crédit`); await refreshAfter(); });
  },
  'cmd-annuler': (el) => {
    const c = cmdById(el.dataset.id);
    const p = PAYE(c);
    modal({
      title: `Annuler ${esc(c.numero)} ?`,
      body: `<p>${isLivree(c) ? 'Les articles comptés seront remis en stock.' : 'La commande sera annulée.'}</p>
        ${p > 0 ? `<div class="field" style="margin-top:14px"><label>Le client a déjà payé ${money(p)}</label>
          <select id="an-r"><option value="especes">Je le rembourse maintenant en espèces</option><option value="wave">Je le rembourse maintenant par Wave</option><option value="">Je le rembourserai plus tard (reste dans « Nous devons »)</option></select></div>` : ''}`,
      foot: `<button class="btn ghost" data-close>Retour</button><button class="btn danger" id="an-ok">Annuler la commande</button>`,
      onMount: (m, close) => {
        $('#an-ok', m).onclick = (e) => run(e.currentTarget, async () => {
          await cancelOrder(c, p > 0 ? ($('#an-r', m).value || null) : null);
          close(); toast('Commande annulée'); await refreshAfter();
        });
      },
    });
  },
  'cmd-suppr': async (el) => {
    if (!(await confirmBox('Supprimer définitivement cette commande annulée ?', { ok: 'Supprimer', danger: true }))) return;
    await run(null, async () => { await DB.remove('commandes', el.dataset.id); await refreshAfter(); });
  },
});

/* ---------- Vente rapide (saisie par la gérante) ---------- */
ACT['quick-sale'] = () => {
  const dispo = A.produits.filter((p) => p.actif);
  const valides = A.clients.filter((c) => c.statut === 'valide').sort((a, b) => a.nom.localeCompare(b.nom));
  const qte = {};
  const total = () => sum(Object.entries(qte), ([id, q]) => (prod(id)?.prix || 0) * q);
  modal({
    title: 'Nouvelle vente', size: 'wide',
    body: `
    <div class="row">
      <div class="field"><label>Client</label><select id="qs-cli"><option value="">— Client de passage —</option>${valides.map((c) => `<option value="${esc(c.id)}">${esc(c.nom)}</option>`).join('')}</select></div>
      <div class="field" id="qs-nom-f"><label>Nom (client de passage)</label><input id="qs-nom" placeholder="Ex. Voisine Fatou"></div>
    </div>
    <label class="small muted" style="font-weight:600">Articles</label>
    <div id="qs-lines" style="margin:6px 0 10px">${dispo.map((p) => `<div class="cart-line" style="padding:8px 0">
      <div class="thumb">${prodVisual(p)}</div><div class="info"><b>${esc(p.nom)}</b><span class="small muted">${money(p.prix)} · ${suivi(p) ? `stock ${p.stock}` : 'non compté'}</span></div>
      <div class="stepper"><button type="button" data-qs="-" data-id="${esc(p.id)}">${ic('minus')}</button><span id="qs-q-${esc(p.id)}">0</span><button type="button" data-qs="+" data-id="${esc(p.id)}">${ic('plus')}</button></div></div>`).join('')}</div>
    <div class="total-row big"><span>Total</span><span class="grad-text" id="qs-total">${money(0)}</span></div>
    <h4 class="cart-h">Paiement</h4>
    ${payBlockHtml(0, 0)}
    <p class="small muted">Si le montant reçu est inférieur au total, la différence passe en crédit (client validé obligatoire).</p>`,
    foot: `<button class="btn ghost" data-close>Annuler</button><button class="btn primary" id="qs-ok">${ic('check')} Enregistrer la vente</button>`,
    onMount: (el, close) => {
      const lire = mountPay(el, total);
      let auto = true; // les espèces suivent le total tant que la gérante n'a rien saisi
      ['#pm-esp', '#pm-wave'].forEach((sel) => $(sel, el).addEventListener('input', (e) => { if (e.isTrusted) auto = false; }));
      el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-qs]');
        if (!b) return;
        const p = prod(b.dataset.id);
        let q = (qte[p.id] || 0) + (b.dataset.qs === '+' ? 1 : -1);
        if (suivi(p) && q > p.stock) { toast(`Stock disponible : ${p.stock}`, 'warn'); q = p.stock; }
        qte[p.id] = Math.max(0, q);
        $(`#qs-q-${CSS.escape(p.id)}`, el).textContent = qte[p.id];
        $('#qs-total', el).textContent = money(total());
        if (auto) $('#pm-esp', el).value = total() || '';
        $('#pm-esp', el).dispatchEvent(new Event('input', { bubbles: true }));
      });
      $('#qs-cli', el).onchange = (e) => { $('#qs-nom-f', el).style.visibility = e.target.value ? 'hidden' : 'visible'; };
      $('#qs-ok', el).onclick = (e) => run(e.currentTarget, async () => {
        const lignes = Object.entries(qte).filter(([, q]) => q > 0).map(([id, q]) => { const p = prod(id); return { produit_id: id, nom: p.nom, prix: p.prix, quantite: q }; });
        if (!lignes.length) throw new Error('Ajoutez au moins un article.');
        const cl = client($('#qs-cli', el).value);
        const nom = cl ? cl.nom : ($('#qs-nom', el).value.trim() || 'Client de passage');
        const pays = lire();
        const tot = total();
        const recu = sum(pays, 'montant');
        if (recu < tot && !cl) throw new Error('Un crédit doit être rattaché à un client validé (pour les relances).');
        await checkStock(lignes);
        const moyen = !recu ? 'credit' : pays.length > 1 ? 'mixte' : pays[0].compte;
        const cmd = await DB.insert('commandes', {
          numero: await DB.nextNumero(), client_id: cl ? cl.id : null, client_nom: nom, lignes, total: tot,
          moyen_paiement: moyen, statut: 'en_attente', montant_paye: 0, cout_revient: 0, paiements: [], note: 'Vente saisie par la gérante',
        });
        A.commandes.push(cmd);
        await deliverOrder(cmd, pays);
        close();
        toast(`Vente ${cmd.numero} enregistrée`);
        await refreshAfter();
      });
    },
  });
};

/* ---------- Clients ---------- */
PAGES.clients = {
  title: 'Clients',
  render() {
    const tabs = [['en_attente', 'À valider'], ['valide', 'Validés'], ['refuse', 'Refusés']];
    const q = norm(A.f.q);
    const list = A.clients.filter((c) => c.statut === A.f.cli).filter((c) => !q || norm(c.nom + ' ' + (c.telephone || '')).includes(q))
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    return `
    <div class="page-head"><div><h1>Clients</h1><p class="muted">Vérifiez que chaque personne existe vraiment avant d'autoriser ses commandes.</p></div>
      <button class="btn primary" data-act="cli-add">${ic('user-plus')} Ajouter un client</button></div>
    <div class="toolbar">
      <div class="seg scroll">${tabs.map(([k, l]) => { const n = A.clients.filter((c) => c.statut === k).length; return `<button class="${A.f.cli === k ? 'on' : ''}" data-act="f-cli" data-k="${k}">${l}${n ? `<span class="count">${n}</span>` : ''}</button>`; }).join('')}</div>
      <label class="search field" style="margin:0">${ic('search')}<input class="input" placeholder="Nom ou téléphone…" data-inp="adm-q" value="${esc(A.f.q)}"></label>
    </div>
    <div class="cards">${list.length ? list.map(clientCard).join('') : `<div class="empty"><span class="big">${ic(A.f.cli === 'en_attente' ? 'user-check' : 'users')}</span><h3>${A.f.cli === 'en_attente' ? 'Aucune demande en attente' : 'Aucun client'}</h3></div>`}</div>`;
  },
};

function clientStats(id) {
  const cmds = A.commandes.filter((c) => c.client_id === id);
  const liv = cmds.filter(isLivree);
  return { n: liv.length, total: sum(liv, 'total'), du: sum(cmds, reste), devons: sum(cmds, nousDevons) };
}

function clientCard(c, i) {
  const st = clientStats(c.id);
  const similaires = c.statut === 'en_attente'
    ? A.clients.filter((x) => x.id !== c.id && x.statut !== 'refuse' && (norm(x.nom) === norm(c.nom) || (c.telephone && telDigits(x.telephone).slice(-9) === telDigits(c.telephone).slice(-9))))
    : [];
  const id = esc(c.id);
  let acts = '';
  if (c.statut === 'en_attente') acts = `<button class="btn leaf sm" data-act="cli-valider" data-id="${id}">${ic('user-check')} Valider</button><button class="btn ghost sm" data-act="cli-refuser" data-id="${id}">${ic('user-x')} Refuser</button>`;
  else if (c.statut === 'valide') {
    acts = `<button class="btn soft sm" data-act="cli-detail" data-id="${id}">${ic('eye')} Détails</button>
      ${st.du ? `<button class="btn leaf sm" data-act="cli-rembourser" data-id="${id}">${ic('banknote')} Remboursement</button>` : ''}
      ${c.telephone ? `<button class="btn ghost sm" data-act="cli-lien" data-id="${id}" title="Envoyer son lien de connexion">${ic('link')} Lien</button>` : ''}
      <button class="btn ghost sm" data-act="cli-code" data-id="${id}" title="Définir son code secret">${ic('key-round')}</button>
      <button class="btn ghost sm" data-act="cli-refuser" data-id="${id}" title="Bloquer">${ic('ban')}</button>`;
  } else acts = `<button class="btn leaf sm" data-act="cli-valider" data-id="${id}">${ic('user-check')} Valider</button><button class="btn ghost sm" data-act="cli-suppr" data-id="${id}">${ic('trash-2')}</button>`;
  return `<div class="client-card" style="--i:${i}">
    <div class="ch"><span class="avatar">${esc(initials(c.nom))}</span><div class="nm"><b>${esc(c.nom)}</b><span class="small muted">${c.telephone ? esc(c.telephone) : 'Pas de téléphone'} · ${fDate(c.created_at)}</span></div>
      ${c.statut === 'en_attente' ? '<span class="pill warn dot pulse">À valider</span>' : c.statut === 'valide' ? '<span class="pill ok">Validé</span>' : '<span class="pill bad">Refusé</span>'}</div>
    ${similaires.length ? `<div class="dup">${ic('triangle-alert')} Ressemble à : ${similaires.map((x) => esc(x.nom)).join(', ')}</div>` : ''}
    ${c.statut !== 'en_attente' ? `<div class="cstats"><div><small>Commandes</small><b>${st.n}</b></div><div><small>Total acheté</small><b>${money(st.total)}</b></div><div><small>${st.devons ? 'Nous devons' : 'Reste dû'}</small><b style="color:${st.du ? 'var(--danger)' : st.devons ? '#b05a00' : 'inherit'}">${money(st.devons || st.du)}</b></div></div>` : ''}
    ${c.statut === 'valide' && !c.a_code ? `<div class="small muted">${ic('key-round', 'sm')} Pas encore de code secret : envoyez-lui son lien de connexion.</div>` : ''}
    <div class="oc-actions">${acts}</div>
  </div>`;
}

async function setClientStatut(id, statut) {
  await DB.update('clients', id, { statut });
  await refreshAfter();
}

function remboursementModal(cl) {
  const du = clientStats(cl.id).du;
  modal({
    title: `Remboursement de ${esc(cl.nom)}`,
    body: `<p class="muted" style="margin-bottom:12px">Total dû : <b>${money(du)}</b>. Le montant est réparti sur ses crédits, du plus ancien au plus récent.</p>
      ${payBlockHtml(du, 0, { renduChoix: false })}`,
    foot: `<button class="btn ghost" data-close>Annuler</button><button class="btn leaf" id="rb-ok">${ic('check')} Enregistrer</button>`,
    onMount: (el, close) => {
      const lire = mountPay(el, () => du, { libReste: 'Restera dû', cap: true });
      $('#rb-ok', el).onclick = (e) => run(e.currentTarget, async () => {
        const pays = lire();
        if (!pays.length) throw new Error('Saisissez un montant.');
        await rembourserClient(cl.id, pays);
        const solde = du - sum(pays, 'montant');
        if (!solde) confetti();
        close(); toast(solde ? `Remboursement enregistré · reste ${money(solde)}` : `${cl.nom} est à jour`); await refreshAfter();
      });
    },
  });
}

const lienConnexion = (c) => `${location.origin}${location.pathname}#/?c=${encodeURIComponent(c.id)}&t=${encodeURIComponent(c.token)}`;

Object.assign(ACT, {
  'f-cli': (el) => { A.f.cli = el.dataset.k; renderPage(false); },
  'cli-valider': (el) => run(el, async () => { await setClientStatut(el.dataset.id, 'valide'); toast('Client validé. Il peut maintenant commander.'); }),
  'cli-refuser': async (el) => {
    const c = client(el.dataset.id);
    if (!(await confirmBox(`${c.statut === 'valide' ? 'Bloquer' : 'Refuser'} <b>${esc(c.nom)}</b> ? Cette personne ne pourra plus commander.`, { ok: c.statut === 'valide' ? 'Bloquer' : 'Refuser', danger: true }))) return;
    await run(null, async () => { await setClientStatut(c.id, 'refuse'); toast('Client refusé'); });
  },
  'cli-suppr': async (el) => {
    if (!(await confirmBox('Supprimer définitivement ce client ? Ses commandes passées sont conservées.', { ok: 'Supprimer', danger: true }))) return;
    await run(null, async () => { await DB.remove('clients', el.dataset.id); await refreshAfter(); });
  },
  'cli-rembourser': (el) => remboursementModal(client(el.dataset.id)),
  'cli-lien': (el) => {
    const c = client(el.dataset.id);
    const msg = `Bonjour ${c.nom}, voici votre lien de connexion à ${SETTINGS.nom_boutique} (gardez-le pour vous) :\n${lienConnexion(c)}`;
    window.open(waLink(c.telephone, msg), '_blank', 'noopener');
  },
  'cli-code': (el) => {
    const c = client(el.dataset.id);
    const propose = String(Math.floor(1000 + Math.random() * 9000));
    modal({
      title: `Code secret de ${esc(c.nom)}`,
      body: `<p class="muted" style="margin-bottom:12px">Le client se connecte sur n'importe quel téléphone avec son numéro (${esc(c.telephone || '—')}) et ce code.</p>
        <div class="field"><label>Nouveau code (4 à 6 chiffres)</label><input id="cd-code" class="pin-input" inputmode="numeric" maxlength="6" value="${propose}"></div>`,
      foot: `<button class="btn ghost" data-close>Annuler</button><button class="btn primary" id="cd-ok">Enregistrer${c.telephone ? ' et envoyer' : ''}</button>`,
      onMount: (m, close) => {
        $('#cd-ok', m).onclick = (e) => run(e.currentTarget, async () => {
          const code = $('#cd-code', m).value.trim();
          await DB.adminSetClientCode(c.id, code);
          close(); toast('Code enregistré');
          if (c.telephone) window.open(waLink(c.telephone, `Bonjour ${c.nom}, votre code secret ${SETTINGS.nom_boutique} est : ${code}\nConnexion : ${location.origin}${location.pathname} → « J'ai déjà un compte ».`), '_blank', 'noopener');
          await refreshAfter();
        });
      },
    });
  },
  'cli-add': () => {
    modal({
      title: 'Ajouter un client',
      body: `<div class="field"><label>Nom complet *</label><input id="ca-nom" maxlength="80"></div><div class="field"><label>Téléphone</label><input id="ca-tel" type="tel" maxlength="30"></div><p class="small muted">Le client sera directement validé. Envoyez-lui ensuite son lien de connexion.</p>`,
      foot: `<button class="btn ghost" data-close>Annuler</button><button class="btn primary" id="ca-ok">Ajouter</button>`,
      onMount: (el, close) => {
        $('#ca-ok', el).onclick = (e) => run(e.currentTarget, async () => {
          const nom = $('#ca-nom', el).value.trim();
          if (nom.length < 2) throw new Error('Nom obligatoire.');
          await DB.insert('clients', { nom, telephone: $('#ca-tel', el).value.trim(), statut: 'valide', token: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()), note: '' });
          close(); toast('Client ajouté'); await refreshAfter();
        });
      },
    });
  },
  'cli-detail': (el) => {
    const c = client(el.dataset.id);
    const cmds = A.commandes.filter((x) => x.client_id === c.id).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const st = clientStats(c.id);
    modal({
      title: `${esc(c.nom)}`, size: 'wide',
      body: `<div class="cstats" style="margin-bottom:16px"><div><small>Commandes</small><b>${st.n}</b></div><div><small>Total acheté</small><b>${money(st.total)}</b></div><div><small>Reste dû</small><b style="color:${st.du ? 'var(--danger)' : 'inherit'}">${money(st.du)}</b></div></div>
        <div class="field"><label>Note interne</label><textarea id="cd-note" placeholder="Ex. voisine, paie toujours le vendredi…">${esc(c.note || '')}</textarea></div>
        ${cmds.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>N°</th><th>Date</th><th>Articles</th><th>Statut</th><th class="num">Total</th></tr></thead><tbody>
        ${cmds.map((o, i) => `<tr style="--i:${i}"><td><b>${esc(o.numero)}</b></td><td>${fDate(o.created_at)}</td><td class="small">${(o.lignes || []).map((l) => `${l.quantite}× ${esc(l.nom)}`).join(', ')}</td><td>${pillCmd(o.statut)}</td><td class="num">${money(o.total)}</td></tr>`).join('')}
        </tbody></table></div>` : '<p class="muted">Aucune commande.</p>'}`,
      foot: `<button class="btn ghost" data-close>Fermer</button><button class="btn primary" id="cd-ok">Enregistrer la note</button>`,
      onMount: (m, close) => { $('#cd-ok', m).onclick = (e) => run(e.currentTarget, async () => { await DB.update('clients', c.id, { note: $('#cd-note', m).value }); close(); toast('Note enregistrée'); await refreshAfter(); }); },
    });
  },
});
