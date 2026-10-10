-- =====================================================================
-- Noecy Market — migration v2
-- Caisse par compte, matières premières, produits en vrac, réservations,
-- paiement mixte, connexion client par téléphone + code, notifications push.
--
-- À exécuter dans Supabase > SQL Editor APRÈS schema.sql.
-- Le script peut être relancé sans risque.
-- =====================================================================

-- Extensions (requêtes HTTP depuis la base + tâches planifiées)
do $$ begin create extension if not exists pg_net;  exception when others then raise notice 'pg_net : %', sqlerrm; end $$;
do $$ begin create extension if not exists pg_cron; exception when others then raise notice 'pg_cron : %', sqlerrm; end $$;

-- ---------------------------------------------------------------------
-- Colonnes ajoutées
-- ---------------------------------------------------------------------
alter table produits  add column if not exists suivi_stock boolean not null default true;

alter table clients   add column if not exists code_hash text;
alter table clients   add column if not exists essais int not null default 0;
alter table clients   add column if not exists bloque_jusqua timestamptz;

alter table commandes add column if not exists date_reservation date;
alter table commandes add column if not exists heure_reservation text;
alter table commandes add column if not exists repartition jsonb;
alter table commandes add column if not exists rendu numeric not null default 0;
alter table commandes add column if not exists livree_at timestamptz;
alter table commandes drop constraint if exists commandes_statut_check;
alter table commandes add constraint commandes_statut_check
  check (statut in ('en_attente', 'reservee', 'payee', 'credit', 'annulee'));

alter table ecritures add column if not exists compte text not null default 'especes';

alter table fabrications add column if not exists matieres jsonb not null default '[]';

-- Les caramels sont achetés et revendus sans être comptés
update produits set suivi_stock = false where id = 'p-caramel' and stock = 0;

-- ---------------------------------------------------------------------
-- Nouvelles tables
-- ---------------------------------------------------------------------
create table if not exists matieres (
  id         text primary key default gen_random_uuid()::text,
  nom        text not null,
  unite      text default 'unité',
  stock      numeric not null default 0,   -- quantité restante
  valeur     numeric not null default 0,   -- valeur du stock restant (coût d'achat)
  seuil      numeric not null default 0,
  created_at timestamptz default now()
);

create table if not exists achats (
  id         text primary key default gen_random_uuid()::text,
  matiere_id text references matieres(id) on delete set null,
  produit_id text references produits(id) on delete set null,
  date       date default current_date,
  quantite   numeric not null default 0,
  montant    numeric not null default 0,
  compte     text,
  note       text,
  created_at timestamptz default now()
);

create table if not exists abonnements_push (
  id         text primary key default gen_random_uuid()::text,
  role       text not null check (role in ('admin', 'client')),
  client_id  text references clients(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz default now()
);

-- Réglages privés (adresse de la fonction push, secret) : aucune lecture publique
create table if not exists config_privee (
  cle    text primary key,
  valeur text
);

alter table matieres         enable row level security;
alter table achats           enable row level security;
alter table abonnements_push enable row level security;
alter table config_privee    enable row level security;

do $$
declare t text;
begin
  foreach t in array array['matieres','achats','abonnements_push'] loop
    execute format('drop policy if exists gerante_tout on %I', t);
    execute format('create policy gerante_tout on %I for all to authenticated using (est_admin()) with check (est_admin())', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Fonctions côté client
-- ---------------------------------------------------------------------
drop function if exists inscrire_client(text, text);

create or replace function inscrire_client(p_nom text, p_telephone text, p_code text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare c clients; v_tel text := regexp_replace(coalesce(p_telephone, ''), '\D', '', 'g');
begin
  if length(trim(coalesce(p_nom, ''))) < 2 then raise exception 'Le nom est obligatoire.'; end if;
  if length(v_tel) < 8 then raise exception 'Le numéro de téléphone est obligatoire.'; end if;
  if coalesce(p_code, '') !~ '^\d{4,6}$' then raise exception 'Le code secret doit contenir 4 à 6 chiffres.'; end if;
  if exists (select 1 from clients
             where statut <> 'refuse'
               and right(regexp_replace(coalesce(telephone, ''), '\D', '', 'g'), 9) = right(v_tel, 9)) then
    raise exception 'Ce numéro a déjà un compte. Utilisez « J''ai déjà un compte ».';
  end if;
  insert into clients (nom, telephone, code_hash)
  values (left(trim(p_nom), 80), left(trim(p_telephone), 30), crypt(p_code, gen_salt('bf')))
  returning * into c;
  return json_build_object('id', c.id, 'token', c.token);
end $$;

-- Connexion depuis un autre appareil : téléphone + code secret.
-- Les échecs sont renvoyés en JSON (et non en exception) pour que le compteur d'essais soit enregistré.
create or replace function connexion_client(p_telephone text, p_code text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare c clients; v_tel text := regexp_replace(coalesce(p_telephone, ''), '\D', '', 'g');
begin
  if length(v_tel) < 8 then return json_build_object('erreur', 'Numéro de téléphone invalide.'); end if;
  select * into c from clients
  where statut <> 'refuse'
    and right(regexp_replace(coalesce(telephone, ''), '\D', '', 'g'), 9) = right(v_tel, 9)
  order by created_at desc limit 1;
  if not found then return json_build_object('erreur', 'Aucun compte avec ce numéro.'); end if;
  if c.bloque_jusqua is not null and c.bloque_jusqua > now() then
    return json_build_object('erreur', 'Trop d''essais. Réessayez dans quelques minutes.');
  end if;
  if c.code_hash is null then
    return json_build_object('erreur', 'Ce compte n''a pas encore de code. Demandez à Noecy votre lien de connexion.');
  end if;
  if crypt(coalesce(p_code, ''), c.code_hash) <> c.code_hash then
    update clients set
      essais = case when essais + 1 >= 5 then 0 else essais + 1 end,
      bloque_jusqua = case when essais + 1 >= 5 then now() + interval '15 minutes' else bloque_jusqua end
    where id = c.id;
    return json_build_object('erreur', 'Code incorrect.');
  end if;
  update clients set essais = 0, bloque_jusqua = null where id = c.id;
  return json_build_object('id', c.id, 'token', c.token);
end $$;

create or replace function definir_code_client(p_id text, p_token text, p_code text)
returns json language plpgsql security definer set search_path = public, extensions as $$
begin
  if coalesce(p_code, '') !~ '^\d{4,6}$' then return json_build_object('erreur', 'Le code secret doit contenir 4 à 6 chiffres.'); end if;
  update clients set code_hash = crypt(p_code, gen_salt('bf')) where id = p_id and token = p_token;
  if not found then return json_build_object('erreur', 'Client inconnu.'); end if;
  return json_build_object('ok', true);
end $$;

create or replace function admin_definir_code(p_client_id text, p_code text)
returns json language plpgsql security definer set search_path = public, extensions as $$
begin
  if not est_admin() then return json_build_object('erreur', 'Accès refusé.'); end if;
  if coalesce(p_code, '') !~ '^\d{4,6}$' then return json_build_object('erreur', 'Le code doit contenir 4 à 6 chiffres.'); end if;
  update clients set code_hash = crypt(p_code, gen_salt('bf')), essais = 0, bloque_jusqua = null where id = p_client_id;
  return json_build_object('ok', true);
end $$;

create or replace function statut_client(p_id text, p_token text)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'id', c.id, 'nom', c.nom, 'telephone', c.telephone, 'statut', c.statut,
    'a_code', c.code_hash is not null,
    'du', coalesce((select sum(greatest(o.total - (o.montant_paye - o.rendu), 0))
                    from commandes o where o.client_id = c.id and o.statut = 'credit'), 0))
  from clients c where c.id = p_id and c.token = p_token;
$$;

drop function if exists passer_commande(text, text, jsonb, text, text);

create or replace function passer_commande(
  p_id text, p_token text, p_lignes jsonb, p_moyen text, p_note text default '',
  p_date date default null, p_heure text default null, p_repartition jsonb default null)
returns json language plpgsql security definer set search_path = public as $$
declare
  c clients; p produits; cmd commandes;
  l jsonb; q int;
  v_lignes jsonb := '[]'; v_total numeric := 0;
begin
  select * into c from clients where id = p_id and token = p_token;
  if not found then raise exception 'Client inconnu.'; end if;
  if c.statut <> 'valide' then raise exception 'Votre nom doit être validé avant de commander.'; end if;
  if p_moyen not in ('wave', 'especes', 'mixte', 'credit') then raise exception 'Moyen de paiement invalide.'; end if;
  if p_date is not null and p_date < current_date then raise exception 'La date de réservation est déjà passée.'; end if;

  for l in select value from jsonb_array_elements(coalesce(p_lignes, '[]')) loop
    q := nullif(l ->> 'quantite', '')::int;
    if q is null or q <= 0 then continue; end if;
    select * into p from produits where id = l ->> 'produit_id' and actif;
    if not found then raise exception 'Un produit du panier n''est plus disponible.'; end if;
    -- Stock vérifié seulement pour une commande immédiate d'un produit compté
    if p.suivi_stock and p_date is null and p.stock < q then
      raise exception 'Stock insuffisant pour % (% disponible(s)). Choisissez une date de réservation.', p.nom, p.stock;
    end if;
    v_lignes := v_lignes || jsonb_build_array(jsonb_build_object(
      'produit_id', p.id, 'nom', p.nom, 'prix', p.prix, 'quantite', q));
    v_total := v_total + p.prix * q;
  end loop;

  if jsonb_array_length(v_lignes) = 0 then raise exception 'Votre panier est vide.'; end if;

  insert into commandes (numero, client_id, client_nom, lignes, total, moyen_paiement, note,
                         date_reservation, heure_reservation, repartition)
  values ('CMD-' || lpad(nextval('commande_seq')::text, 4, '0'), c.id, c.nom, v_lignes, v_total, p_moyen,
          left(coalesce(p_note, ''), 500), p_date, left(p_heure, 40), p_repartition)
  returning * into cmd;
  return row_to_json(cmd);
end $$;

create or replace function mes_commandes(p_id text, p_token text)
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(x order by x.created_at desc), '[]'::json)
  from (
    select id, numero, lignes, total, moyen_paiement, statut, montant_paye, rendu,
           date_reservation, heure_reservation, created_at
    from commandes
    where client_id = p_id
      and exists (select 1 from clients where id = p_id and token = p_token)
  ) x;
$$;

create or replace function abonner_push_client(p_id text, p_token text, p_sub jsonb)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from clients where id = p_id and token = p_token and statut <> 'refuse') then
    return json_build_object('erreur', 'Client inconnu.');
  end if;
  insert into abonnements_push (role, client_id, endpoint, p256dh, auth)
  values ('client', p_id, p_sub ->> 'endpoint', p_sub ->> 'p256dh', p_sub ->> 'auth')
  on conflict (endpoint) do update
    set role = 'client', client_id = excluded.client_id, p256dh = excluded.p256dh, auth = excluded.auth;
  return json_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------
-- Notifications : la base appelle la fonction Edge « notifier »
-- ---------------------------------------------------------------------
create or replace function notifier(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_url text; v_secret text; v_anon text;
begin
  select valeur into v_url    from config_privee where cle = 'push_url';
  select valeur into v_secret from config_privee where cle = 'push_secret';
  select valeur into v_anon   from config_privee where cle = 'anon_key';
  if coalesce(v_url, '') = '' then return; end if;
  perform net.http_post(
    url     := v_url,
    body    := p,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || coalesce(v_anon, ''),
      'x-noecy-secret', coalesce(v_secret, ''))
  );
exception when others then
  raise warning 'notifier : %', sqlerrm;  -- une notification ne doit jamais bloquer une commande
end $$;

revoke execute on function notifier(jsonb) from public, anon, authenticated;

create or replace function montant_txt(n numeric) returns text language sql immutable as $$
  select replace(to_char(round(coalesce(n, 0)), 'FM999,999,999,990'), ',', ' ') || ' FCFA';
$$;

create or replace function trg_commande_notif() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_titre text; v_corps text;
begin
  if tg_op = 'INSERT' then
    if not est_admin() then
      perform notifier(jsonb_build_object(
        'cible', 'admins', 'tag', 'cmd-' || new.id, 'url', '/#/admin/commandes',
        'titre', 'Nouvelle commande ' || new.numero,
        'corps', new.client_nom || ' · ' || montant_txt(new.total)
                 || case when new.date_reservation is not null
                         then ' · pour le ' || to_char(new.date_reservation, 'DD/MM') else '' end));
    end if;
  elsif new.statut is distinct from old.statut and new.client_id is not null then
    v_titre := case new.statut
      when 'reservee' then 'Réservation acceptée'
      when 'payee'    then 'Commande ' || new.numero || ' réglée'
      when 'credit'   then 'Commande ' || new.numero || ' livrée'
      when 'annulee'  then 'Commande ' || new.numero || ' annulée'
      else 'Commande ' || new.numero end;
    v_corps := case new.statut
      when 'reservee' then 'Votre commande ' || new.numero || ' est réservée'
                           || coalesce(' pour le ' || to_char(new.date_reservation, 'DD/MM'), '') || '.'
      when 'payee'    then 'Merci pour votre achat !'
      when 'credit'   then 'Reste à payer : ' || montant_txt(new.total - (new.montant_paye - new.rendu))
      when 'annulee'  then 'Contactez Noecy pour plus d''informations.'
      else '' end;
    perform notifier(jsonb_build_object('cible', 'client', 'client_id', new.client_id,
      'titre', v_titre, 'corps', v_corps, 'url', '/', 'tag', 'cmd-' || new.id));
  end if;
  return new;
end $$;

drop trigger if exists commande_notif on commandes;
create trigger commande_notif after insert or update on commandes
  for each row execute function trg_commande_notif();

create or replace function trg_client_notif() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if not est_admin() then
      perform notifier(jsonb_build_object('cible', 'admins', 'url', '/#/admin/clients', 'tag', 'cli-' || new.id,
        'titre', 'Nouveau client à valider', 'corps', new.nom || coalesce(' · ' || new.telephone, '')));
    end if;
  elsif new.statut = 'valide' and old.statut is distinct from 'valide' then
    perform notifier(jsonb_build_object('cible', 'client', 'client_id', new.id, 'url', '/',
      'titre', 'Compte validé', 'corps', 'Bienvenue chez Noecy Market ! Vous pouvez commander dès maintenant.'));
  end if;
  return new;
end $$;

drop trigger if exists client_notif on clients;
create trigger client_notif after insert or update on clients
  for each row execute function trg_client_notif();

-- Rappels quotidiens (crédits + résumé du jour pour la gérante), tous les jours à 9 h (heure de Dakar = UTC)
do $$
begin
  perform cron.unschedule('noecy-rappels') where exists (select 1 from cron.job where jobname = 'noecy-rappels');
  perform cron.schedule('noecy-rappels', '0 9 * * *', $c$ select notifier('{"type":"rappels"}'::jsonb) $c$);
exception when others then
  raise notice 'Planification des rappels impossible (pg_cron) : %', sqlerrm;
end $$;
