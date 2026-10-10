# Plateforme de boutiques et restaurants

Application web où plusieurs commerçants ont chacun leur boutique en ligne. **Noecy Market** est la première boutique.

- **Vitrine** (`/`) : toutes les boutiques et restaurants validés, recherche, filtre par type, bouton « Créer ma boutique ».
- **Boutique** (`/?b=noecy`, `/?b=ama-food`…) : chaque commerce a son lien, ses produits, son logo et sa couleur.
- **Deux types** : *vente de produits* (stock, fabrication, réservations) et *restaurant* (menu du jour).
- **Création payante** : le commerçant remplit `#/creer`, paie les frais par Wave et indique la référence ; l'administrateur vérifie le paiement et valide.
- **Espace de gestion** (`/admin.html`) : chaque gérant gère sa boutique ; l'administrateur de la plateforme voit tout (vue d'ensemble, demandes, boutiques, réglages) et peut entrer dans n'importe quelle boutique.
- **Espace vendeur** (`/vendeur.html`) : points de vente d'une boutique.

Aucune installation : HTML + CSS + JavaScript, aucune étape de build. Installable sur l'écran d'accueil du téléphone.

---

## 1. Essayer tout de suite (mode local)

Lancez `python3 -m http.server` dans ce dossier puis ouvrez http://localhost:8000.

Sans clés Supabase dans `js/config.js`, tout est enregistré dans le navigateur : parfait pour tester, mais **vos clients ne verront pas vos données depuis leur téléphone**.

Mode local : administrateur de la plateforme = identifiant **admin**, mot de passe **2012** (à changer dans Paramètres).

---

## 2. Mettre en ligne gratuitement

### a) La base de données : Supabase (gratuit)

1. Créez un projet sur https://supabase.com (région *Europe*).
2. **SQL Editor** → **New query** → collez `supabase/schema.sql` → **Run**.
3. Nouvelle requête → collez `supabase/migration_v2.sql` → **Run**, puis `supabase/migration_v3_vendeurs.sql`, `supabase/migration_v4_plateforme.sql` (plateforme multi-boutiques) et `supabase/migration_v5_options.sql` (accès des boutiques, suppression de compte) (caisse par compte, matières, réservations, connexion par numéro, notifications).
4. **Authentication → Users → Add user** : créez votre compte gérante (cochez *Auto Confirm User*), puis :
   ```sql
   insert into admins (email) values ('votre.email@exemple.com');
   ```
5. **Authentication → Sign In / Providers → Email** : laissez *Allow new users to sign up* **activé** (les futurs commerçants créent leur compte) et désactivez *Confirm email*. Un compte ne donne accès à rien tant que sa boutique n'est pas validée.
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

**GitHub Pages** (gratuit, depuis ce dépôt) : *Settings → Pages → Build and deployment → Source : Deploy from a branch → Branch : `main` / `(root)` → Save*.
Le site est alors à `https://noecy20.github.io/Noecy-Market/` et l'espace gérante à `https://noecy20.github.io/Noecy-Market/admin.html`. Chaque envoi sur `main` le met à jour en 1 à 2 minutes.

L'espace gérante est à l'adresse : `https://votre-site/admin.html` (à ajouter à l'écran d'accueil du téléphone : icône sombre « Noecy Gérante », séparée de la boutique).

---

## 3. La plateforme

### Créer une boutique (commerçant)
1. Vitrine → **Créer ma boutique** : type (produits ou restaurant), nom, ville, présentation, responsable, téléphone, e-mail et mot de passe.
2. Paiement des frais (montant et lien Wave réglés par l'administrateur), puis référence de la transaction.
3. La demande apparaît chez l'administrateur ; le commerçant voit « En attente » dans `admin.html`.

### Valider (administrateur)
**Demandes** → vérifier le paiement dans Wave → interrupteur **Paiement reçu** → **Valider et mettre en ligne** (message WhatsApp proposé). La boutique reçoit ses réglages et catégories de départ. **Boutiques** : suspendre, réactiver, gérer. **Réglages** : nom de la plateforme, frais de création, lien Wave, WhatsApp.

### Accès de chaque boutique (administrateur)
**Plateforme → Boutiques → Accès** (ou *Paramètres → Accès de la boutique*) :
- **Valider les nouveaux clients** : comme Noecy, chaque client doit être accepté avant de commander ; désactivé, il commande dès son inscription.
- **Paiement à crédit** : option « Payer plus tard » proposée ou non aux clients.
- **Livraison** (restaurants) et **Points de vente** (vendeurs).
Le gérant voit ses accès mais ne peut pas les modifier.

### Comptes clients
- Les clients voient toutes les boutiques (bouton en haut de chaque boutique, vitrine sur l'écran d'accueil) et choisissent où acheter. Leur nom et leur numéro sont pré-remplis quand ils s'inscrivent dans une nouvelle boutique.
- Pas de changement de compte : le client peut **se déconnecter** (puis revenir avec son numéro) ou **demander la suppression** de son compte. La boutique valide ou refuse dans **Clients → Suppressions** ; les commandes passées restent dans l'historique.

### Restaurant
- **Plats & carte** : la liste des plats (non comptés en stock).
- **Menu du jour** : choisir les plats du jour, le nombre de portions (vide = sans limite), masquer/afficher un plat, reprendre un menu précédent, préparer les jours suivants.
- **Publier** : le menu devient visible et les clients abonnés reçoivent une notification. Un plat passe « Épuisé » automatiquement ; une commande annulée libère ses portions.
- Les clients choisissent **sur place, à emporter ou livraison** (adresse obligatoire) et l'heure souhaitée.
- **Commandes** : À accepter → En cuisine → Prête (le client est prévenu) → Remise et encaissée. Tableau **Préparation en cuisine** par plat et bilan du jour.

Guide complet pour activer les notifications sur Android, iPhone et ordinateur : **[GUIDE_NOTIFICATIONS.md](GUIDE_NOTIFICATIONS.md)** (aussi disponible dans l'application).

## 4. Le lien de paiement Wave

Dans **Wave Business** : *Encaisser* → *Partager le lien de paiement*. Collez-le dans **Paramètres → Paiement Wave**.
Ajoutez `{montant}` pour pré-remplir le montant, par exemple `https://pay.wave.com/m/M_XXXX/c/sn/?amount={montant}`.

---

## 5. Comment ça marche

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

### Points de vente (vendeurs)
- Exécutez d'abord `supabase/migration_v3_vendeurs.sql` (après la v2).
- **Points de vente → Nouveau vendeur** : nom, téléphone, code PIN et droits (vendre à crédit, encaisser les crédits, annuler une vente, changer le prix, voir les quantités en stock). L'accès est envoyé par WhatsApp.
- Le vendeur utilise **`vendeur.html`** (icône verte « Noecy Vendeur » à mettre sur son écran d'accueil) : il vend, suit ses ventes, ses crédits et sa caisse.
- Chaque vente baisse le **stock Noecy**, mais l'argent, les ventes et les crédits sont **au vendeur** : ils n'entrent ni dans votre caisse ni dans vos commandes. Le coût de la marchandise sortie est déduit de votre bénéfice.
- Désactiver un vendeur coupe son accès immédiatement ; changer son code le déconnecte de ses autres appareils.

### Stock, achats et bénéfice
- **Matières premières** (sucre, fleurs, bananes, huile, bouteilles…) : achetées une fois, utilisées sur plusieurs fabrications. Leur coût est réparti au prorata de la quantité utilisée.
- **Fabrication** = matières utilisées + autres dépenses du lot → coût par unité et bénéfice attendu.
- **Produits en vrac** (ex. caramels achetés 1 000 ou 2 000 et revendus sans les compter) : désactivez « Compter le stock » sur le produit et enregistrez chaque achat. Bénéfice = ventes − achats.

Les relances WhatsApp ajoutent l'indicatif 221 (Sénégal) aux numéros à 9 chiffres.

---

## 6. Sauvegardes

**Paramètres → Sauvegarder (JSON)** télécharge toutes vos données.

## Structure

```
Noecy_market/
├── index.html, sw.js, manifest*.webmanifest, icons/
├── css/style.css
├── js/config.js           ← clés Supabase + clé publique VAPID
├── js/db.js               ← accès aux données (local ou Supabase)
├── js/core.js             ← outils communs, notifications
├── js/vitrine.js          ← vitrine et création de boutique
├── js/shop.js             ← boutique / restaurant (client)
├── js/admin*.js           ← espace gérante
├── js/app.js              ← routeur
└── supabase/
    ├── schema.sql, migration_v2.sql, migration_v3_vendeurs.sql, migration_v4_plateforme.sql
    └── functions/notifier/index.ts   ← envoi des notifications push
```
