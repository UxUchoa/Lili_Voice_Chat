begin;

-- ============================================================
-- CRUD de categorias — item 9
--
-- Criar, renomear, mover canais e reordenar já existiam (`create_channel`,
-- `update_channel`, `move_channel_to_category`, `reorder_channel`). O que
-- faltava era excluir a categoria dizendo, de forma explícita, para onde vão
-- os canais dela.
-- ============================================================

-- ------------------------------------------------------------
-- Excluir categoria dizendo o que fazer com os canais
--
-- O `parent_id` já é `on delete set null`, então apagar a categoria nunca
-- apagou canal junto — o padrão sempre foi seguro. O que faltava era a
-- escolha ser **explícita**: quem exclui precisa dizer para onde vão os
-- canais, em vez de descobrir depois onde eles foram parar.
--
-- `DELETE_CHANNELS` existe porque às vezes é isso mesmo que se quer, mas ela
-- só apaga o que estava naquela categoria e nunca é o padrão.
-- ------------------------------------------------------------
create or replace function public.delete_category(
  p_category_id uuid,
  p_strategy text default 'UNCATEGORIZE',
  p_target_category_id uuid default null
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_server_id uuid;
  v_kind text;
  v_moved integer := 0;
  v_deleted integer := 0;
begin
  select server_id, kind into v_server_id, v_kind
  from public.channels where id = p_category_id;
  if v_server_id is null then raise exception 'category not found'; end if;
  if v_kind <> 'category' then raise exception 'not a category'; end if;
  if not (
    public.is_server_owner(v_server_id)
    or public.has_server_permission(v_server_id, 32768)
  ) then
    raise exception 'forbidden';
  end if;
  if p_strategy not in ('UNCATEGORIZE', 'MOVE_TO_CATEGORY', 'DELETE_CHANNELS')
  then
    raise exception 'invalid strategy';
  end if;

  if p_strategy = 'MOVE_TO_CATEGORY' then
    if p_target_category_id is null or p_target_category_id = p_category_id then
      raise exception 'invalid target category';
    end if;
    -- O destino precisa ser categoria do mesmo servidor: sem isto daria para
    -- mover canais para dentro de outro servidor passando um id qualquer.
    if not exists (
      select 1 from public.channels
      where id = p_target_category_id
        and server_id = v_server_id
        and kind = 'category'
    ) then
      raise exception 'invalid target category';
    end if;
    update public.channels
    set parent_id = p_target_category_id
    where parent_id = p_category_id;
    get diagnostics v_moved = row_count;
  elsif p_strategy = 'DELETE_CHANNELS' then
    delete from public.channels where parent_id = p_category_id;
    get diagnostics v_deleted = row_count;
  end if;
  -- `UNCATEGORIZE` não precisa de update: o `on delete set null` do
  -- `parent_id` faz exatamente isso quando a categoria sai.

  delete from public.channels where id = p_category_id;

  perform public.write_audit(
    v_server_id,
    'CHANNEL_DELETE',
    'CHANNEL',
    p_category_id,
    jsonb_build_object(
      'strategy', p_strategy,
      'moved', v_moved,
      'deleted', v_deleted
    )
  );
end $$;

revoke all on function public.delete_category(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.delete_category(uuid, text, uuid)
  to authenticated;

commit;
