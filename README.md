# Noecy Market

Application web de gestion et de vente pour Noecy Market : jus (bissap, tomi), chips de banane, douceurs (caramel).

- **Boutique client** (`/`) : nom obligatoire → validation par la gérante → panier → paiement Wave / espèces / plus tard.
- **Espace gérante** (`/#/admin`) : tableau de bord + alertes, commandes, clients, produits, stock & fabrication, rentabilité, grand livre, relances crédit, paramètres.

Aucune installation : HTML + CSS + JavaScript, aucune étape de build.

---

## 1. Essayer tout de suite (mode local)

Ouvrez `index.html` dans le navigateur (ou lancez `python3 -m http.server` dans ce dossier puis ouvrez http://localhost:8000).

En **mode local**, tout est enregistré dans le navigateur. C'est parfait pour tester, mais **vos clients ne verront pas vos données depuis leur téléphone**. Pour la vraie utilisation, passez au mode en ligne (étape 2).

Au premier accès à `#/admin`, on vous demande de créer un code PIN.

---

## 2. Mettre en ligne gratuitement (≈ 10 minutes)

### a) La base de données : Supabase (gratuit)

1. Créez un compte sur https://supabase.com, puis **New project** (choisissez la région *Europe*, ex. Paris/Frankfurt).
2. Menu **SQL Editor** → **New query** → collez tout le contenu de `supabase/schema.sql` → **Run**.
3. Menu **Authentication → Users → Add user** : créez votre compte gérante (e-mail + mot de passe), cochez *Auto Confirm User*.
4. Retour dans **SQL Editor**, exécutez (avec VOTRE e-mail) :
   ```sql
   insert into admins (email) values ('votre.email@exemple.com');
   ```
5. Recommandé : **Authentication → Sign In / Providers → Email** → désactivez *Allow new users to sign up*.
6. Menu **Project Settings → API** : copiez **Project URL** et la clé **anon public**.
7. Collez-les dans `js/config.js` :
   ```js
   window.NOECY_CONFIG = {
     SUPABASE_URL: 'https://xxxx.supabase.co',
     SUPABASE_ANON_KEY: 'eyJhbGciOi...',
   };
   ```
   > La clé *anon* est faite pour être publique : la sécurité est assurée par les règles RLS du fichier SQL.
   > Ne mettez **jamais** la clé `service_role` dans ce fichier.

### b) L'hébergement du site (gratuit)

**Option la plus simple : Netlify Drop**
1. Allez sur https://app.netlify.com/drop
2. Glissez-déposez le dossier `Noecy_market` entier.
3. Vous obtenez un lien du type `https://noecy-market.netlify.app` → partagez-le à vos clients !

Autres options gratuites : **Vercel**, **Cloudflare Pages**, **GitHub Pages** (dossier à la racine, aucune commande de build).

L'espace gérante est à l'adresse : `https://votre-site/#/admin`.

---

## 3. Le lien de paiement Wave

Dans l'app **Wave Business** : *Encaisser* → *Partager le lien de paiement*. Collez ce lien dans **Paramètres → Paiement Wave**.

Pour que le montant soit pré-rempli, ajoutez `{montant}` à l'endroit voulu, par exemple :
`https://pay.wave.com/m/M_XXXX/c/sn/?amount={montant}`

Le bouton « Payer avec Wave » apparaît au client après sa commande et dans « Mes commandes ». Il est aussi ajouté aux messages de relance.

---

## 4. Comment ça marche

| Étape | Effet |
|---|---|
| Le client entre son nom | Demande « À valider » dans **Clients** (doublons signalés) |
| Vous validez | Le client peut ajouter au panier et commander (animation de confettis) |
| Le client commande | Commande « En attente » + notification sonore côté gérante |
| Vous cliquez **Payée** | Stock déduit + entrée dans le grand livre |
| Vous cliquez **Crédit** (ou paiement partiel) | Stock déduit, **pas** d'argent → apparaît dans **Relances crédit** |
| **Encaisser** un crédit | Entrée « Règlement crédit » au grand livre |
| **Nouvelle fabrication** | +stock, dépenses au grand livre, coût de revient par unité calculé |
| **Annuler** une vente | Articles remis en stock, remboursement noté au grand livre |

**Bénéfice** = prix de vente − coût moyen par unité (total des dépenses ÷ unités fabriquées).

**Alertes du tableau de bord** : rupture, stock sous le seuil, produit qui part vite (≤ 3 jours de stock au rythme des 7 derniers jours), clients/commandes en attente, crédits de plus de 7 jours.

Les relances WhatsApp ajoutent l'indicatif 221 (Sénégal) aux numéros à 9 chiffres ; saisissez l'indicatif complet pour un autre pays.

---

## 5. Sauvegardes

**Paramètres → Sauvegarder (JSON)** télécharge toutes vos données. Faites-le régulièrement.

## Structure

```
Noecy_market/
├── index.html
├── css/style.css
├── js/config.js        ← vos clés Supabase
├── js/db.js            ← accès aux données (local ou Supabase)
├── js/app.js           ← boutique + espace gérante
└── supabase/schema.sql ← tables, sécurité RLS, fonctions
```
