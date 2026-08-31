begin;

alter table public.messages
  add column mention_user_ids uuid[] not null default '{}',
  add column mention_role_ids uuid[] not null default '{}',
  add column mention_here_recipient_ids uuid[] not null default '{}',
  add column mentions_everyone boolean not null default false,
  add column mentions_here boolean not null default false;

update public.messages
set mention_user_ids = mention_recipient_ids
where coalesce(array_length(mention_recipient_ids, 1), 0) > 0;

alter table public.messages
  drop constraint if exists messages_mention_recipient_ids_check;
alter table public.messages
  add constraint messages_mention_user_ids_limit
    check (coalesce(array_length(mention_user_ids, 1), 0) <= 100),
  add constraint messages_mention_role_ids_limit
    check (coalesce(array_length(mention_role_ids, 1), 0) <= 100),
  add constraint messages_mention_here_ids_limit
    check (coalesce(array_length(mention_here_recipient_ids, 1), 0) <= 5000),
  add constraint messages_mention_recipient_ids_limit
    check (coalesce(array_length(mention_recipient_ids, 1), 0) <= 5000);

create or replace function public.validate_message_mentions()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_server_id uuid;
  v_can_mention_everyone boolean;
begin
  new.mention_user_ids := coalesce(new.mention_user_ids, '{}'::uuid[]);
  new.mention_role_ids := coalesce(new.mention_role_ids, '{}'::uuid[]);
  new.mention_here_recipient_ids := coalesce(new.mention_here_recipient_ids, '{}'::uuid[]);
  new.mentions_everyone := coalesce(new.mentions_everyone, false);
  new.mentions_here := coalesce(new.mentions_here, false);

  select server_id into v_server_id
  from public.channels
  where id = new.channel_id;

  v_can_mention_everyone := public.has_channel_permission(
    new.channel_id,
    8388608,
    new.author_id
  );

  if v_server_id is null and (
    new.mentions_everyone
    or new.mentions_here
    or coalesce(array_length(new.mention_role_ids, 1), 0) > 0
    or coalesce(array_length(new.mention_here_recipient_ids, 1), 0) > 0
  ) then
    raise exception 'server mentions are not valid in direct messages';
  end if;

  if (new.mentions_everyone or new.mentions_here) and not v_can_mention_everyone then
    raise exception 'missing mention everyone permission';
  end if;

  if exists (
    select 1
    from unnest(new.mention_role_ids) requested(role_id)
    left join public.roles role_row
      on role_row.id = requested.role_id
     and role_row.server_id = v_server_id
     and not role_row.is_default
    where role_row.id is null
       or (not role_row.mentionable and not v_can_mention_everyone)
  ) then
    raise exception 'invalid or non-mentionable role';
  end if;

  if exists (
    select 1
    from unnest(new.mention_user_ids) requested(user_id)
    where requested.user_id = new.author_id
       or not public.has_channel_permission(new.channel_id, 1, requested.user_id)
  ) then
    raise exception 'invalid mention recipient';
  end if;

  if exists (
    select 1
    from unnest(new.mention_here_recipient_ids) requested(user_id)
    where requested.user_id = new.author_id
       or not exists (
         select 1 from public.server_members member_row
         where member_row.server_id = v_server_id
           and member_row.user_id = requested.user_id
       )
  ) then
    raise exception 'invalid here recipient';
  end if;

  select coalesce(array_agg(distinct candidate.user_id), '{}'::uuid[])
  into new.mention_recipient_ids
  from (
    select user_id from unnest(new.mention_user_ids) explicit_user(user_id)
    union all
    select user_id from unnest(new.mention_here_recipient_ids) here_user(user_id)
    union all
    select member_role.user_id
    from public.member_roles member_role
    where member_role.server_id = v_server_id
      and member_role.role_id = any(new.mention_role_ids)
    union all
    select server_member.user_id
    from public.server_members server_member
    where new.mentions_everyone
      and server_member.server_id = v_server_id
  ) candidate
  where candidate.user_id <> new.author_id
    and public.has_channel_permission(new.channel_id, 1, candidate.user_id);

  return new;
end;
$$;

drop trigger if exists messages_validate_mentions on public.messages;
create trigger messages_validate_mentions
before insert or update of
  mention_user_ids,
  mention_role_ids,
  mention_here_recipient_ids,
  mentions_everyone,
  mentions_here,
  channel_id
on public.messages
for each row execute function public.validate_message_mentions();

drop function if exists public.send_encrypted_message(
  uuid, uuid, text, text, smallint, integer, uuid, uuid[]
);

create function public.send_encrypted_message(
  p_channel_id uuid,
  p_device_id uuid,
  p_ciphertext text,
  p_nonce text,
  p_payload_version smallint,
  p_mls_epoch integer,
  p_reply_to_id uuid default null,
  p_mention_recipient_ids uuid[] default '{}',
  p_mention_role_ids uuid[] default '{}',
  p_mention_here_recipient_ids uuid[] default '{}',
  p_mentions_everyone boolean default false,
  p_mentions_here boolean default false
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
  if not exists (
    select 1 from public.devices
    where id = p_device_id and user_id = v_user and revoked_at is null
  ) then
    raise exception 'invalid device';
  end if;
  if char_length(p_ciphertext) not between 1 and 131072
     or p_mls_epoch < 0
     or p_payload_version < 1 then
    raise exception 'invalid payload';
  end if;
  if p_reply_to_id is not null and not exists (
    select 1 from public.messages
    where id = p_reply_to_id and channel_id = p_channel_id
  ) then
    raise exception 'reply target does not belong to channel';
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

  insert into public.messages(
    id,
    channel_id,
    author_id,
    sender_device_id,
    ciphertext,
    nonce,
    payload_version,
    mls_epoch,
    reply_to_id,
    mention_user_ids,
    mention_role_ids,
    mention_here_recipient_ids,
    mentions_everyone,
    mentions_here
  ) values (
    v_message_id,
    p_channel_id,
    v_user,
    p_device_id,
    p_ciphertext,
    p_nonce,
    p_payload_version,
    p_mls_epoch,
    p_reply_to_id,
    coalesce(p_mention_recipient_ids, '{}'),
    coalesce(p_mention_role_ids, '{}'),
    coalesce(p_mention_here_recipient_ids, '{}'),
    coalesce(p_mentions_everyone, false),
    coalesce(p_mentions_here, false)
  );
  return v_message_id;
end;
$$;

revoke all on function public.send_encrypted_message(
  uuid, uuid, text, text, smallint, integer, uuid, uuid[], uuid[], uuid[], boolean, boolean
) from public, anon, authenticated;
grant execute on function public.send_encrypted_message(
  uuid, uuid, text, text, smallint, integer, uuid, uuid[], uuid[], uuid[], boolean, boolean
) to authenticated;

commit;
