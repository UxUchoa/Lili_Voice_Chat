begin;

create table public.mls_groups (
  channel_id uuid primary key references public.channels(id) on delete cascade,
  founder_device_id uuid not null references public.devices(id),
  cipher_suite integer not null default 3,
  current_epoch integer not null default 0 check (current_epoch >= 0),
  created_at timestamptz not null default now()
);

create table public.mls_group_events (
  sequence bigint generated always as identity primary key,
  channel_id uuid not null references public.channels(id) on delete cascade,
  epoch integer not null check (epoch > 0),
  event_type text not null check (event_type in ('ADD_COMMIT','REMOVE_COMMIT','UPDATE_COMMIT')),
  sender_device_id uuid not null references public.devices(id),
  payload text not null check (char_length(payload) between 1 and 524288),
  created_at timestamptz not null default now()
);
create index mls_group_events_channel_sequence_idx
  on public.mls_group_events(channel_id, sequence);

create or replace function public.initialize_mls_group(p_channel_id uuid, p_device_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_rows integer;
begin
  if not public.has_channel_permission(p_channel_id, 1) then raise exception 'forbidden'; end if;
  if not exists(select 1 from public.devices where id = p_device_id and user_id = auth.uid() and revoked_at is null) then
    raise exception 'invalid device';
  end if;
  insert into public.mls_groups(channel_id, founder_device_id)
  values(p_channel_id, p_device_id)
  on conflict(channel_id) do nothing;
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

create or replace function public.channel_recipient_devices(p_channel_id uuid)
returns table(device_id uuid, user_id uuid, identity_public_key text)
language sql
stable
security definer
set search_path = public
as $$
  select d.id, d.user_id, d.identity_public_key
  from public.devices d
  where d.revoked_at is null
    and public.has_channel_permission(p_channel_id, 1)
    and public.has_channel_permission(p_channel_id, 1, d.user_id);
$$;

create or replace function public.claim_mls_key_package(
  p_channel_id uuid, p_target_device_id uuid, p_sender_device_id uuid
)
returns table(package_id uuid, user_id uuid, device_id uuid, key_package text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_channel_permission(p_channel_id, 1) then raise exception 'forbidden'; end if;
  if not exists(
    select 1 from public.mls_groups g
    join public.devices caller on caller.id = g.founder_device_id
    where g.channel_id = p_channel_id and g.founder_device_id = p_sender_device_id
      and caller.user_id = auth.uid() and caller.revoked_at is null
  ) then raise exception 'only the active MLS founder may consume key packages'; end if;
  if not exists(
    select 1 from public.devices d
    where d.id = p_target_device_id and d.revoked_at is null
      and public.has_channel_permission(p_channel_id, 1, d.user_id)
  ) then raise exception 'target is not an active channel device'; end if;
  return query
    update public.e2ee_key_packages kp
    set consumed_at = now()
    where kp.id = (
      select candidate.id from public.e2ee_key_packages candidate
      where candidate.device_id = p_target_device_id
        and candidate.consumed_at is null and candidate.expires_at > now()
      order by candidate.created_at
      for update skip locked
      limit 1
    )
    returning kp.id, kp.user_id, kp.device_id, kp.key_package;
end;
$$;

create or replace function public.append_mls_group_event(
  p_channel_id uuid, p_device_id uuid, p_epoch integer,
  p_event_type text, p_payload text
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare v_sequence bigint;
begin
  if p_event_type not in ('ADD_COMMIT','REMOVE_COMMIT','UPDATE_COMMIT')
    or p_epoch < 1 or char_length(p_payload) not between 1 and 524288 then
    raise exception 'invalid MLS event';
  end if;
  if not public.has_channel_permission(p_channel_id, 1)
    or not exists(select 1 from public.devices where id = p_device_id and user_id = auth.uid() and revoked_at is null) then
    raise exception 'forbidden';
  end if;
  insert into public.mls_group_events(channel_id, epoch, event_type, sender_device_id, payload)
  values(p_channel_id, p_epoch, p_event_type, p_device_id, p_payload)
  returning sequence into v_sequence;
  return v_sequence;
end;
$$;

create or replace function public.deliver_mls_welcome(
  p_channel_id uuid, p_sender_device_id uuid, p_recipient_user_id uuid,
  p_recipient_device_id uuid, p_epoch integer, p_envelope text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if not public.has_channel_permission(p_channel_id, 1)
    or not exists(select 1 from public.devices where id = p_sender_device_id and user_id = auth.uid() and revoked_at is null)
    or not exists(select 1 from public.devices where id = p_recipient_device_id and user_id = p_recipient_user_id and revoked_at is null)
    or not public.has_channel_permission(p_channel_id, 1, p_recipient_user_id)
    or p_epoch < 1 or char_length(p_envelope) not between 1 and 1048576 then
    raise exception 'invalid MLS welcome';
  end if;
  insert into public.channel_key_envelopes(channel_id, recipient_user_id, recipient_device_id, epoch, envelope)
  values(p_channel_id, p_recipient_user_id, p_recipient_device_id, p_epoch, p_envelope)
  on conflict(channel_id, recipient_device_id, epoch) do update set envelope = excluded.envelope
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.publish_mls_add(
  p_channel_id uuid, p_sender_device_id uuid, p_epoch integer,
  p_event_payload text, p_recipient_user_id uuid,
  p_recipient_device_id uuid, p_welcome_envelope text
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare v_sequence bigint; v_envelope jsonb;
begin
  if not public.has_channel_permission(p_channel_id, 1)
    or not exists(select 1 from public.devices where id = p_sender_device_id and user_id = auth.uid() and revoked_at is null)
    or not exists(select 1 from public.devices where id = p_recipient_device_id and user_id = p_recipient_user_id and revoked_at is null)
    or not public.has_channel_permission(p_channel_id, 1, p_recipient_user_id)
    or p_epoch < 1 or char_length(p_event_payload) not between 1 and 524288
    or char_length(p_welcome_envelope) not between 1 and 1048576 then
    raise exception 'invalid MLS add publication';
  end if;
  begin
    v_envelope := p_welcome_envelope::jsonb;
  exception when others then
    raise exception 'welcome envelope must be valid JSON';
  end;
  perform 1 from public.mls_groups
  where channel_id = p_channel_id and founder_device_id = p_sender_device_id
  for update;
  if not found then raise exception 'only the MLS founder may publish add commits'; end if;
  if p_epoch <> (select current_epoch + 1 from public.mls_groups where channel_id = p_channel_id) then
    raise exception 'non-sequential MLS epoch';
  end if;
  insert into public.mls_group_events(channel_id, epoch, event_type, sender_device_id, payload)
  values(p_channel_id, p_epoch, 'ADD_COMMIT', p_sender_device_id, p_event_payload)
  returning sequence into v_sequence;
  v_envelope := jsonb_set(v_envelope, '{joinedAfterSequence}', to_jsonb(v_sequence), true);
  insert into public.channel_key_envelopes(channel_id, recipient_user_id, recipient_device_id, epoch, envelope)
  values(p_channel_id, p_recipient_user_id, p_recipient_device_id, p_epoch, v_envelope::text)
  on conflict(channel_id, recipient_device_id, epoch) do update set envelope = excluded.envelope;
  update public.mls_groups set current_epoch = p_epoch where channel_id = p_channel_id;
  return v_sequence;
end;
$$;

revoke all on public.mls_groups, public.mls_group_events from anon, authenticated;
grant select on public.mls_groups, public.mls_group_events to authenticated;

revoke all on function public.initialize_mls_group(uuid, uuid) from public, anon, authenticated;
revoke all on function public.channel_recipient_devices(uuid) from public, anon, authenticated;
revoke all on function public.claim_mls_key_package(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.append_mls_group_event(uuid, uuid, integer, text, text) from public, anon, authenticated;
revoke all on function public.deliver_mls_welcome(uuid, uuid, uuid, uuid, integer, text) from public, anon, authenticated;
revoke all on function public.publish_mls_add(uuid, uuid, integer, text, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.initialize_mls_group(uuid, uuid) to authenticated;
grant execute on function public.channel_recipient_devices(uuid) to authenticated;
grant execute on function public.claim_mls_key_package(uuid, uuid, uuid) to authenticated;
grant execute on function public.append_mls_group_event(uuid, uuid, integer, text, text) to authenticated;
grant execute on function public.deliver_mls_welcome(uuid, uuid, uuid, uuid, integer, text) to authenticated;
grant execute on function public.publish_mls_add(uuid, uuid, integer, text, uuid, uuid, text) to authenticated;

alter table public.mls_groups enable row level security;
create policy mls_groups_select on public.mls_groups for select to authenticated
using (public.has_channel_permission(channel_id, 1));

alter table public.mls_group_events enable row level security;
create policy mls_group_events_select on public.mls_group_events for select to authenticated
using (public.has_channel_permission(channel_id, 1));

alter publication supabase_realtime add table public.mls_group_events;

commit;
