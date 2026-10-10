# Recevoir les notifications

Une fois activées, les notifications arrivent sur le téléphone **même quand l'application est fermée**.
Ce guide existe aussi dans l'application : bouton **« Notifications »** (profil client) ou **Paramètres → Notifications → Guide** (gérants).

## Ce que chacun reçoit

| Qui | Notifications |
|---|---|
| **Client** | Compte validé · commande acceptée, en cuisine, prête, remise · menu du jour publié (restaurants) · rappel s'il reste un montant à payer |
| **Gérant de boutique** | Nouvelle commande ou réservation · nouveau client à valider · demande de suppression de compte · vente d'un vendeur · résumé chaque matin à 9 h |
| **Administrateur de la plateforme** | Nouvelle demande de boutique · résumé du matin |

## Activer sur un téléphone Android

1. Ouvrez le site dans **Chrome**.
2. Menu **⋮** (en haut à droite) → **« Ajouter à l'écran d'accueil »** ou **« Installer l'application »**.
3. Ouvrez l'application depuis la nouvelle icône.
4. Touchez **« Recevoir les notifications »** (client) ou **Paramètres → Notifications → Activer sur cet appareil** (gérant), puis **Autoriser**.

**Bloquées ?** Touchez le cadenas à gauche de l'adresse → *Autorisations* → *Notifications* → Autoriser. Dans les réglages du téléphone, autorisez aussi Chrome à fonctionner en arrière-plan (économiseur de batterie).

## Activer sur un iPhone

> Il faut **iOS 16.4 ou plus récent** et passer par l'écran d'accueil : Apple n'autorise pas les notifications des sites ouverts dans Safari.

1. Ouvrez le site dans **Safari** (pas Chrome).
2. Touchez **Partager** (carré avec une flèche) → **« Sur l'écran d'accueil »** → Ajouter.
3. Fermez Safari et ouvrez l'application **depuis la nouvelle icône**.
4. Touchez **« Recevoir les notifications »** ou **Activer sur cet appareil**, puis **Autoriser**.

**Bloquées ?** *Réglages* de l'iPhone → *Notifications* → choisissez l'application → *Autoriser les notifications*.

## Activer sur un ordinateur

1. Utilisez **Chrome**, **Edge** ou **Firefox**.
2. Cliquez sur **« Recevoir les notifications »** ou **Activer sur cet appareil**, puis **Autoriser**.

**Bloquées ?** Cadenas à gauche de l'adresse → *Notifications* → Autoriser, puis rechargez la page.

## Bon à savoir

- Chaque appareil s'active **une fois**. Après un changement de téléphone ou un effacement des données du navigateur, réactivez-les.
- Gérants : le bouton **Tester** (Paramètres → Notifications) envoie une notification d'essai sur vos appareils.
- Clients : les notifications sont liées à la boutique où vous les avez activées. Activez-les dans chaque boutique que vous suivez.

## Mise en service (une seule fois, administrateur de la plateforme)

Sans cette étape, aucune notification ne part, même si les téléphones sont activés.

1. Supabase → **Edge Functions** → *Deploy a new function* → *Via Editor* → nom **`notifier`** → collez `supabase/functions/notifier/index.ts` → **Deploy**.
2. **Edge Functions → Secrets** : ajoutez `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `NOECY_PUSH_SECRET` (valeurs dans le fichier privé `SECRETS_SUPABASE.local.txt`).
3. **SQL Editor** : exécutez le fichier privé `supabase/config_push.local.sql`.
4. Dans l'application : **Paramètres → Notifications → Activer sur cet appareil**, puis **Tester**.
