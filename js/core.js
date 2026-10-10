/*
 * Noecy Market — outils communs (boutique + espace gérante)
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
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
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
  mixte: { label: 'Espèces + Wave', icon: 'split', bg: '#f8eaf2', sub: 'Une partie de chaque' },
  credit: { label: 'Payer plus tard', icon: 'handshake', bg: '#fff4dc', sub: 'Crédit, sous réserve d\'accord' },
};
// Comptes de caisse
const COMPTES = {
  especes: { label: 'Espèces', icon: 'banknote' },
  wave: { label: 'Wave', icon: 'waves' },
};
const compteLbl = (k) => COMPTES[k]?.label || 'Espèces';
const STATUT_CMD = {
  en_attente: ['En attente', 'warn pulse'],
  reservee: ['Réservée', 'info'],
  preparation: ['En cuisine', 'info pulse'],
  prete: ['Prête', 'ok pulse'],
  payee: ['Payée', 'ok'],
  credit: ['À crédit', 'bad'],
  annulee: ['Annulée', ''],
};
const pillCmd = (s) => { const [l, c] = STATUT_CMD[s] || [s, '']; return `<span class="pill dot ${c}">${l}</span>`; };

// Notification à l'écran : se ferme seule, au toucher, ou en la faisant glisser
function toast(msg, type = 'ok', ms = 3600) {
  const t = document.createElement('div');
  const name = { err: 'circle-x', warn: 'triangle-alert', info: 'bell-ring' }[type] || 'circle-check';
  t.className = `toast toast-${type}`;
  t.innerHTML = `${ic(name)}<span>${esc(msg)}</span><button class="toast-x" aria-label="Fermer">${ic('x')}</button>`;
  $('#toasts').append(t);
  icons();
  const close = () => {
    if (t.classList.contains('out')) return;
    t.classList.add('out'); setTimeout(() => t.remove(), 380);
  };
  t.addEventListener('click', close);
  let x0 = null;
  t.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  t.addEventListener('touchmove', (e) => {
    if (x0 === null) return;
    const dx = e.touches[0].clientX - x0;
    t.style.transform = `translateX(${dx}px)`; t.style.opacity = String(1 - Math.min(1, Math.abs(dx) / 220));
  }, { passive: true });
  t.addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].clientX - (x0 ?? 0); x0 = null;
    if (Math.abs(dx) > 70) close(); else { t.style.transform = ''; t.style.opacity = ''; }
  });
  setTimeout(close, ms);
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
  downloadFile(name, '\ufeff' + csv, 'text/csv;charset=utf-8');
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

const suivi = (p) => p && p.suivi_stock !== false; // produit dont on compte le stock
const iso = () => new Date().toISOString();

/* =====================================================================
   Notifications push (service worker)
   ===================================================================== */
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

async function swRegistration() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    await navigator.serviceWorker.register('sw.js');
    return await navigator.serviceWorker.ready;
  } catch (e) { console.warn('service worker', e); return null; }
}

function b64ToBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const s = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

// 'on' | 'off' | 'denied' | 'unsupported'
async function pushState() {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg && (await reg.pushManager.getSubscription());
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

async function subscribePush() {
  if (!pushSupported()) {
    throw new Error(isIOS && !isStandalone()
      ? "Sur iPhone : touchez Partager puis « Sur l'écran d'accueil », ouvrez l'app depuis l'écran d'accueil, puis activez les notifications."
      : 'Ce navigateur ne gère pas les notifications. Essayez Chrome.');
  }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications refusées. Autorisez-les dans les réglages du navigateur pour ce site.');
  const reg = await swRegistration();
  if (!reg) throw new Error('Impossible d\'activer les notifications sur cet appareil.');
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(window.NOECY_CONFIG.VAPID_PUBLIC_KEY) });
  }
  return sub;
}

// Notification système affichée par la page elle-même (mode local, onglet en arrière-plan)
async function localNotify(titre, corps, url = '/') {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const reg = await swRegistration();
    if (reg) reg.showNotification(titre, { body: corps, icon: 'icons/icon-192.png', badge: 'icons/badge-96.png', data: { url } });
  } catch (e) { /* ignore */ }
}

if ('serviceWorker' in navigator && location.protocol !== 'file:') swRegistration();

// Adresse de la boutique (même depuis admin.html)
const urlBoutique = () => location.origin + location.pathname.replace(/admin\.html$/, '').replace(/index\.html$/, '');
