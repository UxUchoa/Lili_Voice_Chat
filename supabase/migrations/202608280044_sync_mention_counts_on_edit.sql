begin;

create or replace function public.is_effective_mention_values(
  p_channel_id uuid,
  p_mention_user_ids uuid[],
  p_mention_role_ids uuid[],
  p_mention_here_recipient_ids uuid[],
  p_mentions_everyone boolean,
  p_mention_recipient_ids uuid[],
  p_user_id uuid
) returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    p_user_id = any(coalesce(p_mention_user_ids, '{}'::uuid[]))
    or (
      p_user_id = any(coalesce(p_mention_here_recipient_ids, '{}'::uuid[]))
      and not preferences.suppress_everyone
    )
    or (
      coalesce(p_mentions_everyone, false)
      and p_user_id = any(coalesce(p_mention_recipient_ids, '{}'::uuid[]))
      and not preferences.suppress_everyone
    )
    or (
      not preferences.suppress_roles
      and exists (
        select 1
        from public.channels channel_row
        join public.member_roles member_role
          on member_role.server_id = channel_row.server_id
         and member_role.user_id = p_user_id
        where channel_row.id = p_channel_id
          and member_role.role_id = any(
            coalesce(p_mention_role_ids, '{}'::uuid[])
          )
      )
    ),
    false
  )
  from public.notification_preferences_for(p_user_id, p_channel_id) preferences;
$$;

create or replace function public.is_effective_message_mention(
  p_message_id uuid,
  p_user_id uuid
) returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_effective_mention_values(
    message_row.channel_id,
    message_row.mention_user_ids,
    message_row.mention_role_ids,
    message_row.mention_here_recipient_ids,
    message_row.mentions_everyone,
    message_row.mention_recipient_ids,
    p_user_id
  )
  from public.messages message_row
  where message_row.id = p_message_id;
$$;

create or replace function public.sync_edited_message_mention_counts()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.read_states read_state
  set mention_count = greatest(0, read_state.mention_count - 1)
  from (
    select distinct recipient_id
    from unnest(old.mention_recipient_ids) recipient(recipient_id)
  ) removed
  where read_state.channel_id = old.channel_id
    and read_state.user_id = removed.recipient_id
    and removed.recipient_id <> old.author_id
    and public.is_effective_mention_values(
      old.channel_id,
      old.mention_user_ids,
      old.mention_role_ids,
      old.mention_here_recipient_ids,
      old.mentions_everyone,
      old.mention_recipient_ids,
      removed.recipient_id
    )
    and not public.is_effective_mention_values(
      new.channel_id,
      new.mention_user_ids,
      new.mention_role_ids,
      new.mention_here_recipient_ids,
      new.mentions_everyone,
      new.mention_recipient_ids,
      removed.recipient_id
    );

  insert into public.read_states(
    channel_id, user_id, last_message_id, last_read_at, mention_count
  )
  select new.channel_id, added.recipient_id, null, to_timestamp(0), 1
  from (
    select distinct recipient_id
    from unnest(new.mention_recipient_ids) recipient(recipient_id)
  ) added
  left join public.read_states existing
    on existing.channel_id = new.channel_id
   and existing.user_id = added.recipient_id
  where added.recipient_id <> new.author_id
    and (existing.user_id is null or new.created_at > existing.last_read_at)
    and not public.is_effective_mention_values(
      old.channel_id,
      old.mention_user_ids,
      old.mention_role_ids,
      old.mention_here_recipient_ids,
      old.mentions_everyone,
      old.mention_recipient_ids,
      added.recipient_id
    )
    and public.is_effective_mention_values(
      new.channel_id,
      new.mention_user_ids,
      new.mention_role_ids,
      new.mention_here_recipient_ids,
      new.mentions_everyone,
      new.mention_recipient_ids,
      added.recipient_id
    )
  on conflict (channel_id, user_id) do update
  set mention_count = public.read_states.mention_count + 1;

  return new;
end;
$$;

drop trigger if exists messages_sync_edited_mention_counts on public.messages;
create trigger messages_sync_edited_mention_counts
after update of
  mention_user_ids,
  mention_role_ids,
  mention_here_recipient_ids,
  mentions_everyone,
  mentions_here
on public.messages
for each row execute function public.sync_edited_message_mention_counts();

revoke all on function public.is_effective_mention_values(
  uuid, uuid[], uuid[], uuid[], boolean, uuid[], uuid
), public.sync_edited_message_mention_counts()
from public, anon, authenticated;

commit;
