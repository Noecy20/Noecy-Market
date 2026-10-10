# Noecy Market

Application web de gestion et de vente pour Noecy Market : jus (bissap, tomi), chips de banane, douceurs (caramel).

- **Boutique client** (`/`) : inscription (nom + téléphone) → validation par la gérante → panier → commande immédiate ou réservée pour un jour → paiement Wave, espèces, les deux, ou plus tard.
- **Espace gérante** (`/admin.html`) : tableau de bord et alertes, commandes, clients, caisse par compte (espèces / Wave), produits, stock & achats (matières premières réutilisables), rentabilité, crédits & dettes, paramètres, notifications push.

Aucune installation : HTML + CSS + JavaScript, aucune étape de build. Installable sur l'écran d'accueil du téléphone (PWA).

---

## 1. Essayer tout de suite (mode local)

Lancez `python3 -m http.server` dans ce dossier puis ouvrez http://localhost:8000.

Sans clés Supabase dans `js/config.js`, tout est enregistré dans le navigateur : parfait pour tester, mais **vos clients ne verront pas vos données depuis leur téléphone**.

Code PIN de l'espace gérante en mode local : **2012** (à changer dans Paramètres).

---

## 2. Mettre en ligne gratuitement

### a) La base de données : Supabase (gratuit)

1. Créez un projet sur https://supabase.com (région *Europe*).
2. **SQL Editor** → **New query** → collez `supabase/schema.sql` → **Run**.
3. Nouvelle requête → collez `supabase/migration_v2.sql` → **Run** (caisse par compte, matières, réservations, connexion par numéro, notifications).
4. **Authentication → Users → Add user** : créez votre compte gérante (cochez *Auto Confirm User*), puis :
   ```sql
   insert into admins (email) values ('votre.email@exemple.com');
   ```
5. Recommandé : **Authentication → Sign In / Providers → Email** → désactivez *Allow new users to sign up*.
6. **Project Settings → API** : copiez **Project URL** et la clé **anon public** dans `js/config.js`.
   > La clé *anon* est faite pour être publique : la sécurité est assurée par les règles RLS. Ne mettez **jamais** la clé `service_role` dans ce fichier.

### b) Les notifications push (même application fermée)

1. **Edge Functions** → **Deploy a new function** → **Via Editor** → nom : `notifier` → collez le contenu de `supabase/functions/notifier/index.ts` → **Deploy**.
2. **Edge Functions → Secrets** : ajoutez `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` et `NOECY_PUSH_SECRET` (valeurs dans `SECRETS_SUPABASE.local.txt`, fichier privé non publié).
3. **SQL Editor** : exécutez `supabase/config_push.local.sql` (fichier privé : il indique à la base où envoyer les notifications).
4. Dans l'app : **Paramètres → Notifications → Activer sur cet appareil**, puis **Tester**.

Pour générer de nouvelles clés : `npx web-push generate-vapid-keys` (la clé publique va dans `js/config.js`, la clé privée dans les secrets Supabase).

Ce qui est notifié :

| Qui | Quand |
|---|---|
| Gérante | Nouvelle commande ou réservation, nouveau client à valider, résumé chaque matin à 9 h |
| Client | Compte validé, réservation acceptée, commande remise / réglée / annulée |
| Client à crédit | Rappel automatique chaque jour à 9 h dès que le crédit a plus d'un jour (message modifiable dans Paramètres) |

**iPhone** : les notifications web fonctionnent seulement si l'app est ajoutée à l'écran d'accueil (Safari → Partager → *Sur l'écran d'accueil*), puis ouverte depuis l'icône (iOS 16.4 ou plus).

### c) L'hébergement du site (gratuit)

**Netlify Drop** : glissez le dossier sur https://app.netlify.com/drop (sans les fichiers `*.local.*`).
Ou reliez le dépôt GitHub à Netlify / Vercel / Cloudflare Pages (aucune commande de build, dossier de publication `.`).

L'espace gérante est à l'adresse : `https://votre-site/admin.html` (à ajouter à l'écran d'accueil du téléphone : icône sombre « Noecy Gérante », séparée de la boutique).

---

## 3. Le lien de paiement Wave

Dans **Wave Business** : *Encaisser* → *Partager le lien de paiement*. Collez-le dans **Paramètres → Paiement Wave**.
Ajoutez `{montant}` pour pré-remplir le montant, par exemple `https://pay.wave.com/m/M_XXXX/c/sn/?amount={montant}`.

---

## 4. Comment ça marche

### Clients sans mot de passe
- Inscription : nom + téléphone. Un seul compte par numéro.
- Sur un autre téléphone : « J'ai déjà un compte » → numéro de téléphone, c'est tout.
- **Clients → Lien** envoie aussi par WhatsApp un lien qui connecte directement le client.
- À savoir : sans code, une personne qui connaît le numéro d'un client peut se connecter à sa place. La validation des nouveaux noms par la gérante reste le garde-fou.

### Commandes et argent

| Action | Stock | Caisse |
|---|---|---|
| **Remettre & encaisser** | Déduit (produits comptés) | Entrée sur le compte choisi (espèces et/ou Wave) |
| **À crédit** | Déduit | Rien : la somme apparaît dans **Crédits & dettes** |
| **Réserver** (avec avance facultative) | Rien jusqu'à la remise | Avance enregistrée → « Nous devons » tant que la marchandise n'est pas remise |
| Trop perçu, monnaie non rendue | — | Le client apparaît dans « Vous leur devez » → **Rendre l'argent** |
| **Remboursement reçu** d'un client | — | Réparti sur ses crédits, du plus ancien au plus récent |
| **Annuler** | Remis en stock si déjà remis | Remboursement maintenant ou plus tard |

### Caisse
Solde par compte (**Espèces**, **Wave**, total). **Dépense** = argent pris dans la caisse (motif + montant + compte), **Entrée** = apport, **Transfert** = retrait Wave ↔ espèces. Pour démarrer, enregistrez votre fond de caisse en **Entrée → Apport**.

### Stock, achats et bénéfice
- **Matières premières** (sucre, fleurs, bananes, huile, bouteilles…) : achetées une fois, utilisées sur plusieurs fabrications. Leur coût est réparti au prorata de la quantité utilisée.
- **Fabrication** = matières utilisées + autres dépenses du lot → coût par unité et bénéfice attendu.
- **Produits en vrac** (ex. caramels achetés 1 000 ou 2 000 et revendus sans les compter) : désactivez « Compter le stock » sur le produit et enregistrez chaque achat. Bénéfice = ventes − achats.

Les relances WhatsApp ajoutent l'indicatif 221 (Sénégal) aux numéros à 9 chiffres.

---

## 5. Sauvegardes

**Paramètres → Sauvegarder (JSON)** télécharge toutes vos données.

## Structure

```
Noecy_market/
├── index.html, sw.js, manifest*.webmanifest, icons/
├── css/style.css
├── js/config.js           ← clés Supabase + clé publique VAPID
├── js/db.js               ← accès aux données (local ou Supabase)
├── js/core.js             ← outils communs, notifications
├── js/shop.js             ← boutique client
├── js/admin*.js           ← espace gérante
├── js/app.js              ← routeur
└── supabase/
    ├── schema.sql, migration_v2.sql
    └── functions/notifier/index.ts   ← envoi des notifications push
```
