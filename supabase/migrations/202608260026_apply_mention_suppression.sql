begin;

create or replace function public.notification_preferences_for(
  p_user_id uuid,
  p_channel_id uuid
) returns table(mode text, suppress_everyone boolean, suppress_roles boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with channel_context as (
    select server_id from public.channels where id = p_channel_id
  ), selected as (
    select
      setting.mode,
      setting.muted_until,
      setting.suppress_everyone,
      setting.suppress_roles
    from public.notification_settings setting
    cross join channel_context context
    where setting.user_id = p_user_id
      and (
        (setting.scope_type = 'CHANNEL' and setting.scope_id = p_channel_id::text)
        or (
          setting.scope_type = 'SERVER'
          and context.server_id is not null
          and setting.scope_id = context.server_id::text
        )
        or (setting.scope_type = 'GLOBAL' and setting.scope_id = '*')
      )
    order by case setting.scope_type
      when 'CHANNEL' then 1
      when 'SERVER' then 2
      else 3
    end
    limit 1
  )
  select
    case when selected.muted_until > now() then 'NONE'
      else coalesce(selected.mode, 'ALL') end,
    coalesce(selected.suppress_everyone, false),
    coalesce(selected.suppress_roles, false)
  from (select 1) seed
  left join selected on true;
$$;

create or replace function public.notification_mode_for(
  p_user_id uuid,
  p_channel_id uuid
) returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select preferences.mode
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
  select coalesce(
    p_user_id = any(message_row.mention_user_ids)
    or (
      p_user_id = any(message_row.mention_here_recipient_ids)
      and not preferences.suppress_everyone
    )
    or (
      message_row.mentions_everyone
      and p_user_id = any(message_row.mention_recipient_ids)
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
        where channel_row.id = message_row.channel_id
          and member_role.role_id = any(message_row.mention_role_ids)
      )
    ),
    false
  )
  from public.messages message_row
  cross join lateral public.notification_preferences_for(
    p_user_id,
    message_row.channel_id
  ) preferences
  where message_row.id = p_message_id;
$$;

create or replace function public.increment_message_mention_counts()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.read_states(
    channel_id, user_id, last_message_id, last_read_at, mention_count
  )
  select new.channel_id, recipient.user_id, null, to_timestamp(0), 1
  from unnest(new.mention_recipient_ids) recipient(user_id)
  where recipient.user_id <> new.author_id
    and public.is_effective_message_mention(new.id, recipient.user_id)
  on conflict (channel_id, user_id) do update
  set mention_count = public.read_states.mention_count + 1;
  return new;
end;
$$;

create or replace function public.enqueue_message_notifications()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.notification_envelopes(
    recipient_user_id,
    message_id,
    channel_id,
    event_type
  )
  select
    recipient.user_id,
    new.id,
    new.channel_id,
    case when mention_state.effective then 'MENTION' else 'MESSAGE' end
  from (
    select server_member.user_id
    from public.channels channel_row
    join public.server_members server_member
      on server_member.server_id = channel_row.server_id
    where channel_row.id = new.channel_id
    union
    select channel_member.user_id
    from public.channel_members channel_member
    where channel_member.channel_id = new.channel_id
  ) recipient
  cross join lateral public.notification_preferences_for(
    recipient.user_id,
    new.channel_id
  ) preferences
  cross join lateral (
    select public.is_effective_message_mention(
      new.id,
      recipient.user_id
    ) as effective
  ) mention_state
  where recipient.user_id <> new.author_id
    and public.has_channel_permission(new.channel_id, 1, recipient.user_id)
    and not public.is_blocked_pair(new.author_id, recipient.user_id)
    and exists (
      select 1 from public.push_subscriptions subscription
      where subscription.user_id = recipient.user_id
    )
    and (
      preferences.mode = 'ALL'
      or (preferences.mode = 'MENTIONS' and mention_state.effective)
    )
  on conflict do nothing;
  return new;
end;
$$;

revoke all on function public.notification_preferences_for(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.is_effective_message_mention(uuid, uuid)
  from public, anon, authenticated;

commit;
