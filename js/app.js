/*
 * Plateforme — routeur et démarrage
 *   index.html            → vitrine des boutiques
 *   index.html#/creer      → demande de création de boutique
 *   index.html?b=<slug>    → boutique (ou restaurant)
 *   admin.html             → espace de gestion (gérants + administrateur de la plateforme)
 */
'use strict';

let CURRENT = null;
const slugCourant = () => {
  const p = new URLSearchParams(location.search).get('b');
  if (p) return p;
  // Anciens liens de connexion client sans boutique : ils concernaient Noecy Market
  if (/[?&]c=/.test(location.hash)) return 'noecy';
  return null;
};

// Ouvre la fiche d'un client demandée depuis le tableau de bord
function ouvrirFicheEnAttente() {
  const id = A.nextClient; A.nextClient = '';
  if (id && A.ready && client(id)) ACT['cli-detail']({ dataset: { id } });
}

async function route() {
  $('#modal-root').innerHTML = '';
  document.body.classList.remove('side-open');
  const h = location.hash || '#/';
  if (h.startsWith('#/admin')) {
    const page = h.split('/')[2] || 'dashboard';
    A.page = PAGES[page] ? page : 'dashboard';
    A.f.q = A.nextQ || ''; A.nextQ = '';
    if (CURRENT === 'admin' && A.ready) { renderPage(); ouvrirFicheEnAttente(); return; }
    stopShop();
    window.onscroll = null;
    CURRENT = 'admin';
    await startAdmin();
    ouvrirFicheEnAttente();
    return;
  }
  const slug = slugCourant();
  if (!slug) {
    stopAdmin(); stopShop();
    if (CURRENT === 'vitrine' && h.startsWith('#/creer')) { renderCreer(); return; }
    if (CURRENT === 'vitrine') { renderVitrine(); return; }
    CURRENT = 'vitrine';
    await startVitrine();
    return;
  }
  // Boutique : un lien de connexion client relance la boutique même si elle est déjà ouverte
  if (CURRENT === 'shop' && SHOP.slug === slug && !/[?&]c=/.test(h)) { renderShopView(); return; }
  stopAdmin();
  stopShop();
  CURRENT = 'shop';
  await startShop(slug);
}
window.addEventListener('hashchange', route);

(async () => {
  try { await DB.init(); }
  catch (e) {
    $('#app').innerHTML = `<div class="empty" style="padding-top:120px"><span class="big">${ic('triangle-alert')}</span><h3>Impossible de démarrer</h3><p>${esc(e.message)}</p></div>`;
    icons();
    return;
  }
  route();
})();
