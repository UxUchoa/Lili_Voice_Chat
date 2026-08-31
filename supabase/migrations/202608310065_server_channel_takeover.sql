begin;

-- ============================================================
-- Canal de servidor assume o grupo mesmo com par vivo
--
-- A migração anterior só assumia o grupo quando ninguém mais dava sinal. Não
-- bastou, e o motivo é o caso comum: o outro participante **está** online, mas
-- o cliente dele só publica Welcome quando faz alguma operação MLS naquele
-- canal. Alguém parado em outro canal, ou só com a aba aberta, conta como
-- "vivo" e não entrega nada — e quem chegou fica esperando indefinidamente uma
-- chave que ninguém vai mandar.
--
-- `p_allow_takeover` é o cliente dizendo que já esperou. Ele tenta primeiro
-- sem o sinalizador; se nenhum Welcome aparecer em alguns segundos, tenta de
-- novo com ele e assume o grupo. A espera existe para dar chance a quem
-- realmente está prestes a entregar; o limite existe porque um canal público
-- que não abre é um canal quebrado.
--
-- Continua valendo só para canal de servidor. Numa conversa privada, assumir o
-- grupo por conta própria trocaria a chave sem a outra pessoa participar — que
-- é exatamente o que o E2EE existe para impedir. Lá, esperar é a resposta
-- certa mesmo quando incomoda.
-- ============================================================

create or replace function public.initialize_mls_group(
  p_channel_id uuid,
  p_device_id uuid,
  p_allow_takeover boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_rows integer;
  v_device public.devices%rowtype;
  v_group public.mls_groups%rowtype;
  v_group_is_empty boolean;
  v_founder_alive boolean;
  v_is_server_channel boolean;
  v_peer_alive boolean;
begin
  if not public.has_channel_permission(p_channel_id, 1) then
    raise exception 'forbidden';
  end if;
  select * into v_device from public.devices
  where id = p_device_id and user_id = auth.uid() and revoked_at is null;
  if not found then raise exception 'invalid device'; end if;

  select kind not in ('dm', 'gdm') into v_is_server_channel
  from public.channels where id = p_channel_id;

  insert into public.mls_groups(channel_id, founder_device_id)
  values(p_channel_id, p_device_id)
  on conflict(channel_id) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 1 then
    insert into public.mls_group_members(channel_id, device_id, user_id, mls_credential, joined_epoch)
    values(p_channel_id, v_device.id, v_device.user_id, v_device.mls_credential, 0);
    return true;
  end if;

  select * into v_group from public.mls_groups
  where channel_id = p_channel_id
  for update;

  if exists (
    select 1 from public.mls_group_members
    where channel_id = p_channel_id
      and device_id = p_device_id
      and removed_epoch is null
  ) then
    return false;
  end if;

  v_group_is_empty :=
    v_group.current_epoch = 0
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
    );

  -- (1) Grupo vazio e abandonado: assumir não destrói nada.
  if v_group_is_empty and v_group.created_at < now() - interval '5 seconds' then
    update public.mls_groups
    set founder_device_id = p_device_id, created_at = now(), current_epoch = 0
    where channel_id = p_channel_id;
    delete from public.mls_group_members where channel_id = p_channel_id;
    insert into public.mls_group_members(channel_id, device_id, user_id, mls_credential, joined_epoch)
    values(p_channel_id, v_device.id, v_device.user_id, v_device.mls_credential, 0);
    return true;
  end if;

  -- (2) O fundador voltou sem estado local.
  if v_group.founder_device_id = p_device_id then
    if v_group_is_empty then
      return false;
    end if;
    delete from public.mls_group_events where channel_id = p_channel_id;
    delete from public.channel_key_envelopes where channel_id = p_channel_id;
    delete from public.mls_group_members where channel_id = p_channel_id;
    update public.mls_groups
    set created_at = now(), current_epoch = 0
    where channel_id = p_channel_id;
    insert into public.mls_group_members(channel_id, device_id, user_id, mls_credential, joined_epoch)
    values(p_channel_id, v_device.id, v_device.user_id, v_device.mls_credential, 0);
    return true;
  end if;

  -- (3) Canal de servidor: ninguém vivo para entregar, ou o cliente já esperou.
  if v_is_server_channel then
    select exists(
      select 1
      from public.mls_group_members member
      join public.devices device on device.id = member.device_id
      where member.channel_id = p_channel_id
        and member.removed_epoch is null
        and member.device_id <> p_device_id
        and device.revoked_at is null
        and device.last_seen_at > now() - interval '90 seconds'
    ) into v_peer_alive;

    if p_allow_takeover or not v_peer_alive then
      delete from public.mls_group_events where channel_id = p_channel_id;
      delete from public.channel_key_envelopes where channel_id = p_channel_id;
      delete from public.mls_group_members where channel_id = p_channel_id;
      update public.mls_groups
      set founder_device_id = p_device_id, created_at = now(), current_epoch = 0
      where channel_id = p_channel_id;
      insert into public.mls_group_members(channel_id, device_id, user_id, mls_credential, joined_epoch)
      values(p_channel_id, v_device.id, v_device.user_id, v_device.mls_credential, 0);
      return true;
    end if;
  end if;

  -- (4) Fundador ausente.
  select exists(
    select 1 from public.devices
    where id = v_group.founder_device_id
      and revoked_at is null
      and last_seen_at > now() - interval '3 minutes'
  ) into v_founder_alive;
  if v_founder_alive then return false; end if;

  delete from public.mls_group_events where channel_id = p_channel_id;
  delete from public.channel_key_envelopes where channel_id = p_channel_id;
  delete from public.mls_group_members where channel_id = p_channel_id;
  update public.mls_groups
  set founder_device_id = p_device_id, created_at = now(), current_epoch = 0
  where channel_id = p_channel_id;
  insert into public.mls_group_members(channel_id, device_id, user_id, mls_credential, joined_epoch)
  values(p_channel_id, v_device.id, v_device.user_id, v_device.mls_credential, 0);
  return true;
end;
$fn$;

-- A assinatura mudou; a versão de dois argumentos deixaria uma sobrecarga
-- ambígua para o PostgREST.
drop function if exists public.initialize_mls_group(uuid, uuid);

revoke all on function public.initialize_mls_group(uuid, uuid, boolean) from public, anon;
grant execute on function public.initialize_mls_group(uuid, uuid, boolean) to authenticated;

commit;
