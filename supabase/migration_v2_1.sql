-- =====================================================================
-- Noecy Market — correctif v2.1
-- Les clients inscrits sans code secret se connectent avec leur numéro seul.
-- À exécuter dans Supabase > SQL Editor (après migration_v2.sql).
-- =====================================================================

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
  -- Compte inscrit avant les codes secrets : connexion avec le numéro seul (le client crée ensuite son code)
  if c.code_hash is null then
    return json_build_object('id', c.id, 'token', c.token, 'sans_code', true);
  end if;
  if coalesce(p_code, '') = '' then
    return json_build_object('erreur', 'Entrez votre code secret.', 'code_requis', true);
  end if;
  if crypt(p_code, c.code_hash) <> c.code_hash then
    update clients set
      essais = case when essais + 1 >= 5 then 0 else essais + 1 end,
      bloque_jusqua = case when essais + 1 >= 5 then now() + interval '15 minutes' else bloque_jusqua end
    where id = c.id;
    return json_build_object('erreur', 'Code incorrect.', 'code_requis', true);
  end if;
  update clients set essais = 0, bloque_jusqua = null where id = c.id;
  return json_build_object('id', c.id, 'token', c.token);
end $$;
