begin;

alter table public.notification_envelopes
  add column attempt_count integer not null default 0 check (attempt_count between 0 and 20),
  add column next_attempt_at timestamptz not null default now(),
  add column claimed_at timestamptz,
  add column last_error text;

create index notification_envelopes_pending_idx
  on public.notification_envelopes(next_attempt_at, created_at)
  where dispatched_at is null;

create or replace function public.notification_mode_for(
  p_user_id uuid,
  p_channel_id uuid
) returns text
language sql
stable
security definer
set search_path = public
as $$
  with channel_context as (
    select server_id from public.channels where id = p_channel_id
  ), selected as (
    select ns.mode, ns.muted_until
    from public.notification_settings ns
    cross join channel_context context
    where ns.user_id = p_user_id
      and (
        (ns.scope_type = 'CHANNEL' and ns.scope_id = p_channel_id::text)
        or (ns.scope_type = 'SERVER' and context.server_id is not null and ns.scope_id = context.server_id::text)
        or (ns.scope_type = 'GLOBAL' and ns.scope_id = '*')
      )
    order by case ns.scope_type when 'CHANNEL' then 1 when 'SERVER' then 2 else 3 end
    limit 1
  )
  select case
    when selected.muted_until > now() then 'NONE'
    else coalesce(selected.mode, 'ALL')
  end
  from (select 1) seed
  left join selected on true;
$$;

drop trigger if exists messages_enqueue_mentions on public.messages;
drop function if exists public.enqueue_mentions();

create or replace function public.enqueue_message_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
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
    case
      when recipient.user_id = any(new.mention_recipient_ids) then 'MENTION'
      else 'MESSAGE'
    end
  from (
    select sm.user_id
    from public.channels channel_row
    join public.server_members sm on sm.server_id = channel_row.server_id
    where channel_row.id = new.channel_id
    union
    select cm.user_id
    from public.channel_members cm
    where cm.channel_id = new.channel_id
  ) recipient
  where recipient.user_id <> new.author_id
    and public.has_channel_permission(new.channel_id, 1, recipient.user_id)
    and not public.is_blocked_pair(new.author_id, recipient.user_id)
    and exists (
      select 1
      from public.push_subscriptions subscription
      where subscription.user_id = recipient.user_id
    )
    and (
      public.notification_mode_for(recipient.user_id, new.channel_id) = 'ALL'
      or (
        public.notification_mode_for(recipient.user_id, new.channel_id) = 'MENTIONS'
        and recipient.user_id = any(new.mention_recipient_ids)
      )
    )
  on conflict do nothing;
  return new;
end;
$$;

create trigger messages_enqueue_notifications
after insert on public.messages
for each row execute function public.enqueue_message_notifications();

create or replace function public.claim_notification_envelopes(p_limit integer default 100)
returns setof public.notification_envelopes
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidates as (
    select envelope.id
    from public.notification_envelopes envelope
    where envelope.dispatched_at is null
      and envelope.next_attempt_at <= now()
      and (envelope.claimed_at is null or envelope.claimed_at < now() - interval '5 minutes')
      and envelope.attempt_count < 20
    order by envelope.created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 100), 500))
  )
  update public.notification_envelopes envelope
  set claimed_at = now()
  from candidates
  where envelope.id = candidates.id
  returning envelope.*;
end;
$$;

revoke all on function public.notification_mode_for(uuid, uuid) from public, anon, authenticated;
revoke all on function public.enqueue_message_notifications() from public, anon, authenticated;
revoke all on function public.claim_notification_envelopes(integer) from public, anon, authenticated;
grant execute on function public.claim_notification_envelopes(integer) to service_role;

commit;
