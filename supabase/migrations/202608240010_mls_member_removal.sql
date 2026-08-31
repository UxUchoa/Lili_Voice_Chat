begin;

alter table public.devices add column mls_credential text;
update public.devices set mls_credential = user_id::text where mls_credential is null;
alter table public.devices
  alter column mls_credential set not null,
  add constraint devices_mls_credential_length check (char_length(mls_credential) between 1 and 160);

create or replace function public.protect_device_identity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.id <> old.id
    or new.user_id <> old.user_id
    or new.identity_public_key <> old.identity_public_key
    or new.fingerprint <> old.fingerprint
    or new.mls_credential <> old.mls_credential
    or new.created_at <> old.created_at then
    raise exception 'immutable device identity';
  end if;
  return new;
end;
$$;
create trigger devices_protect_identity before update on public.devices
for each row execute function public.protect_device_identity();
revoke all on function public.protect_device_identity() from public, anon, authenticated;

create table public.mls_group_members (
  channel_id uuid not null references public.mls_groups(channel_id) on delete cascade,
  device_id uuid not null references public.devices(id),
  user_id uuid not null references public.profiles(id),
  mls_credential text not null,
  joined_epoch integer not null check (joined_epoch >= 0),
  removed_epoch integer check (removed_epoch is null or removed_epoch > joined_epoch),
  created_at timestamptz not null default now(),
  primary key (channel_id, device_id)
);
create index mls_group_members_active_idx on public.mls_group_members(channel_id)
where removed_epoch is null;

insert into public.mls_group_members(channel_id, device_id, user_id, mls_credential, joined_epoch)
select group_row.channel_id, device.id, device.user_id, device.mls_credential, 0
from public.mls_groups group_row
join public.devices device on device.id = group_row.founder_device_id
on conflict do nothing;

revoke all on public.mls_group_members from public, anon, authenticated;

create or replace function public.initialize_mls_group(p_channel_id uuid, p_device_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_rows integer; v_device public.devices%rowtype;
begin
  if not public.has_channel_permission(p_channel_id, 1) then raise exception 'forbidden'; end if;
  select * into v_device from public.devices
  where id = p_device_id and user_id = auth.uid() and revoked_at is null;
  if not found then raise exception 'invalid device'; end if;
  insert into public.mls_groups(channel_id, founder_device_id)
  values(p_channel_id, p_device_id)
  on conflict(channel_id) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 1 then
    insert into public.mls_group_members(channel_id, device_id, user_id, mls_credential, joined_epoch)
    values(p_channel_id, v_device.id, v_device.user_id, v_device.mls_credential, 0);
  end if;
  return v_rows = 1;
end;
$$;

drop function public.channel_recipient_devices(uuid);
create function public.channel_recipient_devices(p_channel_id uuid)
returns table(device_id uuid, user_id uuid, identity_public_key text, mls_credential text)
language sql
stable
security definer
set search_path = public
as $$
  select d.id, d.user_id, d.identity_public_key, d.mls_credential
  from public.devices d
  where d.revoked_at is null
    and public.has_channel_permission(p_channel_id, 1)
    and public.has_channel_permission(p_channel_id, 1, d.user_id);
$$;

create function public.channel_mls_members(p_channel_id uuid, p_sender_device_id uuid)
returns table(device_id uuid, user_id uuid, mls_credential text, joined_epoch integer)
language sql
stable
security definer
set search_path = public
as $$
  select member.device_id, member.user_id, member.mls_credential, member.joined_epoch
  from public.mls_group_members member
  join public.mls_groups group_row on group_row.channel_id = member.channel_id
  join public.devices founder on founder.id = group_row.founder_device_id
  where member.channel_id = p_channel_id
    and member.removed_epoch is null
    and group_row.founder_device_id = p_sender_device_id
    and founder.user_id = auth.uid()
    and founder.revoked_at is null
  order by member.joined_epoch, member.device_id;
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
declare
  v_sequence bigint;
  v_envelope jsonb;
  v_recipient public.devices%rowtype;
begin
  if not public.has_channel_permission(p_channel_id, 1)
    or not exists(select 1 from public.devices where id = p_sender_device_id and user_id = auth.uid() and revoked_at is null)
    or not public.has_channel_permission(p_channel_id, 1, p_recipient_user_id)
    or p_epoch < 1 or char_length(p_event_payload) not between 1 and 524288
    or char_length(p_welcome_envelope) not between 1 and 1048576 then
    raise exception 'invalid MLS add publication';
  end if;
  select * into v_recipient from public.devices
  where id = p_recipient_device_id and user_id = p_recipient_user_id and revoked_at is null;
  if not found then raise exception 'invalid MLS recipient'; end if;
  begin
    v_envelope := p_welcome_envelope::jsonb;
    perform p_event_payload::jsonb;
  exception when others then
    raise exception 'MLS payloads must be valid JSON';
  end;
  perform 1 from public.mls_groups
  where channel_id = p_channel_id and founder_device_id = p_sender_device_id
  for update;
  if not found then raise exception 'only the MLS founder may publish add commits'; end if;
  if p_epoch <> (select current_epoch + 1 from public.mls_groups where channel_id = p_channel_id) then
    raise exception 'non-sequential MLS epoch';
  end if;
  if exists(select 1 from public.mls_group_members where channel_id = p_channel_id and device_id = p_recipient_device_id and removed_epoch is null) then
    raise exception 'device is already an active MLS member';
  end if;
  insert into public.mls_group_events(channel_id, epoch, event_type, sender_device_id, payload)
  values(p_channel_id, p_epoch, 'ADD_COMMIT', p_sender_device_id, p_event_payload)
  returning sequence into v_sequence;
  v_envelope := jsonb_set(v_envelope, '{joinedAfterSequence}', to_jsonb(v_sequence), true);
  insert into public.channel_key_envelopes(channel_id, recipient_user_id, recipient_device_id, epoch, envelope)
  values(p_channel_id, p_recipient_user_id, p_recipient_device_id, p_epoch, v_envelope::text)
  on conflict(channel_id, recipient_device_id, epoch) do update set envelope = excluded.envelope;
  insert into public.mls_group_members(channel_id, device_id, user_id, mls_credential, joined_epoch, removed_epoch)
  values(p_channel_id, v_recipient.id, v_recipient.user_id, v_recipient.mls_credential, p_epoch, null)
  on conflict(channel_id, device_id) do update
  set user_id = excluded.user_id,
      mls_credential = excluded.mls_credential,
      joined_epoch = excluded.joined_epoch,
      removed_epoch = null;
  update public.mls_groups set current_epoch = p_epoch where channel_id = p_channel_id;
  return v_sequence;
end;
$$;

create function public.publish_mls_remove(
  p_channel_id uuid,
  p_sender_device_id uuid,
  p_removed_device_id uuid,
  p_epoch integer,
  p_event_payload text
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare v_sequence bigint; v_removed public.devices%rowtype;
begin
  if not public.has_channel_permission(p_channel_id, 1)
    or not exists(select 1 from public.devices where id = p_sender_device_id and user_id = auth.uid() and revoked_at is null)
    or p_removed_device_id = p_sender_device_id
    or p_epoch < 1
    or char_length(p_event_payload) not between 1 and 524288 then
    raise exception 'invalid MLS remove publication';
  end if;
  begin
    perform p_event_payload::jsonb;
  exception when others then
    raise exception 'MLS event payload must be valid JSON';
  end;
  perform 1 from public.mls_groups
  where channel_id = p_channel_id and founder_device_id = p_sender_device_id
  for update;
  if not found then raise exception 'only the MLS founder may publish remove commits'; end if;
  select * into v_removed from public.devices where id = p_removed_device_id;
  if not found then raise exception 'unknown MLS member device'; end if;
  if v_removed.revoked_at is null and public.has_channel_permission(p_channel_id, 1, v_removed.user_id) then
    raise exception 'cannot remove an authorized active device';
  end if;
  if not exists(select 1 from public.mls_group_members where channel_id = p_channel_id and device_id = p_removed_device_id and removed_epoch is null) then
    raise exception 'device is not an active MLS member';
  end if;
  if p_epoch <> (select current_epoch + 1 from public.mls_groups where channel_id = p_channel_id) then
    raise exception 'non-sequential MLS epoch';
  end if;
  insert into public.mls_group_events(channel_id, epoch, event_type, sender_device_id, payload)
  values(p_channel_id, p_epoch, 'REMOVE_COMMIT', p_sender_device_id, p_event_payload)
  returning sequence into v_sequence;
  update public.mls_group_members
  set removed_epoch = p_epoch
  where channel_id = p_channel_id and device_id = p_removed_device_id;
  update public.mls_groups set current_epoch = p_epoch where channel_id = p_channel_id;
  return v_sequence;
end;
$$;

revoke all on function public.append_mls_group_event(uuid, uuid, integer, text, text) from authenticated;
revoke all on function public.initialize_mls_group(uuid, uuid) from public, anon, authenticated;
revoke all on function public.channel_recipient_devices(uuid) from public, anon, authenticated;
revoke all on function public.channel_mls_members(uuid, uuid) from public, anon, authenticated;
revoke all on function public.publish_mls_add(uuid, uuid, integer, text, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.publish_mls_remove(uuid, uuid, uuid, integer, text) from public, anon, authenticated;
grant execute on function public.initialize_mls_group(uuid, uuid) to authenticated;
grant execute on function public.channel_recipient_devices(uuid) to authenticated;
grant execute on function public.channel_mls_members(uuid, uuid) to authenticated;
grant execute on function public.publish_mls_add(uuid, uuid, integer, text, uuid, uuid, text) to authenticated;
grant execute on function public.publish_mls_remove(uuid, uuid, uuid, integer, text) to authenticated;

commit;
