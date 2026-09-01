begin;

-- ============================================================
-- Saída do E2EE: a proteção passa a ser autenticação + RLS
--
-- Decisão de produto. O OpenMLS entregava sigilo real contra o servidor, mas
-- ao custo de uma máquina de grupo que precisava de fundador vivo, Welcome
-- entregue e época sincronizada entre dispositivos. Quando essa máquina
-- quebrava — dispositivo recriado, fundador revogado, grupo refundado — a
-- conversa parava de funcionar para os dois lados e o histórico virava
-- cadeado permanente. O que fica no lugar é o modelo comum de aplicativo de
-- mensagens: o conteúdo é legível pelo backend e o acesso é decidido pelas
-- políticas de RLS, que já existem e continuam valendo por participação no
-- canal.
--
-- O que isto significa, dito sem eufemismo: a partir daqui **o servidor pode
-- ler as mensagens**. Quem tiver acesso ao banco tem acesso ao conteúdo. Não
-- há mais promessa de sigilo ponta a ponta em nenhum lugar do produto, e os
-- textos da interface que a faziam saem junto nesta mesma mudança.
--
-- O histórico existente é apagado aqui, por decisão explícita. Toda linha de
-- `messages` é ciphertext MLS cuja chave de época não existe mais em lugar
-- nenhum: não há como convertê-la para texto. Manter as linhas só encheria a
-- conversa de cadeados permanentes. **Isto é irreversível.**
-- ============================================================

-- ------------------------------------------------------------
-- 1. Apagar o histórico cifrado
--
-- `message_attachments`, `message_reactions` e `message_pins` têm cascata a
-- partir de `messages`; apagar a raiz basta.
--
-- Os arquivos no Storage não são apagados aqui, e não precisam ser: o Postgres
-- recusa `delete` direto em `storage.objects`, e o gatilho
-- `message_attachments_capture_orphan` já registra o caminho em
-- `pending_storage_deletions` antes de a linha sumir. A função de borda
-- `attachments-expire` varre essa fila com a service role, que é o único
-- caminho que remove o arquivo de verdade.
-- ------------------------------------------------------------
delete from public.messages;

-- ------------------------------------------------------------
-- 2. `messages`: sai o ciphertext, entra o corpo em claro
-- ------------------------------------------------------------
alter table public.messages
  drop column ciphertext,
  drop column nonce,
  drop column mls_epoch;

alter table public.messages
  add column body text not null default '';
alter table public.messages
  alter column body drop default;
alter table public.messages
  add constraint messages_body_length
  check (char_length(body) between 1 and 8000);

-- O dispositivo continua registrado para a lista de sessões e para as
-- chamadas, mas deixa de ser exigido para escrever: sem MLS ele não tem mais
-- papel criptográfico nenhum na mensagem.
alter table public.messages
  alter column sender_device_id drop not null;

-- Marcador de formato do corpo. Fica para que uma mudança futura de estrutura
-- possa conviver com as linhas antigas em vez de invalidá-las — foi
-- exatamente o que faltou na troca anterior.
alter table public.messages
  alter column payload_version set default 4;

-- `sender_device_id` passou a aceitar nulo, e `<>` com nulo devolve nulo: a
-- comparação antiga deixaria a identidade da mensagem mudar sem erro.
create or replace function public.protect_message_identity()
returns trigger language plpgsql as $$
begin
  if new.id is distinct from old.id
    or new.channel_id is distinct from old.channel_id
    or new.author_id is distinct from old.author_id
    or new.sender_device_id is distinct from old.sender_device_id
    or new.created_at is distinct from old.created_at then
    raise exception 'immutable message identity';
  end if;
  return new;
end $$;

-- ------------------------------------------------------------
-- 3. `message_attachments`: metadados em claro
--
-- O nome e o tipo do arquivo viviam dentro do payload cifrado. Sem cifra eles
-- passam a ser colunas, e o hash do ciphertext deixa de fazer sentido.
-- ------------------------------------------------------------
alter table public.message_attachments
  drop column ciphertext_hash;
alter table public.message_attachments
  rename column ciphertext_size to byte_size;
alter table public.message_attachments
  rename constraint message_attachments_ciphertext_size_check
  to message_attachments_byte_size_check;

alter table public.message_attachments
  add column name text not null default '',
  add column mime text not null default 'application/octet-stream';
alter table public.message_attachments
  alter column name drop default,
  alter column mime drop default;
alter table public.message_attachments
  add constraint message_attachments_name_length
  check (char_length(name) between 1 and 260);

-- ------------------------------------------------------------
-- 4. Envio em claro
--
-- Mesmas guardas do `send_encrypted_message` — permissão de escrita, alvo da
-- resposta no mesmo canal, teto de menções e slowmode — menos as que só
-- existiam por causa do MLS (dispositivo válido, ciphertext, época).
-- ------------------------------------------------------------
create or replace function public.send_message(
  p_channel_id uuid,
  p_body text,
  p_device_id uuid default null,
  p_reply_to_id uuid default null,
  p_mention_recipient_ids uuid[] default '{}',
  p_mention_role_ids uuid[] default '{}',
  p_mention_here_recipient_ids uuid[] default '{}',
  p_mentions_everyone boolean default false,
  p_mentions_here boolean default false,
  p_attachments jsonb default '[]'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_message_id uuid := gen_random_uuid();
  v_user uuid := auth.uid();
  v_slowmode integer;
begin
  if not public.has_channel_permission(p_channel_id, 2, v_user) then
    raise exception 'forbidden';
  end if;
  if char_length(coalesce(p_body, '')) not between 1 and 8000 then
    raise exception 'invalid payload';
  end if;
  -- O dispositivo é opcional, mas se vier precisa ser desta conta: aceitar o
  -- de outra pessoa deixaria a autoria da sessão mentir na lista de sessões.
  if p_device_id is not null and not exists (
    select 1 from public.devices
    where id = p_device_id and user_id = v_user and revoked_at is null
  ) then
    raise exception 'invalid device';
  end if;
  if p_reply_to_id is not null and not exists (
    select 1 from public.messages
    where id = p_reply_to_id and channel_id = p_channel_id
  ) then
    raise exception 'reply target does not belong to channel';
  end if;
  if coalesce(array_length(p_mention_recipient_ids, 1), 0) > 100 then
    raise exception 'too many mentions';
  end if;

  select slowmode_seconds into v_slowmode
  from public.channels where id = p_channel_id;
  if coalesce(v_slowmode, 0) > 0
     and not public.has_channel_permission(p_channel_id, 16, v_user) then
    perform pg_advisory_xact_lock(
      hashtextextended(p_channel_id::text || ':' || v_user::text, 0)
    );
    if exists (
      select 1 from public.messages
      where channel_id = p_channel_id
        and author_id = v_user
        and deleted_at is null
        and created_at > now() - make_interval(secs => v_slowmode)
    ) then
      raise exception 'slowmode active: wait % seconds', v_slowmode;
    end if;
  end if;

  -- `mention_user_ids` é a lista pedida por quem escreveu.
  -- `mention_recipient_ids` é a lista **resolvida**, que o gatilho de
  -- validação preenche depois de conferir permissão e visibilidade do canal.
  -- Escrever direto na resolvida deixaria a menção sem efeito.
  insert into public.messages(
    id, channel_id, author_id, sender_device_id, body, payload_version,
    reply_to_id, mention_user_ids, mention_role_ids,
    mention_here_recipient_ids, mentions_everyone, mentions_here
  ) values (
    v_message_id, p_channel_id, v_user, p_device_id, p_body, 4,
    p_reply_to_id, coalesce(p_mention_recipient_ids, '{}'),
    coalesce(p_mention_role_ids, '{}'),
    coalesce(p_mention_here_recipient_ids, '{}'),
    coalesce(p_mentions_everyone, false), coalesce(p_mentions_here, false)
  );

  -- Os anexos entram na mesma transação da mensagem.
  -- Antes eles viajavam dentro do payload cifrado e chegavam junto por
  -- construção. Numa tabela à parte, inseri-los depois abre uma janela em que
  -- o destinatário recebe pelo realtime uma mensagem que anuncia arquivo e não
  -- tem nenhum — e nada o faz buscar de novo.
  if jsonb_array_length(coalesce(p_attachments, '[]'::jsonb)) > 0 then
    insert into public.message_attachments(
      id, message_id, channel_id, storage_object, byte_size, name, mime
    )
    select
      coalesce((item->>'id')::uuid, gen_random_uuid()),
      v_message_id,
      p_channel_id,
      item->>'storage_object',
      (item->>'byte_size')::bigint,
      item->>'name',
      coalesce(item->>'mime', 'application/octet-stream')
    from jsonb_array_elements(p_attachments) item;
  end if;

  return v_message_id;
end $$;

revoke all on function public.send_message(
  uuid, text, uuid, uuid, uuid[], uuid[], uuid[], boolean, boolean, jsonb
) from public, anon, authenticated;
grant execute on function public.send_message(
  uuid, text, uuid, uuid, uuid[], uuid[], uuid[], boolean, boolean, jsonb
) to authenticated;

-- ------------------------------------------------------------
-- 5. Fim do MLS
--
-- As funções saem antes das tabelas porque várias as referenciam.
-- ------------------------------------------------------------
drop function if exists public.send_encrypted_message(
  uuid, uuid, text, text, smallint, integer, uuid, uuid[], uuid[], uuid[],
  boolean, boolean
);
drop function if exists public.initialize_mls_group(uuid, uuid, boolean);
drop function if exists public.initialize_mls_group(uuid, uuid);
drop function if exists public.publish_mls_add(
  uuid, uuid, integer, text, uuid, uuid, text
);
drop function if exists public.publish_mls_remove(uuid, uuid, uuid, integer, text);
drop function if exists public.append_mls_group_event(uuid, uuid, integer, text, text);
drop function if exists public.deliver_mls_welcome(uuid, uuid, uuid, uuid, integer, text);
drop function if exists public.claim_mls_key_package(uuid, uuid, uuid);
drop function if exists public.channel_mls_members(uuid, uuid);
drop function if exists public.channel_recipient_devices(uuid);

drop table if exists public.channel_key_envelopes;
drop table if exists public.e2ee_key_packages;
drop table if exists public.mls_group_events;
drop table if exists public.mls_group_members;
drop table if exists public.mls_groups;

-- ------------------------------------------------------------
-- 6. `devices` vira registro de sessão
--
-- A tabela continua servindo à lista de sessões, ao heartbeat e às chamadas.
-- O que era material do MLS deixa de ser obrigatório. `fingerprint` continua
-- exigido: é ele que evita duplicar o dispositivo a cada login no mesmo
-- navegador, e agora é só um identificador aleatório persistido localmente.
-- ------------------------------------------------------------
alter table public.devices
  alter column identity_public_key drop not null,
  alter column mls_credential drop not null;
alter table public.devices
  drop constraint if exists devices_mls_credential_length;

create or replace function public.protect_device_identity()
returns trigger language plpgsql as $$
begin
  if new.id is distinct from old.id
    or new.user_id is distinct from old.user_id
    or new.fingerprint is distinct from old.fingerprint
    or new.created_at is distinct from old.created_at then
    raise exception 'immutable device identity';
  end if;
  return new;
end $$;


-- ------------------------------------------------------------
-- 7. Funções que ainda falavam de ciphertext
--
-- A cota media o tamanho do payload cifrado e o expurgo apagava o material do
-- MLS junto com a conta. Nenhuma das duas coisas existe mais: a medida passa a
-- ser o corpo em claro mais o tamanho real do anexo, e a `e2ee_key_packages`
-- sai do expurgo porque a tabela deixou de existir. Sem isto, cota, expurgo e
-- exclusão de conta quebrariam na primeira chamada.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.server_quota_status(p_server_id uuid)
 RETURNS TABLE(used_bytes bigint, share_bytes bigint, percent numeric, level text, message_count bigint, oldest_message_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_limit bigint;
  v_servers bigint;
  v_share bigint;
  v_used bigint;
begin
  -- 1 = VIEW_CHANNEL não basta: saber o consumo do servidor é informação de
  -- administração. 65536 = MANAGE_SERVER.
  if not public.has_server_permission(p_server_id, 65536) then
    raise exception 'forbidden';
  end if;

  select database_limit_bytes into v_limit
  from public.instance_quota_config where singleton;
  select greatest(count(*), 1) into v_servers from public.servers;
  v_share := greatest(v_limit / v_servers, 1);

  select
    coalesce(sum(octet_length(m.body)), 0)
      + coalesce((
        select sum(a.byte_size)
        from public.message_attachments a
        join public.channels c on c.id = a.channel_id
        where c.server_id = p_server_id
      ), 0),
    count(*),
    min(m.created_at)
  into v_used, message_count, oldest_message_at
  from public.messages m
  join public.channels c on c.id = m.channel_id
  where c.server_id = p_server_id and m.deleted_at is null;

  return query select
    v_used,
    v_share,
    round(v_used::numeric * 100 / v_share, 2),
    public.quota_alert_level(v_used, v_share),
    message_count,
    oldest_message_at;
end;
$function$;

CREATE OR REPLACE FUNCTION public.prune_server_messages(p_server_id uuid, p_target_percent numeric DEFAULT 70)
 RETURNS TABLE(deleted_count integer, freed_bytes bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_share bigint;
  v_used bigint;
  v_target bigint;
  v_row record;
  v_deleted integer := 0;
  v_freed bigint := 0;
begin
  if not public.has_server_permission(p_server_id, 65536) then
    raise exception 'forbidden';
  end if;

  select s.used_bytes, s.share_bytes into v_used, v_share
  from public.server_quota_status(p_server_id) s;
  v_target := (v_share * least(greatest(p_target_percent, 10), 100) / 100)::bigint;
  if v_used <= v_target then return query select 0, 0::bigint; return; end if;

  for v_row in
    select m.id,
           octet_length(m.body)
             + coalesce((
               select sum(a.byte_size)
               from public.message_attachments a where a.message_id = m.id
             ), 0) as bytes
    from public.messages m
    join public.channels c on c.id = m.channel_id
    where c.server_id = p_server_id
      and m.deleted_at is null
      and not exists (
        select 1 from public.message_pins p where p.message_id = m.id
      )
    order by m.created_at, m.id
  loop
    exit when v_used - v_freed <= v_target;
    -- O gatilho da seção 1 registra o anexo para a função de borda apagar do
    -- Storage antes de a linha sumir por CASCADE.
    delete from public.messages where id = v_row.id;
    v_deleted := v_deleted + 1;
    v_freed := v_freed + v_row.bytes;
  end loop;

  return query select v_deleted, v_freed;
end;
$function$;

CREATE OR REPLACE FUNCTION public.tombstone_account(p_user_id uuid)
 RETURNS TABLE(servers_transferred integer, servers_deleted integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_server record;
  v_heir uuid;
  v_transferred integer := 0;
  v_deleted integer := 0;
  v_username text;
begin
  if p_user_id is null then raise exception 'user id is required'; end if;
  if not exists(select 1 from public.profiles where id = p_user_id) then
    raise exception 'profile not found';
  end if;

  -- `username` é único e cabe em 24 caracteres, então o nome da lápide não
  -- pode ser um pedaço fixo do uuid: doze hexadecimais colidem uma vez a cada
  -- muitas contas, e a colisão faria o expurgo da segunda falhar para sempre.
  -- Sorteia de novo até achar um livre.
  v_username := 'removido_' || left(replace(p_user_id::text, '-', ''), 12);
  while exists(
    select 1 from public.profiles
    where username = v_username and id <> p_user_id
  ) loop
    v_username := 'removido_' || left(replace(gen_random_uuid()::text, '-', ''), 12);
  end loop;

  -- A lápide é marcada **antes** de transferir os servidores: é ela que
  -- autoriza `protect_server_owner` a aceitar a transferência sem sessão do
  -- dono. Tudo acontece na mesma transação, então não há janela em que o
  -- perfil esteja anônimo com os servidores ainda pendurados nele.
  --
  -- `bio` é NOT NULL com default vazio, e `presence` só aceita os valores em
  -- minúscula do check. As duas políticas vão para NOBODY para que a lápide
  -- não continue recebendo conversa nem pedido de amizade.
  update public.profiles
  set username = v_username,
      display_name = 'Usuário removido',
      avatar_path = null,
      banner_path = null,
      bio = '',
      pronouns = null,
      custom_status = null,
      presence = 'offline',
      dm_policy = 'NOBODY',
      friend_request_policy = 'NOBODY',
      profile_visible = false,
      deleted_at = now(),
      updated_at = now()
  where id = p_user_id;

  for v_server in
    select id from public.servers where owner_id = p_user_id
  loop
    -- 1 << 60 = ADMINISTRATOR.
    select sm.user_id into v_heir
    from public.server_members sm
    where sm.server_id = v_server.id
      and sm.user_id <> p_user_id
      and (public.effective_server_permissions(v_server.id, sm.user_id)
           & (1::bigint << 60)) <> 0
    order by sm.joined_at
    limit 1;

    if v_heir is null then
      select sm.user_id into v_heir
      from public.server_members sm
      where sm.server_id = v_server.id and sm.user_id <> p_user_id
      order by sm.joined_at
      limit 1;
    end if;

    if v_heir is null then
      delete from public.servers where id = v_server.id;
      v_deleted := v_deleted + 1;
    else
      update public.servers set owner_id = v_heir, updated_at = now()
      where id = v_server.id;
      v_transferred := v_transferred + 1;
    end if;
  end loop;

  delete from public.devices where user_id = p_user_id;
  delete from public.push_subscriptions where user_id = p_user_id;
  delete from public.server_members where user_id = p_user_id;
  delete from public.channel_members where user_id = p_user_id;
  delete from public.user_contacts where user_id = p_user_id;

  return query select v_transferred, v_deleted;
end;
$function$;

commit;
