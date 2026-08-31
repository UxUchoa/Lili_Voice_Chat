begin;

-- ============================================================
-- Recuperação de grupo MLS: as três situações reais, numa função só
--
-- `202608290046` reescreveu `initialize_mls_group` para permitir refundar
-- quando o fundador estava revogado, mas ao fazê-lo apagou a recuperação de
-- grupo vazio abandonado que existia desde `202608270029` — e trocou a
-- idempotência da segunda chamada por um `true`. Esta migração junta os três
-- casos que acontecem de verdade, sem perder nenhum:
--
--   1. Grupo comprovadamente vazio e abandonado (sem evento, mensagem ou
--      Welcome, e criado há mais de 5 segundos): qualquer dispositivo com
--      acesso ao canal pode assumir. É o caso de uma aba que fundou o grupo e
--      morreu antes do primeiro commit.
--   2. O próprio fundador voltou sem estado local. Só o fundador entrega
--      Welcome, e ele não consegue entregar para si mesmo: refundar é a única
--      saída. A janela de 5 segundos mantém a segunda chamada imediata
--      idempotente, que é como o cliente confirma que já é o fundador.
--   3. O fundador sumiu — revogado ou sem batimento recente. O próximo
--      dispositivo refunda a partir da época zero.
--
-- Em nenhum caso um dispositivo tira o lugar de um fundador vivo: quem
-- realmente precisa esperar o Welcome continua esperando.
-- ============================================================

create or replace function public.initialize_mls_group(
  p_channel_id uuid,
  p_device_id uuid
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
begin
  if not public.has_channel_permission(p_channel_id, 1) then
    raise exception 'forbidden';
  end if;
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

  -- O grupo já existe. Travar a linha impede dois dispositivos de refundarem
  -- ao mesmo tempo e acabarem em árvores diferentes.
  select * into v_group from public.mls_groups
  where channel_id = p_channel_id
  for update;

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
      -- Chamada repetida logo após fundar: o cliente já é o fundador e ainda
      -- não publicou nada; não há o que refazer.
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

  -- (3) Fundador ausente. Um dispositivo web raramente é revogado — a chave
  -- mestra vive em `sessionStorage` —, então a ausência também é medida pelo
  -- batimento: sem sinal recente, o fundador não volta para entregar Welcome.
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

revoke all on function public.initialize_mls_group(uuid, uuid)
  from public, anon;
grant execute on function public.initialize_mls_group(uuid, uuid)
  to authenticated, service_role;

commit;
