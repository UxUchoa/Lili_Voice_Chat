begin;

create or replace function public.initialize_mls_group(
  p_channel_id uuid,
  p_device_id uuid
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rows integer;
  v_device public.devices%rowtype;
  v_group public.mls_groups%rowtype;
begin
  if not public.has_channel_permission(p_channel_id, 1) then
    raise exception 'forbidden';
  end if;
  select * into v_device
  from public.devices
  where id = p_device_id and user_id = auth.uid() and revoked_at is null;
  if not found then raise exception 'invalid device'; end if;

  insert into public.mls_groups(channel_id, founder_device_id)
  values(p_channel_id, p_device_id)
  on conflict(channel_id) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 1 then
    insert into public.mls_group_members(
      channel_id, device_id, user_id, mls_credential, joined_epoch
    ) values (
      p_channel_id, v_device.id, v_device.user_id, v_device.mls_credential, 0
    );
    return true;
  end if;

  select * into v_group
  from public.mls_groups
  where channel_id = p_channel_id
  for update;

  -- Recuperação limitada a um grupo comprovadamente vazio e abandonado.
  -- Nunca troca fundador depois de mensagem, Welcome ou commit publicado.
  if v_group.current_epoch = 0
     and v_group.created_at < now() - interval '5 seconds'
     and not exists (
       select 1 from public.mls_group_events event
       where event.channel_id = p_channel_id
     )
     and not exists (
       select 1 from public.messages message
       where message.channel_id = p_channel_id
     )
     and not exists (
       select 1 from public.channel_key_envelopes envelope
       where envelope.channel_id = p_channel_id
     ) then
    update public.mls_groups
    set founder_device_id = p_device_id,
        created_at = now()
    where channel_id = p_channel_id;

    delete from public.mls_group_members
    where channel_id = p_channel_id;
    insert into public.mls_group_members(
      channel_id, device_id, user_id, mls_credential, joined_epoch
    ) values (
      p_channel_id, v_device.id, v_device.user_id, v_device.mls_credential, 0
    );
    return true;
  end if;

  return false;
end;
$$;

revoke all on function public.initialize_mls_group(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.initialize_mls_group(uuid, uuid)
  to authenticated;

commit;

