-- =====================================================================
-- Migration v5 : accès réglables par boutique et suppression de compte client
--  - options de chaque boutique, décidées par l'administrateur de la plateforme :
--      validation_clients (les nouveaux clients doivent être validés), paiement_credit,
--      livraison (restaurants), points_vente
--  - un client ne change plus de compte : il demande la suppression, la boutique valide
--
-- À exécuter dans Supabase > SQL Editor APRÈS migration_v4_plateforme.sql.
-- Le script peut être relancé sans risque.
-- =====================================================================

alter table boutiques add column if not exists options jsonb not null default '{}';
alter table clients add column if not exists suppression_demandee_at timestamptz;
alter table clients add column if not exists suppression_motif text;

-- Les options ne peuvent être changées que par l'administrateur de la plateforme
create or replace function trg_boutique_protege() returns trigger
language plpgsql set search_path = public as $$
begin
  if not est_admin() and current_user not in ('postgres', 'supabase_admin', 'service_role') then
    if new.statut is distinct from old.statut or new.paiement_valide is distinct from old.paiement_valide
       or new.paiement_montant is distinct from old.paiement_montant or new.slug is distinct from old.slug
       or new.type is distinct from old.type or new.proprietaire_id is distinct from old.proprietaire_id
       or new.prefixe is distinct from old.prefixe or new.options is distinct from old.options then
      raise exception 'Modification réservée à l''administrateur de la plateforme.';
    end if;
  end if;
  return new;
end $$;

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
  -- Boutique sans validation des clients : le compte est utilisable tout de suite
  insert into clients (boutique_id, nom, telephone, statut)
  values (p_boutique, left(trim(p_nom), 80), left(trim(p_telephone), 30),
          case when coalesce((select (options ->> 'validation_clients')::boolean from boutiques where id = p_boutique), true) then 'en_attente' else 'valide' end)
  returning * into c;
  return json_build_object('id', c.id, 'token', c.token);
end $$;

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
  -- Accès réglés par l'administrateur de la plateforme
  if p_moyen = 'credit' and coalesce((b.options ->> 'paiement_credit')::boolean, true) = false then
    raise exception 'Le paiement à crédit n''est pas proposé par cette boutique.';
  end if;
  if p_mode = 'livraison' and coalesce((b.options ->> 'livraison')::boolean, true) = false then
    raise exception 'Cette boutique ne propose pas la livraison.';
  end if;

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

-- Vitrine et page boutique : les options servent à l'affichage (crédit, livraison…)
create or replace function liste_boutiques() returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object(
    'id', id, 'slug', slug, 'nom', nom, 'type', type, 'ville', ville, 'description', description,
    'logo', logo, 'couleur', couleur, 'options', options) order by validee_at), '[]'::json)
  from boutiques where statut = 'active';
$$;

create or replace function boutique_publique(p_slug text) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'id', b.id, 'slug', b.slug, 'nom', b.nom, 'type', b.type, 'ville', b.ville, 'description', b.description,
    'logo', b.logo, 'couleur', b.couleur, 'statut', b.statut, 'options', b.options)
  from boutiques b where lower(b.slug) = lower(p_slug) or b.id = p_slug limit 1;
$$;

create or replace function statut_client(p_id text, p_token text)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'id', c.id, 'nom', c.nom, 'telephone', c.telephone, 'statut', c.statut,
    'suppression_demandee_at', c.suppression_demandee_at,
    'du', coalesce((select sum(greatest(o.total - (o.montant_paye - o.rendu), 0))
                    from commandes o where o.client_id = c.id and o.statut = 'credit'), 0))
  from clients c where c.id = p_id and c.token = p_token;
$$;

-- Le client demande la suppression de son compte ; la boutique la valide (ou la refuse)
create or replace function demander_suppression(p_id text, p_token text, p_motif text default null)
returns json language plpgsql security definer set search_path = public as $$
begin
  update clients set suppression_demandee_at = coalesce(suppression_demandee_at, now()), suppression_motif = left(nullif(trim(coalesce(p_motif, '')), ''), 300)
  where id = p_id and token = p_token;
  if not found then return json_build_object('erreur', 'Client inconnu.'); end if;
  return json_build_object('ok', true);
end $$;

create or replace function annuler_suppression(p_id text, p_token text)
returns json language plpgsql security definer set search_path = public as $$
begin
  update clients set suppression_demandee_at = null, suppression_motif = null where id = p_id and token = p_token;
  if not found then return json_build_object('erreur', 'Client inconnu.'); end if;
  return json_build_object('ok', true);
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
  elsif new.suppression_demandee_at is not null and old.suppression_demandee_at is null then
    perform notifier(jsonb_build_object('cible', 'admins', 'boutique_id', new.boutique_id, 'url', '/admin.html#/admin/clients', 'tag', 'sup-' || new.id,
      'titre', 'Demande de suppression de compte', 'corps', new.nom || coalesce(' · ' || new.suppression_motif, '')));
  elsif new.statut = 'valide' and old.statut is distinct from 'valide' then
    perform notifier(jsonb_build_object('cible', 'client', 'client_id', new.id, 'url', '/?b=' || v_slug,
      'titre', 'Compte validé', 'corps', 'Bienvenue ! Vous pouvez commander dès maintenant.'));
  end if;
  return new;
end $$;
