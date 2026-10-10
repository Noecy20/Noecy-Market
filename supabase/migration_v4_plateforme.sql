-- =====================================================================
-- Migration v4 : plateforme multi-boutiques
--  - plusieurs boutiques (vente de produits ou restaurant) dans la même application
--  - demandes de création payantes, validées par l'administrateur de la plateforme
--  - restaurants : menu du jour, portions par jour, visibilité, publication notifiée
--
-- À exécuter dans Supabase > SQL Editor APRÈS schema.sql, migration_v2.sql et
-- migration_v3_vendeurs.sql. Le script peut être relancé sans risque.
-- Les données existantes deviennent la boutique « noecy ».
--
-- Dans Supabase > Authentication > Sign In / Providers > Email :
--   - activer « Allow new users to sign up » (les futures boutiques créent leur compte)
--   - désactiver « Confirm email » (sinon chaque nouvelle boutique doit confirmer son e-mail)
-- Un compte créé ne donne accès à rien tant que sa boutique n'est pas validée.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Réglages de la plateforme (lecture publique, écriture administrateur)
-- ---------------------------------------------------------------------
create table if not exists plateforme (
  cle    text primary key,
  valeur jsonb
);
alter table plateforme enable row level security;
drop policy if exists lecture_publique on plateforme;
create policy lecture_publique on plateforme for select to anon, authenticated using (true);
drop policy if exists admin_tout on plateforme;
create policy admin_tout on plateforme for all to authenticated using (est_admin()) with check (est_admin());

insert into plateforme (cle, valeur) values
  ('nom', '"Mon Marché"'),
  ('slogan', '"Les boutiques et restaurants de chez nous, en un seul endroit."'),
  ('prix_creation', '10000'),
  ('wave_lien', '""'),
  ('whatsapp', '""'),
  ('devise', '"FCFA"')
on conflict (cle) do nothing;

-- ---------------------------------------------------------------------
-- Boutiques et membres
-- ---------------------------------------------------------------------
create table if not exists boutiques (
  id                 text primary key default gen_random_uuid()::text,
  slug               text not null unique,
  nom                text not null,
  type               text not null default 'produits' check (type in ('produits', 'restaurant')),
  statut             text not null default 'en_attente' check (statut in ('en_attente', 'active', 'refusee', 'suspendue')),
  proprietaire_id    uuid,
  email              text,
  responsable        text,
  telephone          text,
  ville              text,
  description        text,
  logo               text,
  couleur            text default '#6d1b4f',
  prefixe            text not null default 'CMD',
  compteur           int  not null default 0,
  paiement_montant   numeric not null default 0,
  paiement_ref       text,
  paiement_valide    boolean not null default false,
  paiement_valide_at timestamptz,
  motif_refus        text,
  created_at         timestamptz default now(),
  validee_at         timestamptz
);

create table if not exists membres (
  user_id     uuid not null,
  boutique_id text not null references boutiques(id) on delete cascade,
  role        text not null default 'proprietaire' check (role in ('proprietaire', 'gerant')),
  email       text,
  created_at  timestamptz default now(),
  primary key (user_id, boutique_id)
);

-- Noecy Market devient la première boutique (numérotation des commandes conservée)
insert into boutiques (id, slug, nom, type, statut, prefixe, compteur, paiement_valide, couleur, validee_at, description)
values ('noecy', 'noecy',
        coalesce((select valeur #>> '{}' from parametres where cle = 'nom_boutique' limit 1), 'Noecy Market'),
        'produits', 'active', 'CMD',
        coalesce((select last_value::int from commande_seq), 0),
        true, '#6d1b4f', now(),
        coalesce((select valeur #>> '{}' from parametres where cle = 'slogan' limit 1), 'Jus, chips et douceurs faits maison.'))
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- Rattacher toutes les données à une boutique
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['categories','produits','clients','commandes','fabrications','ecritures',
                           'matieres','achats','vendeurs','parametres','abonnements_push'] loop
    execute format('alter table %I add column if not exists boutique_id text references boutiques(id) on delete cascade', t);
    execute format('update %I set boutique_id = %L where boutique_id is null', t, 'noecy');
    execute format('create index if not exists %I on %I (boutique_id)', t || '_boutique_idx', t);
  end loop;
end $$;

-- Valeurs par défaut pour les nouvelles lignes (les écrans envoient toujours la boutique)
do $$
declare t text;
begin
  foreach t in array array['categories','produits','clients','commandes','fabrications','ecritures',
                           'matieres','achats','vendeurs','parametres'] loop
    execute format('alter table %I alter column boutique_id set not null', t);
  end loop;
end $$;

-- Paramètres : une valeur par boutique
alter table parametres alter column boutique_id set not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'parametres_pkey' and array_length(conkey, 1) = 2) then
    alter table parametres drop constraint if exists parametres_pkey;
    alter table parametres add constraint parametres_pkey primary key (boutique_id, cle);
  end if;
end $$;

-- Notifications : un même téléphone peut suivre plusieurs boutiques
alter table abonnements_push drop constraint if exists abonnements_push_endpoint_key;
alter table abonnements_push drop constraint if exists abonnements_push_role_check;
alter table abonnements_push add constraint abonnements_push_role_check check (role in ('admin', 'client', 'super'));
drop index if exists abonnements_push_unique;
create unique index if not exists abonnements_push_unique on abonnements_push (endpoint, role, boutique_id) nulls not distinct;

-- Commandes : étapes de cuisine et informations restaurant
alter table commandes drop constraint if exists commandes_statut_check;
alter table commandes add constraint commandes_statut_check
  check (statut in ('en_attente', 'reservee', 'preparation', 'prete', 'payee', 'credit', 'annulee'));
alter table commandes add column if not exists mode_retrait text;   -- sur_place | emporter | livraison
alter table commandes add column if not exists adresse text;
alter table commandes add column if not exists menu_date date;

-- ---------------------------------------------------------------------
-- Restaurants : menu du jour
-- ---------------------------------------------------------------------
create table if not exists menus (
  id          text primary key default gen_random_uuid()::text,
  boutique_id text not null references boutiques(id) on delete cascade,
  date        date not null,
  publie      boolean not null default false,
  publie_at   timestamptz,
  note        text,
  created_at  timestamptz default now(),
  unique (boutique_id, date)
);

create table if not exists menu_items (
  id          text primary key default gen_random_uuid()::text,
  menu_id     text not null references menus(id) on delete cascade,
  boutique_id text not null references boutiques(id) on delete cascade,
  produit_id  text not null references produits(id) on delete cascade,
  quantite    int,                       -- portions du jour (vide = sans limite)
  reserve     int not null default 0,    -- portions déjà commandées
  visible     boolean not null default true,
  ordre       int not null default 0,
  created_at  timestamptz default now(),
  unique (menu_id, produit_id)
);

-- ---------------------------------------------------------------------
-- Droits
-- ---------------------------------------------------------------------
-- Administrateur de la plateforme, ou membre d'une boutique active
create or replace function peut_gerer(p_boutique text) returns boolean
language sql stable security definer set search_path = public as $$
  select est_admin() or exists (
    select 1 from membres m join boutiques b on b.id = m.boutique_id
    where m.user_id = auth.uid() and m.boutique_id = p_boutique and b.statut = 'active');
$$;

create or replace function boutique_active(p_boutique text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from boutiques where id = p_boutique and statut = 'active');
$$;

do $$
declare t text;
begin
  foreach t in array array['categories','produits','clients','commandes','fabrications','ecritures',
                           'matieres','achats','vendeurs','parametres','abonnements_push','menus','menu_items'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists gerante_tout on %I', t);
    execute format('drop policy if exists gestion on %I', t);
    execute format('create policy gestion on %I for all to authenticated using (peut_gerer(boutique_id)) with check (peut_gerer(boutique_id))', t);
  end loop;
end $$;

-- Lecture publique : seulement les boutiques actives
drop policy if exists lecture_publique on categories;
create policy lecture_publique on categories for select to anon, authenticated using (boutique_active(boutique_id));
drop policy if exists lecture_publique on produits;
create policy lecture_publique on produits for select to anon, authenticated using (actif and boutique_active(boutique_id));
drop policy if exists lecture_publique on parametres;
create policy lecture_publique on parametres for select to anon, authenticated using (boutique_active(boutique_id));
drop policy if exists lecture_publique on menus;
create policy lecture_publique on menus for select to anon, authenticated using (publie and boutique_active(boutique_id));
drop policy if exists lecture_publique on menu_items;
create policy lecture_publique on menu_items for select to anon, authenticated
  using (visible and boutique_active(boutique_id) and exists (select 1 from menus m where m.id = menu_id and m.publie));

alter table boutiques enable row level security;
alter table membres enable row level security;
drop policy if exists lecture on boutiques;
create policy lecture on boutiques for select to authenticated
  using (est_admin() or proprietaire_id = auth.uid() or peut_gerer(id));
drop policy if exists modification on boutiques;
create policy modification on boutiques for update to authenticated using (peut_gerer(id)) with check (peut_gerer(id));
drop policy if exists suppression on boutiques;
create policy suppression on boutiques for delete to authenticated using (est_admin());
drop policy if exists lecture on membres;
create policy lecture on membres for select to authenticated using (est_admin() or user_id = auth.uid());
drop policy if exists admin_tout on membres;
create policy admin_tout on membres for all to authenticated using (est_admin()) with check (est_admin());

-- Une boutique ne peut pas changer elle-même son statut, son paiement ou son adresse
-- (exécutée avec les droits de l'appelant : les fonctions internes, propriétaires du schéma, passent)
create or replace function trg_boutique_protege() returns trigger
language plpgsql set search_path = public as $$
begin
  if not est_admin() and current_user not in ('postgres', 'supabase_admin', 'service_role') then
    if new.statut is distinct from old.statut or new.paiement_valide is distinct from old.paiement_valide
       or new.paiement_montant is distinct from old.paiement_montant or new.slug is distinct from old.slug
       or new.type is distinct from old.type or new.proprietaire_id is distinct from old.proprietaire_id
       or new.prefixe is distinct from old.prefixe then
      raise exception 'Modification réservée à l''administrateur de la plateforme.';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists boutique_protege on boutiques;
create trigger boutique_protege before update on boutiques for each row execute function trg_boutique_protege();

-- ---------------------------------------------------------------------
-- Vitrine et demandes de boutique
-- ---------------------------------------------------------------------
create or replace function liste_boutiques() returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object(
    'id', id, 'slug', slug, 'nom', nom, 'type', type, 'ville', ville, 'description', description,
    'logo', logo, 'couleur', couleur) order by validee_at), '[]'::json)
  from boutiques where statut = 'active';
$$;

create or replace function boutique_publique(p_slug text) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'id', b.id, 'slug', b.slug, 'nom', b.nom, 'type', b.type, 'ville', b.ville, 'description', b.description,
    'logo', b.logo, 'couleur', b.couleur, 'statut', b.statut)
  from boutiques b where lower(b.slug) = lower(p_slug) or b.id = p_slug limit 1;
$$;

-- Adresse courte unique à partir du nom (« Ama Food » → « ama-food »)
create or replace function slug_unique(p_nom text) returns text
language plpgsql stable security definer set search_path = public as $$
declare base text; s text; i int := 1;
begin
  base := lower(regexp_replace(translate(coalesce(p_nom, 'boutique'),
            'àâäáãçéèêëíìîïñóòôöõúùûüýÿÀÂÄÁÃÇÉÈÊËÍÌÎÏÑÓÒÔÖÕÚÙÛÜÝ', 'aaaaaceeeeiiiinooooouuuuyyAAAAACEEEEIIIINOOOOOUUUUY'),
            '[^a-zA-Z0-9]+', '-', 'g'));
  base := trim(both '-' from left(base, 30));
  if base = '' then base := 'boutique'; end if;
  s := base;
  while exists (select 1 from boutiques where slug = s) loop
    i := i + 1; s := base || '-' || i;
  end loop;
  return s;
end $$;

-- Demande de création (le compte vient d'être créé par l'e-mail et le mot de passe)
create or replace function demander_boutique(
  p_nom text, p_type text, p_responsable text, p_telephone text, p_ville text, p_description text, p_paiement_ref text)
returns json language plpgsql security definer set search_path = public as $$
declare b boutiques; v_prix numeric;
begin
  if auth.uid() is null then raise exception 'Connectez-vous d''abord.'; end if;
  if length(trim(coalesce(p_nom, ''))) < 2 then raise exception 'Le nom de la boutique est obligatoire.'; end if;
  if p_type not in ('produits', 'restaurant') then raise exception 'Type de boutique invalide.'; end if;
  if length(regexp_replace(coalesce(p_telephone, ''), '\D', '', 'g')) < 8 then raise exception 'Le téléphone est obligatoire.'; end if;
  if length(trim(coalesce(p_paiement_ref, ''))) < 3 then raise exception 'Indiquez la référence de votre paiement Wave.'; end if;
  select coalesce((valeur #>> '{}')::numeric, 0) into v_prix from plateforme where cle = 'prix_creation';
  insert into boutiques (slug, nom, type, statut, proprietaire_id, email, responsable, telephone, ville, description,
                         prefixe, paiement_montant, paiement_ref)
  values (slug_unique(p_nom), left(trim(p_nom), 60), p_type, 'en_attente', auth.uid(), auth.jwt() ->> 'email',
          left(trim(coalesce(p_responsable, '')), 80), left(trim(p_telephone), 30), left(trim(coalesce(p_ville, '')), 60),
          left(trim(coalesce(p_description, '')), 400),
          upper(left(regexp_replace(translate(p_nom, 'àâäéèêëîïôöùûüç', 'aaaeeeeiioouuuc'), '[^a-zA-Z]', '', 'g') || 'XXX', 3)),
          coalesce(v_prix, 0), left(trim(p_paiement_ref), 80))
  returning * into b;
  insert into membres (user_id, boutique_id, role, email) values (auth.uid(), b.id, 'proprietaire', auth.jwt() ->> 'email')
  on conflict do nothing;
  return json_build_object('id', b.id, 'slug', b.slug, 'statut', b.statut);
end $$;

-- Boutiques du compte connecté (y compris celles en attente)
create or replace function mes_boutiques() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'super', est_admin(),
    'boutiques', coalesce((select json_agg(json_build_object(
        'id', b.id, 'slug', b.slug, 'nom', b.nom, 'type', b.type, 'statut', b.statut, 'logo', b.logo, 'couleur', b.couleur,
        'paiement_valide', b.paiement_valide, 'motif_refus', b.motif_refus, 'created_at', b.created_at) order by b.created_at)
      from boutiques b
      where est_admin() or b.proprietaire_id = auth.uid()
         or exists (select 1 from membres m where m.boutique_id = b.id and m.user_id = auth.uid())), '[]'::json));
$$;

-- Validation par l'administrateur : la boutique devient visible et reçoit ses réglages de départ
create or replace function valider_boutique(p_boutique text) returns json
language plpgsql security definer set search_path = public as $$
declare b boutiques;
begin
  if not est_admin() then raise exception 'Accès refusé.'; end if;
  select * into b from boutiques where id = p_boutique for update;
  if not found then raise exception 'Boutique introuvable.'; end if;
  if not b.paiement_valide then raise exception 'Confirmez d''abord que le paiement a été reçu.'; end if;
  update boutiques set statut = 'active', validee_at = coalesce(validee_at, now()), motif_refus = null where id = b.id;
  insert into parametres (boutique_id, cle, valeur) values
    (b.id, 'nom_boutique', to_jsonb(b.nom)),
    (b.id, 'slogan', to_jsonb(coalesce(nullif(b.description, ''), 'Bienvenue chez ' || b.nom))),
    (b.id, 'whatsapp', to_jsonb(coalesce(b.telephone, ''))),
    (b.id, 'devise', '"FCFA"'),
    (b.id, 'seuil_defaut', '5'),
    (b.id, 'wave_lien', '""'),
    (b.id, 'message_relance', to_jsonb('Bonjour {nom}, petit rappel de ' || b.nom || ' : il reste {montant} à régler pour votre commande {numero}. Merci !'))
  on conflict (boutique_id, cle) do nothing;
  if not exists (select 1 from categories where boutique_id = b.id) then
    if b.type = 'restaurant' then
      insert into categories (boutique_id, nom, icone, couleur, ordre) values
        (b.id, 'Plats', 'soup', '#c26a26', 1), (b.id, 'Boissons', 'cup-soda', '#1c9a69', 2), (b.id, 'Desserts', 'cake', '#a02a6e', 3);
    else
      insert into categories (boutique_id, nom, icone, couleur, ordre) values (b.id, 'Produits', 'shopping-bag', coalesce(b.couleur, '#6d1b4f'), 1);
    end if;
  end if;
  return json_build_object('ok', true);
end $$;

-- Chiffres de chaque boutique pour l'administrateur (30 derniers jours)
create or replace function stats_plateforme() returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if not est_admin() then raise exception 'Accès refusé.'; end if;
  return (select coalesce(json_agg(json_build_object(
      'id', b.id,
      'commandes', (select count(*) from commandes c where c.boutique_id = b.id and c.created_at > now() - interval '30 days' and c.statut <> 'annulee'),
      'ca', (select coalesce(sum(total), 0) from commandes c where c.boutique_id = b.id and c.statut in ('payee', 'credit') and coalesce(c.confirmed_at, c.created_at) > now() - interval '30 days'),
      'clients', (select count(*) from clients c where c.boutique_id = b.id),
      'produits', (select count(*) from produits p where p.boutique_id = b.id and p.actif))), '[]'::json)
    from boutiques b);
end $$;

-- Numéro de commande propre à chaque boutique (NOE-0001, AMA-0001…)
create or replace function numero_commande(p_boutique text) returns text
language plpgsql security definer set search_path = public as $$
declare v text;
begin
  update boutiques set compteur = compteur + 1 where id = p_boutique
  returning prefixe || '-' || lpad(compteur::text, 4, '0') into v;
  if v is null then raise exception 'Boutique introuvable.'; end if;
  return v;
end $$;
revoke execute on function numero_commande(text) from public, anon, authenticated;

drop function if exists prochain_numero();
create or replace function prochain_numero(p_boutique text) returns text
language plpgsql security definer set search_path = public as $$
begin
  if not peut_gerer(p_boutique) then raise exception 'Accès refusé.'; end if;
  return numero_commande(p_boutique);
end $$;

-- ---------------------------------------------------------------------
-- Fonctions clients (par boutique)
-- ---------------------------------------------------------------------
drop function if exists inscrire_client(text, text);
create or replace function inscrire_client(p_boutique text, p_nom text, p_telephone text)
returns json language plpgsql security definer set search_path = public as $$
declare c clients; v_tel text := regexp_replace(coalesce(p_telephone, ''), '\D', '', 'g');
begin
  if not boutique_active(p_boutique) then raise exception 'Cette boutique n''est pas disponible.'; end if;
  if length(trim(coalesce(p_nom, ''))) < 2 then raise exception 'Le nom est obligatoire.'; end if;
  if length(v_tel) < 8 then raise exception 'Le numéro de téléphone est obligatoire.'; end if;
  if exists (select 1 from clients where boutique_id = p_boutique and statut <> 'refuse'
             and right(regexp_replace(coalesce(telephone, ''), '\D', '', 'g'), 9) = right(v_tel, 9)) then
    raise exception 'Ce numéro a déjà un compte. Utilisez « J''ai déjà un compte ».';
  end if;
  insert into clients (boutique_id, nom, telephone) values (p_boutique, left(trim(p_nom), 80), left(trim(p_telephone), 30))
  returning * into c;
  return json_build_object('id', c.id, 'token', c.token);
end $$;

drop function if exists connexion_client(text);
create or replace function connexion_client(p_boutique text, p_telephone text)
returns json language plpgsql security definer set search_path = public as $$
declare c clients; v_tel text := regexp_replace(coalesce(p_telephone, ''), '\D', '', 'g');
begin
  if length(v_tel) < 8 then return json_build_object('erreur', 'Numéro de téléphone invalide.'); end if;
  select * into c from clients
  where boutique_id = p_boutique and statut <> 'refuse'
    and right(regexp_replace(coalesce(telephone, ''), '\D', '', 'g'), 9) = right(v_tel, 9)
  order by created_at desc limit 1;
  if not found then return json_build_object('erreur', 'Aucun compte avec ce numéro dans cette boutique. Inscrivez-vous avec « Je suis nouveau ».'); end if;
  return json_build_object('id', c.id, 'token', c.token);
end $$;

-- Menu publié d'un restaurant pour une date (portions restantes)
create or replace function menu_publie(p_boutique text, p_date date default current_date)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object('id', m.id, 'date', m.date, 'note', m.note, 'publie_at', m.publie_at,
    'items', coalesce((select json_agg(json_build_object(
        'id', i.id, 'produit_id', i.produit_id, 'quantite', i.quantite,
        'restant', case when i.quantite is null then null else greatest(i.quantite - i.reserve, 0) end) order by i.ordre, p.nom)
      from menu_items i join produits p on p.id = i.produit_id and p.actif
      where i.menu_id = m.id and i.visible), '[]'::json))
  from menus m
  where m.boutique_id = p_boutique and m.date = coalesce(p_date, current_date) and m.publie and boutique_active(p_boutique);
$$;

-- Prochains menus publiés (aujourd'hui et jours suivants) pour les précommandes
create or replace function menus_a_venir(p_boutique text)
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(menu_publie(p_boutique, m.date) order by m.date), '[]'::json)
  from menus m where m.boutique_id = p_boutique and m.publie and m.date >= current_date and m.date < current_date + 7;
$$;

drop function if exists passer_commande(text, text, jsonb, text, text, date, text, jsonb);
create or replace function passer_commande(
  p_id text, p_token text, p_lignes jsonb, p_moyen text, p_note text default '',
  p_date date default null, p_heure text default null, p_repartition jsonb default null,
  p_mode text default null, p_adresse text default null)
returns json language plpgsql security definer set search_path = public as $$
declare
  c clients; b boutiques; p produits; cmd commandes; m menus; mi menu_items;
  l jsonb; q int;
  v_lignes jsonb := '[]'; v_total numeric := 0; v_date date;
begin
  select * into c from clients where id = p_id and token = p_token;
  if not found then raise exception 'Client inconnu.'; end if;
  if c.statut <> 'valide' then raise exception 'Votre nom doit être validé avant de commander.'; end if;
  select * into b from boutiques where id = c.boutique_id;
  if b.statut <> 'active' then raise exception 'Cette boutique n''est pas disponible.'; end if;
  if p_moyen not in ('wave', 'especes', 'mixte', 'credit') then raise exception 'Moyen de paiement invalide.'; end if;
  if p_date is not null and p_date < current_date then raise exception 'La date choisie est déjà passée.'; end if;
  if p_mode is not null and p_mode not in ('sur_place', 'emporter', 'livraison') then raise exception 'Mode de retrait invalide.'; end if;
  if p_mode = 'livraison' and length(trim(coalesce(p_adresse, ''))) < 3 then raise exception 'Indiquez l''adresse de livraison.'; end if;

  if b.type = 'restaurant' then
    -- Restaurant : on commande dans le menu publié du jour choisi, dans la limite des portions
    v_date := coalesce(p_date, current_date);
    select * into m from menus where boutique_id = b.id and date = v_date and publie;
    if not found then raise exception 'Le menu de ce jour n''est pas encore publié.'; end if;
    for l in select value from jsonb_array_elements(coalesce(p_lignes, '[]')) loop
      q := nullif(l ->> 'quantite', '')::int;
      if q is null or q <= 0 then continue; end if;
      select * into mi from menu_items where menu_id = m.id and produit_id = l ->> 'produit_id' and visible for update;
      if not found then raise exception 'Un plat n''est plus disponible.'; end if;
      select * into p from produits where id = mi.produit_id and actif;
      if not found then raise exception 'Un plat n''est plus disponible.'; end if;
      if mi.quantite is not null and mi.quantite - mi.reserve < q then
        raise exception 'Plus que % portion(s) de %.', greatest(mi.quantite - mi.reserve, 0), p.nom;
      end if;
      update menu_items set reserve = reserve + q where id = mi.id;
      v_lignes := v_lignes || jsonb_build_array(jsonb_build_object('produit_id', p.id, 'nom', p.nom, 'prix', p.prix, 'quantite', q));
      v_total := v_total + p.prix * q;
    end loop;
  else
    for l in select value from jsonb_array_elements(coalesce(p_lignes, '[]')) loop
      q := nullif(l ->> 'quantite', '')::int;
      if q is null or q <= 0 then continue; end if;
      select * into p from produits where id = l ->> 'produit_id' and boutique_id = b.id and actif;
      if not found then raise exception 'Un produit du panier n''est plus disponible.'; end if;
      if p.suivi_stock and p_date is null and p.stock < q then
        raise exception 'Stock insuffisant pour % (% disponible(s)). Choisissez une date de réservation.', p.nom, p.stock;
      end if;
      v_lignes := v_lignes || jsonb_build_array(jsonb_build_object('produit_id', p.id, 'nom', p.nom, 'prix', p.prix, 'quantite', q));
      v_total := v_total + p.prix * q;
    end loop;
  end if;

  if jsonb_array_length(v_lignes) = 0 then raise exception 'Votre panier est vide.'; end if;

  insert into commandes (boutique_id, numero, client_id, client_nom, lignes, total, moyen_paiement, note,
                         date_reservation, heure_reservation, repartition, mode_retrait, adresse, menu_date)
  values (b.id, numero_commande(b.id), c.id, c.nom, v_lignes, v_total, p_moyen, left(coalesce(p_note, ''), 500),
          case when b.type = 'restaurant' then v_date else p_date end, left(p_heure, 40), p_repartition,
          p_mode, left(nullif(trim(coalesce(p_adresse, '')), ''), 200),
          case when b.type = 'restaurant' then v_date else null end)
  returning * into cmd;
  return row_to_json(cmd);
end $$;

create or replace function mes_commandes(p_id text, p_token text)
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(x order by x.created_at desc), '[]'::json)
  from (
    select id, numero, lignes, total, moyen_paiement, statut, montant_paye, rendu,
           date_reservation, heure_reservation, mode_retrait, adresse, created_at
    from commandes
    where client_id = p_id
      and exists (select 1 from clients where id = p_id and token = p_token)
  ) x;
$$;

create or replace function abonner_push_client(p_id text, p_token text, p_sub jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare c clients;
begin
  select * into c from clients where id = p_id and token = p_token and statut <> 'refuse';
  if not found then return json_build_object('erreur', 'Client inconnu.'); end if;
  insert into abonnements_push (role, client_id, boutique_id, endpoint, p256dh, auth)
  values ('client', c.id, c.boutique_id, p_sub ->> 'endpoint', p_sub ->> 'p256dh', p_sub ->> 'auth')
  on conflict (endpoint, role, boutique_id) do update
    set client_id = excluded.client_id, p256dh = excluded.p256dh, auth = excluded.auth;
  return json_build_object('ok', true);
end $$;

-- Une commande de restaurant annulée libère ses portions
create or replace function trg_commande_menu() returns trigger
language plpgsql security definer set search_path = public as $$
declare l jsonb;
begin
  if new.menu_date is not null and new.statut = 'annulee' and old.statut is distinct from 'annulee' then
    for l in select value from jsonb_array_elements(new.lignes) loop
      update menu_items i set reserve = greatest(i.reserve - (l ->> 'quantite')::int, 0)
      from menus m where m.id = i.menu_id and m.boutique_id = new.boutique_id and m.date = new.menu_date and i.produit_id = l ->> 'produit_id';
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists commande_menu on commandes;
create trigger commande_menu after update on commandes for each row execute function trg_commande_menu();

-- ---------------------------------------------------------------------
-- Vendeurs : rattachés à leur boutique
-- ---------------------------------------------------------------------
create or replace function vendeur_donnees(p_id text, p_token text)
returns json language plpgsql stable security definer set search_path = public as $$
declare v vendeurs; voir boolean;
begin
  v := vendeur_verif(p_id, p_token);
  voir := coalesce((v.droits ->> 'voir_stock')::boolean, false);
  return json_build_object(
    'vendeur', json_build_object('id', v.id, 'nom', v.nom, 'telephone', v.telephone, 'droits', v.droits),
    'parametres', (select coalesce(json_object_agg(cle, valeur), '{}'::json) from parametres
                   where boutique_id = v.boutique_id and cle in ('nom_boutique', 'devise', 'wave_lien')),
    'categories', (select coalesce(json_agg(c order by c.ordre), '[]'::json) from categories c where c.boutique_id = v.boutique_id),
    'produits', (select coalesce(json_agg(json_build_object(
        'id', p.id, 'nom', p.nom, 'prix', p.prix, 'photo', p.photo, 'unite', p.unite, 'categorie_id', p.categorie_id,
        'suivi_stock', p.suivi_stock, 'stock', case when voir then p.stock else null end,
        'dispo', case when p.suivi_stock then greatest(p.stock, 0) else null end) order by p.nom), '[]'::json)
      from produits p where p.actif and p.boutique_id = v.boutique_id),
    'ventes', (select coalesce(json_agg(x order by x.created_at desc), '[]'::json) from (
        select id, numero, client_nom, client_telephone, lignes, total, statut, montant_paye, rendu, paiements, note, created_at
        from commandes where vendeur_id = v.id order by created_at desc limit 300) x),
    'ecritures', (select coalesce(json_agg(e order by e.date desc, e.created_at desc), '[]'::json) from (
        select id, date, libelle, type, categorie, compte, montant, created_at
        from ecritures where vendeur_id = v.id order by date desc, created_at desc limit 500) e)
  );
end $$;

create or replace function vendeur_vente(
  p_id text, p_token text, p_lignes jsonb, p_client_nom text, p_client_tel text,
  p_paiements jsonb, p_note text default '')
returns json language plpgsql security definer set search_path = public as $$
declare
  v vendeurs; p produits; cmd commandes; l jsonb; q int; px numeric;
  v_lignes jsonb := '[]'; v_total numeric := 0; v_cout numeric := 0;
  v_paye numeric := 0; v_pays jsonb := '[]'; pay jsonb; m numeric; k text;
  peut_prix boolean;
begin
  v := vendeur_verif(p_id, p_token);
  if not boutique_active(v.boutique_id) then raise exception 'La boutique n''est pas active.'; end if;
  peut_prix := coalesce((v.droits ->> 'prix')::boolean, false);
  for l in select value from jsonb_array_elements(coalesce(p_lignes, '[]')) loop
    q := nullif(l ->> 'quantite', '')::int;
    if q is null or q <= 0 then continue; end if;
    select * into p from produits where id = l ->> 'produit_id' and boutique_id = v.boutique_id and actif for update;
    if not found then raise exception 'Un produit n''est plus disponible.'; end if;
    if p.suivi_stock and p.stock < q then raise exception 'Stock insuffisant pour % (% disponible(s)).', p.nom, p.stock; end if;
    px := case when peut_prix and nullif(l ->> 'prix', '') is not null then greatest((l ->> 'prix')::numeric, 0) else p.prix end;
    if p.suivi_stock then
      update produits set stock = stock - q where id = p.id;
      v_cout := v_cout + q * cout_moyen(p.id);
    end if;
    v_lignes := v_lignes || jsonb_build_array(jsonb_build_object('produit_id', p.id, 'nom', p.nom, 'prix', px, 'quantite', q));
    v_total := v_total + px * q;
  end loop;
  if jsonb_array_length(v_lignes) = 0 then raise exception 'Ajoutez au moins un article.'; end if;

  for pay in select value from jsonb_array_elements(coalesce(p_paiements, '[]')) loop
    m := round(coalesce(nullif(pay ->> 'montant', '')::numeric, 0));
    k := coalesce(pay ->> 'compte', 'especes');
    if m <= 0 then continue; end if;
    if k not in ('especes', 'wave') then raise exception 'Compte de paiement invalide.'; end if;
    m := least(m, v_total - v_paye);
    if m <= 0 then continue; end if;
    v_paye := v_paye + m;
    v_pays := v_pays || jsonb_build_array(jsonb_build_object('date', now(), 'compte', k, 'montant', m));
  end loop;

  if v_paye < v_total then
    if not coalesce((v.droits ->> 'credit')::boolean, false) then
      raise exception 'Vous n''avez pas le droit de vendre à crédit : encaissez le montant complet.';
    end if;
    if length(trim(coalesce(p_client_nom, ''))) < 2 then raise exception 'Pour une vente à crédit, indiquez le nom du client.'; end if;
  end if;

  insert into commandes (boutique_id, numero, client_nom, client_telephone, vendeur_id, lignes, total, moyen_paiement, statut,
                         montant_paye, cout_revient, paiements, note, confirmed_at, livree_at, paid_at)
  values (v.boutique_id, numero_commande(v.boutique_id),
          coalesce(nullif(trim(p_client_nom), ''), 'Client de passage'), nullif(trim(coalesce(p_client_tel, '')), ''), v.id,
          v_lignes, v_total,
          case when v_paye = 0 then 'credit' when jsonb_array_length(v_pays) > 1 then 'mixte' else v_pays -> 0 ->> 'compte' end,
          case when v_paye >= v_total then 'payee' else 'credit' end,
          v_paye, v_cout, v_pays, left(coalesce(p_note, ''), 300), now(), now(),
          case when v_paye >= v_total then now() else null end)
  returning * into cmd;

  for pay in select value from jsonb_array_elements(v_pays) loop
    insert into ecritures (boutique_id, date, libelle, type, categorie, compte, montant, ref, vendeur_id)
    values (v.boutique_id, current_date, 'Vente ' || cmd.numero || ' – ' || cmd.client_nom, 'entree', 'vente', pay ->> 'compte', (pay ->> 'montant')::numeric, cmd.id, v.id);
  end loop;
  return row_to_json(cmd);
end $$;

create or replace function vendeur_encaisser(p_id text, p_token text, p_commande text, p_paiements jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare v vendeurs; c commandes; pay jsonb; m numeric; k text; v_reste numeric; v_pays jsonb := '[]'; v_ajout numeric := 0;
begin
  v := vendeur_verif(p_id, p_token);
  if not coalesce((v.droits ->> 'encaisser')::boolean, false) then raise exception 'Vous n''avez pas le droit d''encaisser les crédits.'; end if;
  select * into c from commandes where id = p_commande and vendeur_id = v.id for update;
  if not found then raise exception 'Vente introuvable.'; end if;
  if c.statut <> 'credit' then raise exception 'Cette vente n''est pas à crédit.'; end if;
  v_reste := c.total - (c.montant_paye - c.rendu);
  for pay in select value from jsonb_array_elements(coalesce(p_paiements, '[]')) loop
    m := round(coalesce(nullif(pay ->> 'montant', '')::numeric, 0)); k := coalesce(pay ->> 'compte', 'especes');
    if k not in ('especes', 'wave') then raise exception 'Compte de paiement invalide.'; end if;
    m := least(m, v_reste - v_ajout);
    if m <= 0 then continue; end if;
    v_ajout := v_ajout + m;
    v_pays := v_pays || jsonb_build_array(jsonb_build_object('date', now(), 'compte', k, 'montant', m));
    insert into ecritures (boutique_id, date, libelle, type, categorie, compte, montant, ref, vendeur_id)
    values (c.boutique_id, current_date, 'Remboursement crédit ' || c.numero || ' – ' || c.client_nom, 'entree', 'recouvrement', k, m, c.id, v.id);
  end loop;
  if v_ajout <= 0 then raise exception 'Saisissez un montant.'; end if;
  update commandes set
    montant_paye = montant_paye + v_ajout,
    paiements = coalesce(paiements, '[]') || v_pays,
    statut = case when montant_paye + v_ajout - rendu >= total then 'payee' else 'credit' end,
    paid_at = case when montant_paye + v_ajout - rendu >= total then now() else null end
  where id = c.id returning * into c;
  return row_to_json(c);
end $$;

create or replace function vendeur_annuler(p_id text, p_token text, p_commande text)
returns json language plpgsql security definer set search_path = public as $$
declare v vendeurs; c commandes; l jsonb; pay jsonb; v_paye numeric;
begin
  v := vendeur_verif(p_id, p_token);
  if not coalesce((v.droits ->> 'annuler')::boolean, false) then raise exception 'Vous n''avez pas le droit d''annuler une vente.'; end if;
  select * into c from commandes where id = p_commande and vendeur_id = v.id for update;
  if not found then raise exception 'Vente introuvable.'; end if;
  if c.statut = 'annulee' then raise exception 'Vente déjà annulée.'; end if;
  for l in select value from jsonb_array_elements(c.lignes) loop
    update produits set stock = stock + (l ->> 'quantite')::int where id = l ->> 'produit_id' and suivi_stock;
  end loop;
  v_paye := c.montant_paye - c.rendu;
  if v_paye > 0 then
    for pay in select value from jsonb_array_elements(coalesce(c.paiements, '[]')) loop
      insert into ecritures (boutique_id, date, libelle, type, categorie, compte, montant, ref, vendeur_id)
      values (c.boutique_id, current_date, 'Annulation ' || c.numero || ' – ' || c.client_nom, 'sortie', 'annulation', coalesce(pay ->> 'compte', 'especes'), (pay ->> 'montant')::numeric, c.id, v.id);
    end loop;
  end if;
  update commandes set statut = 'annulee', rendu = montant_paye where id = c.id returning * into c;
  return row_to_json(c);
end $$;

create or replace function admin_vendeur_code(p_vendeur text, p_code text)
returns json language plpgsql security definer set search_path = public, extensions as $$
begin
  if not exists (select 1 from vendeurs where id = p_vendeur and peut_gerer(boutique_id)) then return json_build_object('erreur', 'Accès refusé.'); end if;
  if coalesce(p_code, '') !~ '^\d{4,6}$' then return json_build_object('erreur', 'Le code doit contenir 4 à 6 chiffres.'); end if;
  update vendeurs set code_hash = crypt(p_code, gen_salt('bf')), token = gen_random_uuid()::text, essais = 0, bloque_jusqua = null
  where id = p_vendeur;
  return json_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------
create or replace function trg_commande_notif() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_titre text; v_corps text; v_vendeur text;
begin
  if tg_op = 'INSERT' then
    if new.vendeur_id is not null then
      select nom into v_vendeur from vendeurs where id = new.vendeur_id;
      perform notifier(jsonb_build_object(
        'cible', 'admins', 'boutique_id', new.boutique_id, 'tag', 'cmd-' || new.id, 'url', '/admin.html#/admin/pointsvente',
        'titre', 'Vente de ' || coalesce(v_vendeur, 'un vendeur'),
        'corps', (select string_agg((x ->> 'quantite') || ' × ' || (x ->> 'nom'), ', ') from jsonb_array_elements(new.lignes) x)
                 || ' · ' || montant_txt(new.total)));
    elsif not peut_gerer(new.boutique_id) then
      perform notifier(jsonb_build_object(
        'cible', 'admins', 'boutique_id', new.boutique_id, 'tag', 'cmd-' || new.id, 'url', '/admin.html#/admin/commandes',
        'titre', 'Nouvelle commande ' || new.numero,
        'corps', new.client_nom || ' · ' || montant_txt(new.total)
                 || case new.mode_retrait when 'livraison' then ' · livraison' when 'emporter' then ' · à emporter' when 'sur_place' then ' · sur place' else '' end
                 || case when new.date_reservation is not null and new.date_reservation <> current_date
                         then ' · pour le ' || to_char(new.date_reservation, 'DD/MM') else '' end));
    end if;
  elsif new.statut is distinct from old.statut and new.client_id is not null then
    v_titre := case new.statut
      when 'reservee'    then 'Commande acceptée'
      when 'preparation' then 'Commande en préparation'
      when 'prete'       then 'Votre commande est prête !'
      when 'payee'       then 'Commande ' || new.numero || ' réglée'
      when 'credit'      then 'Commande ' || new.numero || ' remise'
      when 'annulee'     then 'Commande ' || new.numero || ' annulée'
      else 'Commande ' || new.numero end;
    v_corps := case new.statut
      when 'reservee'    then 'Votre commande ' || new.numero || ' est acceptée'
                              || coalesce(' pour le ' || to_char(new.date_reservation, 'DD/MM'), '') || '.'
      when 'preparation' then 'Votre commande ' || new.numero || ' est en cuisine.'
      when 'prete'       then case new.mode_retrait when 'livraison' then 'Elle part en livraison.' else 'Vous pouvez venir la récupérer.' end
      when 'payee'       then 'Merci pour votre achat !'
      when 'credit'      then 'Reste à payer : ' || montant_txt(new.total - (new.montant_paye - new.rendu))
      when 'annulee'     then 'Contactez la boutique pour plus d''informations.'
      else '' end;
    perform notifier(jsonb_build_object('cible', 'client', 'client_id', new.client_id,
      'titre', v_titre, 'corps', v_corps, 'url', '/?b=' || (select slug from boutiques where id = new.boutique_id), 'tag', 'cmd-' || new.id));
  end if;
  return new;
end $$;

create or replace function trg_client_notif() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_slug text;
begin
  select slug into v_slug from boutiques where id = new.boutique_id;
  if tg_op = 'INSERT' then
    if not peut_gerer(new.boutique_id) then
      perform notifier(jsonb_build_object('cible', 'admins', 'boutique_id', new.boutique_id, 'url', '/admin.html#/admin/clients', 'tag', 'cli-' || new.id,
        'titre', 'Nouveau client à valider', 'corps', new.nom || coalesce(' · ' || new.telephone, '')));
    end if;
  elsif new.statut = 'valide' and old.statut is distinct from 'valide' then
    perform notifier(jsonb_build_object('cible', 'client', 'client_id', new.id, 'url', '/?b=' || v_slug,
      'titre', 'Compte validé', 'corps', 'Bienvenue ! Vous pouvez commander dès maintenant.'));
  end if;
  return new;
end $$;

create or replace function trg_boutique_notif() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.statut = 'en_attente' then
    perform notifier(jsonb_build_object('cible', 'super', 'url', '/admin.html#/admin/demandes', 'tag', 'bq-' || new.id,
      'titre', 'Nouvelle demande de boutique',
      'corps', new.nom || ' · ' || case new.type when 'restaurant' then 'restaurant' else 'boutique' end || ' · paiement ' || coalesce(new.paiement_ref, '?')));
  end if;
  return new;
end $$;
drop trigger if exists boutique_notif on boutiques;
create trigger boutique_notif after insert on boutiques for each row execute function trg_boutique_notif();

-- Menu publié : les clients du restaurant sont prévenus
create or replace function trg_menu_notif() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_nom text; v_slug text; v_plats text;
begin
  if new.publie and (tg_op = 'INSERT' or old.publie is distinct from true) then
    update menus set publie_at = now() where id = new.id and publie_at is null;
    select nom, slug into v_nom, v_slug from boutiques where id = new.boutique_id;
    select string_agg(p.nom, ', ' order by i.ordre, p.nom) into v_plats
    from menu_items i join produits p on p.id = i.produit_id where i.menu_id = new.id and i.visible;
    perform notifier(jsonb_build_object('cible', 'boutique_clients', 'boutique_id', new.boutique_id, 'url', '/?b=' || v_slug, 'tag', 'menu-' || new.id,
      'titre', v_nom || ' : ' || case when new.date = current_date then 'le menu du jour est en ligne' else 'menu du ' || to_char(new.date, 'DD/MM') || ' en ligne' end,
      'corps', coalesce(left(v_plats, 160), 'Découvrez les plats du jour.')));
  end if;
  return new;
end $$;
drop trigger if exists menu_notif on menus;
create trigger menu_notif after insert or update of publie on menus for each row execute function trg_menu_notif();
