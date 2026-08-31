begin;

-- ============================================================
-- O cargo @everyone voltou a ser editável
--
-- `can_manage_role` existe para proteger a hierarquia entre cargos e por isso
-- nega o cargo padrão de propósito: ninguém deve poder excluir, duplicar,
-- reordenar ou atribuir o @everyone. `update_role` reusava essa mesma checagem
-- e, com isso, *nenhuma* alteração no @everyone passava — nem cor, nem ícone,
-- nem permissões. Como o @everyone é justamente onde se define a linha de base
-- do servidor, o painel de cargos ficava inútil em servidores novos, que só
-- têm esse cargo.
--
-- Agora `update_role` faz a checagem certa para cada caso: hierarquia para os
-- cargos comuns, "administra cargos neste servidor" para o padrão. Nome e
-- exibição em separado continuam travados no @everyone, porque são identidade
-- de um cargo que todo mundo tem.
-- ============================================================

drop function if exists public.update_role(
  uuid, text, text, bigint, boolean, boolean, text
);

create function public.update_role(
  p_role_id uuid,
  p_name text,
  p_color text,
  p_permissions bigint,
  p_hoist boolean,
  p_mentionable boolean,
  p_unicode_emoji text default null
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role public.roles%rowtype;
  v_actor_permissions bigint;
  v_after_name text;
  v_after_emoji text;
  v_after_hoist boolean;
begin
  select * into v_role from public.roles where id = p_role_id;
  if not found then raise exception 'forbidden'; end if;

  if v_role.is_default then
    -- 16384 = MANAGE_ROLES.
    if not (
      public.is_server_owner(v_role.server_id)
      or public.has_server_permission(v_role.server_id, 16384)
    ) then
      raise exception 'forbidden';
    end if;
  elsif not public.can_manage_role(p_role_id) then
    raise exception 'forbidden';
  end if;

  v_actor_permissions := public.effective_server_permissions(v_role.server_id);
  if not public.is_server_owner(v_role.server_id)
     and (p_permissions & ~v_actor_permissions) <> 0 then
    raise exception 'cannot grant unowned permissions';
  end if;

  v_after_name := case
    when v_role.is_default then v_role.name
    else left(trim(coalesce(p_name, '')), 100)
  end;
  if char_length(v_after_name) < 1 then
    raise exception 'invalid role name';
  end if;
  v_after_emoji := nullif(trim(coalesce(p_unicode_emoji, '')), '');
  if v_after_emoji is not null and char_length(v_after_emoji) > 32 then
    raise exception 'role icon is too long';
  end if;
  v_after_hoist := case when v_role.is_default then false else p_hoist end;

  update public.roles set
    name = v_after_name,
    color = p_color,
    permissions = p_permissions,
    unicode_emoji = v_after_emoji,
    hoist = v_after_hoist,
    mentionable = p_mentionable
  where id = p_role_id;

  perform public.write_audit(
    v_role.server_id,
    'ROLE_UPDATE',
    'ROLE',
    p_role_id,
    jsonb_build_object(
      'before', jsonb_build_object(
        'name', v_role.name,
        'color', v_role.color,
        'permissions', v_role.permissions::text,
        'icon', v_role.unicode_emoji,
        'hoist', v_role.hoist,
        'mentionable', v_role.mentionable
      ),
      'after', jsonb_build_object(
        'name', v_after_name,
        'color', p_color,
        'permissions', p_permissions::text,
        'icon', v_after_emoji,
        'hoist', v_after_hoist,
        'mentionable', p_mentionable
      )
    )
  );
end;
$$;

revoke all on function public.update_role(
  uuid, text, text, bigint, boolean, boolean, text
) from public, anon, authenticated;
grant execute on function public.update_role(
  uuid, text, text, bigint, boolean, boolean, text
) to authenticated;

commit;
