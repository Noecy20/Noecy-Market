-- =====================================================================
-- Noecy Market — schéma Supabase (PostgreSQL)
-- À exécuter UNE fois dans Supabase > SQL Editor > New query > Run
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Gérantes autorisées (seuls ces e-mails ont accès à l'espace gérante)
-- ---------------------------------------------------------------------
create table if not exists admins (
  email text primary key
);

create or replace function est_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from admins
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- ---------------------------------------------------------------------
-- Tables métier
-- ---------------------------------------------------------------------
create table if not exists categories (
  id         text primary key default gen_random_uuid()::text,
  nom        text not null,
  icone      text default 'shopping-bag',
  couleur    text default '#6d1b4f',
  ordre      int  default 0,
  created_at timestamptz default now()
);

create table if not exists produits (
  id           text primary key default gen_random_uuid()::text,
  nom          text not null,
  categorie_id text references categories(id) on delete set null,
  prix         numeric not null default 0,
  photo        text,
  description  text,
  unite        text,
  stock        int  not null default 0,
  seuil_alerte int  not null default 5,
  actif        boolean not null default true,
  created_at   timestamptz default now()
);

create table if not exists clients (
  id         text primary key default gen_random_uuid()::text,
  nom        text not null,
  telephone  text,
  statut     text not null default 'en_attente'
             check (statut in ('en_attente', 'valide', 'refuse')),
  token      text not null default gen_random_uuid()::text,
  note       text,
  created_at timestamptz default now()
);

create sequence if not exists commande_seq;

create table if not exists commandes (
  id             text primary key default gen_random_uuid()::text,
  numero         text,
  client_id      text references clients(id) on delete set null,
  client_nom     text,
  lignes         jsonb not null default '[]',
  total          numeric not null default 0,
  moyen_paiement text,
  statut         text not null default 'en_attente'
                 check (statut in ('en_attente', 'payee', 'credit', 'annulee')),
  montant_paye   numeric not null default 0,
  cout_revient   numeric not null default 0,
  paiements      jsonb not null default '[]',
  note           text,
  created_at     timestamptz default now(),
  confirmed_at   timestamptz,
  paid_at        timestamptz
);

create table if not exists fabrications (
  id         text primary key default gen_random_uuid()::text,
  produit_id text references produits(id) on delete set null,
  date       date default current_date,
  quantite   int not null default 0,
  depenses   jsonb not null default '[]',
  cout_total numeric not null default 0,
  note       text,
  created_at timestamptz default now()
);

create table if not exists ecritures (
  id         text primary key default gen_random_uuid()::text,
  date       date default current_date,
  libelle    text not null,
  type       text not null check (type in ('entree', 'sortie')),
  categorie  text,
  montant    numeric not null default 0,
  ref        text,
  created_at timestamptz default now()
);

create table if not exists parametres (
  cle    text primary key,
  valeur jsonb
);

-- ---------------------------------------------------------------------
-- Sécurité (Row Level Security)
-- ---------------------------------------------------------------------
alter table admins       enable row level security;
alter table categories   enable row level security;
alter table produits     enable row level security;
alter table clients      enable row level security;
alter table commandes    enable row level security;
alter table fabrications enable row level security;
alter table ecritures    enable row level security;
alter table parametres   enable row level security;

do $$
declare t text;
begin
  foreach t in array array['categories','produits','clients','commandes','fabrications','ecritures','parametres'] loop
    execute format('drop policy if exists gerante_tout on %I', t);
    execute format('create policy gerante_tout on %I for all to authenticated using (est_admin()) with check (est_admin())', t);
  end loop;
end $$;

-- Lecture publique : catalogue + paramètres (lien Wave, WhatsApp…)
drop policy if exists lecture_publique on categories;
create policy lecture_publique on categories for select to anon, authenticated using (true);

drop policy if exists lecture_publique on produits;
create policy lecture_publique on produits for select to anon, authenticated using (actif);

drop policy if exists lecture_publique on parametres;
create policy lecture_publique on parametres for select to anon, authenticated using (true);

-- Les clients n'accèdent JAMAIS directement aux tables clients/commandes :
-- tout passe par les fonctions ci-dessous (vérification id + jeton secret).

-- ---------------------------------------------------------------------
-- Fonctions côté client
-- ---------------------------------------------------------------------
create or replace function inscrire_client(p_nom text, p_telephone text)
returns json language plpgsql security definer set search_path = public as $$
declare c clients;
begin
  if length(trim(coalesce(p_nom, ''))) < 2 then
    raise exception 'Le nom est obligatoire.';
  end if;
  insert into clients (nom, telephone)
  values (left(trim(p_nom), 80), nullif(left(trim(coalesce(p_telephone, '')), 30), ''))
  returning * into c;
  return json_build_object('id', c.id, 'token', c.token);
end $$;

create or replace function statut_client(p_id text, p_token text)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object('id', id, 'nom', nom, 'telephone', telephone, 'statut', statut)
  from clients where id = p_id and token = p_token;
$$;

create or replace function passer_commande(p_id text, p_token text, p_lignes jsonb, p_moyen text, p_note text default '')
returns json language plpgsql security definer set search_path = public as $$
declare
  c clients; p produits; cmd commandes;
  l jsonb; q int;
  v_lignes jsonb := '[]'; v_total numeric := 0;
begin
  select * into c from clients where id = p_id and token = p_token;
  if not found then raise exception 'Client inconnu.'; end if;
  if c.statut <> 'valide' then raise exception 'Votre nom doit être validé avant de commander.'; end if;
  if p_moyen not in ('wave', 'especes', 'credit') then raise exception 'Moyen de paiement invalide.'; end if;

  for l in select value from jsonb_array_elements(coalesce(p_lignes, '[]')) loop
    q := nullif(l ->> 'quantite', '')::int;
    if q is null or q <= 0 then continue; end if;
    select * into p from produits where id = l ->> 'produit_id' and actif;
    if not found then raise exception 'Un produit du panier n''est plus disponible.'; end if;
    if p.stock < q then raise exception 'Stock insuffisant pour % (% disponible(s)).', p.nom, p.stock; end if;
    v_lignes := v_lignes || jsonb_build_array(jsonb_build_object(
      'produit_id', p.id, 'nom', p.nom, 'prix', p.prix, 'quantite', q));
    v_total := v_total + p.prix * q;
  end loop;

  if jsonb_array_length(v_lignes) = 0 then raise exception 'Votre panier est vide.'; end if;

  insert into commandes (numero, client_id, client_nom, lignes, total, moyen_paiement, note)
  values ('CMD-' || lpad(nextval('commande_seq')::text, 4, '0'), c.id, c.nom, v_lignes, v_total, p_moyen, left(coalesce(p_note, ''), 500))
  returning * into cmd;
  return row_to_json(cmd);
end $$;

create or replace function mes_commandes(p_id text, p_token text)
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(x order by x.created_at desc), '[]'::json)
  from (
    select id, numero, lignes, total, moyen_paiement, statut, montant_paye, created_at
    from commandes
    where client_id = p_id
      and exists (select 1 from clients where id = p_id and token = p_token)
  ) x;
$$;

-- Numéro de commande pour les ventes saisies par la gérante
create or replace function prochain_numero()
returns text language plpgsql security definer set search_path = public as $$
begin
  if not est_admin() then raise exception 'Accès refusé.'; end if;
  return 'CMD-' || lpad(nextval('commande_seq')::text, 4, '0');
end $$;

-- ---------------------------------------------------------------------
-- Données initiales
-- ---------------------------------------------------------------------
insert into categories (id, nom, icone, couleur, ordre) values
  ('cat-jus',   'Jus',    'cup-soda', '#b0185f', 1),
  ('cat-chips', 'Chips',  'banana', '#e39b06', 2),
  ('cat-sucre', 'Sucrée', 'candy', '#b5652a', 3)
on conflict (id) do nothing;

insert into produits (id, nom, categorie_id, prix, unite, description) values
  ('p-bissap',      'Jus de Bissap',         'cat-jus',   500, 'Bouteille 50 cl', 'Jus de fleurs d''hibiscus fait maison, légèrement sucré et parfumé à la menthe. Servir bien frais.'),
  ('p-tomi',        'Jus de Tomi',           'cat-jus',   500, 'Bouteille 50 cl', 'Jus de tamarin (tomi) maison, acidulé et rafraîchissant.'),
  ('p-chips-mure',  'Chips banane mûre',     'cat-chips', 500, 'Sachet',          'Chips de banane mûre, naturellement sucrées et croustillantes.'),
  ('p-chips-verte', 'Chips banane non mûre', 'cat-chips', 500, 'Sachet',          'Chips de banane verte, salées et ultra croustillantes.'),
  ('p-caramel',     'Caramel',               'cat-sucre', 250, 'Sachet',          'Caramels maison fondants, préparés en petites quantités.')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- DERNIÈRE ÉTAPE : remplacez par VOTRE e-mail de gérante, puis exécutez
-- ---------------------------------------------------------------------
-- insert into admins (email) values ('votre.email@exemple.com');
--
-- ENSUITE : exécutez migration_v2.sql (nouvelles fonctionnalités).
