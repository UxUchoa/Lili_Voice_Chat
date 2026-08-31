begin;

-- Foreground clients need the same delivery decision used by Web Push, but
-- must never receive message plaintext from the database. The caller only
-- learns whether its own notification should be delivered; the body remains
-- inside the MLS ciphertext and is decrypted locally by the client.
create or replace function public.notification_event_for_message(
  p_message_id uuid
) returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when message_row.author_id = auth.uid() then null
    when not public.has_channel_permission(
      message_row.channel_id,
      1,
      auth.uid()
    ) then null
    when public.is_blocked_pair(message_row.author_id, auth.uid()) then null
    when preferences.mode = 'ALL' then
      case when mention_state.effective then 'MENTION' else 'MESSAGE' end
    when preferences.mode = 'MENTIONS' and mention_state.effective then
      'MENTION'
    else null
  end
  from public.messages message_row
  cross join lateral public.notification_preferences_for(
    auth.uid(),
    message_row.channel_id
  ) preferences
  cross join lateral (
    select public.is_effective_message_mention(
      message_row.id,
      auth.uid()
    ) as effective
  ) mention_state
  where message_row.id = p_message_id
    and auth.uid() is not null;
$$;

revoke all on function public.notification_event_for_message(uuid)
  from public, anon, authenticated;
grant execute on function public.notification_event_for_message(uuid)
  to authenticated;

commit;
