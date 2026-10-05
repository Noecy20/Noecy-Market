/*
 * Noecy Market — application (boutique client + espace gérante)
 * Aucune étape de build : HTML + CSS + JS natifs.
 */
'use strict';

/* =====================================================================
   Utilitaires
   ===================================================================== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sum = (arr, f) => arr.reduce((s, x) => s + (Number(typeof f === 'function' ? f(x) : x[f]) || 0), 0);
const nf = new Intl.NumberFormat('fr-FR');
const num = (n) => nf.format(Math.round(n || 0));
const money = (n) => num(n) + ' ' + (SETTINGS.devise || 'FCFA');
const pct = (n) => (isFinite(n) ? Math.round(n) : 0) + ' %';
const dayKey = (d = new Date()) => {
  const x = new Date(d);
  return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
};
const toDate = (d) => new Date(typeof d === 'string' && d.length === 10 ? d + 'T00:00:00' : d);
const fDate = (d) => (d ? toDate(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const fDateTime = (d) => (d ? toDate(d).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const daysSince = (d) => Math.floor((Date.now() - toDate(d).getTime()) / 864e5);
const ic = (n, c = '') => `<i data-lucide="${n}" class="ic ${c}"></i>`;
const icons = () => { try { window.lucide && lucide.createIcons(); } catch (e) { /* hors ligne */ } };
const initials = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const debounce = (fn, ms = 200) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const telDigits = (t) => String(t || '').replace(/\D/g, '');

let SETTINGS = { ...(window.DB && DB.DEFAULT_SETTINGS) };
let CATS = [];
const ICONES = [
  ['cup-soda', 'Boisson'], ['glass-water', 'Verre'], ['milk', 'Lait'], ['coffee', 'Café'], ['banana', 'Banane'],
  ['apple', 'Fruit'], ['citrus', 'Agrume'], ['cherry', 'Cerise'], ['candy', 'Bonbon'], ['cookie', 'Biscuit'],
  ['cake', 'Gâteau'], ['croissant', 'Viennoiserie'], ['ice-cream-cone', 'Glace'], ['popcorn', 'Snack'], ['nut', 'Noix'],
  ['wheat', 'Céréale'], ['soup', 'Plat'], ['sandwich', 'Sandwich'], ['package', 'Paquet'], ['shopping-bag', 'Autre'],
];
const catOf = (id) => CATS.find((c) => c.id === id);

const PAY = {
  wave: { label: 'Wave', icon: 'waves', bg: '#dcf6ff', sub: 'Paiement mobile instantané' },
  especes: { label: 'Espèces', icon: 'banknote', bg: '#e2f5ec', sub: 'À la livraison / au retrait' },
  credit: { label: 'Payer plus tard', icon: 'handshake', bg: '#fff4dc', sub: 'Crédit, sous réserve d\'accord' },
};
const STATUT_CMD = {
  en_attente: ['En attente', 'warn pulse'],
  payee: ['Payée', 'ok'],
  credit: ['À crédit', 'bad'],
  annulee: ['Annulée', ''],
};
const pillCmd = (s) => { const [l, c] = STATUT_CMD[s] || [s, '']; return `<span class="pill dot ${c}">${l}</span>`; };

function toast(msg, type = 'ok', ms = 3200) {
  const t = document.createElement('div');
  const name = { err: 'circle-x', warn: 'triangle-alert', info: 'bell-ring' }[type] || 'circle-check';
  t.className = `toast toast-${type}`;
  t.innerHTML = `${ic(name)}<span>${esc(msg)}</span>`;
  $('#toasts').append(t);
  icons();
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 400); }, ms);
}

function modal({ title, body, foot = '', size = '', locked = false, onMount }) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap' + (size === 'drawer' ? ' is-drawer' : '');
  wrap.innerHTML = `<div class="modal ${size}" role="dialog" aria-modal="true">
      <div class="modal-head"><h3>${title}</h3>${locked ? '' : `<button class="icon-btn flat" data-close aria-label="Fermer">${ic('x')}</button>`}</div>
      <div class="modal-body">${body}</div>
      ${foot ? `<div class="modal-foot">${foot}</div>` : ''}
    </div>`;
  $('#modal-root').append(wrap);
  const close = () => {
    wrap.classList.remove('in'); wrap.classList.add('out');
    setTimeout(() => { wrap.remove(); if (CURRENT === 'shop') updateCartUI(false); }, 320);
  };
  $('#fab-cart')?.classList.remove('show');
  if (!locked) {
    wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('[data-close]')) close(); });
  }
  icons();
  requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.add('in')));
  if (onMount) onMount(wrap, close);
  return { el: wrap, close };
}

function confirmBox(msg, { ok = 'Confirmer', danger = false, title = 'Confirmation' } = {}) {
  return new Promise((res) => {
    modal({
      title, body: `<p style="font-size:15.5px">${msg}</p>`,
      foot: `<button class="btn ghost" data-close>Annuler</button><button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${ok}</button>`,
      onMount: (el, close) => {
        el.querySelector('[data-ok]').onclick = () => { res(true); close(); };
        el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('[data-close]')) res(false); });
      },
    });
  });
}

async function run(btn, fn) {
  if (btn) { btn.disabled = true; btn.classList.add('loading'); }
  try { return await fn(); }
  catch (err) { console.error(err); toast(err.message || String(err), 'err', 5000); }
  finally { if (btn && btn.isConnected) { btn.disabled = false; btn.classList.remove('loading'); } }
}

function compressImage(file, max = 640, q = 0.8) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => {
      const img = new Image();
      img.onload = () => {
        const s = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        res(c.toDataURL('image/jpeg', q));
      };
      img.onerror = () => rej(new Error('Image illisible.'));
      img.src = r.result;
    };
    r.onerror = () => rej(new Error('Lecture du fichier impossible.'));
    r.readAsDataURL(file);
  });
}

function confetti() {
  const box = document.createElement('div');
  box.className = 'confetti';
  const cols = ['#6d1b4f', '#f6a609', '#c26a26', '#1c9a69', '#e0435a', '#1dc8ff', '#ffd27a'];
  for (let i = 0; i < 110; i++) {
    const s = document.createElement('i');
    s.style.left = Math.random() * 100 + 'vw';
    s.style.background = cols[i % cols.length];
    s.style.animationDelay = Math.random() * 0.7 + 's';
    s.style.setProperty('--x', (Math.random() * 240 - 120) + 'px');
    s.style.setProperty('--r', (Math.random() * 900 - 450) + 'deg');
    box.append(s);
  }
  document.body.append(box);
  setTimeout(() => box.remove(), 4000);
}

function countUp(root = document) {
  $$('[data-count]', root).forEach((el) => {
    const target = Number(el.dataset.count) || 0;
    const isMoney = el.hasAttribute('data-money');
    const t0 = performance.now(), dur = 1000;
    const step = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      const v = target * (1 - Math.pow(1 - p, 3));
      el.textContent = isMoney ? money(v) : num(v);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

function ding() {
  try {
    const a = new (window.AudioContext || window.webkitAudioContext)();
    const o = a.createOscillator(), g = a.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(880, a.currentTime);
    o.frequency.setValueAtTime(1320, a.currentTime + 0.13);
    g.gain.setValueAtTime(0.0001, a.currentTime);
    g.gain.exponentialRampToValueAtTime(0.18, a.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + 0.45);
    o.connect(g).connect(a.destination);
    o.start(); o.stop(a.currentTime + 0.5);
  } catch (e) { /* audio indisponible */ }
}

function downloadFile(name, content, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function downloadCSV(name, rows) {
  const csv = rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\n');
  downloadFile(name, '﻿' + csv, 'text/csv;charset=utf-8');
}

function prodVisual(p) {
  const cat = catOf(p.categorie_id);
  if (p.photo) return `<img src="${esc(p.photo)}" alt="${esc(p.nom)}" class="pv" loading="lazy">`;
  return `<div class="pv pv-ph" style="--c:${esc(cat?.couleur || '#6d1b4f')}">${ic(cat?.icone || 'shopping-bag')}</div>`;
}

function waveLink(total) {
  const l = (SETTINGS.wave_lien || '').trim();
  if (!l) return '';
  return l.includes('{montant}') ? l.replace('{montant}', Math.round(total)) : l;
}
function waLink(tel, text) {
  let d = telDigits(tel);
  if (d.length === 9) d = '221' + d; // numéro sénégalais sans indicatif
  return `https://wa.me/${d}?text=${encodeURIComponent(text)}`;
}

/* Délégation d'événements : data-act="..." → ACT[...] */
const ACT = {};
const INP = {};
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.btn');
  if (btn && !btn.disabled) {
    const r = btn.getBoundingClientRect(), s = document.createElement('span');
    const d = Math.max(r.width, r.height);
    s.className = 'ripple';
    s.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`;
    btn.append(s); setTimeout(() => s.remove(), 600);
  }
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const fn = ACT[el.dataset.act];
  if (fn) { if (!el.matches('input, select, textarea')) e.preventDefault(); fn(el, e); }
});
document.addEventListener('input', (e) => {
  const el = e.target.closest('[data-inp]');
  if (el && INP[el.dataset.inp]) INP[el.dataset.inp](el, e);
});

/* =====================================================================
   BOUTIQUE (côté client)
   ===================================================================== */
const LS_CLIENT = 'noecy_client';
const LS_CART = 'noecy_cart';
const SHOP = { produits: [], client: null, cart: {}, filtre: 'tous', q: '', commandes: [], poll: null, sig: '', moyen: 'wave' };

function loadCart() { try { return JSON.parse(localStorage.getItem(LS_CART)) || {}; } catch (e) { return {}; } }
function saveCart() { try { localStorage.setItem(LS_CART, JSON.stringify(SHOP.cart)); } catch (e) { /* ignore */ } }
function getCreds() { try { return JSON.parse(localStorage.getItem(LS_CLIENT)); } catch (e) { return null; } }

async function startShop() {
  document.body.className = 'shop';
  $('#app').innerHTML = `<div class="products" style="padding-top:90px">${'<div class="skel" style="height:300px"></div>'.repeat(8)}</div>`;
  SHOP.cart = loadCart();
  try {
    const [s, cats, prods] = await Promise.all([DB.getSettings(), DB.listCategories(), DB.listProducts()]);
    SETTINGS = s; CATS = cats; SHOP.produits = prods;
  } catch (e) {
    $('#app').innerHTML = `<div class="empty" style="padding-top:120px"><span class="big">${ic('cloud-off')}</span><h3>Boutique momentanément indisponible</h3><p>${esc(e.message)}</p></div>`;
    return;
  }
  SHOP.sig = shopSig();
  cleanCart();
  await refreshClient();
  renderShop();
  if (!SHOP.client) askName();
  SHOP.poll = setInterval(shopPoll, 10000);
}
function stopShop() { clearInterval(SHOP.poll); SHOP.poll = null; }

const shopSig = () => SHOP.produits.map((p) => p.id + ':' + p.stock + ':' + p.prix).join('|');

function cleanCart() {
  for (const id of Object.keys(SHOP.cart)) {
    const p = SHOP.produits.find((x) => x.id === id);
    if (!p || p.stock <= 0) delete SHOP.cart[id];
    else if (SHOP.cart[id] > p.stock) SHOP.cart[id] = p.stock;
  }
  saveCart();
}

async function refreshClient() {
  const cr = getCreds();
  if (!cr) { SHOP.client = null; return; }
  try {
    SHOP.client = await DB.getClient(cr.id, cr.token);
    if (!SHOP.client) { localStorage.removeItem(LS_CLIENT); return; }
    SHOP.client.token = cr.token;
    if (SHOP.client.statut === 'valide') SHOP.commandes = await DB.myOrders(cr.id, cr.token);
  } catch (e) { console.warn(e); }
}

async function shopPoll() {
  if (document.hidden) return;
  const before = SHOP.client?.statut;
  const beforeOrders = SHOP.commandes.map((c) => c.id + c.statut).join();
  await refreshClient();
  try { SHOP.produits = await DB.listProducts(); } catch (e) { return; }
  const after = SHOP.client?.statut;
  if (before && before !== after) {
    if (after === 'valide') { confetti(); toast('Votre nom est validé ! Vous pouvez commander', 'ok', 5000); }
    if (after === 'refuse') toast("Votre demande n'a pas été validée.", 'warn', 5000);
    renderStatus();
    renderGrid();
  }
  const afterOrders = SHOP.commandes.map((c) => c.id + c.statut).join();
  if (beforeOrders && beforeOrders !== afterOrders) toast('Le statut de votre commande a changé', 'info');
  const sig = shopSig();
  if (sig !== SHOP.sig) { SHOP.sig = sig; cleanCart(); renderGrid(false); updateCartUI(); }
}

function renderShop() {
  const nom = SHOP.client?.nom?.split(' ')[0];
  const cats = CATS.filter((c) => SHOP.produits.some((p) => p.categorie_id === c.id));
  $('#app').innerHTML = `
    <header class="shop-top" id="shop-top">
      <a class="brand" href="#/"><span class="brand-logo">N</span><span class="brand-name">Noecy <b>Market</b></span></a>
      <div class="top-actions">
        <button class="icon-btn" data-act="my-orders" title="Mes commandes" aria-label="Mes commandes">${ic('receipt')}</button>
        <button class="cart-btn" data-act="open-cart" id="cart-btn">${ic('shopping-bag')}<span class="hide-sm">Panier</span><span class="badge" id="cart-count">0</span></button>
      </div>
    </header>
    <section class="hero">
      <div class="blob b1"></div><div class="blob b2"></div><div class="blob b3"></div>
      <div class="hero-inner">
        <p class="eyebrow">Fait maison · Livré avec le sourire</p>
        <h1>${nom ? `Bonjour <span class="hl">${esc(nom)}</span><br>` : ''}Les délices de <span class="hl">Noecy</span></h1>
        <p class="lead">${esc(SETTINGS.slogan)}</p>
        <div id="client-status"></div>
      </div>
      <div class="hero-float" aria-hidden="true"><span>${ic('cup-soda')}</span><span>${ic('banana')}</span><span>${ic('candy')}</span><span>${ic('flower-2')}</span></div>
    </section>
    <section class="shop-tools">
      <div class="chips" id="chips">
        <button class="chip ${SHOP.filtre === 'tous' ? 'on' : ''}" data-act="filtre" data-f="tous"> Tout</button>
        ${cats.map((c) => `<button class="chip ${SHOP.filtre === c.id ? 'on' : ''}" data-act="filtre" data-f="${esc(c.id)}">${ic(c.icone || 'shopping-bag')} ${esc(c.nom)}</button>`).join('')}
      </div>
      <label class="search field" style="margin:0">${ic('search')}<input class="input" placeholder="Rechercher un article…" data-inp="shop-q" value="${esc(SHOP.q)}"></label>
    </section>
    <section class="products" id="grid"></section>
    <footer class="shop-foot">
      © ${new Date().getFullYear()} ${esc(SETTINGS.nom_boutique)} · fait maison
      ${SETTINGS.whatsapp ? ` · <a href="${waLink(SETTINGS.whatsapp, 'Bonjour Noecy')}" target="_blank" rel="noopener">Nous écrire sur WhatsApp</a>` : ''}
      · <a href="#/admin">Espace gérante</a>
    </footer>
    <button class="fab-cart" id="fab-cart" data-act="open-cart"><span id="fab-txt"></span><span class="go">Voir le panier ${ic('arrow-right')}</span></button>`;
  renderStatus();
  renderGrid();
  updateCartUI(false);
  icons();
  window.onscroll = () => { const t = $('#shop-top'); if (t) t.classList.toggle('scrolled', scrollY > 10); };
}

function renderStatus() {
  const el = $('#client-status');
  if (!el) return;
  const c = SHOP.client;
  let h;
  if (!c) {
    h = `<button class="status-card none" data-act="ask-name" style="border:0;color:#fff;cursor:pointer;text-align:left"><span class="si">${ic('user-round')}</span><span><b>Présentez-vous pour commander</b><small>Entrez votre nom, Noecy le valide rapidement.</small></span></button>`;
  } else if (c.statut === 'en_attente') {
    h = `<div class="status-card wait"><span class="si">${ic('hourglass')}</span><span><b>Merci ${esc(c.nom)} ! Vérification en cours…</b><small>Vous pourrez commander dès que Noecy aura validé votre nom.</small></span></div>`;
  } else if (c.statut === 'valide') {
    h = `<div class="status-card ok"><span class="si">${ic('badge-check')}</span><span><b>Compte validé</b><small>Ajoutez vos articles au panier et commandez.</small></span></div>`;
  } else {
    h = `<div class="status-card bad"><span class="si">${ic('circle-x')}</span><span><b>Demande non validée</b><small>Contactez Noecy pour plus d'informations.</small></span></div>`;
  }
  el.innerHTML = h;
  icons();
}

function visibleProducts() {
  const q = norm(SHOP.q);
  return SHOP.produits
    .filter((p) => SHOP.filtre === 'tous' || p.categorie_id === SHOP.filtre)
    .filter((p) => !q || norm(p.nom + ' ' + (p.description || '')).includes(q))
    .sort((a, b) => (b.stock > 0) - (a.stock > 0) || a.nom.localeCompare(b.nom));
}

function addControl(p) {
  if (p.stock <= 0) return `<span class="pill bad">Épuisé</span>`;
  const q = SHOP.cart[p.id];
  if (q) return `<div class="stepper"><button data-act="cart-dec" data-id="${esc(p.id)}" aria-label="Moins">${ic('minus')}</button><span>${q}</span><button data-act="cart-inc" data-id="${esc(p.id)}" aria-label="Plus">${ic('plus')}</button></div>`;
  return `<button class="add-btn" data-act="cart-add" data-id="${esc(p.id)}" aria-label="Ajouter au panier">${ic('plus')}</button>`;
}

function stockTag(p) {
  if (p.stock <= 0) return `<span class="pill bad tag">Rupture</span>`;
  if (p.stock <= (p.seuil_alerte ?? 5)) return `<span class="pill warn tag dot pulse">Plus que ${p.stock} !</span>`;
  return `<span class="pill ok tag dot">Disponible</span>`;
}

function renderGrid(animate = true) {
  const g = $('#grid');
  if (!g) return;
  const list = visibleProducts();
  g.innerHTML = list.length
    ? list.map((p, i) => {
      const cat = catOf(p.categorie_id);
      return `<article class="pcard ${p.stock <= 0 ? 'soldout' : ''}" style="--i:${animate ? i : 0};${animate ? '' : 'animation:none'}" data-act="view-product" data-id="${esc(p.id)}">
        <div class="pcard-media">${prodVisual(p)}${stockTag(p)}</div>
        <div class="pcard-body">
          ${cat ? `<span class="small muted">${ic(cat.icone || 'shopping-bag', 'sm')} ${esc(cat.nom)}${p.unite ? ' · ' + esc(p.unite) : ''}</span>` : ''}
          <h3>${esc(p.nom)}</h3>
          <p class="desc">${esc(p.description || '')}</p>
          <div class="pcard-foot"><span class="price">${money(p.prix)}</span><span data-ctl="${esc(p.id)}">${addControl(p)}</span></div>
        </div>
      </article>`;
    }).join('')
    : `<div class="empty"><span class="big">${ic('search-x')}</span><h3>Aucun article trouvé</h3><p>Essayez une autre catégorie ou recherche.</p></div>`;
  icons();
}

function refreshControl(id) {
  const p = SHOP.produits.find((x) => x.id === id);
  $$(`[data-ctl="${CSS.escape(id)}"]`).forEach((el) => { el.innerHTML = addControl(p); });
  icons();
}

const cartCount = () => Object.values(SHOP.cart).reduce((s, q) => s + q, 0);
const cartTotal = () => Object.entries(SHOP.cart).reduce((s, [id, q]) => s + (SHOP.produits.find((p) => p.id === id)?.prix || 0) * q, 0);

function updateCartUI(bump = true) {
  const n = cartCount();
  const b = $('#cart-count');
  if (b) {
    b.textContent = n;
    b.classList.toggle('zero', !n);
    if (bump) { b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump'); }
  }
  const fab = $('#fab-cart');
  if (fab) {
    fab.classList.toggle('show', n > 0 && !$('.modal-wrap'));
    $('#fab-txt').textContent = `${n} article${n > 1 ? 's' : ''} · ${money(cartTotal())}`;
  }
}

function canOrder() {
  const c = SHOP.client;
  if (!c) { askName(); return false; }
  if (c.statut === 'en_attente') { toast('Votre nom est en cours de validation par Noecy', 'warn', 4000); return false; }
  if (c.statut !== 'valide') { toast("Votre demande n'a pas été validée. Contactez Noecy.", 'err', 4000); return false; }
  return true;
}

function flyToCart(fromEl) {
  const cart = $('#cart-btn');
  const media = fromEl?.closest('.pcard')?.querySelector('.pcard-media') || fromEl?.closest('.modal')?.querySelector('.pd-media');
  if (!cart || !media) return;
  const r = media.getBoundingClientRect(), c = cart.getBoundingClientRect();
  const f = media.cloneNode(true);
  f.className = 'fly';
  f.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
  document.body.append(f);
  requestAnimationFrame(() => {
    const s = 34 / r.width;
    f.style.transform = `translate(${c.left + c.width / 2 - r.left - r.width / 2}px, ${c.top + c.height / 2 - r.top - r.height / 2}px) scale(${s})`;
    f.style.opacity = '.4';
  });
  setTimeout(() => { f.remove(); cart.classList.remove('shake'); void cart.offsetWidth; cart.classList.add('shake'); }, 760);
}

function setQty(id, q, fromEl) {
  const p = SHOP.produits.find((x) => x.id === id);
  if (!p) return;
  if (q > p.stock) { toast(`Stock disponible : ${p.stock}`, 'warn'); q = p.stock; }
  const was = SHOP.cart[id] || 0;
  if (q <= 0) delete SHOP.cart[id]; else SHOP.cart[id] = q;
  saveCart();
  if (q > was && fromEl) flyToCart(fromEl);
  refreshControl(id);
  updateCartUI();
}

Object.assign(ACT, {
  'filtre': (el) => {
    SHOP.filtre = el.dataset.f;
    $$('#chips .chip').forEach((c) => c.classList.toggle('on', c === el));
    renderGrid();
  },
  'ask-name': () => askName(),
  'cart-add': (el) => { if (canOrder()) setQty(el.dataset.id, (SHOP.cart[el.dataset.id] || 0) + 1, el); },
  'cart-inc': (el) => { if (canOrder()) setQty(el.dataset.id, (SHOP.cart[el.dataset.id] || 0) + 1, el); },
  'cart-dec': (el) => setQty(el.dataset.id, (SHOP.cart[el.dataset.id] || 0) - 1),
  'view-product': (el) => viewProduct(el.dataset.id),
  'open-cart': () => openCart(),
  'my-orders': () => openMyOrders(),
});
INP['shop-q'] = debounce((el) => { SHOP.q = el.value; renderGrid(); }, 180);

function askName() {
  if ($('.gate')) return;
  const cr = getCreds();
  if (cr && SHOP.client) return;
  modal({
    title: '', locked: true,
    body: `<form class="gate" id="gate-form" autocomplete="on">
      <span class="hello">${ic('hand')}</span>
      <h2>Bienvenue chez ${esc(SETTINGS.nom_boutique)}</h2>
      <p>Pour commander, dites-nous qui vous êtes.<br>Noecy valide votre nom avant votre première commande.</p>
      <div class="field"><label for="g-nom">Votre nom complet *</label><input id="g-nom" name="name" required minlength="2" maxlength="80" placeholder="Ex. Awa Diop" autocomplete="name"></div>
      <div class="field"><label for="g-tel">Téléphone (recommandé)</label><input id="g-tel" name="tel" type="tel" maxlength="30" placeholder="Ex. 77 123 45 67" autocomplete="tel"><span class="hint">Pour vous confirmer la commande et le paiement Wave.</span></div>
      <button class="btn primary lg block" type="submit">Continuer ${ic('arrow-right')}</button>
      <p class="small muted" style="margin:14px 0 0">Vous pourrez découvrir les articles pendant la validation.</p>
    </form>`,
    onMount: (el, close) => {
      setTimeout(() => $('#g-nom', el)?.focus(), 350);
      $('#gate-form', el).addEventListener('submit', (e) => {
        e.preventDefault();
        const btn = e.submitter || $('button[type=submit]', el);
        run(btn, async () => {
          const nom = $('#g-nom', el).value.trim();
          if (nom.length < 2) throw new Error('Merci d\'indiquer votre nom.');
          const r = await DB.registerClient(nom, $('#g-tel', el).value.trim());
          localStorage.setItem(LS_CLIENT, JSON.stringify({ id: r.id, token: r.token }));
          await refreshClient();
          close();
          renderShop();
          toast('Merci ! Votre demande est envoyée à Noecy');
        });
      });
    },
  });
}

function viewProduct(id) {
  const p = SHOP.produits.find((x) => x.id === id);
  if (!p) return;
  const cat = catOf(p.categorie_id);
  modal({
    title: esc(p.nom),
    body: `<div class="pd-media">${prodVisual(p)}</div>
      <div class="pd-meta">${cat ? `<span class="pill info">${ic(cat.icone || 'shopping-bag', 'sm')} ${esc(cat.nom)}</span>` : ''}${p.unite ? `<span class="pill">${esc(p.unite)}</span>` : ''}${stockTag(p).replace(' tag', '')}</div>
      <p style="color:var(--ink2);white-space:pre-line">${esc(p.description || 'Fait maison par Noecy.')}</p>`,
    foot: `<span class="price" style="margin-right:auto;font-size:22px">${money(p.prix)}</span><span data-ctl="${esc(p.id)}">${addControl(p)}</span>`,
  });
}

function cartBodyHtml() {
  const lines = Object.entries(SHOP.cart).map(([id, q]) => ({ p: SHOP.produits.find((x) => x.id === id), q })).filter((l) => l.p);
  if (!lines.length) {
    return `<div class="empty"><span class="big">${ic('shopping-bag')}</span><h3>Votre panier est vide</h3><p>Ajoutez de bons produits maison !</p><button class="btn primary" style="margin-top:16px" data-close>Découvrir les articles</button></div>`;
  }
  const total = cartTotal();
  return `${lines.map(({ p, q }, i) => `<div class="cart-line" style="animation-delay:${i * 40}ms">
      <div class="thumb">${prodVisual(p)}</div>
      <div class="info"><b>${esc(p.nom)}</b><span class="small muted">${money(p.prix)}</span></div>
      <div class="stepper"><button data-act="cl-dec" data-id="${esc(p.id)}">${ic('minus')}</button><span>${q}</span><button data-act="cl-inc" data-id="${esc(p.id)}">${ic('plus')}</button></div>
      <div class="lt">${money(p.prix * q)}</div>
    </div>`).join('')}
    <h4 style="margin:20px 0 8px">Moyen de paiement</h4>
    <div class="pay-opts">
      ${Object.entries(PAY).map(([k, v]) => `<label class="pay-opt ${SHOP.moyen === k ? 'on' : ''}" data-act="pay-pick" data-k="${k}">
        <span class="pi" style="background:${v.bg}">${ic(v.icon)}</span>
        <span><b>${v.label}</b><small>${v.sub}</small></span><span class="radio"></span></label>`).join('')}
    </div>
    <div class="field"><label for="c-note">Note pour Noecy (facultatif)</label><textarea id="c-note" maxlength="500" placeholder="Lieu de livraison, heure, précisions…"></textarea></div>
    <div class="total-row"><span class="muted">Articles</span><span>${cartCount()}</span></div>
    <div class="total-row big"><span>Total</span><span class="grad-text">${money(total)}</span></div>`;
}

let CART_MODAL = null;
function openCart() {
  CART_MODAL = modal({
    title: `${ic('shopping-bag')} Mon panier`, size: 'drawer',
    body: `<div id="cart-body">${cartBodyHtml()}</div>`,
    foot: cartCount() ? `<button class="btn primary lg block" data-act="place-order" id="order-btn">Commander · ${money(cartTotal())}</button>` : '',
  });
}
function refreshCart() {
  const b = $('#cart-body');
  if (!b) return;
  const note = $('#c-note')?.value || '';
  b.innerHTML = cartBodyHtml();
  if ($('#c-note')) $('#c-note').value = note;
  const ob = $('#order-btn');
  if (ob) ob.innerHTML = `Commander · ${money(cartTotal())}`;
  if (!cartCount() && ob) ob.parentElement.remove();
  icons();
}

Object.assign(ACT, {
  'cl-inc': (el) => { setQty(el.dataset.id, (SHOP.cart[el.dataset.id] || 0) + 1); refreshCart(); },
  'cl-dec': (el) => { setQty(el.dataset.id, (SHOP.cart[el.dataset.id] || 0) - 1); refreshCart(); },
  'pay-pick': (el) => { SHOP.moyen = el.dataset.k; $$('.pay-opt').forEach((o) => o.classList.toggle('on', o === el)); },
  'place-order': (el) => {
    if (!canOrder()) return;
    run(el, async () => {
      const lignes = Object.entries(SHOP.cart).map(([produit_id, quantite]) => ({ produit_id, quantite }));
      const note = $('#c-note')?.value || '';
      const cmd = await DB.placeOrder(SHOP.client.id, SHOP.client.token, lignes, SHOP.moyen, note);
      SHOP.cart = {}; saveCart();
      CART_MODAL?.close();
      renderGrid(false); updateCartUI();
      SHOP.commandes = await DB.myOrders(SHOP.client.id, SHOP.client.token).catch(() => SHOP.commandes);
      setTimeout(() => orderSuccess(cmd), 300);
    });
  },
});

function orderSuccess(cmd) {
  confetti();
  const wl = cmd.moyen_paiement === 'wave' ? waveLink(cmd.total) : '';
  modal({
    title: '',
    body: `<div class="success">
      <div class="check-anim"><svg class="tick" viewBox="0 0 52 52"><path d="M14 27 l8 8 l16 -18"/></svg></div>
      <h2>Commande envoyée !</h2>
      <p class="muted">N° <b>${esc(cmd.numero)}</b> · ${money(cmd.total)}</p>
      <p style="margin-top:10px">Noecy va confirmer votre commande très vite. Vous pouvez suivre son statut dans « Mes commandes ».</p>
      ${cmd.moyen_paiement === 'wave' ? (wl
        ? `<div class="wave-box"><p>Payez maintenant avec Wave (${money(cmd.total)}). Indiquez <b>${esc(cmd.numero)}</b> en référence si possible.</p>
           <a class="btn wave block lg" href="${esc(wl)}" target="_blank" rel="noopener"> Payer ${money(cmd.total)} avec Wave</a></div>`
        : `<div class="wave-box"><p>Noecy vous enverra le lien de paiement Wave.</p></div>`) : ''}
    </div>`,
    foot: `<button class="btn ghost" data-close data-act="my-orders">Mes commandes</button><button class="btn primary" data-close>Continuer mes achats</button>`,
  });
}

function openMyOrders() {
  const c = SHOP.client;
  let body;
  if (!c) body = `<div class="empty"><span class="big">${ic('user-round')}</span><h3>Présentez-vous d'abord</h3><button class="btn primary" style="margin-top:14px" data-close data-act="ask-name">Entrer mon nom</button></div>`;
  else if (!SHOP.commandes.length) body = `<div class="empty"><span class="big">${ic('receipt')}</span><h3>Aucune commande pour l'instant</h3><p>Vos commandes apparaîtront ici.</p></div>`;
  else {
    body = SHOP.commandes.map((o, i) => {
      const reste = o.total - (o.montant_paye || 0);
      const wl = o.statut !== 'annulee' && o.statut !== 'payee' && o.moyen_paiement === 'wave' ? waveLink(reste) : '';
      return `<div class="my-order" style="--i:${i}">
        <div class="top"><b>${esc(o.numero)}</b>${pillCmd(o.statut)}</div>
        <span class="small muted">${fDateTime(o.created_at)} · ${PAY[o.moyen_paiement]?.label || ''}</span>
        <ul>${(o.lignes || []).map((l) => `<li>${l.quantite} × ${esc(l.nom)}</li>`).join('')}</ul>
        <div class="total-row"><span class="muted">Total</span><b>${money(o.total)}</b></div>
        ${o.statut === 'credit' ? `<div class="total-row"><span class="muted">Reste à payer</span><b style="color:var(--danger)">${money(reste)}</b></div>` : ''}
        ${wl ? `<a class="btn wave sm block" style="margin-top:8px" href="${esc(wl)}" target="_blank" rel="noopener"> Payer avec Wave</a>` : ''}
      </div>`;
    }).join('');
  }
  modal({ title: `${ic('receipt')} Mes commandes`, size: 'drawer', body });
}

/* =====================================================================
   ESPACE GÉRANTE
   ===================================================================== */
const A = {
  ready: false, page: 'dashboard', periode: '30', poll: null, sig: '', charts: {},
  produits: [], categories: [], clients: [], commandes: [], fabrications: [], ecritures: [],
  f: { cmd: 'en_attente', cli: 'en_attente', q: '', gl: 'tout', glType: 'tous', cat: 'tous' },
  seen: null,
};
const prod = (id) => A.produits.find((p) => p.id === id);
const client = (id) => A.clients.find((c) => c.id === id);
const isConfirmed = (c) => c.statut === 'payee' || c.statut === 'credit';
const reste = (c) => Math.max(0, (c.total || 0) - (c.montant_paye || 0));
const seuilOf = (p) => (p.seuil_alerte ?? SETTINGS.seuil_defaut ?? 5);

function avgCost(pid) {
  const f = A.fabrications.filter((x) => x.produit_id === pid);
  const q = sum(f, 'quantite');
  return q ? sum(f, 'cout_total') / q : 0;
}

async function loadAll() {
  const [s, ...rows] = await Promise.all([DB.getSettings(), ...DB.TABLES.map((t) => DB.all(t))]);
  SETTINGS = s;
  DB.TABLES.forEach((t, i) => { A[t] = rows[i] || []; });
  A.categories.sort((a, b) => (a.ordre || 0) - (b.ordre || 0));
  CATS = A.categories;
}
const adminSig = () => [
  A.commandes.map((c) => c.id + c.statut + c.montant_paye).join(),
  A.clients.map((c) => c.id + c.statut).join(),
  A.produits.map((p) => p.id + p.stock + p.prix + p.actif).join(),
  A.ecritures.length, A.fabrications.length, A.categories.length,
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
  if (document.hidden || !A.ready) return;
  try { await loadAll(); } catch (e) { return; }
  let news = 0;
  A.commandes.filter((c) => !A.seen.has(c.id)).forEach((c) => { news++; A.seen.add(c.id); toast(` Nouvelle commande ${c.numero} — ${c.client_nom} (${money(c.total)})`, 'info', 6000); });
  A.clients.filter((c) => !A.seen.has(c.id)).forEach((c) => { news++; A.seen.add(c.id); toast(` ${c.nom} demande à être validé(e)`, 'info', 6000); });
  if (news) ding();
  const sig = adminSig();
  if (sig !== A.sig) { A.sig = sig; updateNav(); if (!$('.modal-wrap')) renderPage(false); }
}

async function reload() { await loadAll(); A.sig = adminSig(); A.commandes.forEach((c) => A.seen.add(c.id)); A.clients.forEach((c) => A.seen.add(c.id)); }
async function refreshAfter() { await reload(); updateNav(); renderPage(false); }

/* ---------- Connexion ---------- */
async function renderLogin() {
  const local = DB.mode === 'local';
  const first = local && !(await DB.hasAdmin());
  $('#app').innerHTML = `<div class="login">
    <div class="blob" style="width:340px;height:340px;background:#f6a609;right:-80px;top:-60px"></div>
    <div class="blob" style="width:300px;height:300px;background:#e0435a;left:-80px;bottom:-60px;animation-delay:-6s"></div>
    <form class="login-card" id="login-form">
      <a class="brand" href="#/"><span class="brand-logo">N</span><span class="brand-name">Noecy <b>Market</b></span></a>
      <h2>${first ? 'Créez votre code' : 'Espace gérante'}</h2>
      <p class="sub">${first ? 'Choisissez un code PIN (4 à 8 chiffres) pour protéger votre espace.' : local ? 'Entrez votre code PIN' : 'Connectez-vous avec votre compte gérante'}</p>
      ${local ? `
        <div class="field"><input class="pin-input" id="l-pin" type="password" inputmode="numeric" pattern="[0-9]{4,8}" maxlength="8" placeholder="••••" required autocomplete="current-password"></div>
        ${first ? `<div class="field"><input class="pin-input" id="l-pin2" type="password" inputmode="numeric" pattern="[0-9]{4,8}" maxlength="8" placeholder="Confirmer" required></div>` : ''}`
      : `<div class="field"><label>E-mail</label><input id="l-email" type="email" required autocomplete="username"></div>
         <div class="field"><label>Mot de passe</label><input id="l-pass" type="password" required autocomplete="current-password"></div>`}
      <button class="btn primary lg block" type="submit">${first ? 'Créer et entrer' : 'Se connecter'} ${ic('arrow-right')}</button>
      <p class="small muted" style="text-align:center;margin-top:16px"><a href="#/" style="color:var(--plum2)">← Retour à la boutique</a></p>
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
          if (first) {
            if (pin !== $('#l-pin2').value.trim()) throw new Error('Les deux codes ne correspondent pas.');
            await DB.setupAdmin(pin);
          } else await DB.login(null, pin);
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
  ['produits', 'Produits', 'package'],
  ['inventaire', 'Stock & fabrication', 'factory'],
  ['rentabilite', 'Rentabilité', 'trending-up'],
  ['grandlivre', 'Grand livre', 'book-open'],
  ['relances', 'Relances crédit', 'bell-ring'],
  ['parametres', 'Paramètres', 'settings'],
];

function navBadges() {
  return {
    commandes: [A.commandes.filter((c) => c.statut === 'en_attente').length, ''],
    clients: [A.clients.filter((c) => c.statut === 'en_attente').length, ''],
    relances: [A.commandes.filter((c) => c.statut === 'credit').length, 'red'],
    inventaire: [A.produits.filter((p) => p.actif && p.stock <= seuilOf(p)).length, 'red'],
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
  el.innerHTML = P.render();
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
  'goto': (el) => { location.hash = '#/admin/' + el.dataset.page; },
  'periode': (el) => { A.periode = el.dataset.p; renderPage(); },
});

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

function soldSince(since) {
  const m = {};
  A.commandes.filter((c) => isConfirmed(c) && confirmedAt(c) >= since).forEach((c) => {
    (c.lignes || []).forEach((l) => { m[l.produit_id] = (m[l.produit_id] || 0) + Number(l.quantite); });
  });
  return m;
}

function computeStats() {
  const start = periodStart(A.periode);
  const sk = dayKey(start);
  const ventes = A.commandes.filter((c) => isConfirmed(c) && confirmedAt(c) >= start);
  const ca = sum(ventes, 'total');
  const cout = sum(ventes, 'cout_revient');
  const entrees = A.ecritures.filter((e) => e.type === 'entree' && e.date >= sk);
  const sorties = A.ecritures.filter((e) => e.type === 'sortie' && e.date >= sk);
  const credits = A.commandes.filter((c) => c.statut === 'credit');
  const actifs = A.produits.filter((p) => p.actif);
  const articles = sum(ventes, (c) => sum(c.lignes || [], 'quantite'));

  // Série journalière
  const nbJours = A.periode === '7' ? 7 : A.periode === 'mois' ? new Date().getDate() : 30;
  const labels = [], serieCA = [], serieEnc = [];
  for (let i = nbJours - 1; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const k = dayKey(d);
    labels.push(d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }));
    serieCA.push(sum(A.commandes.filter((c) => isConfirmed(c) && dayKey(confirmedAt(c)) === k), 'total'));
    serieEnc.push(sum(A.ecritures.filter((e) => e.type === 'entree' && e.date === k), 'montant'));
  }

  // Par catégorie / produit
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

  return {
    ca, cout, benef: ca - cout, marge: ca ? ((ca - cout) / ca) * 100 : 0, nbVentes: ventes.length, articles,
    encaisse: sum(entrees, 'montant'),
    depenses: sum(sorties.filter((e) => e.categorie === 'fabrication'), 'montant'),
    sortiesTot: sum(sorties, 'montant'),
    creances: sum(credits, reste), nbCredits: credits.length,
    valeurStock: sum(actifs, (p) => p.stock * p.prix), coutStock: sum(actifs, (p) => p.stock * avgCost(p.id)),
    unitesStock: sum(actifs, 'stock'),
    panier: ventes.length ? ca / ventes.length : 0,
    serie: { labels, ca: serieCA, enc: serieEnc },
    parCat, topProd: Object.entries(parProd).sort((a, b) => b[1].q - a[1].q).slice(0, 5),
    topClients: Object.values(parClient).sort((a, b) => b.ca - a.ca).slice(0, 5),
    enAttente: A.commandes.filter((c) => c.statut === 'en_attente'),
    clientsAttente: A.clients.filter((c) => c.statut === 'en_attente'),
  };
}

function computeAlerts() {
  const out = [];
  const since7 = new Date(); since7.setDate(since7.getDate() - 7);
  const sold7 = soldSince(since7);
  A.produits.filter((p) => p.actif).forEach((p) => {
    const v = (sold7[p.id] || 0) / 7;
    if (p.stock <= 0) out.push({ lvl: 'danger', icon: 'package-x', txt: `<b>${esc(p.nom)}</b> est en rupture de stock.`, page: 'inventaire', btn: 'Fabriquer' });
    else if (v > 0 && p.stock / v <= 3) out.push({ lvl: 'hot', icon: 'flame', txt: `<b>${esc(p.nom)}</b> part vite : ${num(sold7[p.id])} vendu(s) en 7 jours, plus que <b>${p.stock}</b> en stock (≈ ${Math.max(1, Math.round(p.stock / v))} jour(s)).`, page: 'inventaire', btn: 'Réapprovisionner' });
    else if (p.stock <= seuilOf(p)) out.push({ lvl: 'warn', icon: 'triangle-alert', txt: `Stock bas : <b>${esc(p.nom)}</b> — ${p.stock} restant(s) (seuil ${seuilOf(p)}).`, page: 'inventaire', btn: 'Voir' });
  });
  const att = A.commandes.filter((c) => c.statut === 'en_attente').length;
  if (att) out.push({ lvl: 'info', icon: 'shopping-cart', txt: `<b>${att}</b> commande(s) en attente de validation.`, page: 'commandes', btn: 'Traiter' });
  const cl = A.clients.filter((c) => c.statut === 'en_attente').length;
  if (cl) out.push({ lvl: 'info', icon: 'user-check', txt: `<b>${cl}</b> client(s) attendent la validation de leur nom.`, page: 'clients', btn: 'Valider' });
  const retard = A.commandes.filter((c) => c.statut === 'credit' && daysSince(c.confirmed_at || c.created_at) >= 7);
  if (retard.length) out.push({ lvl: 'danger', icon: 'hand-coins', txt: `<b>${retard.length}</b> crédit(s) impayé(s) depuis plus de 7 jours — ${money(sum(retard, reste))}.`, page: 'relances', btn: 'Relancer' });
  return out;
}

const kpi = (label, val, icon, cls, isMoney, sub = '', i = 0) => `<div class="kpi ${cls}" style="--i:${i}">
  <div class="ki">${ic(icon)}</div><div class="kl">${label}</div>
  <div class="kv" data-count="${Math.round(val)}" ${isMoney ? 'data-money' : ''}>0</div>${sub ? `<div class="ks">${sub}</div>` : ''}</div>`;

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
    ${al.length ? `<div class="alerts">${al.map((a, i) => `<div class="alert ${a.lvl}" style="--i:${i}"><span class="ai">${ic(a.icon)}</span><span class="at">${a.txt}</span><button class="btn sm ghost" data-act="goto" data-page="${a.page}">${a.btn}</button></div>`).join('')}</div>`
      : `<div class="alerts"><div class="alert ok"><span class="ai">${ic('circle-check')}</span><span class="at">Tout est sous contrôle : aucun stock critique, aucune commande en attente.</span></div></div>`}
    <div class="kpis">
      ${kpi("Chiffre d'affaires", s.ca, 'coins', '', true, `${s.nbVentes} vente(s) confirmée(s)`, 0)}
      ${kpi('Encaissé', s.encaisse, 'wallet', 'leaf', true, 'Argent réellement reçu', 1)}
      ${kpi('Bénéfice brut', s.benef, 'piggy-bank', 'mango', true, `Marge ${pct(s.marge)}`, 2)}
      ${kpi('Crédits à recouvrer', s.creances, 'hand-coins', 'danger', true, `${s.nbCredits} commande(s) à crédit`, 3)}
      ${kpi('Dépenses fabrication', s.depenses, 'factory', 'caramel', true, `Toutes sorties : ${money(s.sortiesTot)}`, 4)}
      ${kpi('Valeur du stock', s.valeurStock, 'boxes', '', true, `${num(s.unitesStock)} unité(s) · coût ${money(s.coutStock)}`, 5)}
      ${kpi('Panier moyen', s.panier, 'shopping-bag', 'leaf', true, 'Par commande confirmée', 6)}
      ${kpi('Articles vendus', s.articles, 'package-check', 'mango', false, `${A.clients.filter((c) => c.statut === 'valide').length} client(s) validé(s)`, 7)}
    </div>
    <div class="dash-grid">
      <div class="card span2"><div class="card-head"><h3>Évolution des ventes</h3><span class="small muted">Chiffre d'affaires vs encaissé</span></div><div class="chart-box"><canvas id="ch-ventes"></canvas></div></div>
      <div class="card"><div class="card-head"><h3>Ventes par catégorie</h3></div>${Object.keys(s.parCat).length ? '<div class="chart-box sm"><canvas id="ch-cat"></canvas></div>' : `<div class="empty" style="padding:30px 0"><span class="big">${ic('chart-pie')}</span><p>Pas encore de ventes sur la période.</p></div>`}</div>
      <div class="card"><div class="card-head"><h3> Meilleurs produits</h3><span class="small muted">Quantités</span></div>
        ${s.topProd.length ? `<ul class="rank">${s.topProd.map(([id, v]) => `<li><span class="pos"></span><div class="rn"><b>${esc(v.nom)}</b><div class="bar"><i style="width:${(v.q / maxQ) * 100}%"></i></div></div><div class="rv">${num(v.q)}<br><span class="small muted">${money(v.ca)}</span></div></li>`).join('')}</ul>` : '<p class="muted">Aucune vente sur la période.</p>'}
      </div>
      <div class="card"><div class="card-head"><h3> Meilleurs clients</h3><span class="small muted">Montant</span></div>
        ${s.topClients.length ? `<ul class="rank">${s.topClients.map((v) => `<li><span class="pos"></span><div class="rn"><b>${esc(v.nom)}</b><div class="bar leaf"><i style="width:${(v.ca / maxC) * 100}%"></i></div></div><div class="rv">${money(v.ca)}<br><span class="small muted">${v.n} cmd</span></div></li>`).join('')}</ul>` : '<p class="muted">Aucun client sur la période.</p>'}
      </div>
      <div class="card"><div class="card-head"><h3> À traiter</h3></div>
        ${s.enAttente.length || s.clientsAttente.length ? `<ul class="rank">
          ${s.clientsAttente.slice(0, 4).map((c) => `<li><span class="avatar" style="width:34px;height:34px;border-radius:11px;font-size:13px">${esc(initials(c.nom))}</span><div class="rn"><b>${esc(c.nom)}</b><span class="small muted">Nom à valider</span></div><button class="btn sm leaf" data-act="cli-valider" data-id="${esc(c.id)}">${ic('check')}</button></li>`).join('')}
          ${s.enAttente.slice(0, 5).map((c) => `<li><span class="pos">${ic('receipt')}</span><div class="rn"><b>${esc(c.numero)} · ${esc(c.client_nom)}</b><span class="small muted">${fDateTime(c.created_at)}</span></div><div class="rv">${money(c.total)}</div></li>`).join('')}
        </ul><button class="btn soft block" style="margin-top:14px" data-act="goto" data-page="commandes">Voir les commandes</button>` : '<p class="muted">Rien en attente</p>'}
      </div>
    </div>`;
  },
  after() {
    $$('.rank').forEach((r) => $$('li', r).forEach((li, i) => { const p = $('.pos', li); if (p && !p.innerHTML.trim()) p.textContent = i + 1; }));
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
          scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } }, y: { beginAtZero: true, grid: { color: '#f3eaef' }, border: { display: false }, ticks: { callback: (v) => num(v), maxTicksLimit: 5 } } },
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

/* ---------- Services métier ---------- */
async function checkStock(lignes) {
  for (const l of lignes) {
    const p = prod(l.produit_id);
    if (!p) throw new Error(`Produit introuvable : ${l.nom}`);
    if (p.stock < l.quantite) throw new Error(`Stock insuffisant pour ${p.nom} : ${p.stock} disponible(s), ${l.quantite} demandé(s).`);
  }
}

async function confirmOrder(c, paye, moyen) {
  await reload();
  c = A.commandes.find((x) => x.id === c.id) || c;
  if (c.statut !== 'en_attente') throw new Error('Cette commande a déjà été traitée.');
  await checkStock(c.lignes);
  // Le stock est touché dès la confirmation (payée OU à crédit)
  for (const l of c.lignes) {
    const p = prod(l.produit_id);
    p.stock -= l.quantite;
    await DB.update('produits', p.id, { stock: p.stock });
  }
  const cout = sum(c.lignes, (l) => l.quantite * avgCost(l.produit_id));
  paye = Math.max(0, Math.min(Number(paye) || 0, c.total));
  const statut = paye >= c.total ? 'payee' : 'credit';
  const now = new Date().toISOString();
  await DB.update('commandes', c.id, {
    statut, montant_paye: paye, cout_revient: cout, confirmed_at: now, paid_at: statut === 'payee' ? now : null,
    paiements: paye > 0 ? [{ date: now, montant: paye, moyen }] : [],
  });
  if (paye > 0) {
    await DB.insert('ecritures', { date: dayKey(), libelle: `Vente ${c.numero} – ${c.client_nom}`, type: 'entree', categorie: 'vente', montant: paye, ref: c.id });
  }
  return statut;
}

async function addPayment(c, montant, moyen) {
  montant = Math.min(Number(montant) || 0, reste(c));
  if (montant <= 0) throw new Error('Montant invalide.');
  const paye = (c.montant_paye || 0) + montant;
  const now = new Date().toISOString();
  const statut = paye >= c.total ? 'payee' : 'credit';
  await DB.update('commandes', c.id, { montant_paye: paye, statut, paid_at: statut === 'payee' ? now : null, paiements: [...(c.paiements || []), { date: now, montant, moyen }] });
  await DB.insert('ecritures', { date: dayKey(), libelle: `Règlement crédit ${c.numero} – ${c.client_nom}`, type: 'entree', categorie: 'recouvrement', montant, ref: c.id });
  return statut;
}

async function cancelOrder(c) {
  if (isConfirmed(c)) {
    for (const l of c.lignes) {
      const p = prod(l.produit_id);
      if (p) { p.stock += Number(l.quantite); await DB.update('produits', p.id, { stock: p.stock }); }
    }
    if (c.montant_paye > 0) {
      await DB.insert('ecritures', { date: dayKey(), libelle: `Annulation ${c.numero} – remboursement ${c.client_nom}`, type: 'sortie', categorie: 'annulation', montant: c.montant_paye, ref: c.id });
    }
  }
  await DB.update('commandes', c.id, { statut: 'annulee' });
}

/* ---------- Commandes ---------- */
PAGES.commandes = {
  title: 'Commandes',
  render() {
    const tabs = [['en_attente', 'En attente'], ['credit', 'À crédit'], ['payee', 'Payées'], ['annulee', 'Annulées'], ['toutes', 'Toutes']];
    const q = norm(A.f.q);
    const list = A.commandes
      .filter((c) => A.f.cmd === 'toutes' || c.statut === A.f.cmd)
      .filter((c) => !q || norm(c.numero + ' ' + c.client_nom).includes(q))
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    return `
    <div class="page-head"><div><h1>Commandes</h1><p class="muted">Validez les commandes : payée ou à crédit. Le stock est déduit à la validation.</p></div>
      <button class="btn primary" data-act="quick-sale">${ic('plus')} Nouvelle vente</button></div>
    <div class="toolbar">
      <div class="seg">${tabs.map(([k, l]) => { const n = k === 'toutes' ? 0 : A.commandes.filter((c) => c.statut === k).length; return `<button class="${A.f.cmd === k ? 'on' : ''}" data-act="f-cmd" data-k="${k}">${l}${n && k !== 'annulee' && k !== 'payee' ? `<span class="count">${n}</span>` : ''}</button>`; }).join('')}</div>
      <label class="search field" style="margin:0">${ic('search')}<input class="input" placeholder="N° ou client…" data-inp="adm-q" value="${esc(A.f.q)}"></label>
    </div>
    <div class="cards">${list.length ? list.map(orderCard).join('') : `<div class="empty"><span class="big">${ic('receipt')}</span><h3>Aucune commande ici</h3></div>`}</div>`;
  },
};

function orderCard(c, i) {
  const cl = client(c.client_id);
  const lines = (c.lignes || []).map((l) => {
    const p = prod(l.produit_id);
    const bad = c.statut === 'en_attente' && (!p || p.stock < l.quantite);
    return `<li class="${bad ? 'bad' : ''}"><span>${l.quantite} × ${esc(l.nom)}${bad ? ` <small>(stock : ${p ? p.stock : 0})</small>` : ''}</span><span>${money(l.prix * l.quantite)}</span></li>`;
  }).join('');
  const pay = PAY[c.moyen_paiement];
  const r = reste(c);
  let actions = '';
  if (c.statut === 'en_attente') {
    actions = `<button class="btn leaf sm" data-act="cmd-payee" data-id="${esc(c.id)}">${ic('check')} Payée</button>
      <button class="btn mango sm" data-act="cmd-credit" data-id="${esc(c.id)}">${ic('hand-coins')} Crédit</button>
      <button class="btn ghost sm" data-act="cmd-annuler" data-id="${esc(c.id)}" style="flex:0">${ic('x')}</button>`;
  } else if (c.statut === 'credit') {
    actions = `<button class="btn leaf sm" data-act="cmd-encaisser" data-id="${esc(c.id)}">${ic('banknote')} Encaisser</button>
      ${cl?.telephone ? `<a class="btn ghost sm" href="${esc(relanceLink(c, cl))}" target="_blank" rel="noopener">${ic('message-circle')} Relancer</a>` : ''}
      <button class="btn ghost sm" data-act="cmd-annuler" data-id="${esc(c.id)}" style="flex:0" title="Annuler">${ic('x')}</button>`;
  } else if (c.statut === 'payee') {
    actions = `<button class="btn ghost sm" data-act="cmd-annuler" data-id="${esc(c.id)}">${ic('undo-2')} Annuler la vente</button>`;
  } else {
    actions = `<button class="btn ghost sm" data-act="cmd-suppr" data-id="${esc(c.id)}">${ic('trash-2')} Supprimer</button>`;
  }
  return `<div class="order-card st-${c.statut}" style="--i:${i}">
    <div class="oc-head"><div><b>${esc(c.numero)}</b> ${pillCmd(c.statut)}</div><span class="small muted">${fDateTime(c.created_at)}</span></div>
    <div class="oc-client">${ic('user')} ${esc(c.client_nom)} ${cl?.telephone ? `<span class="small muted">· ${esc(cl.telephone)}</span>` : ''}</div>
    <ul class="oc-lines">${lines}</ul>
    ${c.note ? `<p class="small" style="color:var(--ink2)">Note : ${esc(c.note)}</p>` : ''}
    <div class="oc-foot"><span class="pill ${c.moyen_paiement === 'wave' ? 'wave' : ''}">${pay ? ic(pay.icon) : ''} ${pay?.label || esc(c.moyen_paiement)}</span><span class="oc-total">${money(c.total)}</span></div>
    ${c.statut === 'credit' ? `<div><div class="total-row small"><span class="muted">Payé ${money(c.montant_paye)}</span><b style="color:var(--danger)">Reste ${money(r)}</b></div><div class="bar warn"><i style="width:${(c.montant_paye / c.total) * 100}%"></i></div></div>` : ''}
    <div class="oc-actions">${actions}</div>
  </div>`;
}

function relanceLink(c, cl) {
  const msg = (SETTINGS.message_relance || DB.DEFAULT_SETTINGS.message_relance)
    .replace(/\{nom\}/g, c.client_nom).replace(/\{montant\}/g, money(reste(c))).replace(/\{numero\}/g, c.numero);
  const wl = waveLink(reste(c));
  return waLink(cl?.telephone, msg + (wl ? `\n\nPaiement Wave : ${wl}` : ''));
}

function paymentModal(c, { title, defaut, onOk }) {
  modal({
    title,
    body: `<p class="muted" style="margin-bottom:14px">${esc(c.numero)} · ${esc(c.client_nom)} · Total ${money(c.total)}${c.montant_paye ? ` · déjà payé ${money(c.montant_paye)}` : ''}</p>
      <div class="row">
        <div class="field"><label>Montant reçu (${esc(SETTINGS.devise)})</label><input id="pm-m" type="number" min="0" step="1" value="${Math.round(defaut)}"></div>
        <div class="field"><label>Moyen</label><select id="pm-moy">${['wave', 'especes'].map((k) => `<option value="${k}" ${c.moyen_paiement === k ? 'selected' : ''}>${PAY[k].label}</option>`).join('')}<option value="autre">Autre</option></select></div>
      </div>
      <p class="small muted">Si le montant est inférieur au reste dû, la différence reste en crédit.</p>`,
    foot: `<button class="btn ghost" data-close>Annuler</button><button class="btn leaf" id="pm-ok">${ic('check')} Valider</button>`,
    onMount: (el, close) => {
      $('#pm-ok', el).onclick = (e) => run(e.currentTarget, async () => { await onOk(+$('#pm-m', el).value, $('#pm-moy', el).value); close(); await refreshAfter(); });
    },
  });
}

Object.assign(ACT, {
  'f-cmd': (el) => { A.f.cmd = el.dataset.k; renderPage(false); },
  'cmd-payee': (el) => {
    const c = A.commandes.find((x) => x.id === el.dataset.id);
    paymentModal(c, { title: ' Confirmer le paiement', defaut: c.total, onOk: async (m, moy) => {
      const st = await confirmOrder(c, m, moy);
      toast(st === 'payee' ? `${c.numero} validée et payée` : `${c.numero} validée — reste en crédit`);
    } });
  },
  'cmd-credit': async (el) => {
    const c = A.commandes.find((x) => x.id === el.dataset.id);
    if (!(await confirmBox(`Valider <b>${esc(c.numero)}</b> de <b>${esc(c.client_nom)}</b> à crédit ?<br><span class="muted small">Le stock sera déduit et ${money(c.total)} sera ajouté aux relances.</span>`, { ok: 'Valider à crédit' }))) return;
    await run(null, async () => { await confirmOrder(c, 0, null); toast(`${c.numero} validée à crédit`); await refreshAfter(); });
  },
  'cmd-encaisser': (el) => {
    const c = A.commandes.find((x) => x.id === el.dataset.id);
    paymentModal(c, { title: ' Encaisser un règlement', defaut: reste(c), onOk: async (m, moy) => {
      const st = await addPayment(c, m, moy);
      if (st === 'payee') { confetti(); toast(`${c.numero} entièrement réglée`); } else toast('Règlement enregistré');
    } });
  },
  'cmd-annuler': async (el) => {
    const c = A.commandes.find((x) => x.id === el.dataset.id);
    const extra = isConfirmed(c) ? `<br><span class="small muted">Les articles seront remis en stock${c.montant_paye ? ` et un remboursement de ${money(c.montant_paye)} sera noté au grand livre` : ''}.</span>` : '';
    if (!(await confirmBox(`Annuler la commande <b>${esc(c.numero)}</b> ?${extra}`, { ok: 'Annuler la commande', danger: true }))) return;
    await run(null, async () => { await cancelOrder(c); toast('Commande annulée'); await refreshAfter(); });
  },
  'cmd-suppr': async (el) => {
    if (!(await confirmBox('Supprimer définitivement cette commande annulée ?', { ok: 'Supprimer', danger: true }))) return;
    await run(null, async () => { await DB.remove('commandes', el.dataset.id); await refreshAfter(); });
  },
});
INP['adm-q'] = debounce((el) => {
  A.f.q = el.value;
  const pos = el.selectionStart;
  renderPage(false);
  const n = $('[data-inp="adm-q"]'); if (n) { n.focus(); n.setSelectionRange(pos, pos); }
}, 250);

/* ---------- Vente rapide (saisie par la gérante) ---------- */
ACT['quick-sale'] = () => {
  const dispo = A.produits.filter((p) => p.actif);
  const valides = A.clients.filter((c) => c.statut === 'valide').sort((a, b) => a.nom.localeCompare(b.nom));
  const qte = {};
  const body = () => `
    <div class="row">
      <div class="field"><label>Client</label><select id="qs-cli"><option value="">— Client de passage —</option>${valides.map((c) => `<option value="${esc(c.id)}">${esc(c.nom)}</option>`).join('')}</select></div>
      <div class="field" id="qs-nom-f"><label>Nom (client de passage)</label><input id="qs-nom" placeholder="Ex. Voisine Fatou"></div>
    </div>
    <label class="small muted" style="font-weight:600">Articles</label>
    <div id="qs-lines" style="margin:6px 0 10px">${dispo.map((p) => `<div class="cart-line" style="padding:8px 0">
      <div class="thumb">${prodVisual(p)}</div><div class="info"><b>${esc(p.nom)}</b><span class="small muted">${money(p.prix)} · stock ${p.stock}</span></div>
      <div class="stepper"><button type="button" data-qs="-" data-id="${esc(p.id)}">${ic('minus')}</button><span id="qs-q-${esc(p.id)}">0</span><button type="button" data-qs="+" data-id="${esc(p.id)}">${ic('plus')}</button></div></div>`).join('')}</div>
    <div class="row">
      <div class="field"><label>Paiement</label><select id="qs-pay"><option value="wave">Payé par Wave</option><option value="especes">Payé en espèces</option><option value="credit">À crédit</option></select></div>
      <div class="field"><label>Date</label><input id="qs-date" type="date" value="${dayKey()}" disabled></div>
    </div>
    <div class="total-row big"><span>Total</span><span class="grad-text" id="qs-total">${money(0)}</span></div>`;
  modal({
    title: ' Nouvelle vente', size: 'wide', body: body(),
    foot: `<button class="btn ghost" data-close>Annuler</button><button class="btn primary" id="qs-ok">${ic('check')} Enregistrer la vente</button>`,
    onMount: (el, close) => {
      const total = () => sum(Object.entries(qte), ([id, q]) => (prod(id)?.prix || 0) * q);
      el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-qs]');
        if (!b) return;
        const p = prod(b.dataset.id);
        let q = (qte[p.id] || 0) + (b.dataset.qs === '+' ? 1 : -1);
        if (q > p.stock) { toast(`Stock disponible : ${p.stock}`, 'warn'); q = p.stock; }
        qte[p.id] = Math.max(0, q);
        $(`#qs-q-${CSS.escape(p.id)}`, el).textContent = qte[p.id];
        $('#qs-total', el).textContent = money(total());
      });
      $('#qs-cli', el).onchange = (e) => { $('#qs-nom-f', el).style.visibility = e.target.value ? 'hidden' : 'visible'; };
      $('#qs-ok', el).onclick = (e) => run(e.currentTarget, async () => {
        const lignes = Object.entries(qte).filter(([, q]) => q > 0).map(([id, q]) => { const p = prod(id); return { produit_id: id, nom: p.nom, prix: p.prix, quantite: q }; });
        if (!lignes.length) throw new Error('Ajoutez au moins un article.');
        const cid = $('#qs-cli', el).value;
        const cl = client(cid);
        const nom = cl ? cl.nom : ($('#qs-nom', el).value.trim() || 'Client de passage');
        const moyen = $('#qs-pay', el).value;
        if (moyen === 'credit' && !cl) throw new Error('Un crédit doit être rattaché à un client validé (pour les relances).');
        await checkStock(lignes);
        const cmd = await DB.insert('commandes', {
          numero: await DB.nextNumero(), client_id: cl ? cl.id : null, client_nom: nom, lignes, total: sum(lignes, (l) => l.prix * l.quantite),
          moyen_paiement: moyen, statut: 'en_attente', montant_paye: 0, cout_revient: 0, paiements: [], note: 'Vente saisie par la gérante',
        });
        A.commandes.push(cmd);
        await confirmOrder(cmd, moyen === 'credit' ? 0 : cmd.total, moyen);
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
      <div class="seg">${tabs.map(([k, l]) => { const n = A.clients.filter((c) => c.statut === k).length; return `<button class="${A.f.cli === k ? 'on' : ''}" data-act="f-cli" data-k="${k}">${l}${n ? `<span class="count">${n}</span>` : ''}</button>`; }).join('')}</div>
      <label class="search field" style="margin:0">${ic('search')}<input class="input" placeholder="Nom ou téléphone…" data-inp="adm-q" value="${esc(A.f.q)}"></label>
    </div>
    <div class="cards">${list.length ? list.map(clientCard).join('') : `<div class="empty"><span class="big">${ic(A.f.cli === 'en_attente' ? 'user-check' : 'users')}</span><h3>${A.f.cli === 'en_attente' ? 'Aucune demande en attente' : 'Aucun client'}</h3></div>`}</div>`;
  },
};

function clientStats(id) {
  const cmds = A.commandes.filter((c) => c.client_id === id && isConfirmed(c));
  return { n: cmds.length, total: sum(cmds, 'total'), du: sum(cmds.filter((c) => c.statut === 'credit'), reste) };
}

function clientCard(c, i) {
  const st = clientStats(c.id);
  const similaires = c.statut === 'en_attente'
    ? A.clients.filter((x) => x.id !== c.id && x.statut !== 'refuse' && (norm(x.nom) === norm(c.nom) || (c.telephone && telDigits(x.telephone) === telDigits(c.telephone))))
    : [];
  let acts = '';
  if (c.statut === 'en_attente') acts = `<button class="btn leaf sm" data-act="cli-valider" data-id="${esc(c.id)}">${ic('user-check')} Valider</button><button class="btn ghost sm" data-act="cli-refuser" data-id="${esc(c.id)}">${ic('user-x')} Refuser</button>`;
  else if (c.statut === 'valide') acts = `<button class="btn soft sm" data-act="cli-detail" data-id="${esc(c.id)}">${ic('eye')} Détails</button>${c.telephone ? `<a class="btn ghost sm" href="${esc(waLink(c.telephone, `Bonjour ${c.nom}`))}" target="_blank" rel="noopener">${ic('message-circle')}</a>` : ''}<button class="btn ghost sm" data-act="cli-refuser" data-id="${esc(c.id)}" title="Bloquer">${ic('ban')}</button>`;
  else acts = `<button class="btn leaf sm" data-act="cli-valider" data-id="${esc(c.id)}">${ic('user-check')} Valider</button><button class="btn ghost sm" data-act="cli-suppr" data-id="${esc(c.id)}">${ic('trash-2')}</button>`;
  return `<div class="client-card" style="--i:${i}">
    <div class="ch"><span class="avatar">${esc(initials(c.nom))}</span><div class="nm"><b>${esc(c.nom)}</b><span class="small muted">${c.telephone ? `${esc(c.telephone)}` : 'Pas de téléphone'} · ${fDate(c.created_at)}</span></div>
      ${c.statut === 'en_attente' ? '<span class="pill warn dot pulse">À valider</span>' : c.statut === 'valide' ? '<span class="pill ok">Validé</span>' : '<span class="pill bad">Refusé</span>'}</div>
    ${similaires.length ? `<div class="dup">${ic('triangle-alert')} Ressemble à : ${similaires.map((x) => esc(x.nom)).join(', ')}</div>` : ''}
    ${c.statut !== 'en_attente' ? `<div class="cstats"><div><small>Commandes</small><b>${st.n}</b></div><div><small>Total acheté</small><b>${money(st.total)}</b></div><div><small>Reste dû</small><b style="color:${st.du ? 'var(--danger)' : 'inherit'}">${money(st.du)}</b></div></div>` : ''}
    <div class="oc-actions">${acts}</div>
  </div>`;
}

async function setClientStatut(id, statut) {
  await DB.update('clients', id, { statut });
  await refreshAfter();
}

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
  'cli-add': () => {
    modal({
      title: ' Ajouter un client',
      body: `<div class="field"><label>Nom complet *</label><input id="ca-nom" maxlength="80"></div><div class="field"><label>Téléphone</label><input id="ca-tel" type="tel" maxlength="30"></div><p class="small muted">Le client sera directement validé.</p>`,
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
      <div class="seg"><button class="${A.f.cat === 'tous' ? 'on' : ''}" data-act="f-cat" data-k="tous">Tout</button>${A.categories.map((c) => `<button class="${A.f.cat === c.id ? 'on' : ''}" data-act="f-cat" data-k="${esc(c.id)}">${esc(c.nom)}</button>`).join('')}</div>
      <label class="search field" style="margin:0">${ic('search')}<input class="input" placeholder="Rechercher…" data-inp="adm-q" value="${esc(A.f.q)}"></label>
    </div>
    <div class="cards">${list.length ? list.map((p, i) => {
      const cu = avgCost(p.id), cat = catOf(p.categorie_id);
      const marge = p.prix - cu;
      return `<div class="ap-card ${p.actif ? '' : 'inactive'}" style="--i:${i}">
        <div class="media">${prodVisual(p)}<div class="tags">${cat ? `<span class="pill">${ic(cat.icone || 'shopping-bag', 'sm')} ${esc(cat.nom)}</span>` : ''}${p.actif ? '' : '<span class="pill">Masqué</span>'}</div></div>
        <div class="body">
          <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start"><h3>${esc(p.nom)}</h3><span class="price">${money(p.prix)}</span></div>
          <div class="mini"><div><small>Stock</small><b style="color:${p.stock <= 0 ? 'var(--danger)' : p.stock <= seuilOf(p) ? '#b77400' : 'inherit'}">${p.stock}</b></div><div><small>Coût / unité</small><b>${cu ? money(cu) : '—'}</b></div><div><small>Marge / unité</small><b style="color:${cu ? (marge >= 0 ? 'var(--leaf)' : 'var(--danger)') : 'inherit'}">${cu ? money(marge) : '—'}</b></div></div>
          <div class="acts">
            <label class="switch" title="Visible en boutique"><input type="checkbox" data-act="prod-toggle" data-id="${esc(p.id)}" ${p.actif ? 'checked' : ''}><span></span></label><span class="small muted" style="flex:1">${p.actif ? 'En boutique' : 'Masqué'}</span>
            <button class="icon-btn flat" data-act="prod-edit" data-id="${esc(p.id)}" title="Modifier">${ic('pencil')}</button>
            <button class="icon-btn flat" data-act="prod-suppr" data-id="${esc(p.id)}" title="Supprimer">${ic('trash-2')}</button>
          </div>
        </div></div>`;
    }).join('') : `<div class="empty"><span class="big">${ic('package')}</span><h3>Aucun produit</h3><p>Créez votre premier article.</p></div>`}</div>`;
  },
};

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
    const used = A.fabrications.some((f) => f.produit_id === p.id) || A.commandes.some((c) => (c.lignes || []).some((l) => l.produit_id === p.id));
    if (used) {
      if (await confirmBox(`<b>${esc(p.nom)}</b> a un historique (ventes ou fabrications). Il est préférable de le <b>masquer</b> de la boutique pour garder vos statistiques.`, { ok: 'Masquer le produit' })) {
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
  p = p || { nom: '', categorie_id: A.categories[0]?.id || '', prix: '', unite: '', description: '', photo: '', stock: 0, seuil_alerte: SETTINGS.seuil_defaut || 5, actif: true };
  let photo = p.photo || '';
  modal({
    title: isNew ? ' Nouveau produit' : `Modifier · ${esc(p.nom)}`, size: 'wide',
    body: `<form id="pf" autocomplete="off">
      <label class="dropzone" id="pf-dz"><div class="prev" id="pf-prev">${photo ? `<img src="${esc(photo)}" class="pv">` : ic('camera')}</div>
        <div><b>Photo du produit</b><p class="small muted">Cliquez ou glissez une image (compressée automatiquement).</p>
        ${photo ? '<button type="button" class="btn ghost sm" id="pf-rm" style="margin-top:8px">Retirer la photo</button>' : ''}</div>
        <input type="file" accept="image/*" id="pf-file"></label>
      <div class="row" style="margin-top:14px">
        <div class="field"><label>Nom *</label><input id="pf-nom" required maxlength="80" value="${esc(p.nom)}" placeholder="Ex. Jus de Bissap"></div>
        <div class="field"><label>Catégorie</label><select id="pf-cat">${A.categories.map((c) => `<option value="${esc(c.id)}" ${c.id === p.categorie_id ? 'selected' : ''}>${esc(c.nom)}</option>`).join('')}</select></div>
      </div>
      <div class="row3">
        <div class="field"><label>Prix de vente * (${esc(SETTINGS.devise)})</label><input id="pf-prix" type="number" min="0" step="1" required value="${esc(p.prix)}"></div>
        <div class="field"><label>Format / unité</label><input id="pf-unite" maxlength="40" value="${esc(p.unite || '')}" placeholder="Bouteille 50 cl, sachet…"></div>
        <div class="field"><label>Seuil d'alerte stock</label><input id="pf-seuil" type="number" min="0" step="1" value="${esc(p.seuil_alerte ?? 5)}"></div>
      </div>
      ${isNew ? `<div class="field"><label>Stock initial</label><input id="pf-stock" type="number" min="0" step="1" value="0"><span class="hint">Astuce : utilisez plutôt « Stock & fabrication » pour enregistrer aussi vos dépenses.</span></div>` : ''}
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
        if (data.nom.length < 2) throw new Error('Le nom est obligatoire.');
        if (!(data.prix >= 0) || $('#pf-prix', el).value === '') throw new Error('Indiquez un prix de vente.');
        if (isNew) {
          data.stock = Math.max(0, parseInt($('#pf-stock', el).value, 10) || 0);
          await DB.insert('produits', data);
        } else await DB.update('produits', p.id, data);
        close();
        toast(isNew ? 'Produit créé' : 'Produit mis à jour');
        await refreshAfter();
      });
    },
  });
}

/* ---------- Stock & fabrication ---------- */
const SUGG = {
  'cat-jus': ['Fleurs de bissap', 'Tamarin (tomi)', 'Sucre', 'Menthe', 'Arôme vanille', 'Bouteilles', 'Glace', 'Eau', 'Transport'],
  'cat-chips': ['Bananes', 'Huile', 'Sel', 'Piment', 'Sachets', 'Gaz', 'Transport'],
  'cat-sucre': ['Sucre', 'Lait concentré', 'Beurre', 'Arachides', 'Emballages', 'Gaz', 'Transport'],
};

PAGES.inventaire = {
  title: 'Stock & fabrication',
  render() {
    const prods = A.produits.slice().sort((a, b) => (b.actif - a.actif) || (a.stock - seuilOf(a)) - (b.stock - seuilOf(b)));
    const fabs = A.fabrications.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.created_at).localeCompare(String(a.created_at)));
    return `
    <div class="page-head"><div><h1>Stock & fabrication</h1><p class="muted">Enregistrez chaque fabrication avec ses dépenses : le stock et le coût de revient se calculent seuls.</p></div>
      <button class="btn primary" data-act="fab-new">${ic('factory')} Nouvelle fabrication</button></div>
    <div class="table-wrap" style="margin-bottom:26px"><table class="tbl">
      <thead><tr><th>Produit</th><th>Stock</th><th class="hide-mobile">Niveau</th><th class="num">Coût / unité</th><th class="num">Valeur (prix vente)</th><th></th></tr></thead>
      <tbody>${prods.map((p, i) => {
        const s = seuilOf(p), lvl = Math.min(100, (p.stock / Math.max(1, s * 3)) * 100);
        const cls = p.stock <= 0 ? 'bad' : p.stock <= s ? 'warn' : 'leaf';
        return `<tr style="--i:${i};${p.actif ? '' : 'opacity:.55'}">
          <td><div style="display:flex;gap:12px;align-items:center"><div class="thumb">${prodVisual(p)}</div><div><b>${esc(p.nom)}</b><br><span class="small muted">Seuil d'alerte : ${s}</span></div></div></td>
          <td><span class="stock-num" style="color:${cls === 'bad' ? 'var(--danger)' : cls === 'warn' ? '#b77400' : 'inherit'}">${p.stock}</span></td>
          <td class="hide-mobile"><div class="bar ${cls} stock-bar"><i style="width:${lvl}%"></i></div></td>
          <td class="num">${avgCost(p.id) ? money(avgCost(p.id)) : '—'}</td>
          <td class="num">${money(p.stock * p.prix)}</td>
          <td class="num" style="white-space:nowrap"><button class="btn soft sm" data-act="fab-new" data-id="${esc(p.id)}">${ic('plus')} Fabriquer</button> <button class="btn ghost sm" data-act="stock-adj" data-id="${esc(p.id)}" title="Inventaire">${ic('clipboard-check')}</button></td>
        </tr>`;
      }).join('')}</tbody>
      <tfoot><tr><td>Total</td><td>${num(sum(prods, 'stock'))}</td><td class="hide-mobile"></td><td></td><td class="num">${money(sum(prods, (p) => p.stock * p.prix))}</td><td></td></tr></tfoot>
    </table></div>
    <div class="card-head"><h3> Historique des fabrications</h3><span class="small muted">${fabs.length} lot(s) · ${money(sum(fabs, 'cout_total'))} dépensés</span></div>
    ${fabs.length ? `<div class="table-wrap"><table class="tbl">
      <thead><tr><th>Date</th><th>Produit</th><th class="num">Quantité</th><th>Dépenses</th><th class="num">Coût total</th><th class="num">Coût / unité</th><th class="num">Bénéfice attendu</th><th></th></tr></thead>
      <tbody>${fabs.map((f, i) => {
        const p = prod(f.produit_id);
        const cu = f.quantite ? f.cout_total / f.quantite : 0;
        const ben = (p?.prix || 0) * f.quantite - f.cout_total;
        return `<tr style="--i:${i}"><td>${fDate(f.date)}</td><td><b>${esc(p?.nom || 'Produit supprimé')}</b></td><td class="num">${num(f.quantite)}</td>
          <td class="small">${(f.depenses || []).map((d) => `${esc(d.libelle)} <span class="muted">(${num(d.montant)})</span>`).join(', ') || '—'}</td>
          <td class="num">${money(f.cout_total)}</td><td class="num">${money(cu)}</td>
          <td class="num ${ben >= 0 ? 'amt-in' : 'amt-out'}">${money(ben)}</td>
          <td class="num"><button class="icon-btn flat" data-act="fab-suppr" data-id="${esc(f.id)}" title="Supprimer">${ic('trash-2')}</button></td></tr>`;
      }).join('')}</tbody></table></div>` : `<div class="card"><div class="empty" style="padding:30px"><span class="big">${ic('factory')}</span><h3>Aucune fabrication enregistrée</h3><p>Cliquez sur « Nouvelle fabrication » après chaque production.</p></div></div>`}`;
  },
};

function fabForm(pid) {
  const prods = A.produits.filter((p) => p.actif || p.id === pid);
  if (!prods.length) return toast("Créez d'abord un produit.", 'warn');
  let deps = [{ libelle: '', montant: '' }];
  modal({
    title: ' Nouvelle fabrication', size: 'wide',
    body: `<div class="row3">
        <div class="field"><label>Produit</label><select id="fb-p">${prods.map((p) => `<option value="${esc(p.id)}" ${p.id === pid ? 'selected' : ''}>${esc(p.nom)}</option>`).join('')}</select></div>
        <div class="field"><label>Quantité fabriquée *</label><input id="fb-q" type="number" min="1" step="1" placeholder="Ex. 40"></div>
        <div class="field"><label>Date</label><input id="fb-d" type="date" value="${dayKey()}"></div>
      </div>
      <label class="small" style="font-weight:600;color:var(--ink2)">Dépenses pour ce lot</label>
      <div class="sugg" id="fb-sugg"></div>
      <div id="fb-deps"></div>
      <button type="button" class="btn ghost sm" id="fb-add">${ic('plus')} Ajouter une dépense</button>
      <div class="recap" id="fb-recap"></div>
      <div class="field" style="margin-top:14px"><label>Note</label><input id="fb-note" maxlength="200" placeholder="Facultatif"></div>
      <label class="check"><input type="checkbox" id="fb-gl" checked> Enregistrer les dépenses dans le grand livre</label>`,
    foot: `<button class="btn ghost" data-close>Annuler</button><button class="btn primary" id="fb-ok">${ic('check')} Enregistrer la fabrication</button>`,
    onMount: (el, close) => {
      const renderDeps = () => {
        $('#fb-deps', el).innerHTML = deps.map((d, i) => `<div class="dep-line">
          <input class="input" data-i="${i}" data-k="libelle" placeholder="Ex. Sucre" value="${esc(d.libelle)}">
          <input class="input" data-i="${i}" data-k="montant" type="number" min="0" step="1" placeholder="Montant" value="${esc(d.montant)}">
          <button type="button" class="icon-btn flat" data-rm="${i}" title="Retirer">${ic('x')}</button></div>`).join('');
        icons(); recap();
      };
      const renderSugg = () => {
        const p = prod($('#fb-p', el).value);
        $('#fb-sugg', el).innerHTML = (SUGG[p?.categorie_id] || ['Ingrédients', 'Emballages', 'Gaz', 'Transport']).map((s) => `<button type="button" data-s="${esc(s)}">+ ${esc(s)}</button>`).join('');
      };
      const recap = () => {
        const p = prod($('#fb-p', el).value);
        const q = parseInt($('#fb-q', el).value, 10) || 0;
        const tot = sum(deps, (d) => Number(d.montant) || 0);
        const cu = q ? tot / q : 0;
        const ben = q * (p?.prix || 0) - tot;
        $('#fb-recap', el).innerHTML = `
          <div><small>Coût total</small><b>${money(tot)}</b></div>
          <div><small>Coût par unité</small><b>${q ? money(cu) : '—'}</b></div>
          <div><small>Prix de vente</small><b>${money(p?.prix || 0)}</b></div>
          <div><small>Marge par unité</small><b class="${q ? ((p?.prix || 0) - cu >= 0 ? 'pos' : 'neg') : ''}">${q ? money((p?.prix || 0) - cu) : '—'}</b></div>
          <div style="grid-column:1/-1"><small>Bénéfice si tout est vendu</small><b class="${ben >= 0 ? 'pos' : 'neg'}" style="font-size:24px">${money(ben)}</b>${tot && q ? ` <span class="small muted">· marge ${pct(((q * (p?.prix || 0) - tot) / Math.max(1, q * (p?.prix || 0))) * 100)}</span>` : ''}</div>`;
      };
      el.addEventListener('input', (e) => {
        const t = e.target;
        if (t.dataset.i !== undefined) { deps[+t.dataset.i][t.dataset.k] = t.value; recap(); }
        if (t.id === 'fb-q') recap();
      });
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
        if (r) { deps.splice(+r.dataset.rm, 1); if (!deps.length) deps.push({ libelle: '', montant: '' }); renderDeps(); }
      });
      $('#fb-add', el).onclick = () => { deps.push({ libelle: '', montant: '' }); renderDeps(); };
      $('#fb-p', el).onchange = () => { renderSugg(); recap(); };
      renderSugg(); renderDeps();
      setTimeout(() => $('#fb-q', el).focus(), 350);
      $('#fb-ok', el).onclick = (e) => run(e.currentTarget, async () => {
        const p = prod($('#fb-p', el).value);
        const q = parseInt($('#fb-q', el).value, 10);
        if (!p) throw new Error('Choisissez un produit.');
        if (!q || q <= 0) throw new Error('Indiquez la quantité fabriquée.');
        const depenses = deps.filter((d) => d.libelle.trim() || Number(d.montant)).map((d) => ({ libelle: d.libelle.trim() || 'Dépense', montant: Number(d.montant) || 0 }));
        const cout = sum(depenses, 'montant');
        const date = $('#fb-d', el).value || dayKey();
        const f = await DB.insert('fabrications', { produit_id: p.id, date, quantite: q, depenses, cout_total: cout, note: $('#fb-note', el).value.trim() });
        await DB.update('produits', p.id, { stock: (p.stock || 0) + q });
        if ($('#fb-gl', el).checked && cout > 0) {
          await DB.insert('ecritures', { date, libelle: `Fabrication ${p.nom} (${q} unités)`, type: 'sortie', categorie: 'fabrication', montant: cout, ref: f.id });
        }
        close();
        toast(`+${q} ${p.nom} en stock`);
        await refreshAfter();
      });
    },
  });
}

Object.assign(ACT, {
  'fab-new': (el) => fabForm(el.dataset.id),
  'fab-suppr': async (el) => {
    const f = A.fabrications.find((x) => x.id === el.dataset.id);
    const p = prod(f.produit_id);
    if (!(await confirmBox(`Supprimer ce lot (${f.quantite} × ${esc(p?.nom || '')}) ?<br><span class="small muted">${f.quantite} unité(s) seront retirées du stock et la dépense supprimée du grand livre.</span>`, { ok: 'Supprimer', danger: true }))) return;
    await run(null, async () => {
      if (p) await DB.update('produits', p.id, { stock: Math.max(0, p.stock - f.quantite) });
      for (const e of A.ecritures.filter((x) => x.ref === f.id)) await DB.remove('ecritures', e.id);
      await DB.remove('fabrications', f.id);
      toast('Fabrication supprimée'); await refreshAfter();
    });
  },
  'stock-adj': (el) => {
    const p = prod(el.dataset.id);
    modal({
      title: ` Inventaire · ${esc(p.nom)}`,
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
      const fabs = A.fabrications.filter((f) => f.produit_id === p.id);
      const fabQ = sum(fabs, 'quantite'), dep = sum(fabs, 'cout_total');
      const cu = fabQ ? dep / fabQ : 0;
      let vQ = 0, vCA = 0;
      A.commandes.filter(isConfirmed).forEach((c) => (c.lignes || []).forEach((l) => { if (l.produit_id === p.id) { vQ += Number(l.quantite); vCA += l.prix * l.quantite; } }));
      const benReal = vCA - vQ * cu;
      const benPot = fabQ * p.prix - dep;
      const marge = p.prix ? ((p.prix - cu) / p.prix) * 100 : 0;
      return { p, fabQ, dep, cu, vQ, vCA, benReal, benPot, marge };
    }).filter((r) => r.fabQ || r.vQ || r.p.actif).sort((a, b) => b.benReal - a.benReal);
    const tDep = sum(rows, 'dep'), tCA = sum(rows, 'vCA'), tBen = sum(rows, 'benReal'), tPot = sum(rows, 'benPot');
    return `
    <div class="page-head"><div><h1>Rentabilité</h1><p class="muted">Ce que chaque produit vous coûte et vous rapporte, selon vos fabrications et vos ventes.</p></div></div>
    <div class="kpis">
      ${kpi('Total dépensé (fabrication)', tDep, 'factory', 'caramel', true, '', 0)}
      ${kpi('Chiffre d\'affaires des ventes', tCA, 'coins', '', true, '', 1)}
      ${kpi('Bénéfice réalisé', tBen, 'piggy-bank', tBen >= 0 ? 'leaf' : 'danger', true, 'Ventes − coût des unités vendues', 2)}
      ${kpi('Bénéfice potentiel', tPot, 'sparkles', 'mango', true, 'Si tout ce qui a été fabriqué est vendu', 3)}
    </div>
    <div class="cards">${rows.map((r, i) => `<div class="prof-card" style="--i:${i}">
      <div class="ph"><div class="thumb">${prodVisual(r.p)}</div><div><h3>${esc(r.p.nom)}</h3><span class="small muted">Prix ${money(r.p.prix)}${r.cu ? ` · coût ${money(r.cu)}/u` : ''}</span></div>
        <div class="margin-ring" style="--p:${Math.max(0, Math.min(100, r.marge))}" title="Marge unitaire"><span>${r.cu ? pct(r.marge) : '—'}</span></div></div>
      <div class="prof-grid">
        <div><small>Fabriqué</small><b>${num(r.fabQ)}</b></div>
        <div><small>Dépensé</small><b>${money(r.dep)}</b></div>
        <div><small>Vendu</small><b>${num(r.vQ)}</b></div>
        <div><small>Ventes</small><b>${money(r.vCA)}</b></div>
        <div class="hl ${r.benReal < 0 ? 'neg' : ''}"><small>Bénéfice réalisé</small><b>${money(r.benReal)}</b></div>
        <div><small>Bénéfice potentiel</small><b>${money(r.benPot)}</b></div>
      </div>
      ${!r.cu ? '<p class="small muted" style="margin-top:10px">Enregistrez une fabrication pour connaître le coût de revient.</p>' : ''}
    </div>`).join('') || `<div class="empty"><span class="big">${ic('trending-up')}</span><h3>Pas encore de données</h3></div>`}</div>`;
  },
};

/* ---------- Grand livre ---------- */
const GL_CATS = { vente: 'Vente', recouvrement: 'Règlement crédit', fabrication: 'Fabrication', annulation: 'Annulation', apport: 'Apport', achat: 'Achat divers', transport: 'Transport', emballage: 'Emballage', autre: 'Autre' };

PAGES.grandlivre = {
  title: 'Grand livre',
  render() {
    const start = dayKey(periodStart(A.f.gl === 'tout' ? 'tout' : A.f.gl));
    const all = A.ecritures.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.created_at).localeCompare(String(b.created_at)));
    // Solde d'ouverture = tout ce qui précède la période
    let solde = sum(all.filter((e) => e.date < start), (e) => (e.type === 'entree' ? 1 : -1) * e.montant);
    const ouverture = solde;
    const q = norm(A.f.q);
    const rows = all.filter((e) => e.date >= start).map((e) => { solde += (e.type === 'entree' ? 1 : -1) * e.montant; return { ...e, solde }; })
      .filter((e) => (A.f.glType === 'tous' || e.type === A.f.glType) && (!q || norm(e.libelle).includes(q)));
    const ent = sum(rows.filter((e) => e.type === 'entree'), 'montant'), sor = sum(rows.filter((e) => e.type === 'sortie'), 'montant');
    A._glRows = rows;
    return `
    <div class="page-head"><div><h1>Grand livre</h1><p class="muted">Toutes les entrées et sorties d'argent, avec le solde au fil du temps.</p></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost" data-act="gl-csv">${ic('download')} Export CSV</button><button class="btn primary" data-act="gl-add">${ic('plus')} Écriture</button></div></div>
    <div class="ledger-sum">
      ${kpi('Entrées', ent, 'arrow-down-left', 'leaf', true, '', 0)}
      ${kpi('Sorties', sor, 'arrow-up-right', 'danger', true, '', 1)}
      ${kpi('Solde de caisse', solde, 'landmark', solde >= 0 ? '' : 'danger', true, `Ouverture : ${money(ouverture)}`, 2)}
    </div>
    <div class="toolbar">
      <div class="seg">${[['7', '7 j'], ['30', '30 j'], ['mois', 'Ce mois'], ['tout', 'Tout']].map(([k, l]) => `<button class="${A.f.gl === k ? 'on' : ''}" data-act="f-gl" data-k="${k}">${l}</button>`).join('')}</div>
      <div class="seg">${[['tous', 'Tous'], ['entree', 'Entrées'], ['sortie', 'Sorties']].map(([k, l]) => `<button class="${A.f.glType === k ? 'on' : ''}" data-act="f-gltype" data-k="${k}">${l}</button>`).join('')}</div>
      <label class="search field" style="margin:0">${ic('search')}<input class="input" placeholder="Libellé…" data-inp="adm-q" value="${esc(A.f.q)}"></label>
    </div>
    ${rows.length ? `<div class="table-wrap"><table class="tbl">
      <thead><tr><th>Date</th><th>Libellé</th><th class="hide-mobile">Catégorie</th><th class="num">Entrée</th><th class="num">Sortie</th><th class="num">Solde</th><th></th></tr></thead>
      <tbody>${rows.slice().reverse().map((e, i) => `<tr style="--i:${Math.min(i, 30)}">
        <td style="white-space:nowrap">${fDate(e.date)}</td><td>${esc(e.libelle)}</td>
        <td class="hide-mobile"><span class="pill">${esc(GL_CATS[e.categorie] || e.categorie || '—')}</span></td>
        <td class="num amt-in">${e.type === 'entree' ? money(e.montant) : ''}</td>
        <td class="num amt-out">${e.type === 'sortie' ? money(e.montant) : ''}</td>
        <td class="num"><b>${money(e.solde)}</b></td>
        <td class="num">${['vente', 'recouvrement', 'fabrication', 'annulation'].includes(e.categorie) ? '' : `<button class="icon-btn flat" data-act="gl-suppr" data-id="${esc(e.id)}" title="Supprimer">${ic('trash-2')}</button>`}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="2">Total période</td><td class="hide-mobile"></td><td class="num amt-in">${money(ent)}</td><td class="num amt-out">${money(sor)}</td><td class="num">${money(solde)}</td><td></td></tr></tfoot>
    </table></div>` : `<div class="card"><div class="empty" style="padding:30px"><span class="big">${ic('book-open')}</span><h3>Aucune écriture</h3><p>Les ventes, règlements et fabrications s'enregistrent automatiquement ici.</p></div></div>`}`;
  },
};

Object.assign(ACT, {
  'f-gl': (el) => { A.f.gl = el.dataset.k; renderPage(false); },
  'f-gltype': (el) => { A.f.glType = el.dataset.k; renderPage(false); },
  'gl-csv': () => {
    downloadCSV(`grand-livre-noecy-${dayKey()}.csv`, [['Date', 'Libellé', 'Catégorie', 'Entrée', 'Sortie', 'Solde'],
      ...(A._glRows || []).map((e) => [e.date, e.libelle, GL_CATS[e.categorie] || e.categorie, e.type === 'entree' ? e.montant : '', e.type === 'sortie' ? e.montant : '', e.solde])]);
  },
  'gl-add': () => {
    modal({
      title: ' Nouvelle écriture',
      body: `<div class="seg" style="margin-bottom:14px" id="gl-t"><button class="on" data-t="sortie" type="button">${ic('arrow-up-right')} Sortie</button><button data-t="entree" type="button">${ic('arrow-down-left')} Entrée</button></div>
        <div class="field"><label>Libellé *</label><input id="gl-l" maxlength="120" placeholder="Ex. Achat de sachets"></div>
        <div class="row"><div class="field"><label>Montant *</label><input id="gl-m" type="number" min="0" step="1"></div>
        <div class="field"><label>Date</label><input id="gl-d" type="date" value="${dayKey()}"></div></div>
        <div class="field"><label>Catégorie</label><select id="gl-c">${['achat', 'emballage', 'transport', 'apport', 'autre'].map((k) => `<option value="${k}">${GL_CATS[k]}</option>`).join('')}</select></div>`,
      foot: `<button class="btn ghost" data-close>Annuler</button><button class="btn primary" id="gl-ok">Enregistrer</button>`,
      onMount: (el, close) => {
        let type = 'sortie';
        $('#gl-t', el).onclick = (e) => { const b = e.target.closest('[data-t]'); if (!b) return; type = b.dataset.t; $$('#gl-t button', el).forEach((x) => x.classList.toggle('on', x === b)); };
        $('#gl-ok', el).onclick = (e) => run(e.currentTarget, async () => {
          const libelle = $('#gl-l', el).value.trim(), montant = Number($('#gl-m', el).value);
          if (!libelle) throw new Error('Libellé obligatoire.');
          if (!(montant > 0)) throw new Error('Montant invalide.');
          await DB.insert('ecritures', { date: $('#gl-d', el).value || dayKey(), libelle, type, categorie: $('#gl-c', el).value, montant, ref: null });
          close(); toast('Écriture enregistrée'); await refreshAfter();
        });
      },
    });
  },
  'gl-suppr': async (el) => {
    if (!(await confirmBox('Supprimer cette écriture ?', { ok: 'Supprimer', danger: true }))) return;
    await run(null, async () => { await DB.remove('ecritures', el.dataset.id); await refreshAfter(); });
  },
});

/* ---------- Relances crédit ---------- */
PAGES.relances = {
  title: 'Relances crédit',
  render() {
    const credits = A.commandes.filter((c) => c.statut === 'credit');
    const parClient = {};
    credits.forEach((c) => {
      const k = c.client_id || c.client_nom;
      const g = parClient[k] || (parClient[k] = { nom: c.client_nom, cl: client(c.client_id), cmds: [], du: 0, plusVieux: c.confirmed_at || c.created_at });
      g.cmds.push(c); g.du += reste(c);
      if ((c.confirmed_at || c.created_at) < g.plusVieux) g.plusVieux = c.confirmed_at || c.created_at;
    });
    const groupes = Object.values(parClient).sort((a, b) => b.du - a.du);
    return `
    <div class="page-head"><div><h1>Relances crédit</h1><p class="muted">Les clients qui ont reçu leurs articles mais n'ont pas encore tout payé.</p></div></div>
    <div class="kpis" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">
      ${kpi('Total à recouvrer', sum(groupes, 'du'), 'hand-coins', 'danger', true, '', 0)}
      ${kpi('Clients concernés', groupes.length, 'users', 'mango', false, '', 1)}
      ${kpi('Commandes à crédit', credits.length, 'receipt', '', false, '', 2)}
    </div>
    ${groupes.length ? `<div class="cards">${groupes.map((g, i) => {
      const j = daysSince(g.plusVieux);
      return `<div class="client-card" style="--i:${i}">
        <div class="ch"><span class="avatar">${esc(initials(g.nom))}</span><div class="nm"><b>${esc(g.nom)}</b><span class="small muted">${g.cl?.telephone ? esc(g.cl.telephone) : 'Pas de téléphone'}</span></div>
          <span class="pill ${j >= 7 ? 'bad' : j >= 3 ? 'warn' : 'info'}">${ic('clock')} ${j} j</span></div>
        <div style="font-size:26px;font-weight:800;color:var(--danger);letter-spacing:-.03em">${money(g.du)}</div>
        <ul class="oc-lines">${g.cmds.map((c) => `<li><span>${esc(c.numero)} · ${fDate(c.confirmed_at || c.created_at)}</span><span>reste ${money(reste(c))}</span></li>`).join('')}</ul>
        <div class="oc-actions">
          ${g.cl?.telephone ? `<a class="btn leaf sm" href="${esc(relanceLink({ ...g.cmds[0], total: g.du + (g.cmds[0].montant_paye || 0), numero: g.cmds.map((c) => c.numero).join(', '), montant_paye: g.cmds[0].montant_paye || 0 }, g.cl))}" target="_blank" rel="noopener">${ic('message-circle')} Relancer sur WhatsApp</a>` : ''}
          <button class="btn soft sm" data-act="rel-copy" data-k="${esc(g.cl?.id || g.nom)}">${ic('copy')} Copier le message</button>
          ${g.cmds.map((c) => `<button class="btn ghost sm" data-act="cmd-encaisser" data-id="${esc(c.id)}">${ic('banknote')} Encaisser ${esc(c.numero)}</button>`).join('')}
        </div></div>`;
    }).join('')}</div>` : `<div class="card"><div class="empty" style="padding:40px"><span class="big">${ic('party-popper')}</span><h3>Aucun crédit en cours</h3><p>Tout le monde est à jour !</p></div></div>`}`;
  },
};
ACT['rel-copy'] = (el) => {
  const k = el.dataset.k;
  const cmds = A.commandes.filter((c) => c.statut === 'credit' && (c.client_id === k || c.client_nom === k));
  const du = sum(cmds, reste);
  const msg = (SETTINGS.message_relance || '').replace(/\{nom\}/g, cmds[0]?.client_nom || '').replace(/\{montant\}/g, money(du)).replace(/\{numero\}/g, cmds.map((c) => c.numero).join(', '));
  const wl = waveLink(du);
  const txt = msg + (wl ? `\n\nPaiement Wave : ${wl}` : '');
  (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => toast('Message copié'), () => toast(txt, 'info', 8000));
};

/* ---------- Paramètres ---------- */
PAGES.parametres = {
  title: 'Paramètres',
  render() {
    const s = SETTINGS;
    return `
    <div class="page-head"><div><h1>Paramètres</h1><p class="muted">Boutique, paiement Wave, catégories et sauvegardes.</p></div></div>
    ${DB.mode === 'local' ? `<div class="note-box" style="margin-bottom:16px">${ic('info')}<div><b>Mode local (démo).</b> Les données sont enregistrées uniquement dans ce navigateur : vos clients ne peuvent pas encore commander depuis leur téléphone. Pour passer en ligne gratuitement, suivez le fichier <b>README.md</b> (Supabase + Netlify), cela prend ~10 minutes.</div></div>`
      : `<div class="note-box ok" style="margin-bottom:16px">${ic('cloud')}<div><b>En ligne.</b> Vos données sont partagées avec la boutique en temps réel (Supabase).</div></div>`}
    <div class="settings-grid">
      <div class="card"><div class="card-head"><h3> Boutique</h3></div>
        <div class="field"><label>Nom de la boutique</label><input id="s-nom" value="${esc(s.nom_boutique)}"></div>
        <div class="field"><label>Slogan (page d'accueil)</label><textarea id="s-slogan" maxlength="200">${esc(s.slogan)}</textarea></div>
        <div class="row"><div class="field"><label>WhatsApp de la boutique</label><input id="s-wa" type="tel" value="${esc(s.whatsapp)}" placeholder="77 123 45 67"></div>
        <div class="field"><label>Devise</label><input id="s-dev" value="${esc(s.devise)}" maxlength="8"></div></div>
        <div class="field"><label>Seuil d'alerte stock par défaut</label><input id="s-seuil" type="number" min="0" value="${esc(s.seuil_defaut)}"></div>
      </div>
      <div class="card"><div class="card-head"><h3> Paiement Wave</h3></div>
        <div class="field"><label>Lien de paiement Wave</label><input id="s-wave" type="url" value="${esc(s.wave_lien)}" placeholder="https://pay.wave.com/m/M_xxxxx/c/sn/">
          <span class="hint">Dans l'app Wave Business : « Encaisser » → « Partager le lien ». Pour pré-remplir le montant, ajoutez <code>{montant}</code> à l'endroit voulu, ex. <code>…/c/sn/?amount={montant}</code>.</span></div>
        ${s.wave_lien ? `<a class="btn wave sm" href="${esc(waveLink(1000))}" target="_blank" rel="noopener">Tester le lien (1 000)</a>` : ''}
        <div class="field" style="margin-top:14px"><label>Message de relance</label><textarea id="s-rel">${esc(s.message_relance)}</textarea><span class="hint">Variables : {nom}, {montant}, {numero}</span></div>
      </div>
      <div class="card"><div class="card-head"><h3> Catégories</h3><button class="btn soft sm" data-act="cat-add">${ic('plus')} Ajouter</button></div>
        <div id="cats">${A.categories.map((c) => `<div class="cat-row" data-id="${esc(c.id)}"><span class="cat-ic" style="--c:${esc(c.couleur || '#6d1b4f')}">${ic(c.icone || 'shopping-bag')}</span><select class="input" data-f="icone">${ICONES.map(([k, l]) => `<option value="${k}" ${k === c.icone ? 'selected' : ''}>${l}</option>`).join('')}</select><input class="input" data-f="nom" value="${esc(c.nom)}"><input type="color" data-f="couleur" value="${esc(c.couleur || '#6d1b4f')}"><button class="icon-btn flat" data-act="cat-suppr" data-id="${esc(c.id)}">${ic('trash-2')}</button></div>`).join('')}</div>
        <p class="hint small muted">Les catégories vides n'apparaissent pas dans la boutique.</p>
      </div>
      <div class="card"><div class="card-head"><h3> Sécurité & sauvegarde</h3></div>
        ${DB.mode === 'local' ? `<div class="row"><div class="field"><label>Ancien code</label><input id="s-pin0" type="password" inputmode="numeric" maxlength="8"></div><div class="field"><label>Nouveau code</label><input id="s-pin1" type="password" inputmode="numeric" maxlength="8"></div></div>
          <button class="btn ghost sm" data-act="pin-change">${ic('lock')} Changer le code</button><hr style="border:0;border-top:1px solid var(--line);margin:18px 0">` : ''}
        <p class="small muted" style="margin-bottom:10px">Téléchargez régulièrement une sauvegarde complète de vos données.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn ghost sm" data-act="backup">${ic('download')} Sauvegarder (JSON)</button>
          ${DB.mode === 'local' ? `<label class="btn ghost sm" style="cursor:pointer">${ic('upload')} Restaurer<input type="file" accept=".json,application/json" id="restore" hidden></label>` : ''}
        </div>
      </div>
    </div>
    <div style="position:sticky;bottom:16px;margin-top:18px;display:flex;justify-content:flex-end"><button class="btn primary lg" data-act="settings-save">${ic('save')} Enregistrer les paramètres</button></div>`;
  },
  after() {
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
  },
};

Object.assign(ACT, {
  'settings-save': (el) => run(el, async () => {
    const s = {
      nom_boutique: $('#s-nom').value.trim() || 'Noecy Market',
      slogan: $('#s-slogan').value.trim(),
      whatsapp: $('#s-wa').value.trim(),
      devise: $('#s-dev').value.trim() || 'FCFA',
      seuil_defaut: Math.max(0, parseInt($('#s-seuil').value, 10) || 0),
      wave_lien: $('#s-wave').value.trim(),
      message_relance: $('#s-rel').value.trim(),
    };
    if (s.wave_lien && !/^https?:\/\//i.test(s.wave_lien)) throw new Error('Le lien Wave doit commencer par https://');
    await DB.saveSettings(s);
    // Catégories modifiées
    for (const row of $$('#cats .cat-row')) {
      const c = A.categories.find((x) => x.id === row.dataset.id);
      const patch = { icone: $('[data-f=icone]', row).value || 'shopping-bag', nom: $('[data-f=nom]', row).value.trim() || 'Catégorie', couleur: $('[data-f=couleur]', row).value };
      if (c && (c.icone !== patch.icone || c.nom !== patch.nom || c.couleur !== patch.couleur)) await DB.update('categories', c.id, patch);
    }
    toast('Paramètres enregistrés');
    await refreshAfter();
  }),
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

/* =====================================================================
   Routeur
   ===================================================================== */
let CURRENT = null;
async function route() {
  $('#modal-root').innerHTML = '';
  document.body.classList.remove('side-open');
  const h = location.hash || '#/';
  if (h.startsWith('#/admin')) {
    const page = h.split('/')[2] || 'dashboard';
    A.page = PAGES[page] ? page : 'dashboard';
    A.f.q = '';
    if (CURRENT === 'admin' && A.ready) { renderPage(); return; }
    stopShop();
    window.onscroll = null;
    CURRENT = 'admin';
    await startAdmin();
  } else {
    if (CURRENT === 'shop') return;
    stopAdmin();
    CURRENT = 'shop';
    await startShop();
  }
}
window.addEventListener('hashchange', route);

(async () => {
  try { await DB.init(); }
  catch (e) {
    $('#app').innerHTML = `<div class="empty" style="padding-top:120px"><span class="big">${ic('triangle-alert')}</span><h3>Impossible de démarrer</h3><p>${esc(e.message)}</p></div>`;
    return;
  }
  route();
})();
