/*
 * Couche de données de Noecy Market.
 * Deux implémentations avec la même interface :
 *   - LocalDB    : localStorage (démo, un seul navigateur)
 *   - SupabaseDB : base partagée en ligne (production)
 */
(function () {
  'use strict';

  const cfg = window.NOECY_CONFIG || {};
  const TABLES = ['categories', 'produits', 'clients', 'commandes', 'fabrications', 'ecritures', 'matieres', 'achats', 'vendeurs'];

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

    // --- Points de vente (vendeurs) ---
    _vendeur(id, token) {
      const v = this.db().vendeurs.find((x) => x.id === id && x.token === token);
      if (!v) throw new Error('Session expirée : reconnectez-vous.');
      if (!v.actif) throw new Error('Votre accès vendeur a été désactivé par Noecy Market.');
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
      if (!v.actif) throw new Error('Votre accès a été désactivé par Noecy Market.');
      if (v.bloque_jusqua && new Date(v.bloque_jusqua) > new Date()) throw new Error('Trop d\'essais. Réessayez dans quelques minutes.');
      if (!v.code_hash) throw new Error('Aucun code défini : demandez votre code à Noecy Market.');
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
      const p = { ...DEFAULT_SETTINGS, ...db.parametres };
      return clone({
        vendeur: { id: v.id, nom: v.nom, telephone: v.telephone, droits: v.droits || {} },
        parametres: { nom_boutique: p.nom_boutique, devise: p.devise, wave_lien: p.wave_lien },
        categories: db.categories,
        produits: db.produits.filter((x) => x.actif).map((x) => ({
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
        const p = db.produits.find((x) => x.id === l.produit_id && x.actif);
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
      db.compteur = (db.compteur || 0) + 1;
      const t = now();
      const cmd = {
        id: uid(), numero: numero(db.compteur), client_id: null, client_nom: (client_nom || '').trim() || 'Client de passage',
        client_telephone: (client_tel || '').trim() || null, vendeur_id: v.id, lignes: out, total,
        moyen_paiement: !paye ? 'credit' : pays.length > 1 ? 'mixte' : pays[0].compte,
        statut: paye >= total ? 'payee' : 'credit', montant_paye: paye, rendu: 0, cout_revient: cout, paiements: pays,
        note: (note || '').slice(0, 300), created_at: t, confirmed_at: t, livree_at: t, paid_at: paye >= total ? t : null,
      };
      db.commandes.push(cmd);
      pays.forEach((p) => db.ecritures.push({ id: uid(), created_at: t, date: today(), libelle: `Vente ${cmd.numero} – ${cmd.client_nom}`, type: 'entree', categorie: 'vente', compte: p.compte, montant: p.montant, ref: cmd.id, vendeur_id: v.id }));
      this._save();
      return clone(cmd);
    },
    async vendeurEncaisser(id, token, commandeId, paiements) {
      const db = this.db(), v = this._vendeur(id, token);
      if (!(v.droits || {}).encaisser) throw new Error('Vous n\'avez pas le droit d\'encaisser les crédits.');
      const c = db.commandes.find((x) => x.id === commandeId && x.vendeur_id === v.id);
      if (!c) throw new Error('Vente introuvable.');
      if (c.statut !== 'credit') throw new Error('Cette vente n\'est pas à crédit.');
      let reste = c.total - ((c.montant_paye || 0) - (c.rendu || 0)), ajout = 0; const t = now();
      for (const pay of paiements || []) {
        const m = Math.min(Math.round(Number(pay.montant) || 0), reste - ajout);
        if (m <= 0) continue;
        ajout += m;
        const compte = pay.compte === 'wave' ? 'wave' : 'especes';
        c.paiements = [...(c.paiements || []), { date: t, compte, montant: m }];
        db.ecritures.push({ id: uid(), created_at: t, date: today(), libelle: `Remboursement crédit ${c.numero} – ${c.client_nom}`, type: 'entree', categorie: 'recouvrement', compte, montant: m, ref: c.id, vendeur_id: v.id });
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
        (c.paiements || []).forEach((p) => db.ecritures.push({ id: uid(), created_at: t, date: today(), libelle: `Annulation ${c.numero} – ${c.client_nom}`, type: 'sortie', categorie: 'annulation', compte: p.compte || 'especes', montant: p.montant, ref: c.id, vendeur_id: v.id }));
      }
      c.statut = 'annulee'; c.rendu = c.montant_paye || 0;
      this._save(); return clone(c);
    },
    async adminVendeurCode(vendeurId, code) {
      if (!/^\d{4,6}$/.test(String(code || ''))) throw new Error('Le code doit contenir 4 à 6 chiffres.');
      const v = this.db().vendeurs.find((x) => x.id === vendeurId);
      if (!v) throw new Error('Vendeur introuvable.');
      v.code_hash = await sha256(code); v.token = uid(); v.essais = 0; v.bloque_jusqua = null; this._save();
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

    // --- Points de vente (vendeurs) ---
    async vendeurLogin(telephone, code) {
      return chkRpc(await this.sb.rpc('vendeur_connexion', { p_telephone: telephone || '', p_code: code || '' }));
    },
    async vendeurData(id, token) { return chk(await this.sb.rpc('vendeur_donnees', { p_id: id, p_token: token })); },
    async vendeurVente(id, token, { lignes, client_nom, client_tel, paiements, note }) {
      return chk(await this.sb.rpc('vendeur_vente', {
        p_id: id, p_token: token, p_lignes: lignes, p_client_nom: client_nom || '', p_client_tel: client_tel || '', p_paiements: paiements || [], p_note: note || '',
      }));
    },
    async vendeurEncaisser(id, token, commandeId, paiements) {
      return chk(await this.sb.rpc('vendeur_encaisser', { p_id: id, p_token: token, p_commande: commandeId, p_paiements: paiements }));
    },
    async vendeurAnnuler(id, token, commandeId) {
      return chk(await this.sb.rpc('vendeur_annuler', { p_id: id, p_token: token, p_commande: commandeId }));
    },
    async adminVendeurCode(vendeurId, code) {
      chkRpc(await this.sb.rpc('admin_vendeur_code', { p_vendeur: vendeurId, p_code: code }));
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
