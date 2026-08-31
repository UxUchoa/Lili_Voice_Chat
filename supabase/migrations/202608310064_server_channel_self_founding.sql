begin;

-- ============================================================
-- Canal de servidor não espera ninguém
--
-- O sintoma: "Aguardando a chave de criptografia deste canal. Ela é entregue
-- quando outro participante do canal estiver com a aplicação aberta." Um canal
-- de servidor ficava inutilizável — texto e voz — porque só o fundador do
-- grupo MLS entrega Welcome, e o fundador podia ser um dispositivo que não
-- existe mais. Na web isso é rotina: a chave mestra vive em `sessionStorage`,
-- então fechar a aba já aposenta o dispositivo.
--
-- A recuperação existente cobria só o caso do fundador sem sinal há três
-- minutos. Três minutos olhando para uma mensagem de espera é o mesmo que
-- estar quebrado, e não cobria o caso de haver outro membro online que
-- simplesmente não estava com aquele canal aberto para entregar nada.
--
-- A regra nova é por tipo de canal, e a distinção é deliberada:
--
--   - **Servidor** (`text`/`voice`): se nenhum outro dispositivo membro deu
--     sinal recente, este assume o grupo na hora. Um servidor é um lugar
--     público que precisa estar de pé quando alguém chega, mesmo que seja o
--     primeiro a chegar.
--   - **Conversa privada** (`dm`/`gdm`): continua esperando. Ali refundar por
--     conta própria seria trocar a chave de uma conversa de duas pessoas sem
--     que a outra participe — o que é exatamente o que o E2EE existe para
--     impedir.
--
-- Refundar reinicia a época: o que foi escrito antes deixa de ser legível.
-- Num canal onde ninguém tem a chave, isso já era verdade — a diferença é que
-- agora o canal volta a funcionar daqui para frente.
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

  -- O grupo já existe. Travar a linha impede dois dispositivos de refundarem
  -- ao mesmo tempo e acabarem em árvores diferentes.
  select * into v_group from public.mls_groups
  where channel_id = p_channel_id
  for update;

  -- Já sou membro: nada a fazer, o estado local é que manda.
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

  -- (3) Canal de servidor sem ninguém para entregar a chave.
  --
  -- O batimento do dispositivo é de 45 s, então 90 s de silêncio significa
  -- duas batidas perdidas: ninguém ali é capaz de publicar um Welcome. Se
  -- houver alguém vivo, este dispositivo espera — roubar o grupo de quem está
  -- online forçaria todo mundo a entrar de novo por nada.
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

    if not v_peer_alive then
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

  -- (4) Fundador ausente. Vale para conversa privada e para o canal de
  -- servidor cujo par está vivo mas cujo fundador não é ele.
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

commit;
