/*
 * Plateforme — vitrine (liste des boutiques) et demande de création de boutique
 */
'use strict';

let PLATEFORME = {};
const LS_DERNIERE = 'noecy_derniere_boutique';
const VIT = { q: '', type: 'tous', boutiques: [] };
const lienBoutique = (slug) => `${urlBoutique()}?b=${encodeURIComponent(slug)}`;
const TYPES_BQ = {
  produits: { label: 'Boutique', icon: 'shopping-bag', desc: 'Vente de produits : stock, fabrication, livraison ou retrait.' },
  restaurant: { label: 'Restaurant', icon: 'utensils', desc: 'Menu du jour publié chaque jour, portions limitées, sur place, à emporter ou livraison.' },
};

function logoBoutique(b, cls = '') {
  if (b.logo) return `<span class="bq-logo ${cls}"><img src="${esc(b.logo)}" alt=""></span>`;
  return `<span class="bq-logo ${cls}" style="--c:${esc(b.couleur || '#6d1b4f')}">${esc((b.nom || '?').trim()[0].toUpperCase())}</span>`;
}

async function chargerPlateforme() {
  try { PLATEFORME = await DB.getPlateforme(); } catch (e) { PLATEFORME = { nom: 'Mon Marché', devise: 'FCFA' }; }
  SETTINGS = { ...SETTINGS, devise: PLATEFORME.devise || 'FCFA' };
}

function enteteVitrine() {
  return `<header class="shop-top" id="shop-top">
    <a class="brand" href="${urlBoutique()}"><span class="brand-logo vt-logo">${esc((PLATEFORME.nom || 'M').trim()[0])}</span><span class="brand-name">${esc(PLATEFORME.nom || 'Mon Marché')}</span></a>
    <div class="top-actions">
      <a class="btn ghost sm hide-sm" href="admin.html">${ic('log-in')} Espace gérant</a>
      <a class="btn primary sm" href="#/creer">${ic('store')} Créer ma boutique</a>
    </div>
  </header>`;
}

async function startVitrine() {
  document.body.className = 'shop vitrine';
  document.body.removeAttribute('style');
  $('#app').innerHTML = `<div class="products" style="padding-top:90px">${'<div class="skel" style="height:220px"></div>'.repeat(6)}</div>`;
  await chargerPlateforme();
  try { VIT.boutiques = await DB.listeBoutiques(); }
  catch (e) {
    $('#app').innerHTML = `<div class="empty" style="padding-top:120px"><span class="big">${ic('database')}</span><h3>Plateforme en cours d'installation</h3><p>${esc(e.message)}</p><p class="small muted" style="margin-top:8px">Administrateur : exécutez <code>supabase/migration_v4_plateforme.sql</code>.</p></div>`;
    icons(); return;
  }
  if ((location.hash || '').startsWith('#/creer')) return renderCreer();
  renderVitrine();
}

function renderVitrine() {
  document.title = PLATEFORME.nom || 'Mon Marché';
  let derniere = null;
  try { derniere = JSON.parse(localStorage.getItem(LS_DERNIERE)); } catch (e) { /* ignore */ }
  const der = derniere && VIT.boutiques.find((b) => b.id === derniere.id);
  const nbResto = VIT.boutiques.filter((b) => b.type === 'restaurant').length;
  $('#app').innerHTML = `${enteteVitrine()}
    <section class="hero vt-hero">
      <div class="blob b1"></div><div class="blob b2"></div><div class="blob b3"></div>
      <div class="hero-inner">
        <p class="eyebrow">${VIT.boutiques.length} boutique(s)${nbResto ? ` dont ${nbResto} restaurant(s)` : ''}</p>
        <h1>${esc(PLATEFORME.nom || 'Mon Marché')}</h1>
        <p class="lead">${esc(PLATEFORME.slogan || '')}</p>
        <div class="status-stack">
          ${der ? `<a class="status-card ok" href="${esc(lienBoutique(der.slug))}"><span class="si">${ic('history')}</span><span><b>Continuer chez ${esc(der.nom)}</b><small>Votre dernière visite</small></span></a>` : ''}
          <a class="status-pill" href="#/creer">${ic('store')} Vous vendez ? Ouvrez votre boutique</a>
        </div>
      </div>
      <div class="hero-float" aria-hidden="true"><span>${ic('shopping-bag')}</span><span>${ic('utensils')}</span><span>${ic('cup-soda')}</span><span>${ic('cake')}</span></div>
    </section>
    <section class="shop-tools">
      <div class="chips" id="vt-types">
        ${[['tous', 'Tout', 'sparkles'], ['produits', 'Boutiques', 'shopping-bag'], ['restaurant', 'Restaurants', 'utensils']].map(([k, l, i]) => `<button class="chip ${VIT.type === k ? 'on' : ''}" data-act="vt-type" data-k="${k}">${ic(i)} ${l}</button>`).join('')}
      </div>
      <label class="search field" style="margin:0">${ic('search')}<input class="input" placeholder="Chercher une boutique, une ville…" data-inp="vt-q" value="${esc(VIT.q)}"></label>
    </section>
    <section class="vt-grid" id="vt-grid"></section>
    <footer class="shop-foot">© ${new Date().getFullYear()} ${esc(PLATEFORME.nom || '')} · <a href="#/creer">Créer ma boutique</a> · <a href="admin.html">Espace gérant</a>
      ${PLATEFORME.whatsapp ? ` · <a href="${waLink(PLATEFORME.whatsapp, 'Bonjour')}" target="_blank" rel="noopener">Nous contacter</a>` : ''}</footer>`;
  renderGrilleVitrine();
  icons();
  window.onscroll = () => { const t = $('#shop-top'); if (t) t.classList.toggle('scrolled', scrollY > 10); };
}

function renderGrilleVitrine() {
  const g = $('#vt-grid'); if (!g) return;
  const q = norm(VIT.q);
  const list = VIT.boutiques.filter((b) => VIT.type === 'tous' || b.type === VIT.type)
    .filter((b) => !q || norm(`${b.nom} ${b.ville || ''} ${b.description || ''}`).includes(q));
  g.innerHTML = list.length ? list.map((b, i) => `<a class="vt-card" style="--i:${i};--c:${esc(b.couleur || '#6d1b4f')}" href="${esc(lienBoutique(b.slug))}">
      <div class="vt-band">${logoBoutique(b, 'lg')}<span class="pill ${b.type === 'restaurant' ? 'warn' : 'info'}">${ic(TYPES_BQ[b.type]?.icon || 'store')} ${TYPES_BQ[b.type]?.label || 'Boutique'}</span></div>
      <div class="vt-body"><h3>${esc(b.nom)}</h3>${b.ville ? `<span class="small muted">${ic('map-pin', 'sm')} ${esc(b.ville)}</span>` : ''}<p>${esc(b.description || '')}</p>
        <span class="vt-go">${b.type === 'restaurant' ? 'Voir le menu' : 'Voir la boutique'} ${ic('arrow-right')}</span></div>
    </a>`).join('')
    : `<div class="empty"><span class="big">${ic('store')}</span><h3>Aucune boutique trouvée</h3><p>Essayez une autre recherche.</p></div>`;
  icons();
}

Object.assign(ACT, {
  'vt-type': (el) => { VIT.type = el.dataset.k; $$('#vt-types .chip').forEach((c) => c.classList.toggle('on', c === el)); renderGrilleVitrine(); },
});
INP['vt-q'] = debounce((el) => { VIT.q = el.value; renderGrilleVitrine(); }, 180);

/* ---------- Demande de création de boutique ---------- */
async function renderCreer() {
  document.title = `Créer ma boutique · ${PLATEFORME.nom || ''}`;
  const prix = Number(PLATEFORME.prix_creation) || 0;
  const wl = (PLATEFORME.wave_lien || '').trim();
  const lienWave = wl ? (wl.includes('{montant}') ? wl.replace('{montant}', Math.round(prix)) : wl) : '';
  const connecte = await DB.isLoggedIn().catch(() => false);
  const moi = connecte ? await DB.moi().catch(() => null) : null;
  $('#app').innerHTML = `${enteteVitrine()}
    <main class="creer">
      <div class="creer-head">
        <a href="${urlBoutique()}" class="small" style="color:var(--plum2)">${ic('arrow-left', 'sm')} Toutes les boutiques</a>
        <h1>Ouvrez votre boutique</h1>
        <p class="muted">Vendez vos produits ou publiez le menu de votre restaurant chaque jour. Après vérification de votre paiement, votre boutique est mise en ligne et vous recevez votre espace de gestion.</p>
      </div>
      <form id="cr-form" class="creer-form" autocomplete="on">
        <section class="profil-section">
          <div class="ps-head"><h2><span class="step">1</span> Votre activité</h2></div>
          <div class="type-cards">${Object.entries(TYPES_BQ).map(([k, t], i) => `<label class="type-card ${i === 0 ? 'on' : ''}"><input type="radio" name="cr-type" value="${k}" ${i === 0 ? 'checked' : ''}>
            <span class="tc-ic">${ic(t.icon)}</span><span><b>${t.label === 'Boutique' ? 'Vente de produits' : 'Restaurant'}</b><small>${t.desc}</small></span></label>`).join('')}</div>
          <div class="row"><div class="field"><label>Nom de la boutique *</label><input id="cr-nom" required maxlength="60" placeholder="Ex. Ama Food"></div>
            <div class="field"><label>Ville / quartier</label><input id="cr-ville" maxlength="60" placeholder="Ex. Dakar, Liberté 6"></div></div>
          <div class="field"><label>Présentation</label><textarea id="cr-desc" maxlength="400" placeholder="Ce que vous vendez, vos spécialités, vos horaires…"></textarea></div>
        </section>
        <section class="profil-section">
          <div class="ps-head"><h2><span class="step">2</span> Le responsable</h2></div>
          <div class="row"><div class="field"><label>Votre nom *</label><input id="cr-resp" required maxlength="80" autocomplete="name"></div>
            <div class="field"><label>Téléphone / WhatsApp *</label><input id="cr-tel" type="tel" required maxlength="30" autocomplete="tel" placeholder="77 123 45 67"></div></div>
          ${moi ? `<p class="note-box ok small">${ic('user-check')}<span>Connecté(e) avec <b>${esc(moi.email)}</b> : la boutique sera rattachée à ce compte.</span></p>`
            : `<div class="row"><div class="field"><label>E-mail * (pour vous connecter)</label><input id="cr-email" type="email" required autocomplete="username"></div>
              <div class="field"><label>Mot de passe * (6 caractères min.)</label><input id="cr-pass" type="password" required minlength="6" autocomplete="new-password"></div></div>
              <p class="small muted">Déjà un compte gérant ? Utilisez le même e-mail et le même mot de passe.</p>`}
        </section>
        <section class="profil-section">
          <div class="ps-head"><h2><span class="step">3</span> Frais de création</h2></div>
          <div class="pay-box">
            <div><small>Montant à payer</small><b>${money(prix)}</b></div>
            ${lienWave ? `<a class="btn wave lg" href="${esc(lienWave)}" target="_blank" rel="noopener">${ic('waves')} Payer avec Wave</a>` : `<p class="small muted">Contactez l'administrateur pour le moyen de paiement${PLATEFORME.whatsapp ? ` : <a href="${waLink(PLATEFORME.whatsapp, 'Bonjour, je souhaite créer ma boutique.')}" target="_blank" rel="noopener">WhatsApp</a>` : ''}.</p>`}
          </div>
          <div class="field" style="margin-top:14px"><label>Référence du paiement * </label><input id="cr-ref" required maxlength="80" placeholder="ID de transaction Wave, ou numéro qui a payé">
            <span class="hint">Elle permet à l'administrateur de retrouver votre paiement avant de valider la boutique.</span></div>
        </section>
        <button class="btn primary lg block" type="submit">${ic('send')} Envoyer ma demande</button>
      </form>
    </main>`;
  icons();
  $('#cr-form').addEventListener('change', (e) => {
    if (e.target.name === 'cr-type') $$('.type-card').forEach((c) => c.classList.toggle('on', c.contains(e.target)));
  });
  $('#cr-form').addEventListener('submit', (e) => {
    e.preventDefault();
    run(e.submitter, async () => {
      const d = {
        nom: $('#cr-nom').value.trim(), type: $('input[name=cr-type]:checked').value, ville: $('#cr-ville').value.trim(),
        description: $('#cr-desc').value.trim(), responsable: $('#cr-resp').value.trim(), telephone: $('#cr-tel').value.trim(), paiement_ref: $('#cr-ref').value.trim(),
      };
      if (d.nom.length < 2) throw new Error('Indiquez le nom de la boutique.');
      if (telDigits(d.telephone).length < 8) throw new Error('Indiquez un numéro de téléphone.');
      if (d.paiement_ref.length < 3) throw new Error('Indiquez la référence de votre paiement.');
      if (!moi) {
        const email = $('#cr-email').value.trim(), pass = $('#cr-pass').value;
        // Compte existant : on se connecte ; sinon on le crée
        try { await DB.login(email, pass); } catch (err) { await DB.signUp(email, pass); }
      }
      const r = await DB.demanderBoutique(d);
      confetti();
      $('#app').innerHTML = `${enteteVitrine()}<main class="creer"><div class="success" style="max-width:560px;margin:40px auto">
        <div class="check-anim"><svg class="tick" viewBox="0 0 52 52"><path d="M14 27 l8 8 l16 -18"/></svg></div>
        <h2>Demande envoyée !</h2>
        <p class="muted">« ${esc(d.nom)} » est en attente de validation. L'administrateur vérifie votre paiement (réf. ${esc(d.paiement_ref)}) puis met votre boutique en ligne.</p>
        <div class="note-box info small" style="margin-top:18px;text-align:left">${ic('info')}<span>Votre future adresse : <b>${esc(lienBoutique(r.slug))}</b><br>Votre espace de gestion : <b>${esc(urlBoutique())}admin.html</b> (avec votre e-mail et votre mot de passe).</span></div>
        <div class="btn-row" style="justify-content:center;margin-top:18px"><a class="btn primary" href="admin.html">${ic('log-in')} Mon espace de gestion</a><a class="btn ghost" href="${urlBoutique()}">Retour aux boutiques</a></div>
      </div></main>`;
      icons();
    });
  });
}
