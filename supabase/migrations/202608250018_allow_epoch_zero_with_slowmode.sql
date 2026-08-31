begin;

create or replace function public.send_encrypted_message(
  p_channel_id uuid, p_device_id uuid, p_ciphertext text, p_nonce text,
  p_payload_version smallint, p_mls_epoch integer, p_reply_to_id uuid default null,
  p_mention_recipient_ids uuid[] default '{}'
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_message_id uuid := gen_random_uuid();
  v_user uuid := auth.uid();
  v_slowmode integer;
begin
  if not public.has_channel_permission(p_channel_id, 2, v_user) then raise exception 'forbidden'; end if;
  if not exists(select 1 from public.devices where id = p_device_id and user_id = v_user and revoked_at is null) then
    raise exception 'invalid device';
  end if;
  if char_length(p_ciphertext) not between 1 and 131072 or p_mls_epoch < 0 or p_payload_version < 1 then
    raise exception 'invalid payload';
  end if;
  if p_reply_to_id is not null and not exists(
    select 1 from public.messages where id = p_reply_to_id and channel_id = p_channel_id
  ) then raise exception 'reply target does not belong to channel'; end if;
  if coalesce(array_length(p_mention_recipient_ids, 1), 0) > 100 then raise exception 'too many mentions'; end if;

  select slowmode_seconds into v_slowmode from public.channels where id = p_channel_id;
  if coalesce(v_slowmode, 0) > 0 and not public.has_channel_permission(p_channel_id, 16, v_user) then
    perform pg_advisory_xact_lock(hashtextextended(p_channel_id::text || ':' || v_user::text, 0));
    if exists(
      select 1 from public.messages
      where channel_id = p_channel_id and author_id = v_user and deleted_at is null
        and created_at > now() - make_interval(secs => v_slowmode)
    ) then raise exception 'slowmode active: wait % seconds', v_slowmode; end if;
  end if;

  insert into public.messages(
    id, channel_id, author_id, sender_device_id, ciphertext, nonce,
    payload_version, mls_epoch, reply_to_id, mention_recipient_ids
  ) values(
    v_message_id, p_channel_id, v_user, p_device_id, p_ciphertext, p_nonce,
    p_payload_version, p_mls_epoch, p_reply_to_id, coalesce(p_mention_recipient_ids, '{}')
  );
  return v_message_id;
end $$;

commit;
