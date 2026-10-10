/*
 * Noecy Market — routeur et démarrage
 */
'use strict';

let CURRENT = null;

function setManifest(admin) {
  const l = $('#manifest');
  if (l) l.setAttribute('href', admin ? 'manifest-admin.webmanifest' : 'manifest.webmanifest');
}

async function route() {
  $('#modal-root').innerHTML = '';
  document.body.classList.remove('side-open');
  const h = location.hash || '#/';
  if (h.startsWith('#/admin')) {
    const page = h.split('/')[2] || 'dashboard';
    A.page = PAGES[page] ? page : 'dashboard';
    A.f.q = '';
    setManifest(true);
    if (CURRENT === 'admin' && A.ready) { renderPage(); return; }
    stopShop();
    window.onscroll = null;
    CURRENT = 'admin';
    await startAdmin();
  } else {
    setManifest(false);
    // Un lien de connexion client relance la boutique même si elle est déjà ouverte
    if (CURRENT === 'shop' && !/[?&]c=/.test(h)) return;
    stopAdmin();
    stopShop();
    CURRENT = 'shop';
    await startShop();
  }
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
