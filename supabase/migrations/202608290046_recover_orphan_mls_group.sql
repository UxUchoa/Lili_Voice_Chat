begin;

-- Um grupo MLS cujo dispositivo fundador foi revogado (ou cuja chave local se
-- perdeu, o que leva à revogação) ficava travado para sempre: `initialize_mls_group`
-- só criava o grupo quando ele não existia, então nenhum outro dispositivo
-- conseguia assumir e ninguém mais recebia Welcome. Na web isso acontece
-- sempre que a aba é fechada, porque a master key vive em sessionStorage.
--
-- Quando o fundador não está mais ativo, permitimos que o próximo dispositivo
-- refunde o grupo a partir da época zero. As mensagens antigas continuam
-- indecifráveis — elas já eram, pois nenhum dispositivo vivo tem a chave — mas
-- o canal volta a funcionar em vez de morrer.
create or replace function public.initialize_mls_group(p_channel_id uuid, p_device_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
  v_device public.devices%rowtype;
  v_group public.mls_groups%rowtype;
  v_founder_alive boolean;
begin
  if not public.has_channel_permission(p_channel_id, 1) then raise exception 'forbidden'; end if;
  select * into v_device from public.devices
  where id = p_device_id and user_id = auth.uid() and revoked_at is null;
  if not found then raise exception 'invalid device'; end if;

  insert into public.mls_groups(channel_id, founder_device_id)
  values(p_channel_id, p_device_id)
  on conflict(channel_id) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 1 then
    insert into public.mls_group_members(channel_id, device_id, user_id, mls_credential, joined_epoch)
    values(p_channel_id, v_device.id, v_device.user_id, v_device.mls_credential, 0);
    return true;
  end if;

  -- O grupo já existe. Travamos a linha para que dois dispositivos não tentem
  -- refundar ao mesmo tempo.
  select * into v_group from public.mls_groups
  where channel_id = p_channel_id
  for update;

  if v_group.founder_device_id = p_device_id then
    -- Este dispositivo é o fundador e ainda não tem estado local (aba nova
    -- antes do primeiro commit). Recriar o estado fundador é determinístico.
    return v_group.current_epoch = 0;
  end if;

  select exists(
    select 1 from public.devices
    where id = v_group.founder_device_id and revoked_at is null
  ) into v_founder_alive;
  if v_founder_alive then
    -- Fundador vivo: este dispositivo deve mesmo esperar o Welcome.
    return false;
  end if;

  delete from public.mls_group_events where channel_id = p_channel_id;
  delete from public.channel_key_envelopes where channel_id = p_channel_id;
  delete from public.mls_group_members where channel_id = p_channel_id;
  update public.mls_groups
  set founder_device_id = p_device_id, current_epoch = 0
  where channel_id = p_channel_id;
  insert into public.mls_group_members(channel_id, device_id, user_id, mls_credential, joined_epoch)
  values(p_channel_id, v_device.id, v_device.user_id, v_device.mls_credential, 0);
  return true;
end;
$$;

revoke all on function public.initialize_mls_group(uuid, uuid) from public, anon;
grant execute on function public.initialize_mls_group(uuid, uuid) to authenticated, service_role;

commit;
