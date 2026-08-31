begin;

create or replace function public.send_encrypted_message(
  p_channel_id uuid, p_device_id uuid, p_ciphertext text, p_nonce text,
  p_payload_version smallint, p_mls_epoch integer, p_reply_to_id uuid default null,
  p_mention_recipient_ids uuid[] default '{}'
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_message_id uuid := gen_random_uuid(); v_user uuid := auth.uid();
begin
  if not public.has_channel_permission(p_channel_id, 2, v_user) then raise exception 'forbidden'; end if;
  if not exists(select 1 from public.devices where id = p_device_id and user_id = v_user and revoked_at is null) then raise exception 'invalid device'; end if;
  -- A newly-created MLS group is valid at epoch zero. Epoch one is reached
  -- only after the first membership commit.
  if char_length(p_ciphertext) > 131072 or p_mls_epoch < 0 then raise exception 'invalid payload'; end if;
  insert into public.messages(id, channel_id, author_id, sender_device_id, ciphertext, nonce, payload_version, mls_epoch, reply_to_id, mention_recipient_ids)
  values(v_message_id, p_channel_id, v_user, p_device_id, p_ciphertext, p_nonce, p_payload_version, p_mls_epoch, p_reply_to_id, coalesce(p_mention_recipient_ids, '{}'));
  return v_message_id;
end;
$$;

commit;
