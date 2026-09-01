begin;

-- ============================================================
-- Spoiler em anexo — item 13
--
-- A marca viaja com o anexo, não com quem olha: quem envia decide que aquilo
-- nasce coberto, e isso vale para todo mundo que abrir a conversa. Já o
-- "revelado" é decisão de cada leitor e fica no cliente — sincronizar isso
-- entre dispositivos não daria nada a ninguém, e revelar no celular não
-- deveria revelar no desktop.
-- ============================================================

alter table public.message_attachments
  add column spoiler boolean not null default false;

-- O envio passa a aceitar a marca. Mesma função de antes; só o mapeamento do
-- JSON ganha o campo, com `false` quando quem chama não manda nada — cliente
-- antigo continua funcionando.
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
  -- `mention_recipient_ids` é a resolvida pelo gatilho de validação.
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
      id, message_id, channel_id, storage_object, byte_size, name, mime,
      spoiler
    )
    select
      coalesce((item->>'id')::uuid, gen_random_uuid()),
      v_message_id,
      p_channel_id,
      item->>'storage_object',
      (item->>'byte_size')::bigint,
      item->>'name',
      coalesce(item->>'mime', 'application/octet-stream'),
      coalesce((item->>'spoiler')::boolean, false)
    from jsonb_array_elements(v_attachments) item;
  end if;

  return v_message_id;
end $$;

commit;
