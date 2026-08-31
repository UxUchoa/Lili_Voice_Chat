create or replace function public.validate_message_mentions()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1
    from unnest(coalesce(new.mention_recipient_ids, '{}'::uuid[])) recipient(user_id)
    where recipient.user_id = new.author_id
       or not public.has_channel_permission(new.channel_id, 1, recipient.user_id)
  ) then
    raise exception 'invalid mention recipient';
  end if;
  return new;
end;
$$;

drop trigger if exists messages_validate_mentions on public.messages;
create trigger messages_validate_mentions
before insert or update of mention_recipient_ids, channel_id on public.messages
for each row execute function public.validate_message_mentions();

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
  from unnest(coalesce(new.mention_recipient_ids, '{}'::uuid[])) recipient(user_id)
  where recipient.user_id <> new.author_id
  on conflict (channel_id, user_id) do update
  set mention_count = public.read_states.mention_count + 1;
  return new;
end;
$$;

drop trigger if exists messages_increment_mention_counts on public.messages;
create trigger messages_increment_mention_counts
after insert on public.messages
for each row execute function public.increment_message_mention_counts();

revoke all on function public.validate_message_mentions() from public, anon, authenticated;
revoke all on function public.increment_message_mention_counts() from public, anon, authenticated;
