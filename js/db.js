/*
 * Couche de données de la plateforme (plusieurs boutiques).
 * Deux implémentations avec la même interface :
 *   - LocalDB    : localStorage (démo, un seul navigateur)
 *   - SupabaseDB : base partagée en ligne (production)
 *
 * La boutique courante est fixée par DB.setBoutique(id) : toutes les lectures
 * et écritures de la boutique (produits, commandes, caisse…) s'y rapportent.
 */
(function () {
  'use strict';

  const cfg = window.NOECY_CONFIG || {};
  const TABLES = ['categories', 'produits', 'clients', 'commandes', 'fabrications', 'ecritures', 'matieres', 'achats', 'vendeurs', 'menus', 'menu_items'];

  const uid = () =>
    (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  const now = () => new Date().toISOString();
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const digits = (t) => String(t || '').replace(/\D/g, '');
  const tel9 = (t) => digits(t).slice(-9);
  const today = () => {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };
  const addDays = (k, n) => { const d = new Date(k + 'T00:00:00'); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

  const DEFAULT_SETTINGS = {
    nom_boutique: 'Ma boutique',
    slogan: 'Bienvenue !',
    wave_lien: '',
    whatsapp: '',
    devise: 'FCFA',
    seuil_defaut: 5,
    message_relance: 'Bonjour {nom}, petit rappel : il reste {montant} à régler pour votre commande {numero}. Merci beaucoup !',
  };
  const DEFAULT_PLATEFORME = {
    nom: 'Mon Marché',
    slogan: 'Les boutiques et restaurants de chez nous, en un seul endroit.',
    prix_creation: 10000,
    wave_lien: '',
    whatsapp: '',
    devise: 'FCFA',
  };

  const SEED_CATEGORIES = [
    { id: 'cat-jus', nom: 'Jus', icone: 'cup-soda', couleur: '#b0185f', ordre: 1 },
    { id: 'cat-chips', nom: 'Chips', icone: 'banana', couleur: '#e39b06', ordre: 2 },
    { id: 'cat-sucre', nom: 'Sucrée', icone: 'candy', couleur: '#b5652a', ordre: 3 },
  ];
  const SEED_PRODUITS = [
    { id: 'p-bissap', nom: 'Jus de Bissap', categorie_id: 'cat-jus', prix: 500, unite: 'Bouteille 50 cl', description: "Jus de fleurs d'hibiscus fait maison, légèrement sucré et parfumé à la menthe." },
    { id: 'p-tomi', nom: 'Jus de Tomi', categorie_id: 'cat-jus', prix: 500, unite: 'Bouteille 50 cl', description: 'Jus de tamarin (tomi) maison, acidulé et rafraîchissant.' },
    { id: 'p-chips-mure', nom: 'Chips banane mûre', categorie_id: 'cat-chips', prix: 500, unite: 'Sachet', description: 'Chips de banane mûre, naturellement sucrées et croustillantes.' },
    { id: 'p-chips-verte', nom: 'Chips banane non mûre', categorie_id: 'cat-chips', prix: 500, unite: 'Sachet', description: 'Chips de banane verte, salées et ultra croustillantes.' },
    { id: 'p-caramel', nom: 'Caramel', categorie_id: 'cat-sucre', prix: 250, unite: 'Sachet', suivi_stock: false, description: 'Caramels fondants.' },
  ].map((p) => ({ suivi_stock: true, photo: '', stock: 0, seuil_alerte: 5, actif: true, created_at: now(), ...p }));

  const MOYENS = ['wave', 'especes', 'mixte', 'credit'];
  const MODES = ['sur_place', 'emporter', 'livraison'];

  // Champs d'une boutique visibles par tous
  const publicBoutique = (b) => b && ({ id: b.id, slug: b.slug, nom: b.nom, type: b.type, ville: b.ville, description: b.description, logo: b.logo, couleur: b.couleur, statut: b.statut });
  const slugify = (s) => String(s || 'boutique').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'boutique';

  /* ------------------------------------------------------------------ */
  /* Mode LOCAL (démo)                                                   */
  /* ------------------------------------------------------------------ */
  const KEY = 'noecy_db_v1';
  const LS_USER = 'noecy_compte';

  async function sha256(txt) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('noecy::' + txt));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  // Compte administrateur de la plateforme en mode local : identifiant « admin », mot de passe 2012
  const DEFAULT_PIN = '2012';

  const LocalDB = {
    mode: 'local',
    boutique: null,
    _db: null,

    setBoutique(id) { this.boutique = id; },

    db() {
      if (!this._db) {
        try { this._db = JSON.parse(localStorage.getItem(KEY)); } catch (e) { this._db = null; }
        if (!this._db) {
          this._db = {
            categories: clone(SEED_CATEGORIES), produits: clone(SEED_PRODUITS),
            clients: [], commandes: [], fabrications: [], ecritures: [], matieres: [], achats: [], vendeurs: [],
            parametres: { nom_boutique: 'Noecy Market', slogan: 'Jus frais, chips croustillantes et douceurs maison, préparés avec amour.' },
            compteur: 0, admin_pin: null,
          };
        }
        const d = this._db;
        // Migrations des anciennes versions
        const ico = { 'cat-jus': 'cup-soda', 'cat-chips': 'banana', 'cat-sucre': 'candy' };
        (d.categories || []).forEach((c) => { if (!c.icone) c.icone = ico[c.id] || 'shopping-bag'; delete c.emoji; });
        TABLES.forEach((t) => { if (!Array.isArray(d[t])) d[t] = []; });
        d.produits.forEach((p) => { if (p.suivi_stock === undefined) p.suivi_stock = true; });
        d.ecritures.forEach((e) => { if (!e.compte) e.compte = 'especes'; });
        // v4 : plateforme multi-boutiques — les données existantes deviennent la boutique « noecy »
        if (!Array.isArray(d.boutiques)) {
          d.boutiques = [{ id: 'noecy', slug: 'noecy', nom: (d.parametres || {}).nom_boutique || 'Noecy Market', type: 'produits', statut: 'active',
            prefixe: 'CMD', compteur: d.compteur || 0, paiement_valide: true, couleur: '#6d1b4f', description: (d.parametres || {}).slogan || '', created_at: now(), validee_at: now() }];
          d.parametres_bq = { noecy: { ...(d.parametres || {}) } };
          TABLES.forEach((t) => d[t].forEach((r) => { if (!r.boutique_id) r.boutique_id = 'noecy'; }));
          d.membres = []; d.plateforme = {};
          d.comptes = [{ id: 'super', email: 'admin', pass: null, super: true, created_at: now() }];
        }
        if (!d.parametres_bq) d.parametres_bq = {};
        if (!d.plateforme) d.plateforme = {};
        if (!Array.isArray(d.membres)) d.membres = [];
        if (!Array.isArray(d.comptes)) d.comptes = [{ id: 'super', email: 'admin', pass: null, super: true }];
        this._save();
      }
      return this._db;
    },
    _save() {
      try { localStorage.setItem(KEY, JSON.stringify(this._db)); }
      catch (e) { throw new Error('Stockage du navigateur plein : utilisez des photos plus légères.'); }
    },
    _bq(id = this.boutique) { return this.db().boutiques.find((b) => b.id === id); },
    _numero(bid) {
      const b = this._bq(bid);
      b.compteur = (b.compteur || 0) + 1;
      return `${b.prefixe || 'CMD'}-${String(b.compteur).padStart(4, '0')}`;
    },
    _moi() { const id = sessionStorage.getItem(LS_USER); return this.db().comptes.find((c) => c.id === id) || null; },
    _peutGerer(bid) {
      const u = this._moi(); if (!u) return false;
      if (u.super) return true;
      const b = this._bq(bid);
      return !!b && b.statut === 'active' && this.db().membres.some((m) => m.user_id === u.id && m.boutique_id === bid);
    },
    _exiger(bid = this.boutique) { if (!this._peutGerer(bid)) throw new Error('Accès refusé.'); },

    async init() { this.db(); },

    // --- Plateforme et vitrine ---
    async getPlateforme() { return { ...DEFAULT_PLATEFORME, ...this.db().plateforme }; },
    async savePlateforme(s) { const u = this._moi(); if (!u?.super) throw new Error('Accès refusé.'); Object.assign(this.db().plateforme, s); this._save(); },
    async listeBoutiques() { return clone(this.db().boutiques.filter((b) => b.statut === 'active').map(publicBoutique)); },
    async boutiquePublique(slug) {
      const b = this.db().boutiques.find((x) => x.slug.toLowerCase() === String(slug).toLowerCase() || x.id === slug);
      return b ? clone(publicBoutique(b)) : null;
    },

    // --- Boutique courante (lecture publique) ---
    _actif() { const b = this._bq(); return b && b.statut === 'active'; },
    async getSettings() { return { ...DEFAULT_SETTINGS, ...(this.db().parametres_bq[this.boutique] || {}) }; },
    async listCategories() { return clone(this.db().categories.filter((c) => c.boutique_id === this.boutique)).sort((a, b) => (a.ordre || 0) - (b.ordre || 0)); },
    async listProducts() { return clone(this.db().produits.filter((p) => p.actif && p.boutique_id === this.boutique)); },
    _menuJson(m) {
      const db = this.db();
      return {
        id: m.id, date: m.date, note: m.note, publie_at: m.publie_at,
        items: db.menu_items.filter((i) => i.menu_id === m.id && i.visible && db.produits.some((p) => p.id === i.produit_id && p.actif))
          .sort((a, b) => (a.ordre || 0) - (b.ordre || 0))
          .map((i) => ({ id: i.id, produit_id: i.produit_id, quantite: i.quantite, restant: i.quantite === null || i.quantite === undefined ? null : Math.max(0, i.quantite - (i.reserve || 0)) })),
      };
    },
    async menuPublie(bid, date = today()) {
      const m = this.db().menus.find((x) => x.boutique_id === bid && x.date === date && x.publie);
      return m && this._bq(bid)?.statut === 'active' ? clone(this._menuJson(m)) : null;
    },
    async menusAVenir(bid) {
      const t = today(), fin = addDays(t, 7);
      return clone(this.db().menus.filter((m) => m.boutique_id === bid && m.publie && m.date >= t && m.date < fin)
        .sort((a, b) => a.date.localeCompare(b.date)).map((m) => this._menuJson(m)));
    },

    // --- Clients (sans mot de passe : numéro de téléphone) ---
    _findTel(telephone) {
      const t = tel9(telephone);
      return this.db().clients.filter((c) => c.boutique_id === this.boutique && c.statut !== 'refuse' && tel9(c.telephone) === t)
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
    },
    async registerClient(nom, telephone) {
      if (!this._actif()) throw new Error('Cette boutique n\'est pas disponible.');
      nom = (nom || '').trim();
      if (nom.length < 2) throw new Error('Le nom est obligatoire.');
      if (digits(telephone).length < 8) throw new Error('Le numéro de téléphone est obligatoire.');
      if (this._findTel(telephone)) throw new Error('Ce numéro a déjà un compte. Utilisez « J\'ai déjà un compte ».');
      const c = { id: uid(), token: uid(), boutique_id: this.boutique, nom, telephone: String(telephone).trim(), statut: 'en_attente', note: '', created_at: now() };
      this.db().clients.push(c); this._save();
      return { id: c.id, token: c.token };
    },
    async loginClient(telephone) {
      if (digits(telephone).length < 8) throw new Error('Numéro de téléphone invalide.');
      const c = this._findTel(telephone);
      if (!c) throw new Error('Aucun compte avec ce numéro dans cette boutique. Inscrivez-vous avec « Je suis nouveau ».');
      return { id: c.id, token: c.token };
    },
    async getClient(id, token) {
      const db = this.db();
      const c = db.clients.find((x) => x.id === id && x.token === token);
      if (!c) return null;
      const du = db.commandes.filter((o) => o.client_id === c.id && o.statut === 'credit')
        .reduce((s, o) => s + Math.max(0, o.total - ((o.montant_paye || 0) - (o.rendu || 0))), 0);
      return { id: c.id, nom: c.nom, telephone: c.telephone, statut: c.statut, du };
    },
    async placeOrder(id, token, lignes, moyen, note, extra = {}) {
      const db = this.db();
      const c = db.clients.find((x) => x.id === id && x.token === token);
      if (!c) throw new Error('Client inconnu.');
      if (c.statut !== 'valide') throw new Error('Votre nom doit être validé avant de commander.');
      const b = this._bq(c.boutique_id);
      if (!b || b.statut !== 'active') throw new Error('Cette boutique n\'est pas disponible.');
      if (!MOYENS.includes(moyen)) throw new Error('Moyen de paiement invalide.');
      const mode = extra.mode_retrait || null;
      if (mode && !MODES.includes(mode)) throw new Error('Mode de retrait invalide.');
      if (mode === 'livraison' && (extra.adresse || '').trim().length < 3) throw new Error('Indiquez l\'adresse de livraison.');
      const dateResa = extra.date_reservation || null;
      if (dateResa && dateResa < today()) throw new Error('La date choisie est déjà passée.');
      const out = []; let total = 0; let menuDate = null;
      if (b.type === 'restaurant') {
        menuDate = dateResa || today();
        const m = db.menus.find((x) => x.boutique_id === b.id && x.date === menuDate && x.publie);
        if (!m) throw new Error('Le menu de ce jour n\'est pas encore publié.');
        const reserver = [];
        for (const l of lignes) {
          const q = parseInt(l.quantite, 10);
          if (!q || q <= 0) continue;
          const mi = db.menu_items.find((i) => i.menu_id === m.id && i.produit_id === l.produit_id && i.visible);
          const p = mi && db.produits.find((x) => x.id === mi.produit_id && x.actif);
          if (!p) throw new Error('Un plat n\'est plus disponible.');
          if (mi.quantite !== null && mi.quantite !== undefined && mi.quantite - (mi.reserve || 0) < q) throw new Error(`Plus que ${Math.max(0, mi.quantite - (mi.reserve || 0))} portion(s) de ${p.nom}.`);
          reserver.push([mi, q]);
          out.push({ produit_id: p.id, nom: p.nom, prix: p.prix, quantite: q });
          total += p.prix * q;
        }
        reserver.forEach(([mi, q]) => { mi.reserve = (mi.reserve || 0) + q; });
      } else {
        for (const l of lignes) {
          const q = parseInt(l.quantite, 10);
          if (!q || q <= 0) continue;
          const p = db.produits.find((x) => x.id === l.produit_id && x.boutique_id === b.id && x.actif);
          if (!p) throw new Error('Un produit du panier n\'est plus disponible.');
          if (p.suivi_stock && !dateResa && p.stock < q) throw new Error(`Stock insuffisant pour ${p.nom} (${p.stock} disponible(s)). Choisissez une date de réservation.`);
          out.push({ produit_id: p.id, nom: p.nom, prix: p.prix, quantite: q });
          total += p.prix * q;
        }
      }
      if (!out.length) throw new Error('Votre panier est vide.');
      const cmd = {
        id: uid(), boutique_id: b.id, numero: this._numero(b.id), client_id: c.id, client_nom: c.nom, lignes: out, total,
        moyen_paiement: moyen, statut: 'en_attente', montant_paye: 0, rendu: 0, cout_revient: 0, paiements: [],
        note: (note || '').slice(0, 500), date_reservation: menuDate || dateResa, heure_reservation: extra.heure_reservation || null,
        repartition: extra.repartition || null, mode_retrait: mode, adresse: (extra.adresse || '').trim() || null, menu_date: menuDate,
        created_at: now(), confirmed_at: null, paid_at: null, livree_at: null,
      };
      db.commandes.push(cmd); this._save();
      return clone(cmd);
    },
    async myOrders(id, token) {
      const db = this.db();
      if (!db.clients.find((x) => x.id === id && x.token === token)) return [];
      return clone(db.commandes.filter((c) => c.client_id === id)).sort((a, b) => b.created_at.localeCompare(a.created_at));
    },

    // --- Comptes (gérants de boutique et administrateur de la plateforme) ---
    async signUp(email, password) {
      const db = this.db();
      email = String(email || '').trim().toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Adresse e-mail invalide.');
      if (String(password || '').length < 6) throw new Error('Le mot de passe doit contenir au moins 6 caractères.');
      if (db.comptes.some((c) => c.email === email)) throw new Error('Un compte existe déjà avec cet e-mail : connectez-vous.');
      const c = { id: uid(), email, pass: await sha256(password), super: false, created_at: now() };
      db.comptes.push(c); this._save();
      sessionStorage.setItem(LS_USER, c.id);
    },
    async login(email, password) {
      const db = this.db();
      email = String(email || '').trim().toLowerCase();
      const c = db.comptes.find((x) => x.email === email);
      const attendu = c && (c.pass || (c.super ? (db.admin_pin || await sha256(DEFAULT_PIN)) : null));
      if (!c || (await sha256(password)) !== attendu) throw new Error('E-mail ou mot de passe incorrect.');
      sessionStorage.setItem(LS_USER, c.id);
    },
    async isLoggedIn() { return !!this._moi(); },
    async logout() { sessionStorage.removeItem(LS_USER); },
    async moi() { const u = this._moi(); return u ? { id: u.id, email: u.email } : null; },
    async changePin(oldPin, newPin) {
      const u = this._moi(); if (!u) throw new Error('Connectez-vous.');
      const attendu = u.pass || (u.super ? (this.db().admin_pin || await sha256(DEFAULT_PIN)) : null);
      if ((await sha256(oldPin)) !== attendu) throw new Error('Ancien mot de passe incorrect.');
      const h = await sha256(newPin);
      if (u.super && !u.pass) this.db().admin_pin = h; else u.pass = h;
      this._save();
    },
    async mesBoutiques() {
      const db = this.db(), u = this._moi();
      if (!u) return { super: false, boutiques: [] };
      const liste = db.boutiques.filter((b) => u.super || b.proprietaire_id === u.id || db.membres.some((m) => m.user_id === u.id && m.boutique_id === b.id));
      return clone({ super: !!u.super, boutiques: liste.map((b) => ({ ...publicBoutique(b), paiement_valide: b.paiement_valide, motif_refus: b.motif_refus, created_at: b.created_at })) });
    },
    async demanderBoutique(d) {
      const db = this.db(), u = this._moi();
      if (!u) throw new Error('Connectez-vous d\'abord.');
      if ((d.nom || '').trim().length < 2) throw new Error('Le nom de la boutique est obligatoire.');
      if (!['produits', 'restaurant'].includes(d.type)) throw new Error('Type de boutique invalide.');
      if (digits(d.telephone).length < 8) throw new Error('Le téléphone est obligatoire.');
      if ((d.paiement_ref || '').trim().length < 3) throw new Error('Indiquez la référence de votre paiement Wave.');
      let s = slugify(d.nom), base = s, i = 1;
      while (db.boutiques.some((b) => b.slug === s)) { i++; s = `${base}-${i}`; }
      const p = await this.getPlateforme();
      const b = {
        id: uid(), slug: s, nom: d.nom.trim().slice(0, 60), type: d.type, statut: 'en_attente', proprietaire_id: u.id, email: u.email,
        responsable: (d.responsable || '').trim(), telephone: d.telephone.trim(), ville: (d.ville || '').trim(), description: (d.description || '').trim(),
        logo: null, couleur: d.type === 'restaurant' ? '#c26a26' : '#6d1b4f',
        prefixe: (slugify(d.nom).replace(/[^a-z]/g, '') + 'xxx').slice(0, 3).toUpperCase(), compteur: 0,
        paiement_montant: Number(p.prix_creation) || 0, paiement_ref: d.paiement_ref.trim(), paiement_valide: false, created_at: now(),
      };
      db.boutiques.push(b);
      db.membres.push({ user_id: u.id, boutique_id: b.id, role: 'proprietaire', email: u.email, created_at: now() });
      this._save();
      return { id: b.id, slug: b.slug, statut: b.statut };
    },

    // --- Administrateur de la plateforme ---
    _super() { if (!this._moi()?.super) throw new Error('Accès refusé.'); },
    async toutesBoutiques() { this._super(); return clone(this.db().boutiques); },
    async majBoutique(id, patch) {
      const b = this._bq(id);
      if (!b) throw new Error('Boutique introuvable.');
      const proteges = ['statut', 'paiement_valide', 'paiement_montant', 'slug', 'type', 'proprietaire_id', 'prefixe'];
      if (!this._moi()?.super) {
        this._exiger(id);
        if (proteges.some((k) => k in patch && patch[k] !== b[k])) throw new Error('Modification réservée à l\'administrateur de la plateforme.');
      }
      Object.assign(b, patch); this._save(); return clone(b);
    },
    async validerBoutique(id) {
      this._super();
      const db = this.db(), b = this._bq(id);
      if (!b) throw new Error('Boutique introuvable.');
      if (!b.paiement_valide) throw new Error('Confirmez d\'abord que le paiement a été reçu.');
      b.statut = 'active'; b.validee_at = b.validee_at || now(); b.motif_refus = null;
      db.parametres_bq[b.id] = { nom_boutique: b.nom, slogan: b.description || `Bienvenue chez ${b.nom}`, whatsapp: b.telephone || '', devise: 'FCFA', seuil_defaut: 5, wave_lien: '',
        message_relance: `Bonjour {nom}, petit rappel de ${b.nom} : il reste {montant} à régler pour votre commande {numero}. Merci !`, ...(db.parametres_bq[b.id] || {}) };
      if (!db.categories.some((c) => c.boutique_id === b.id)) {
        const cats = b.type === 'restaurant'
          ? [['Plats', 'soup', '#c26a26'], ['Boissons', 'cup-soda', '#1c9a69'], ['Desserts', 'cake', '#a02a6e']]
          : [['Produits', 'shopping-bag', b.couleur || '#6d1b4f']];
        cats.forEach(([nom, icone, couleur], i) => db.categories.push({ id: uid(), boutique_id: b.id, nom, icone, couleur, ordre: i + 1, created_at: now() }));
      }
      this._save();
    },
    async statsPlateforme() {
      this._super();
      const db = this.db(), depuis = new Date(Date.now() - 30 * 864e5).toISOString();
      return db.boutiques.map((b) => {
        const cmds = db.commandes.filter((c) => c.boutique_id === b.id && c.created_at > depuis);
        return {
          id: b.id, commandes: cmds.filter((c) => c.statut !== 'annulee').length,
          ca: cmds.filter((c) => c.statut === 'payee' || c.statut === 'credit').reduce((s, c) => s + Number(c.total), 0),
          clients: db.clients.filter((c) => c.boutique_id === b.id).length,
          produits: db.produits.filter((p) => p.boutique_id === b.id && p.actif).length,
        };
      });
    },

    // --- Gestion de la boutique courante ---
    async all(t) {
      this._exiger();
      const rows = clone(this.db()[t].filter((r) => r.boutique_id === this.boutique));
      if (t === 'clients') rows.forEach((c) => { delete c.code_hash; });
      return rows;
    },
    async insert(t, row) {
      this._exiger();
      const r = { id: uid(), created_at: now(), ...row, boutique_id: this.boutique };
      this.db()[t].push(r); this._save(); return clone(r);
    },
    async update(t, id, patch) {
      const r = this.db()[t].find((x) => x.id === id);
      if (!r) throw new Error('Élément introuvable.');
      this._exiger(r.boutique_id);
      Object.assign(r, patch); this._save(); return clone(r);
    },
    async remove(t, id) {
      const r = this.db()[t].find((x) => x.id === id);
      if (r) this._exiger(r.boutique_id);
      this.db()[t] = this.db()[t].filter((x) => x.id !== id);
      if (t === 'menus') this.db().menu_items = this.db().menu_items.filter((i) => i.menu_id !== id);
      this._save();
    },
    async saveSettings(s) {
      this._exiger();
      const db = this.db();
      db.parametres_bq[this.boutique] = { ...(db.parametres_bq[this.boutique] || {}), ...s };
      this._save();
    },
    async nextNumero() { this._exiger(); const n = this._numero(this.boutique); this._save(); return n; },
    async boutiqueCourante() { return clone(this._bq()); },

    // --- Points de vente (vendeurs) ---
    _vendeur(id, token) {
      const v = this.db().vendeurs.find((x) => x.id === id && x.token === token);
      if (!v) throw new Error('Session expirée : reconnectez-vous.');
      if (!v.actif) throw new Error('Votre accès vendeur a été désactivé.');
      return v;
    },
    _coutMoyen(pid) {
      const f = this.db().fabrications.filter((x) => x.produit_id === pid);
      const q = f.reduce((s, x) => s + Number(x.quantite), 0);
      return q ? f.reduce((s, x) => s + Number(x.cout_total), 0) / q : 0;
    },
    async vendeurLogin(telephone, code) {
      const t = tel9(telephone);
      if (t.length < 8) throw new Error('Numéro de téléphone invalide.');
      const v = this.db().vendeurs.filter((x) => tel9(x.telephone) === t).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
      if (!v) throw new Error('Aucun vendeur avec ce numéro.');
      if (!v.actif) throw new Error('Votre accès a été désactivé.');
      if (v.bloque_jusqua && new Date(v.bloque_jusqua) > new Date()) throw new Error('Trop d\'essais. Réessayez dans quelques minutes.');
      if (!v.code_hash) throw new Error('Aucun code défini : demandez votre code à la boutique.');
      if ((await sha256(code)) !== v.code_hash) {
        v.essais = (v.essais || 0) + 1;
        if (v.essais >= 5) { v.bloque_jusqua = new Date(Date.now() + 15 * 60000).toISOString(); v.essais = 0; }
        this._save();
        throw new Error('Code incorrect.');
      }
      v.essais = 0; v.bloque_jusqua = null; this._save();
      return { id: v.id, token: v.token, nom: v.nom };
    },
    async vendeurData(id, token) {
      const db = this.db(), v = this._vendeur(id, token);
      const voir = !!(v.droits || {}).voir_stock;
      const p = { ...DEFAULT_SETTINGS, ...(db.parametres_bq[v.boutique_id] || {}) };
      return clone({
        vendeur: { id: v.id, nom: v.nom, telephone: v.telephone, droits: v.droits || {} },
        parametres: { nom_boutique: p.nom_boutique, devise: p.devise, wave_lien: p.wave_lien },
        categories: db.categories.filter((c) => c.boutique_id === v.boutique_id),
        produits: db.produits.filter((x) => x.actif && x.boutique_id === v.boutique_id).map((x) => ({
          id: x.id, nom: x.nom, prix: x.prix, photo: x.photo, unite: x.unite, categorie_id: x.categorie_id, suivi_stock: x.suivi_stock !== false,
          stock: voir ? x.stock : null, dispo: x.suivi_stock !== false ? Math.max(0, x.stock) : null,
        })),
        ventes: db.commandes.filter((c) => c.vendeur_id === v.id).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))),
        ecritures: db.ecritures.filter((e) => e.vendeur_id === v.id).sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.created_at).localeCompare(String(a.created_at))),
      });
    },
    async vendeurVente(id, token, { lignes, client_nom, client_tel, paiements, note }) {
      const db = this.db(), v = this._vendeur(id, token), dr = v.droits || {};
      const out = []; let total = 0, cout = 0;
      for (const l of lignes) {
        const q = parseInt(l.quantite, 10);
        if (!q || q <= 0) continue;
        const p = db.produits.find((x) => x.id === l.produit_id && x.boutique_id === v.boutique_id && x.actif);
        if (!p) throw new Error('Un produit n\'est plus disponible.');
        const suit = p.suivi_stock !== false;
        if (suit && p.stock < q) throw new Error(`Stock insuffisant pour ${p.nom} (${p.stock} disponible(s)).`);
        const px = dr.prix && l.prix !== undefined && l.prix !== null && l.prix !== '' ? Math.max(0, Number(l.prix)) : p.prix;
        out.push({ produit_id: p.id, nom: p.nom, prix: px, quantite: q, _p: p, _suit: suit });
        total += px * q;
      }
      if (!out.length) throw new Error('Ajoutez au moins un article.');
      let paye = 0; const pays = [];
      for (const pay of paiements || []) {
        let m = Math.round(Number(pay.montant) || 0);
        m = Math.min(m, total - paye);
        if (m <= 0) continue;
        paye += m; pays.push({ date: now(), compte: pay.compte === 'wave' ? 'wave' : 'especes', montant: m });
      }
      if (paye < total) {
        if (!dr.credit) throw new Error('Vous n\'avez pas le droit de vendre à crédit : encaissez le montant complet.');
        if ((client_nom || '').trim().length < 2) throw new Error('Pour une vente à crédit, indiquez le nom du client.');
      }
      out.forEach((l) => { if (l._suit) { l._p.stock -= l.quantite; cout += l.quantite * this._coutMoyen(l.produit_id); } delete l._p; delete l._suit; });
      const t = now();
      const cmd = {
        id: uid(), boutique_id: v.boutique_id, numero: this._numero(v.boutique_id), client_id: null, client_nom: (client_nom || '').trim() || 'Client de passage',
        client_telephone: (client_tel || '').trim() || null, vendeur_id: v.id, lignes: out, total,
        moyen_paiement: !paye ? 'credit' : pays.length > 1 ? 'mixte' : pays[0].compte,
        statut: paye >= total ? 'payee' : 'credit', montant_paye: paye, rendu: 0, cout_revient: cout, paiements: pays,
        note: (note || '').slice(0, 300), created_at: t, confirmed_at: t, livree_at: t, paid_at: paye >= total ? t : null,
      };
      db.commandes.push(cmd);
      pays.forEach((p) => db.ecritures.push({ id: uid(), boutique_id: v.boutique_id, created_at: t, date: today(), libelle: `Vente ${cmd.numero} – ${cmd.client_nom}`, type: 'entree', categorie: 'vente', compte: p.compte, montant: p.montant, ref: cmd.id, vendeur_id: v.id }));
      this._save();
      return clone(cmd);
    },
    async vendeurEncaisser(id, token, commandeId, paiements) {
      const db = this.db(), v = this._vendeur(id, token);
      if (!(v.droits || {}).encaisser) throw new Error('Vous n\'avez pas le droit d\'encaisser les crédits.');
      const c = db.commandes.find((x) => x.id === commandeId && x.vendeur_id === v.id);
      if (!c) throw new Error('Vente introuvable.');
      if (c.statut !== 'credit') throw new Error('Cette vente n\'est pas à crédit.');
      const reste = c.total - ((c.montant_paye || 0) - (c.rendu || 0)); let ajout = 0; const t = now();
      for (const pay of paiements || []) {
        const m = Math.min(Math.round(Number(pay.montant) || 0), reste - ajout);
        if (m <= 0) continue;
        ajout += m;
        const compte = pay.compte === 'wave' ? 'wave' : 'especes';
        c.paiements = [...(c.paiements || []), { date: t, compte, montant: m }];
        db.ecritures.push({ id: uid(), boutique_id: c.boutique_id, created_at: t, date: today(), libelle: `Remboursement crédit ${c.numero} – ${c.client_nom}`, type: 'entree', categorie: 'recouvrement', compte, montant: m, ref: c.id, vendeur_id: v.id });
      }
      if (ajout <= 0) throw new Error('Saisissez un montant.');
      c.montant_paye = (c.montant_paye || 0) + ajout;
      if (c.montant_paye - (c.rendu || 0) >= c.total) { c.statut = 'payee'; c.paid_at = t; }
      this._save(); return clone(c);
    },
    async vendeurAnnuler(id, token, commandeId) {
      const db = this.db(), v = this._vendeur(id, token);
      if (!(v.droits || {}).annuler) throw new Error('Vous n\'avez pas le droit d\'annuler une vente.');
      const c = db.commandes.find((x) => x.id === commandeId && x.vendeur_id === v.id);
      if (!c) throw new Error('Vente introuvable.');
      if (c.statut === 'annulee') throw new Error('Vente déjà annulée.');
      c.lignes.forEach((l) => { const p = db.produits.find((x) => x.id === l.produit_id); if (p && p.suivi_stock !== false) p.stock += Number(l.quantite); });
      const t = now();
      if ((c.montant_paye || 0) - (c.rendu || 0) > 0) {
        (c.paiements || []).forEach((p) => db.ecritures.push({ id: uid(), boutique_id: c.boutique_id, created_at: t, date: today(), libelle: `Annulation ${c.numero} – ${c.client_nom}`, type: 'sortie', categorie: 'annulation', compte: p.compte || 'especes', montant: p.montant, ref: c.id, vendeur_id: v.id }));
      }
      c.statut = 'annulee'; c.rendu = c.montant_paye || 0;
      this._save(); return clone(c);
    },
    async adminVendeurCode(vendeurId, code) {
      if (!/^\d{4,6}$/.test(String(code || ''))) throw new Error('Le code doit contenir 4 à 6 chiffres.');
      const v = this.db().vendeurs.find((x) => x.id === vendeurId);
      if (!v) throw new Error('Vendeur introuvable.');
      this._exiger(v.boutique_id);
      v.code_hash = await sha256(code); v.token = uid(); v.essais = 0; v.bloque_jusqua = null; this._save();
    },

    // Libère les portions d'une commande de restaurant annulée (fait par un déclencheur en ligne)
    _libererPortions(c) {
      const db = this.db();
      const m = db.menus.find((x) => x.boutique_id === c.boutique_id && x.date === c.menu_date);
      if (!m) return;
      (c.lignes || []).forEach((l) => { const i = db.menu_items.find((x) => x.menu_id === m.id && x.produit_id === l.produit_id); if (i) i.reserve = Math.max(0, (i.reserve || 0) - Number(l.quantite)); });
    },

    // --- Notifications push : indisponibles sans serveur ---
    pushDisponible() { return false; },
    async savePushClient() { throw new Error('Notifications disponibles uniquement en mode en ligne.'); },
    async savePushAdmin() { throw new Error('Notifications disponibles uniquement en mode en ligne.'); },
    async sendPush() { throw new Error('Notifications disponibles uniquement en mode en ligne.'); },

    async exportAll() { this._exiger(); const out = {}; for (const t of TABLES) out[t] = await this.all(t); out.parametres = await this.getSettings(); return out; },
    async importAll() { throw new Error('La restauration n\'est pas disponible pour une plateforme multi-boutiques.'); },
  };
  // En mode local, une commande de restaurant annulée libère aussi ses portions
  const updateLocal = LocalDB.update;
  LocalDB.update = async function (t, id, patch) {
    const avant = this.db()[t].find((x) => x.id === id);
    const etait = avant && avant.statut;
    const r = await updateLocal.call(this, t, id, patch);
    if (t === 'commandes' && patch.statut === 'annulee' && etait !== 'annulee' && avant.menu_date) { this._libererPortions(avant); this._save(); }
    return r;
  };

  /* ------------------------------------------------------------------ */
  /* Mode EN LIGNE (Supabase)                                            */
  /* ------------------------------------------------------------------ */
  const chk = ({ data, error }) => {
    if (error) throw new Error(error.message || 'Erreur serveur');
    return data;
  };
  // Les fonctions qui enregistrent un échec côté serveur renvoient { erreur }
  const chkRpc = (r) => {
    const d = chk(r);
    if (d && d.erreur) throw new Error(d.erreur);
    return d;
  };
  const subJson = (sub) => {
    const j = sub.toJSON ? sub.toJSON() : sub;
    return { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth };
  };
  const AUTH_FR = {
    'Invalid login credentials': 'E-mail ou mot de passe incorrect.',
    'User already registered': 'Un compte existe déjà avec cet e-mail : connectez-vous.',
    'Email not confirmed': 'Confirmez d\'abord votre e-mail (lien reçu par e-mail).',
    'Signups not allowed for this instance': 'Les inscriptions sont fermées : contactez l\'administrateur de la plateforme.',
  };
  const authFr = (e) => new Error(AUTH_FR[e.message] || e.message);

  const SupabaseDB = {
    mode: 'supabase',
    boutique: null,
    sb: null,

    setBoutique(id) { this.boutique = id; },

    async init() {
      if (!window.supabase) throw new Error('Bibliothèque Supabase non chargée (connexion internet ?).');
      this.sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    },

    // --- Plateforme et vitrine ---
    async getPlateforme() {
      const rows = chk(await this.sb.from('plateforme').select('cle,valeur'));
      const s = { ...DEFAULT_PLATEFORME };
      rows.forEach((r) => { s[r.cle] = r.valeur; });
      return s;
    },
    async savePlateforme(s) { chk(await this.sb.from('plateforme').upsert(Object.entries(s).map(([cle, valeur]) => ({ cle, valeur })))); },
    async listeBoutiques() { return chk(await this.sb.rpc('liste_boutiques')) || []; },
    async boutiquePublique(slug) { return chk(await this.sb.rpc('boutique_publique', { p_slug: slug })); },

    // --- Boutique courante (lecture publique) ---
    async getSettings() {
      const rows = chk(await this.sb.from('parametres').select('cle,valeur').eq('boutique_id', this.boutique));
      const s = { ...DEFAULT_SETTINGS };
      rows.forEach((r) => { s[r.cle] = r.valeur; });
      return s;
    },
    async listCategories() { return chk(await this.sb.from('categories').select('*').eq('boutique_id', this.boutique).order('ordre')); },
    async listProducts() { return chk(await this.sb.from('produits').select('*').eq('boutique_id', this.boutique).eq('actif', true).order('nom')); },
    async menuPublie(bid, date) { return chk(await this.sb.rpc('menu_publie', { p_boutique: bid, p_date: date || today() })); },
    async menusAVenir(bid) { return chk(await this.sb.rpc('menus_a_venir', { p_boutique: bid })) || []; },

    // --- Clients ---
    async registerClient(nom, telephone) {
      return chkRpc(await this.sb.rpc('inscrire_client', { p_boutique: this.boutique, p_nom: nom, p_telephone: telephone || '' }));
    },
    async loginClient(telephone) {
      return chkRpc(await this.sb.rpc('connexion_client', { p_boutique: this.boutique, p_telephone: telephone || '' }));
    },
    async getClient(id, token) { return chk(await this.sb.rpc('statut_client', { p_id: id, p_token: token })); },
    async placeOrder(id, token, lignes, moyen, note, extra = {}) {
      return chk(await this.sb.rpc('passer_commande', {
        p_id: id, p_token: token, p_lignes: lignes, p_moyen: moyen, p_note: note || '',
        p_date: extra.date_reservation || null, p_heure: extra.heure_reservation || null, p_repartition: extra.repartition || null,
        p_mode: extra.mode_retrait || null, p_adresse: extra.adresse || null,
      }));
    },
    async myOrders(id, token) { return chk(await this.sb.rpc('mes_commandes', { p_id: id, p_token: token })) || []; },

    // --- Comptes ---
    async signUp(email, password) {
      const { data, error } = await this.sb.auth.signUp({ email: String(email).trim(), password });
      if (error) throw authFr(error);
      if (!data.session) throw new Error('Compte créé : confirmez votre e-mail (lien reçu), puis connectez-vous pour envoyer la demande.');
    },
    async login(email, password) {
      const { error } = await this.sb.auth.signInWithPassword({ email: String(email).trim(), password });
      if (error) throw authFr(error);
    },
    async isLoggedIn() { const { data } = await this.sb.auth.getSession(); return !!(data && data.session); },
    async logout() { await this.sb.auth.signOut(); },
    async moi() { const { data } = await this.sb.auth.getUser(); return data?.user ? { id: data.user.id, email: data.user.email } : null; },
    async changePin(oldPin, newPin) {
      const u = await this.moi();
      const { error: e1 } = await this.sb.auth.signInWithPassword({ email: u.email, password: oldPin });
      if (e1) throw new Error('Ancien mot de passe incorrect.');
      const { error } = await this.sb.auth.updateUser({ password: newPin });
      if (error) throw authFr(error);
    },
    async mesBoutiques() { return chk(await this.sb.rpc('mes_boutiques')); },
    async demanderBoutique(d) {
      return chk(await this.sb.rpc('demander_boutique', {
        p_nom: d.nom, p_type: d.type, p_responsable: d.responsable || '', p_telephone: d.telephone || '',
        p_ville: d.ville || '', p_description: d.description || '', p_paiement_ref: d.paiement_ref || '',
      }));
    },

    // --- Administrateur de la plateforme ---
    async toutesBoutiques() { return chk(await this.sb.from('boutiques').select('*').order('created_at', { ascending: false })); },
    async majBoutique(id, patch) { return chk(await this.sb.from('boutiques').update(patch).eq('id', id).select().single()); },
    async validerBoutique(id) { chk(await this.sb.rpc('valider_boutique', { p_boutique: id })); },
    async statsPlateforme() { return chk(await this.sb.rpc('stats_plateforme')) || []; },

    // --- Gestion de la boutique courante ---
    async all(t) {
      const rows = chk(await this.sb.from(t).select('*').eq('boutique_id', this.boutique).order('created_at', { ascending: true }));
      if (t === 'clients') rows.forEach((c) => { delete c.code_hash; });
      return rows;
    },
    async insert(t, row) { return chk(await this.sb.from(t).insert({ id: uid(), ...row, boutique_id: this.boutique }).select().single()); },
    async update(t, id, patch) { return chk(await this.sb.from(t).update(patch).eq('id', id).select().single()); },
    async remove(t, id) { chk(await this.sb.from(t).delete().eq('id', id)); },
    async saveSettings(s) {
      const rows = Object.entries(s).map(([cle, valeur]) => ({ boutique_id: this.boutique, cle, valeur }));
      chk(await this.sb.from('parametres').upsert(rows, { onConflict: 'boutique_id,cle' }));
    },
    async nextNumero() { return chk(await this.sb.rpc('prochain_numero', { p_boutique: this.boutique })); },
    async boutiqueCourante() { return chk(await this.sb.from('boutiques').select('*').eq('id', this.boutique).maybeSingle()); },

    // --- Points de vente (vendeurs) ---
    async vendeurLogin(telephone, code) { return chkRpc(await this.sb.rpc('vendeur_connexion', { p_telephone: telephone || '', p_code: code || '' })); },
    async vendeurData(id, token) { return chk(await this.sb.rpc('vendeur_donnees', { p_id: id, p_token: token })); },
    async vendeurVente(id, token, { lignes, client_nom, client_tel, paiements, note }) {
      return chk(await this.sb.rpc('vendeur_vente', {
        p_id: id, p_token: token, p_lignes: lignes, p_client_nom: client_nom || '', p_client_tel: client_tel || '', p_paiements: paiements || [], p_note: note || '',
      }));
    },
    async vendeurEncaisser(id, token, commandeId, paiements) { return chk(await this.sb.rpc('vendeur_encaisser', { p_id: id, p_token: token, p_commande: commandeId, p_paiements: paiements })); },
    async vendeurAnnuler(id, token, commandeId) { return chk(await this.sb.rpc('vendeur_annuler', { p_id: id, p_token: token, p_commande: commandeId })); },
    async adminVendeurCode(vendeurId, code) { chkRpc(await this.sb.rpc('admin_vendeur_code', { p_vendeur: vendeurId, p_code: code })); },

    // --- Notifications push ---
    pushDisponible() { return !!cfg.VAPID_PUBLIC_KEY; },
    async savePushClient(id, token, sub) { chkRpc(await this.sb.rpc('abonner_push_client', { p_id: id, p_token: token, p_sub: subJson(sub) })); },
    // role 'admin' : gérant de la boutique courante ; role 'super' : administrateur de la plateforme
    async savePushAdmin(sub, role = 'admin') {
      const s = subJson(sub);
      const row = { id: uid(), role, client_id: null, boutique_id: role === 'super' ? null : this.boutique, ...s };
      chk(await this.sb.from('abonnements_push').upsert(row, { onConflict: 'endpoint,role,boutique_id' }));
    },
    async sendPush(payload) {
      const body = { boutique_id: this.boutique, ...payload };
      const { data, error } = await this.sb.functions.invoke('notifier', { body });
      if (error) throw new Error('Envoi impossible : la fonction « notifier » est-elle déployée ?');
      if (data && data.erreur) throw new Error(data.erreur);
      return data;
    },

    async exportAll() {
      const out = {};
      for (const t of TABLES) out[t] = await this.all(t);
      out.parametres = await this.getSettings();
      return out;
    },
    async importAll() { throw new Error('La restauration n\'est disponible qu\'en mode local.'); },
  };

  window.DB = cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY ? SupabaseDB : LocalDB;
  window.DB.TABLES = TABLES;
  window.DB.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
  window.DB.today = today;
  window.DB.addDays = addDays;
})();
