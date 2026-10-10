-- =====================================================================
-- Noecy Market — migration v3 : points de vente (vendeurs)
-- Un vendeur vend la marchandise du stock Noecy Market pour son propre
-- compte : chaque vente baisse le stock Noecy, mais l'argent, les ventes
-- et les crédits sont à lui (sa propre caisse).
--
-- À exécuter dans Supabase > SQL Editor APRÈS migration_v2.sql.
-- Le script peut être relancé sans risque.
-- =====================================================================

create table if not exists vendeurs (
  id            text primary key default gen_random_uuid()::text,
  nom           text not null,
  telephone     text,
  code_hash     text,                                  -- code PIN (haché)
  token         text not null default gen_random_uuid()::text,
  actif         boolean not null default true,
  droits        jsonb not null default '{}',           -- credit, encaisser, annuler, voir_stock, prix
  essais        int not null default 0,
  bloque_jusqua timestamptz,
  note          text,
  created_at    timestamptz default now()
);

alter table commandes add column if not exists vendeur_id text references vendeurs(id) on delete set null;
alter table commandes add column if not exists client_telephone text;
alter table ecritures add column if not exists vendeur_id text references vendeurs(id) on delete set null;
create index if not exists commandes_vendeur_idx on commandes(vendeur_id);
create index if not exists ecritures_vendeur_idx on ecritures(vendeur_id);

alter table vendeurs enable row level security;
drop policy if exists gerante_tout on vendeurs;
create policy gerante_tout on vendeurs for all to authenticated using (est_admin()) with check (est_admin());

-- ---------------------------------------------------------------------
-- Outils internes
-- ---------------------------------------------------------------------
-- Vérifie l'accès d'un vendeur (identifiant + jeton) ; renvoie la ligne ou une erreur
create or replace function vendeur_verif(p_id text, p_token text)
returns vendeurs language plpgsql stable security definer set search_path = public as $$
declare v vendeurs;
begin
  select * into v from vendeurs where id = p_id and token = p_token;
  if not found then raise exception 'Session expirée : reconnectez-vous.'; end if;
  if not v.actif then raise exception 'Votre accès vendeur a été désactivé par Noecy Market.'; end if;
  return v;
end $$;
revoke execute on function vendeur_verif(text, text) from public, anon, authenticated;

-- Coût moyen d'une unité d'après les fabrications
create or replace function cout_moyen(p_produit text)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(cout_total) / nullif(sum(quantite), 0), 0) from fabrications where produit_id = p_produit;
$$;

-- ---------------------------------------------------------------------
-- Côté vendeur
-- ---------------------------------------------------------------------
create or replace function vendeur_connexion(p_telephone text, p_code text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v vendeurs; v_tel text := regexp_replace(coalesce(p_telephone, ''), '\D', '', 'g');
begin
  if length(v_tel) < 8 then return json_build_object('erreur', 'Numéro de téléphone invalide.'); end if;
  select * into v from vendeurs
  where right(regexp_replace(coalesce(telephone, ''), '\D', '', 'g'), 9) = right(v_tel, 9)
  order by created_at desc limit 1;
  if not found then return json_build_object('erreur', 'Aucun vendeur avec ce numéro.'); end if;
  if not v.actif then return json_build_object('erreur', 'Votre accès a été désactivé par Noecy Market.'); end if;
  if v.bloque_jusqua is not null and v.bloque_jusqua > now() then
    return json_build_object('erreur', 'Trop d''essais. Réessayez dans quelques minutes.');
  end if;
  if v.code_hash is null then return json_build_object('erreur', 'Aucun code défini : demandez votre code à Noecy Market.'); end if;
  if crypt(coalesce(p_code, ''), v.code_hash) <> v.code_hash then
    update vendeurs set
      essais = case when essais + 1 >= 5 then 0 else essais + 1 end,
      bloque_jusqua = case when essais + 1 >= 5 then now() + interval '15 minutes' else bloque_jusqua end
    where id = v.id;
    return json_build_object('erreur', 'Code incorrect.');
  end if;
  update vendeurs set essais = 0, bloque_jusqua = null where id = v.id;
  return json_build_object('id', v.id, 'token', v.token, 'nom', v.nom);
end $$;

-- Tout ce dont l'espace vendeur a besoin (sans jamais exposer les données de Noecy)
create or replace function vendeur_donnees(p_id text, p_token text)
returns json language plpgsql stable security definer set search_path = public as $$
declare v vendeurs; voir boolean;
begin
  v := vendeur_verif(p_id, p_token);
  voir := coalesce((v.droits ->> 'voir_stock')::boolean, false);
  return json_build_object(
    'vendeur', json_build_object('id', v.id, 'nom', v.nom, 'telephone', v.telephone, 'droits', v.droits),
    'parametres', (select coalesce(json_object_agg(cle, valeur), '{}'::json) from parametres where cle in ('nom_boutique', 'devise', 'wave_lien')),
    'categories', (select coalesce(json_agg(c order by c.ordre), '[]'::json) from categories c),
    'produits', (select coalesce(json_agg(json_build_object(
        'id', p.id, 'nom', p.nom, 'prix', p.prix, 'photo', p.photo, 'unite', p.unite, 'categorie_id', p.categorie_id,
        'suivi_stock', p.suivi_stock, 'stock', case when voir then p.stock else null end,
        'dispo', case when p.suivi_stock then greatest(p.stock, 0) else null end) order by p.nom), '[]'::json)
      from produits p where p.actif),
    'ventes', (select coalesce(json_agg(x order by x.created_at desc), '[]'::json) from (
        select id, numero, client_nom, client_telephone, lignes, total, statut, montant_paye, rendu, paiements, note, created_at
        from commandes where vendeur_id = v.id order by created_at desc limit 300) x),
    'ecritures', (select coalesce(json_agg(e order by e.date desc, e.created_at desc), '[]'::json) from (
        select id, date, libelle, type, categorie, compte, montant, created_at
        from ecritures where vendeur_id = v.id order by date desc, created_at desc limit 500) e)
  );
end $$;

-- Vente par un vendeur : stock Noecy déduit, argent dans la caisse du vendeur
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
  peut_prix := coalesce((v.droits ->> 'prix')::boolean, false);
  for l in select value from jsonb_array_elements(coalesce(p_lignes, '[]')) loop
    q := nullif(l ->> 'quantite', '')::int;
    if q is null or q <= 0 then continue; end if;
    select * into p from produits where id = l ->> 'produit_id' and actif for update;
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
    m := least(m, v_total - v_paye);          -- la monnaie rendue n'entre pas en caisse
    if m <= 0 then continue; end if;
    v_paye := v_paye + m;
    v_pays := v_pays || jsonb_build_array(jsonb_build_object('date', now(), 'compte', k, 'montant', m));
  end loop;

  if v_paye < v_total then
    if not coalesce((v.droits ->> 'credit')::boolean, false) then
      raise exception 'Vous n''avez pas le droit de vendre à crédit : encaissez le montant complet.';
    end if;
    if length(trim(coalesce(p_client_nom, ''))) < 2 then
      raise exception 'Pour une vente à crédit, indiquez le nom du client.';
    end if;
  end if;

  insert into commandes (numero, client_nom, client_telephone, vendeur_id, lignes, total, moyen_paiement, statut,
                         montant_paye, cout_revient, paiements, note, confirmed_at, livree_at, paid_at)
  values ('CMD-' || lpad(nextval('commande_seq')::text, 4, '0'),
          coalesce(nullif(trim(p_client_nom), ''), 'Client de passage'), nullif(trim(coalesce(p_client_tel, '')), ''), v.id,
          v_lignes, v_total,
          case when v_paye = 0 then 'credit' when jsonb_array_length(v_pays) > 1 then 'mixte' else v_pays -> 0 ->> 'compte' end,
          case when v_paye >= v_total then 'payee' else 'credit' end,
          v_paye, v_cout, v_pays, left(coalesce(p_note, ''), 300), now(), now(),
          case when v_paye >= v_total then now() else null end)
  returning * into cmd;

  for pay in select value from jsonb_array_elements(v_pays) loop
    insert into ecritures (date, libelle, type, categorie, compte, montant, ref, vendeur_id)
    values (current_date, 'Vente ' || cmd.numero || ' – ' || cmd.client_nom, 'entree', 'vente', pay ->> 'compte', (pay ->> 'montant')::numeric, cmd.id, v.id);
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
    insert into ecritures (date, libelle, type, categorie, compte, montant, ref, vendeur_id)
    values (current_date, 'Remboursement crédit ' || c.numero || ' – ' || c.client_nom, 'entree', 'recouvrement', k, m, c.id, v.id);
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
  -- Articles remis dans le stock Noecy
  for l in select value from jsonb_array_elements(c.lignes) loop
    update produits set stock = stock + (l ->> 'quantite')::int where id = l ->> 'produit_id' and suivi_stock;
  end loop;
  -- Argent rendu au client, sur les comptes où il avait été reçu
  v_paye := c.montant_paye - c.rendu;
  if v_paye > 0 then
    for pay in select value from jsonb_array_elements(coalesce(c.paiements, '[]')) loop
      insert into ecritures (date, libelle, type, categorie, compte, montant, ref, vendeur_id)
      values (current_date, 'Annulation ' || c.numero || ' – ' || c.client_nom, 'sortie', 'annulation', coalesce(pay ->> 'compte', 'especes'), (pay ->> 'montant')::numeric, c.id, v.id);
    end loop;
  end if;
  update commandes set statut = 'annulee', rendu = montant_paye where id = c.id returning * into c;
  return row_to_json(c);
end $$;

-- ---------------------------------------------------------------------
-- Côté gérante
-- ---------------------------------------------------------------------
create or replace function admin_vendeur_code(p_vendeur text, p_code text)
returns json language plpgsql security definer set search_path = public, extensions as $$
begin
  if not est_admin() then return json_build_object('erreur', 'Accès refusé.'); end if;
  if coalesce(p_code, '') !~ '^\d{4,6}$' then return json_build_object('erreur', 'Le code doit contenir 4 à 6 chiffres.'); end if;
  -- Nouveau code = nouveau jeton : les anciennes sessions du vendeur sont fermées
  update vendeurs set code_hash = crypt(p_code, gen_salt('bf')), token = gen_random_uuid()::text, essais = 0, bloque_jusqua = null
  where id = p_vendeur;
  if not found then return json_build_object('erreur', 'Vendeur introuvable.'); end if;
  return json_build_object('ok', true);
end $$;

-- Notification : les ventes des vendeurs sont signalées à la gérante avec leur nom
create or replace function trg_commande_notif() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_titre text; v_corps text; v_vendeur text;
begin
  if tg_op = 'INSERT' then
    if new.vendeur_id is not null then
      select nom into v_vendeur from vendeurs where id = new.vendeur_id;
      perform notifier(jsonb_build_object(
        'cible', 'admins', 'tag', 'cmd-' || new.id, 'url', '/admin.html#/admin/pointsvente',
        'titre', 'Vente de ' || coalesce(v_vendeur, 'un vendeur'),
        'corps', (select string_agg((x ->> 'quantite') || ' × ' || (x ->> 'nom'), ', ') from jsonb_array_elements(new.lignes) x)
                 || ' · ' || montant_txt(new.total)));
    elsif not est_admin() then
      perform notifier(jsonb_build_object(
        'cible', 'admins', 'tag', 'cmd-' || new.id, 'url', '/admin.html#/admin/commandes',
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
