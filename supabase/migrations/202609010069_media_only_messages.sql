begin;

-- ============================================================
-- Mensagem só de mídia volta a ser possível
--
-- A saída do E2EE trocou o `ciphertext` pelo corpo em claro e levou junto uma
-- regra que ninguém tinha escrito de propósito. O guard antigo exigia
-- `char_length(p_ciphertext) between 1 and 131072`, e o ciphertext nunca era
-- vazio: mesmo sem legenda, o payload cifrado carregava a estrutura inteira
-- (versão, menções, reações, lista de anexos). Uma foto ou um vídeo sem
-- legenda passava por ali sem esforço.
--
-- Com o corpo em claro, o mesmo `between 1 and 8000` passou a significar
-- "toda mensagem precisa de texto". Enviar só um vídeo virava
-- `invalid payload`, tanto na função quanto na constraint da tabela.
--
-- O que a regra deveria dizer é que a mensagem não pode ser **vazia** — e uma
-- mensagem com anexo não é vazia. O teto de 8.000 caracteres continua.
-- ============================================================

alter table public.messages
  drop constraint messages_body_length;
alter table public.messages
  add constraint messages_body_length check (char_length(body) <= 8000);

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
  v_body text := coalesce(p_body, '');
  v_attachments jsonb := coalesce(p_attachments, '[]'::jsonb);
begin
  if not public.has_channel_permission(p_channel_id, 2, v_user) then
    raise exception 'forbidden';
  end if;
  if char_length(v_body) > 8000 then
    raise exception 'invalid payload';
  end if;
  -- Sem texto **e** sem anexo não há mensagem. Com anexo, a legenda é opcional
  -- — é o caso de mandar só uma foto ou um vídeo.
  if char_length(v_body) = 0 and jsonb_array_length(v_attachments) = 0 then
    raise exception 'invalid payload';
  end if;
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
  -- `mention_recipient_ids` é a **resolvida**, que o gatilho de validação
  -- preenche depois de conferir permissão e visibilidade do canal.
  insert into public.messages(
    id, channel_id, author_id, sender_device_id, body, payload_version,
    reply_to_id, mention_user_ids, mention_role_ids,
    mention_here_recipient_ids, mentions_everyone, mentions_here
  ) values (
    v_message_id, p_channel_id, v_user, p_device_id, v_body, 4,
    p_reply_to_id, coalesce(p_mention_recipient_ids, '{}'),
    coalesce(p_mention_role_ids, '{}'),
    coalesce(p_mention_here_recipient_ids, '{}'),
    coalesce(p_mentions_everyone, false), coalesce(p_mentions_here, false)
  );

  if jsonb_array_length(v_attachments) > 0 then
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
    from jsonb_array_elements(v_attachments) item;
  end if;

  return v_message_id;
end $$;

commit;
