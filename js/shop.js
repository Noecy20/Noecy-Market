/*
 * Noecy Market — boutique (côté client)
 */
'use strict';

const LS_CLIENT = 'noecy_client';
const LS_CART = 'noecy_cart';
const CRENEAUX = ['Matin (8h – 12h)', 'Midi (12h – 14h)', 'Après-midi (14h – 18h)', 'Soir (18h – 21h)', 'Peu importe'];
const SHOP = {
  produits: [], client: null, cart: {}, filtre: 'tous', q: '', commandes: [], poll: null, sig: '',
  moyen: 'wave', quand: 'asap', dateResa: '', heureResa: CRENEAUX[0], partWave: null,
};

function loadCart() { try { return JSON.parse(localStorage.getItem(LS_CART)) || {}; } catch (e) { return {}; } }
function saveCart() { try { localStorage.setItem(LS_CART, JSON.stringify(SHOP.cart)); } catch (e) { /* ignore */ } }
function getCreds() { try { return JSON.parse(localStorage.getItem(LS_CLIENT)); } catch (e) { return null; } }
function setCreds(r) { localStorage.setItem(LS_CLIENT, JSON.stringify({ id: r.id, token: r.token })); }
const prodS = (id) => SHOP.produits.find((p) => p.id === id);
const demain = () => { const d = new Date(); d.setDate(d.getDate() + 1); return dayKey(d); };

// Lien de connexion envoyé par la gérante : #/?c=<id>&t=<jeton>
function lireLienConnexion() {
  const m = location.hash.match(/[?&]c=([^&]+)&t=([^&]+)/);
  if (!m) return false;
  setCreds({ id: decodeURIComponent(m[1]), token: decodeURIComponent(m[2]) });
  history.replaceState(null, '', location.pathname + '#/');
  return true;
}

async function startShop() {
  document.body.className = 'shop';
  $('#app').innerHTML = `<div class="products" style="padding-top:90px">${'<div class="skel" style="height:300px"></div>'.repeat(8)}</div>`;
  SHOP.cart = loadCart();
  const viaLien = lireLienConnexion();
  try {
    const [s, cats, prods] = await Promise.all([DB.getSettings(), DB.listCategories(), DB.listProducts()]);
    SETTINGS = s; CATS = cats; SHOP.produits = prods;
  } catch (e) {
    $('#app').innerHTML = `<div class="empty" style="padding-top:120px"><span class="big">${ic('cloud-off')}</span><h3>Boutique momentanément indisponible</h3><p>${esc(e.message)}</p></div>`;
    icons();
    return;
  }
  SHOP.sig = shopSig();
  cleanCart();
  await refreshClient();
  renderShop();
  if (viaLien && SHOP.client) toast(`Bienvenue ${SHOP.client.nom}, vous êtes connecté(e).`);
  if (!SHOP.client) askName();
  SHOP.poll = setInterval(shopPoll, 10000);
}
function stopShop() { clearInterval(SHOP.poll); SHOP.poll = null; }

const shopSig = () => SHOP.produits.map((p) => p.id + ':' + p.stock + ':' + p.prix + ':' + p.suivi_stock).join('|');

function cleanCart() {
  for (const id of Object.keys(SHOP.cart)) {
    if (!prodS(id)) delete SHOP.cart[id];
  }
  saveCart();
}

async function refreshClient() {
  const cr = getCreds();
  if (!cr) { SHOP.client = null; SHOP.commandes = []; return; }
  try {
    SHOP.client = await DB.getClient(cr.id, cr.token);
    if (!SHOP.client) { localStorage.removeItem(LS_CLIENT); SHOP.commandes = []; return; }
    SHOP.client.token = cr.token;
    if (SHOP.client.statut === 'valide') SHOP.commandes = await DB.myOrders(cr.id, cr.token);
  } catch (e) { console.warn(e); }
}

async function shopPoll() {
  if (document.hidden) return;
  const before = SHOP.client?.statut;
  const beforeDu = SHOP.client?.du;
  const beforeOrders = SHOP.commandes.map((c) => c.id + c.statut).join();
  await refreshClient();
  try { SHOP.produits = await DB.listProducts(); } catch (e) { return; }
  const after = SHOP.client?.statut;
  if (before && before !== after) {
    if (after === 'valide') { confetti(); toast('Votre nom est validé ! Vous pouvez commander', 'ok', 5000); }
    if (after === 'refuse') toast("Votre demande n'a pas été validée.", 'warn', 5000);
    renderGrid();
  }
  const afterOrders = SHOP.commandes.map((c) => c.id + c.statut).join();
  if (beforeOrders && beforeOrders !== afterOrders) toast('Le statut de votre commande a changé', 'info');
  if (before !== after || beforeDu !== SHOP.client?.du || beforeOrders !== afterOrders) renderStatus();
  const sig = shopSig();
  if (sig !== SHOP.sig) { SHOP.sig = sig; cleanCart(); renderGrid(false); updateCartUI(false); }
}

function renderShop() {
  const nom = SHOP.client?.nom?.split(' ')[0];
  const cats = CATS.filter((c) => SHOP.produits.some((p) => p.categorie_id === c.id));
  $('#app').innerHTML = `
    <header class="shop-top" id="shop-top">
      <a class="brand" href="#/"><span class="brand-logo">N</span><span class="brand-name">Noecy <b>Market</b></span></a>
      <div class="top-actions">
        <button class="icon-btn" data-act="my-orders" title="Mon compte et mes commandes" aria-label="Mon compte">${ic('user-round')}</button>
        <button class="cart-btn" data-act="open-cart" id="cart-btn">${ic('shopping-bag')}<span class="hide-sm">Panier</span><span class="badge" id="cart-count">0</span></button>
      </div>
    </header>
    <section class="hero">
      <div class="blob b1"></div><div class="blob b2"></div><div class="blob b3"></div>
      <div class="hero-inner">
        <p class="eyebrow">Fait maison · Livré avec le sourire</p>
        <h1>${nom ? `Bonjour <span class="hl">${esc(nom)}</span><br>` : ''}Les délices de <span class="hl">Noecy</span></h1>
        <p class="lead">${esc(SETTINGS.slogan)}</p>
        <div id="client-status" class="status-stack"></div>
      </div>
      <div class="hero-float" aria-hidden="true"><span>${ic('cup-soda')}</span><span>${ic('banana')}</span><span>${ic('candy')}</span><span>${ic('flower-2')}</span></div>
    </section>
    <section class="shop-tools">
      <div class="chips" id="chips">
        <button class="chip ${SHOP.filtre === 'tous' ? 'on' : ''}" data-act="filtre" data-f="tous">Tout</button>
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

async function renderStatus() {
  const el = $('#client-status');
  if (!el) return;
  const c = SHOP.client;
  const cards = [];
  if (!c) {
    cards.push(`<button class="status-card none" data-act="ask-name"><span class="si">${ic('user-round')}</span><span><b>Présentez-vous pour commander</b><small>Nouveau ou déjà client : c'est par ici.</small></span></button>`);
  } else if (c.statut === 'en_attente') {
    cards.push(`<div class="status-card wait"><span class="si">${ic('hourglass')}</span><span><b>Merci ${esc(c.nom)} ! Vérification en cours…</b><small>Vous pourrez commander dès que Noecy aura validé votre nom.</small></span></div>`);
  } else if (c.statut === 'valide') {
    cards.push(`<div class="status-card ok"><span class="si">${ic('badge-check')}</span><span><b>Compte validé</b><small>Ajoutez vos articles au panier et commandez.</small></span></div>`);
  } else {
    cards.push(`<div class="status-card bad"><span class="si">${ic('circle-x')}</span><span><b>Demande non validée</b><small>Contactez Noecy pour plus d'informations.</small></span></div>`);
  }
  if (c && c.du > 0) {
    const wl = waveLink(c.du);
    cards.push(`<div class="status-card debt"><span class="si">${ic('hand-coins')}</span><span><b>Il reste ${money(c.du)} à régler</b><small>Merci de régulariser dès que possible.</small></span>${wl ? `<a class="btn wave sm" href="${esc(wl)}" target="_blank" rel="noopener">Payer avec Wave</a>` : ''}</div>`);
  }
  const actions = [];
  if (c && c.statut !== 'refuse' && DB.pushDisponible()) actions.push(`<button class="status-pill hidden" id="push-pill" data-act="client-push">${ic('bell-ring')} Recevoir les notifications</button>`);
  if (c && c.statut !== 'refuse' && !c.a_code) actions.push(`<button class="status-pill" data-act="client-code">${ic('key-round')} Créer mon code secret</button>`);
  el.innerHTML = cards.join('') + (actions.length ? `<div class="status-actions">${actions.join('')}</div>` : '');
  icons();
  const pill = $('#push-pill');
  if (pill) {
    const s = await pushState();
    if (s === 'off' || (s === 'unsupported' && isIOS)) pill.classList.remove('hidden');
  }
}

function visibleProducts() {
  const q = norm(SHOP.q);
  const dispo = (p) => !suivi(p) || p.stock > 0;
  return SHOP.produits
    .filter((p) => SHOP.filtre === 'tous' || p.categorie_id === SHOP.filtre)
    .filter((p) => !q || norm(p.nom + ' ' + (p.description || '')).includes(q))
    .sort((a, b) => dispo(b) - dispo(a) || a.nom.localeCompare(b.nom));
}

function addControl(p) {
  const q = SHOP.cart[p.id];
  if (q) return `<div class="stepper"><button data-act="cart-dec" data-id="${esc(p.id)}" aria-label="Moins">${ic('minus')}</button><span>${q}</span><button data-act="cart-inc" data-id="${esc(p.id)}" aria-label="Plus">${ic('plus')}</button></div>`;
  if (suivi(p) && p.stock <= 0) return `<button class="btn soft sm" data-act="cart-add" data-id="${esc(p.id)}">${ic('calendar-clock')} Réserver</button>`;
  return `<button class="add-btn" data-act="cart-add" data-id="${esc(p.id)}" aria-label="Ajouter au panier">${ic('plus')}</button>`;
}

function stockTag(p) {
  if (!suivi(p)) return `<span class="pill ok tag dot">Disponible</span>`;
  if (p.stock <= 0) return `<span class="pill warn tag">Sur réservation</span>`;
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
      return `<article class="pcard ${suivi(p) && p.stock <= 0 ? 'soldout' : ''}" style="--i:${animate ? i : 0};${animate ? '' : 'animation:none'}" data-act="view-product" data-id="${esc(p.id)}">
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
  const p = prodS(id);
  $$(`[data-ctl="${CSS.escape(id)}"]`).forEach((el) => { el.innerHTML = addControl(p); });
  icons();
}

const cartCount = () => Object.values(SHOP.cart).reduce((s, q) => s + q, 0);
const cartTotal = () => Object.entries(SHOP.cart).reduce((s, [id, q]) => s + (prodS(id)?.prix || 0) * q, 0);
// Vrai si un article compté est demandé au-delà du stock : il faut alors une date de réservation
const cartNeedsResa = () => Object.entries(SHOP.cart).some(([id, q]) => { const p = prodS(id); return p && suivi(p) && q > p.stock; });

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
  const p = prodS(id);
  if (!p) return;
  q = Math.min(99, q);
  const was = SHOP.cart[id] || 0;
  if (q > was && suivi(p) && q > p.stock && was <= p.stock) {
    toast(p.stock > 0 ? `Plus que ${p.stock} en stock : le reste sera sur réservation.` : 'Article sur réservation : choisissez une date dans le panier.', 'info', 4000);
  }
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
  'client-push': (el) => run(el, async () => {
    const sub = await subscribePush();
    await DB.savePushClient(SHOP.client.id, SHOP.client.token, sub);
    toast('Notifications activées : vous serez prévenu(e) ici, même application fermée.');
    renderStatus();
  }),
  'client-code': () => codeForm(),
  'client-logout': async () => {
    if (!(await confirmBox('Se déconnecter de ce téléphone ? Vous pourrez revenir avec votre numéro et votre code secret.', { ok: 'Se déconnecter' }))) return;
    localStorage.removeItem(LS_CLIENT);
    SHOP.client = null; SHOP.commandes = []; SHOP.cart = {}; saveCart();
    renderShop(); askName();
  },
});
INP['shop-q'] = debounce((el) => { SHOP.q = el.value; renderGrid(); }, 180);

/* ---------- Inscription / connexion (sans mot de passe : téléphone + code) ---------- */
function askName(tab = 'new') {
  if ($('.gate')) return;
  if (getCreds() && SHOP.client) return;
  modal({
    title: '', locked: true,
    body: `<div class="gate">
      <span class="hello">${ic('hand')}</span>
      <h2>Bienvenue chez ${esc(SETTINGS.nom_boutique)}</h2>
      <div class="seg gate-tabs"><button type="button" data-g="new">Je suis nouveau</button><button type="button" data-g="login">J'ai déjà un compte</button></div>
      <form id="gate-new" autocomplete="on">
        <p>Dites-nous qui vous êtes. Noecy valide votre nom avant votre première commande.</p>
        <div class="field"><label for="g-nom">Nom complet *</label><input id="g-nom" name="name" required minlength="2" maxlength="80" placeholder="Ex. Awa Diop" autocomplete="name"></div>
        <div class="field"><label for="g-tel">Téléphone *</label><input id="g-tel" name="tel" type="tel" required maxlength="30" placeholder="Ex. 77 123 45 67" autocomplete="tel"></div>
        <div class="field"><label for="g-code">Code secret * (4 à 6 chiffres)</label><input id="g-code" class="pin-input" type="password" inputmode="numeric" pattern="[0-9]{4,6}" maxlength="6" required placeholder="••••" autocomplete="new-password">
          <span class="hint">Il vous permettra de retrouver votre compte sur un autre téléphone.</span></div>
        <button class="btn primary lg block" type="submit">Continuer ${ic('arrow-right')}</button>
        <p class="small muted" style="margin:12px 0 0">Vous pourrez découvrir les articles pendant la validation.</p>
      </form>
      <form id="gate-login" class="hidden" autocomplete="on">
        <p>Entrez le numéro avec lequel vous vous êtes inscrit(e).</p>
        <div class="field"><label for="l-tel">Téléphone</label><input id="l-tel" type="tel" required maxlength="30" placeholder="Ex. 77 123 45 67" autocomplete="tel"></div>
        <div class="field hidden" id="l-code-f"><label for="l-code">Code secret</label><input id="l-code" class="pin-input" type="password" inputmode="numeric" maxlength="6" placeholder="••••" autocomplete="current-password"></div>
        <button class="btn primary lg block" type="submit">Me connecter ${ic('log-in')}</button>
        <p class="small muted" style="margin:12px 0 0">Code demandé seulement si vous en avez créé un. Code oublié ? ${SETTINGS.whatsapp ? `<a href="${waLink(SETTINGS.whatsapp, 'Bonjour Noecy, pouvez-vous m\'envoyer mon lien de connexion ?')}" target="_blank" rel="noopener" style="color:var(--plum2)">Demandez à Noecy votre lien de connexion</a>` : 'Demandez à Noecy votre lien de connexion.'}</p>
      </form>
    </div>`,
    onMount: (el, close) => {
      const show = (g) => {
        $$('.gate-tabs button', el).forEach((b) => b.classList.toggle('on', b.dataset.g === g));
        $('#gate-new', el).classList.toggle('hidden', g !== 'new');
        $('#gate-login', el).classList.toggle('hidden', g !== 'login');
        setTimeout(() => $(g === 'new' ? '#g-nom' : '#l-tel', el)?.focus(), 50);
      };
      $('.gate-tabs', el).onclick = (e) => { const b = e.target.closest('[data-g]'); if (b) show(b.dataset.g); };
      show(tab);
      const done = async (r, msg) => {
        setCreds(r);
        await refreshClient();
        close();
        renderShop();
        toast(msg);
        // Compte sans code : on propose tout de suite d'en créer un pour protéger le compte
        if (r.sans_code) setTimeout(() => codeForm(true), 500);
      };
      // Changer de numéro masque à nouveau le champ code
      $('#l-tel', el).addEventListener('input', () => { $('#l-code-f', el).classList.add('hidden'); $('#l-code', el).value = ''; });
      $('#gate-new', el).addEventListener('submit', (e) => {
        e.preventDefault();
        run(e.submitter, async () => {
          const nom = $('#g-nom', el).value.trim();
          if (nom.length < 2) throw new Error('Merci d\'indiquer votre nom.');
          const r = await DB.registerClient(nom, $('#g-tel', el).value.trim(), $('#g-code', el).value.trim());
          await done(r, 'Merci ! Votre demande est envoyée à Noecy.');
        });
      });
      $('#gate-login', el).addEventListener('submit', (e) => {
        e.preventDefault();
        run(e.submitter, async () => {
          try {
            const r = await DB.loginClient($('#l-tel', el).value.trim(), $('#l-code', el).value.trim());
            await done(r, 'Content de vous revoir !');
          } catch (err) {
            if (err.codeRequis) {
              const f = $('#l-code-f', el);
              const first = f.classList.contains('hidden');
              f.classList.remove('hidden');
              $('#l-code', el).focus();
              if (first) return; // premier passage : on affiche simplement le champ code
            }
            throw err;
          }
        });
      });
    },
  });
}

function codeForm(apresConnexion = false) {
  const c = SHOP.client;
  if (!c) return;
  modal({
    title: `${ic('key-round')} ${apresConnexion ? 'Protégez votre compte' : 'Mon code secret'}`,
    body: `<p class="muted" style="margin-bottom:14px">${apresConnexion
      ? 'Votre compte n\'a pas encore de code : pour l\'instant, votre numéro suffit pour s\'y connecter. Choisissez un code pour que personne d\'autre ne puisse commander à votre nom.'
      : `Avec votre numéro (${esc(c.telephone || '—')}) et ce code, vous retrouvez votre compte sur n'importe quel téléphone.`}</p>
      <div class="field"><label>Nouveau code (4 à 6 chiffres)</label><input id="cc-1" class="pin-input" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password"></div>
      <div class="field"><label>Confirmer</label><input id="cc-2" class="pin-input" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password"></div>`,
    foot: `<button class="btn ghost" data-close>${apresConnexion ? 'Plus tard' : 'Annuler'}</button><button class="btn primary" id="cc-ok">Enregistrer</button>`,
    onMount: (el, close) => {
      setTimeout(() => $('#cc-1', el).focus(), 300);
      $('#cc-ok', el).onclick = (e) => run(e.currentTarget, async () => {
        const a = $('#cc-1', el).value.trim();
        if (a !== $('#cc-2', el).value.trim()) throw new Error('Les deux codes ne correspondent pas.');
        await DB.setClientCode(c.id, c.token, a);
        c.a_code = true;
        close(); toast('Code secret enregistré'); renderStatus();
      });
    },
  });
}

function viewProduct(id) {
  const p = prodS(id);
  if (!p) return;
  const cat = catOf(p.categorie_id);
  modal({
    title: esc(p.nom),
    body: `<div class="pd-media">${prodVisual(p)}</div>
      <div class="pd-meta">${cat ? `<span class="pill info">${ic(cat.icone || 'shopping-bag', 'sm')} ${esc(cat.nom)}</span>` : ''}${p.unite ? `<span class="pill">${esc(p.unite)}</span>` : ''}${stockTag(p).replace(' tag', '')}</div>
      <p style="color:var(--ink2);white-space:pre-line">${esc(p.description || 'Fait maison par Noecy.')}</p>
      ${suivi(p) && p.stock <= 0 ? `<p class="note-box info small" style="margin-top:12px">${ic('calendar-clock')}<span>Plus en stock pour le moment : réservez-le pour une date, Noecy le prépare pour vous.</span></p>` : ''}`,
    foot: `<span class="price" style="margin-right:auto;font-size:22px">${money(p.prix)}</span><span data-ctl="${esc(p.id)}">${addControl(p)}</span>`,
  });
}

/* ---------- Panier ---------- */
function cartBodyHtml() {
  const lines = Object.entries(SHOP.cart).map(([id, q]) => ({ p: prodS(id), q })).filter((l) => l.p);
  if (!lines.length) {
    return `<div class="empty"><span class="big">${ic('shopping-bag')}</span><h3>Votre panier est vide</h3><p>Ajoutez de bons produits maison !</p><button class="btn primary" style="margin-top:16px" data-close>Découvrir les articles</button></div>`;
  }
  const total = cartTotal();
  const needResa = cartNeedsResa();
  if (needResa) SHOP.quand = 'resa';
  if (SHOP.partWave === null || SHOP.partWave > total) SHOP.partWave = Math.round(total / 2);
  return `${lines.map(({ p, q }, i) => `<div class="cart-line" style="animation-delay:${i * 40}ms">
      <div class="thumb">${prodVisual(p)}</div>
      <div class="info"><b>${esc(p.nom)}</b><span class="small muted">${money(p.prix)}${suivi(p) && q > p.stock ? ` · <span style="color:var(--plum2);font-weight:600">${p.stock > 0 ? `${q - p.stock} sur réservation` : 'sur réservation'}</span>` : ''}</span></div>
      <div class="stepper"><button data-act="cl-dec" data-id="${esc(p.id)}">${ic('minus')}</button><span>${q}</span><button data-act="cl-inc" data-id="${esc(p.id)}">${ic('plus')}</button></div>
      <div class="lt">${money(p.prix * q)}</div>
    </div>`).join('')}

    <h4 class="cart-h">Pour quand ?</h4>
    <div class="seg seg-full">
      <button type="button" class="${SHOP.quand === 'asap' ? 'on' : ''}" data-act="quand" data-k="asap" ${needResa ? 'disabled' : ''}>${ic('zap')} Dès que possible</button>
      <button type="button" class="${SHOP.quand === 'resa' ? 'on' : ''}" data-act="quand" data-k="resa">${ic('calendar-days')} Réserver une date</button>
    </div>
    ${needResa ? `<p class="small" style="color:var(--plum2);margin:8px 0 0">Certains articles ne sont pas en stock : choisissez le jour où vous les voulez.</p>` : ''}
    <div class="row ${SHOP.quand === 'resa' ? '' : 'hidden'}" style="margin-top:12px">
      <div class="field"><label for="c-date">Jour</label><input id="c-date" type="date" min="${dayKey()}" value="${esc(SHOP.dateResa || demain())}" data-inp="c-date"></div>
      <div class="field"><label for="c-heure">Moment</label><select id="c-heure" data-inp="c-heure">${CRENEAUX.map((c) => `<option ${c === SHOP.heureResa ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
    </div>

    <h4 class="cart-h">Moyen de paiement</h4>
    <div class="pay-opts">
      ${Object.entries(PAY).map(([k, v]) => `<label class="pay-opt ${SHOP.moyen === k ? 'on' : ''}" data-act="pay-pick" data-k="${k}">
        <span class="pi" style="background:${v.bg}">${ic(v.icon)}</span>
        <span><b>${v.label}</b><small>${v.sub}</small></span><span class="radio"></span></label>`).join('')}
    </div>
    ${SHOP.moyen === 'mixte' ? `<div class="row mixte-box">
      <div class="field"><label for="c-wave">Part payée par Wave</label><input id="c-wave" type="number" min="0" max="${total}" step="50" value="${SHOP.partWave}" data-inp="c-wave"></div>
      <div class="field"><label>Part en espèces</label><input id="c-esp" class="input" value="${money(total - SHOP.partWave)}" disabled></div>
    </div>` : ''}
    <div class="field"><label for="c-note">Note pour Noecy (facultatif)</label><textarea id="c-note" maxlength="500" placeholder="Lieu de livraison, précisions…"></textarea></div>
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
  const scroll = b.parentElement.scrollTop;
  b.innerHTML = cartBodyHtml();
  if ($('#c-note')) $('#c-note').value = note;
  b.parentElement.scrollTop = scroll;
  const ob = $('#order-btn');
  if (ob) ob.innerHTML = `Commander · ${money(cartTotal())}`;
  if (!cartCount() && ob) ob.parentElement.remove();
  icons();
}

INP['c-date'] = (el) => { SHOP.dateResa = el.value; };
INP['c-heure'] = (el) => { SHOP.heureResa = el.value; };
INP['c-wave'] = (el) => {
  const total = cartTotal();
  SHOP.partWave = Math.max(0, Math.min(total, Math.round(+el.value || 0)));
  const e = $('#c-esp'); if (e) e.value = money(total - SHOP.partWave);
};

Object.assign(ACT, {
  'cl-inc': (el) => { setQty(el.dataset.id, (SHOP.cart[el.dataset.id] || 0) + 1); refreshCart(); },
  'cl-dec': (el) => { setQty(el.dataset.id, (SHOP.cart[el.dataset.id] || 0) - 1); refreshCart(); },
  'pay-pick': (el) => { SHOP.moyen = el.dataset.k; refreshCart(); },
  'quand': (el) => { SHOP.quand = el.dataset.k; if (SHOP.quand === 'resa' && !SHOP.dateResa) SHOP.dateResa = demain(); refreshCart(); },
  'place-order': (el) => {
    if (!canOrder()) return;
    run(el, async () => {
      const lignes = Object.entries(SHOP.cart).map(([produit_id, quantite]) => ({ produit_id, quantite }));
      const note = $('#c-note')?.value || '';
      const total = cartTotal();
      const extra = {};
      if (SHOP.quand === 'resa') {
        extra.date_reservation = $('#c-date')?.value || SHOP.dateResa;
        extra.heure_reservation = $('#c-heure')?.value || SHOP.heureResa;
        if (!extra.date_reservation) throw new Error('Choisissez le jour de votre réservation.');
        if (extra.date_reservation < dayKey()) throw new Error('Cette date est déjà passée.');
      }
      if (SHOP.moyen === 'mixte') extra.repartition = { wave: SHOP.partWave, especes: total - SHOP.partWave };
      const cmd = await DB.placeOrder(SHOP.client.id, SHOP.client.token, lignes, SHOP.moyen, note, extra);
      SHOP.cart = {}; saveCart(); SHOP.partWave = null;
      CART_MODAL?.close();
      renderGrid(false); updateCartUI();
      SHOP.commandes = await DB.myOrders(SHOP.client.id, SHOP.client.token).catch(() => SHOP.commandes);
      setTimeout(() => orderSuccess(cmd), 300);
    });
  },
});

function orderSuccess(cmd) {
  confetti();
  const partWave = cmd.moyen_paiement === 'wave' ? cmd.total : cmd.moyen_paiement === 'mixte' ? (cmd.repartition?.wave || 0) : 0;
  const wl = partWave ? waveLink(partWave) : '';
  modal({
    title: '',
    body: `<div class="success">
      <div class="check-anim"><svg class="tick" viewBox="0 0 52 52"><path d="M14 27 l8 8 l16 -18"/></svg></div>
      <h2>${cmd.date_reservation ? 'Réservation envoyée !' : 'Commande envoyée !'}</h2>
      <p class="muted">N° <b>${esc(cmd.numero)}</b> · ${money(cmd.total)}${cmd.date_reservation ? ` · pour le <b>${fDate(cmd.date_reservation)}</b>` : ''}</p>
      <p style="margin-top:10px">Noecy va confirmer très vite. Suivez le statut dans « Mon compte ».</p>
      ${partWave ? (wl
        ? `<div class="wave-box"><p>Payez maintenant avec Wave (${money(partWave)}). Indiquez <b>${esc(cmd.numero)}</b> en référence si possible.</p>
           <a class="btn wave block lg" href="${esc(wl)}" target="_blank" rel="noopener">${ic('waves')} Payer ${money(partWave)} avec Wave</a></div>`
        : `<div class="wave-box"><p>Noecy vous enverra le lien de paiement Wave.</p></div>`) : ''}
    </div>`,
    foot: `<button class="btn ghost" data-close data-act="my-orders">Mes commandes</button><button class="btn primary" data-close>Continuer mes achats</button>`,
  });
}

/* ---------- Mon compte & mes commandes ---------- */
function openMyOrders() {
  const c = SHOP.client;
  if (!c) {
    modal({ title: `${ic('user-round')} Mon compte`, size: 'drawer', body: `<div class="empty"><span class="big">${ic('user-round')}</span><h3>Présentez-vous d'abord</h3><p>Nouveau client ou déjà inscrit sur un autre téléphone ?</p><button class="btn primary" style="margin-top:14px" data-close data-act="ask-name">Commencer</button></div>` });
    return;
  }
  const compte = `<div class="account-card">
      <span class="avatar">${esc(initials(c.nom))}</span>
      <div style="flex:1;min-width:0"><b>${esc(c.nom)}</b><span class="small muted">${esc(c.telephone || '')}</span></div>
      ${c.statut === 'valide' ? '<span class="pill ok">Validé</span>' : c.statut === 'en_attente' ? '<span class="pill warn">En attente</span>' : '<span class="pill bad">Refusé</span>'}
    </div>
    <div class="account-actions">
      <button class="btn ghost sm" data-close data-act="client-code">${ic('key-round')} ${c.a_code ? 'Changer mon code' : 'Créer mon code'}</button>
      ${DB.pushDisponible() ? `<button class="btn ghost sm" data-act="client-push">${ic('bell-ring')} Notifications</button>` : ''}
      <button class="btn ghost sm" data-close data-act="client-logout">${ic('log-out')} Changer de compte</button>
    </div>`;
  let liste;
  if (!SHOP.commandes.length) liste = `<div class="empty" style="padding:30px 10px"><span class="big">${ic('receipt')}</span><h3>Aucune commande pour l'instant</h3><p>Vos commandes apparaîtront ici.</p></div>`;
  else {
    liste = SHOP.commandes.map((o, i) => {
      const paye = (o.montant_paye || 0) - (o.rendu || 0);
      const reste = Math.max(0, o.total - paye);
      const wl = o.statut !== 'annulee' && reste > 0 && ['wave', 'mixte'].includes(o.moyen_paiement) ? waveLink(reste) : '';
      return `<div class="my-order" style="--i:${i}">
        <div class="top"><b>${esc(o.numero)}</b>${pillCmd(o.statut)}</div>
        <span class="small muted">${fDateTime(o.created_at)} · ${PAY[o.moyen_paiement]?.label || ''}</span>
        ${o.date_reservation ? `<div class="resa-line">${ic('calendar-days', 'sm')} Pour le ${fDate(o.date_reservation)}${o.heure_reservation ? ' · ' + esc(o.heure_reservation) : ''}</div>` : ''}
        <ul>${(o.lignes || []).map((l) => `<li>${l.quantite} × ${esc(l.nom)}</li>`).join('')}</ul>
        <div class="total-row"><span class="muted">Total</span><b>${money(o.total)}</b></div>
        ${paye > 0 && o.statut !== 'payee' ? `<div class="total-row"><span class="muted">Déjà payé</span><b>${money(paye)}</b></div>` : ''}
        ${o.statut === 'credit' ? `<div class="total-row"><span class="muted">Reste à payer</span><b style="color:var(--danger)">${money(reste)}</b></div>` : ''}
        ${wl ? `<a class="btn wave sm block" style="margin-top:8px" href="${esc(wl)}" target="_blank" rel="noopener">${ic('waves')} Payer avec Wave</a>` : ''}
      </div>`;
    }).join('');
  }
  modal({ title: `${ic('user-round')} Mon compte`, size: 'drawer', body: compte + '<h4 class="cart-h">Mes commandes</h4>' + liste });
}
