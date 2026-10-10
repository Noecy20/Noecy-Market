/*
 * Couche de données de Noecy Market.
 * Deux implémentations avec la même interface :
 *   - LocalDB    : localStorage (démo, un seul navigateur)
 *   - SupabaseDB : base partagée en ligne (production)
 */
(function () {
  'use strict';

  const cfg = window.NOECY_CONFIG || {};
  const TABLES = ['categories', 'produits', 'clients', 'commandes', 'fabrications', 'ecritures', 'matieres', 'achats'];

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

  const DEFAULT_SETTINGS = {
    nom_boutique: 'Noecy Market',
    slogan: 'Jus frais, chips croustillantes et douceurs maison, préparés avec amour.',
    wave_lien: '',
    whatsapp: '',
    devise: 'FCFA',
    seuil_defaut: 5,
    message_relance:
      'Bonjour {nom}, petit rappel amical de Noecy Market : il reste {montant} à régler pour votre commande {numero}. Merci beaucoup !',
  };

  const SEED_CATEGORIES = [
    { id: 'cat-jus', nom: 'Jus', icone: 'cup-soda', couleur: '#b0185f', ordre: 1 },
    { id: 'cat-chips', nom: 'Chips', icone: 'banana', couleur: '#e39b06', ordre: 2 },
    { id: 'cat-sucre', nom: 'Sucrée', icone: 'candy', couleur: '#b5652a', ordre: 3 },
  ];

  const SEED_PRODUITS = [
    { id: 'p-bissap', nom: 'Jus de Bissap', categorie_id: 'cat-jus', prix: 500, unite: 'Bouteille 50 cl',
      description: "Jus de fleurs d'hibiscus fait maison, légèrement sucré et parfumé à la menthe. Servir bien frais." },
    { id: 'p-tomi', nom: 'Jus de Tomi', categorie_id: 'cat-jus', prix: 500, unite: 'Bouteille 50 cl',
      description: 'Jus de tamarin (tomi) maison, acidulé et rafraîchissant.' },
    { id: 'p-chips-mure', nom: 'Chips banane mûre', categorie_id: 'cat-chips', prix: 500, unite: 'Sachet',
      description: 'Chips de banane mûre, naturellement sucrées et croustillantes.' },
    { id: 'p-chips-verte', nom: 'Chips banane non mûre', categorie_id: 'cat-chips', prix: 500, unite: 'Sachet',
      description: 'Chips de banane verte, salées et ultra croustillantes.' },
    { id: 'p-caramel', nom: 'Caramel', categorie_id: 'cat-sucre', prix: 250, unite: 'Sachet', suivi_stock: false,
      description: 'Caramels fondants, en petites quantités.' },
  ].map((p) => ({ suivi_stock: true, photo: '', stock: 0, seuil_alerte: 5, actif: true, created_at: now(), ...p }));

  const MOYENS = ['wave', 'especes', 'mixte', 'credit'];

  /* ------------------------------------------------------------------ */
  /* Mode LOCAL                                                          */
  /* ------------------------------------------------------------------ */
  const KEY = 'noecy_db_v1';

  async function sha256(txt) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('noecy::' + txt));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // Code PIN par défaut de l'espace gérante (mode local), modifiable dans Paramètres
  const DEFAULT_PIN = '2012';

  function numero(n) {
    return 'CMD-' + String(n).padStart(4, '0');
  }


  const LocalDB = {
    mode: 'local',
    _db: null,

    db() {
      if (!this._db) {
        try { this._db = JSON.parse(localStorage.getItem(KEY)); } catch (e) { this._db = null; }
        if (!this._db) {
          this._db = {
            categories: clone(SEED_CATEGORIES),
            produits: clone(SEED_PRODUITS),
            clients: [], commandes: [], fabrications: [], ecritures: [], matieres: [], achats: [],
            parametres: {}, compteur: 0, admin_pin: null,
          };
          this._save();
        }
        // Migrations des anciennes versions
        const ico = { 'cat-jus': 'cup-soda', 'cat-chips': 'banana', 'cat-sucre': 'candy' };
        (this._db.categories || []).forEach((c) => { if (!c.icone) c.icone = ico[c.id] || 'shopping-bag'; delete c.emoji; });
        TABLES.forEach((t) => { if (!Array.isArray(this._db[t])) this._db[t] = []; });
        this._db.produits.forEach((p) => { if (p.suivi_stock === undefined) p.suivi_stock = true; });
        this._db.ecritures.forEach((e) => { if (!e.compte) e.compte = 'especes'; });
      }
      return this._db;
    },
    _save() {
      try { localStorage.setItem(KEY, JSON.stringify(this._db)); }
      catch (e) { throw new Error('Stockage du navigateur plein : utilisez des photos plus légères.'); }
    },

    async init() { this.db(); },

    // --- Public ---
    async getSettings() { return { ...DEFAULT_SETTINGS, ...this.db().parametres }; },
    async listCategories() { return clone(this.db().categories).sort((a, b) => (a.ordre || 0) - (b.ordre || 0)); },
    async listProducts() { return clone(this.db().produits.filter((p) => p.actif)); },

    _findTel(telephone) {
      const t = tel9(telephone);
      return this.db().clients.filter((c) => c.statut !== 'refuse' && tel9(c.telephone) === t)
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
    },
    async registerClient(nom, telephone) {
      nom = (nom || '').trim();
      if (nom.length < 2) throw new Error('Le nom est obligatoire.');
      if (digits(telephone).length < 8) throw new Error('Le numéro de téléphone est obligatoire.');
      if (this._findTel(telephone)) throw new Error('Ce numéro a déjà un compte. Utilisez « J\'ai déjà un compte ».');
      const c = { id: uid(), token: uid(), nom, telephone: String(telephone).trim(), statut: 'en_attente', note: '', created_at: now() };
      this.db().clients.push(c); this._save();
      return { id: c.id, token: c.token };
    },
    // Connexion avec le numéro de téléphone uniquement
    async loginClient(telephone) {
      if (digits(telephone).length < 8) throw new Error('Numéro de téléphone invalide.');
      const c = this._findTel(telephone);
      if (!c) throw new Error('Aucun compte avec ce numéro. Inscrivez-vous avec « Je suis nouveau ».');
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
      if (!MOYENS.includes(moyen)) throw new Error('Moyen de paiement invalide.');
      const dateResa = extra.date_reservation || null;
      if (dateResa && dateResa < today()) throw new Error('La date de réservation est déjà passée.');
      const out = []; let total = 0;
      for (const l of lignes) {
        const q = parseInt(l.quantite, 10);
        if (!q || q <= 0) continue;
        const p = db.produits.find((x) => x.id === l.produit_id && x.actif);
        if (!p) throw new Error('Un produit du panier n\'est plus disponible.');
        if (p.suivi_stock && !dateResa && p.stock < q) throw new Error(`Stock insuffisant pour ${p.nom} (${p.stock} disponible(s)). Choisissez une date de réservation.`);
        out.push({ produit_id: p.id, nom: p.nom, prix: p.prix, quantite: q });
        total += p.prix * q;
      }
      if (!out.length) throw new Error('Votre panier est vide.');
      db.compteur = (db.compteur || 0) + 1;
      const cmd = {
        id: uid(), numero: numero(db.compteur), client_id: c.id, client_nom: c.nom, lignes: out, total,
        moyen_paiement: moyen, statut: 'en_attente', montant_paye: 0, rendu: 0, cout_revient: 0, paiements: [],
        note: (note || '').slice(0, 500), date_reservation: dateResa, heure_reservation: extra.heure_reservation || null,
        repartition: extra.repartition || null, created_at: now(), confirmed_at: null, paid_at: null, livree_at: null,
      };
      db.commandes.push(cmd); this._save();
      return clone(cmd);
    },
    async myOrders(id, token) {
      const db = this.db();
      if (!db.clients.find((x) => x.id === id && x.token === token)) return [];
      return clone(db.commandes.filter((c) => c.client_id === id)).sort((a, b) => b.created_at.localeCompare(a.created_at));
    },

    // --- Notifications push : indisponibles sans serveur ---
    pushDisponible() { return false; },
    async savePushClient() { throw new Error('Notifications disponibles uniquement en mode en ligne.'); },
    async savePushAdmin() { throw new Error('Notifications disponibles uniquement en mode en ligne.'); },
    async sendPush() { throw new Error('Notifications disponibles uniquement en mode en ligne.'); },

    // --- Gérante ---
    async hasAdmin() { return true; },
    async _pinHash() { return this.db().admin_pin || sha256(DEFAULT_PIN); },
    async login(_ignored, pin) {
      if ((await sha256(pin)) !== (await this._pinHash())) throw new Error('Code PIN incorrect.');
      sessionStorage.setItem('noecy_admin', '1');
    },
    async isAdmin() { return sessionStorage.getItem('noecy_admin') === '1'; },
    async logout() { sessionStorage.removeItem('noecy_admin'); },
    async changePin(oldPin, newPin) {
      if ((await sha256(oldPin)) !== (await this._pinHash())) throw new Error('Ancien code incorrect.');
      this.db().admin_pin = await sha256(newPin); this._save();
    },

    async all(t) {
      const rows = clone(this.db()[t]);
      if (t === 'clients') rows.forEach((c) => { c.a_code = !!c.code_hash; delete c.code_hash; });
      return rows;
    },
    async insert(t, row) {
      const r = { id: uid(), created_at: now(), ...row };
      this.db()[t].push(r); this._save(); return clone(r);
    },
    async update(t, id, patch) {
      const r = this.db()[t].find((x) => x.id === id);
      if (!r) throw new Error('Élément introuvable.');
      Object.assign(r, patch); this._save(); return clone(r);
    },
    async remove(t, id) {
      this.db()[t] = this.db()[t].filter((x) => x.id !== id); this._save();
    },
    async saveSettings(s) { this.db().parametres = { ...this.db().parametres, ...s }; this._save(); },
    async nextNumero() { const db = this.db(); db.compteur = (db.compteur || 0) + 1; this._save(); return numero(db.compteur); },

    async exportAll() { const d = clone(this.db()); delete d.admin_pin; return d; },
    async importAll(data) {
      const pin = this.db().admin_pin;
      for (const t of ['categories', 'produits', 'clients', 'commandes', 'fabrications', 'ecritures']) {
        if (!Array.isArray(data[t])) throw new Error('Fichier de sauvegarde invalide.');
      }
      this._db = { ...data, admin_pin: pin }; this._save();
      this._db = null; this.db();
    },
  };

  /* ------------------------------------------------------------------ */
  /* Mode CLOUD (Supabase)                                               */
  /* ------------------------------------------------------------------ */
  const chk = ({ data, error }) => {
    if (error) throw new Error(error.message || 'Erreur serveur');
    return data;
  };
  // Les fonctions RPC renvoient { erreur } quand l'échec doit être enregistré côté serveur
  const chkRpc = (r) => {
    const d = chk(r);
    if (d && d.erreur) throw new Error(d.erreur);
    return d;
  };

  const subJson = (sub) => {
    const j = sub.toJSON ? sub.toJSON() : sub;
    return { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth };
  };

  const SupabaseDB = {
    mode: 'supabase',
    sb: null,

    async init() {
      if (!window.supabase) throw new Error('Bibliothèque Supabase non chargée (connexion internet ?).');
      this.sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    },

    async getSettings() {
      const rows = chk(await this.sb.from('parametres').select('cle,valeur'));
      const s = { ...DEFAULT_SETTINGS };
      rows.forEach((r) => { s[r.cle] = r.valeur; });
      return s;
    },
    async listCategories() { return chk(await this.sb.from('categories').select('*').order('ordre')); },
    async listProducts() { return chk(await this.sb.from('produits').select('*').eq('actif', true).order('nom')); },

    async registerClient(nom, telephone) {
      return chkRpc(await this.sb.rpc('inscrire_client', { p_nom: nom, p_telephone: telephone || '' }));
    },
    async loginClient(telephone) {
      return chkRpc(await this.sb.rpc('connexion_client', { p_telephone: telephone || '' }));
    },
    async getClient(id, token) {
      return chk(await this.sb.rpc('statut_client', { p_id: id, p_token: token }));
    },
    async placeOrder(id, token, lignes, moyen, note, extra = {}) {
      return chk(await this.sb.rpc('passer_commande', {
        p_id: id, p_token: token, p_lignes: lignes, p_moyen: moyen, p_note: note || '',
        p_date: extra.date_reservation || null, p_heure: extra.heure_reservation || null, p_repartition: extra.repartition || null,
      }));
    },
    async myOrders(id, token) {
      return chk(await this.sb.rpc('mes_commandes', { p_id: id, p_token: token })) || [];
    },

    // --- Notifications push ---
    pushDisponible() { return !!cfg.VAPID_PUBLIC_KEY; },
    async savePushClient(id, token, sub) {
      chkRpc(await this.sb.rpc('abonner_push_client', { p_id: id, p_token: token, p_sub: subJson(sub) }));
    },
    async savePushAdmin(sub) {
      const s = subJson(sub);
      chk(await this.sb.from('abonnements_push').upsert({ id: uid(), role: 'admin', client_id: null, ...s }, { onConflict: 'endpoint' }));
    },
    async sendPush(payload) {
      const { data, error } = await this.sb.functions.invoke('notifier', { body: payload });
      if (error) throw new Error('Envoi impossible : la fonction « notifier » est-elle déployée ?');
      if (data && data.erreur) throw new Error(data.erreur);
      return data;
    },

    async hasAdmin() { return true; },
    async login(email, password) {
      chk(await this.sb.auth.signInWithPassword({ email, password }));
      const ok = chk(await this.sb.rpc('est_admin'));
      if (!ok) { await this.sb.auth.signOut(); throw new Error("Ce compte n'est pas autorisé (table admins)."); }
    },
    async isAdmin() {
      const { data } = await this.sb.auth.getSession();
      if (!data || !data.session) return false;
      const r = await this.sb.rpc('est_admin');
      return !r.error && !!r.data;
    },
    async logout() { await this.sb.auth.signOut(); },

    async all(t) {
      if (t === 'clients') {
        const rows = chk(await this.sb.from('clients').select('*').order('created_at', { ascending: true }));
        rows.forEach((c) => { c.a_code = !!c.code_hash; delete c.code_hash; });
        return rows;
      }
      return chk(await this.sb.from(t).select('*').order('created_at', { ascending: true }));
    },
    async insert(t, row) { return chk(await this.sb.from(t).insert({ id: uid(), ...row }).select().single()); },
    async update(t, id, patch) { return chk(await this.sb.from(t).update(patch).eq('id', id).select().single()); },
    async remove(t, id) { chk(await this.sb.from(t).delete().eq('id', id)); },
    async saveSettings(s) {
      const rows = Object.entries(s).map(([cle, valeur]) => ({ cle, valeur }));
      chk(await this.sb.from('parametres').upsert(rows));
    },
    async nextNumero() { return chk(await this.sb.rpc('prochain_numero')); },

    async exportAll() {
      const out = {};
      for (const t of TABLES) out[t] = await this.all(t);
      out.parametres = await this.getSettings();
      return out;
    },
    async importAll() { throw new Error("L'import est réservé au mode local."); },
  };

  window.DB = cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY ? SupabaseDB : LocalDB;
  window.DB.TABLES = TABLES;
  window.DB.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
})();
