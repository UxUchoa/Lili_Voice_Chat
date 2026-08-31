begin;

create or replace function public.set_channel_override(
  p_channel_id uuid, p_target_type text, p_target_id uuid,
  p_allow bigint, p_deny bigint
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_channel public.channels%rowtype;
begin
  select * into v_channel from public.channels where id = p_channel_id;
  if not found or v_channel.server_id is null
     or p_target_type not in ('ROLE','MEMBER')
     or (p_allow & p_deny) <> 0 then
    raise exception 'invalid override';
  end if;
  if not (
    public.is_server_owner(v_channel.server_id)
    or public.has_server_permission(v_channel.server_id, 32768)
  ) then raise exception 'forbidden'; end if;
  if p_target_type = 'ROLE' and not exists(
    select 1 from public.roles
    where id = p_target_id and server_id = v_channel.server_id
  ) then raise exception 'invalid role'; end if;
  if p_target_type = 'MEMBER'
     and not public.is_server_member(v_channel.server_id, p_target_id) then
    raise exception 'invalid member';
  end if;

  insert into public.channel_permission_overrides(
    channel_id, target_type, target_id, allow_mask, deny_mask
  ) values(p_channel_id, p_target_type, p_target_id, p_allow, p_deny)
  on conflict(channel_id, target_type, target_id) do update
  set allow_mask = excluded.allow_mask, deny_mask = excluded.deny_mask;

  if v_channel.kind = 'category' then
    insert into public.channel_permission_overrides(
      channel_id, target_type, target_id, allow_mask, deny_mask
    )
    select child.id, p_target_type, p_target_id, p_allow, p_deny
    from public.channels child
    where child.parent_id = p_channel_id and child.permissions_synced
    on conflict(channel_id, target_type, target_id) do update
    set allow_mask = excluded.allow_mask, deny_mask = excluded.deny_mask;
  elsif v_channel.parent_id is not null then
    update public.channels set permissions_synced = false where id = p_channel_id;
  end if;

  perform public.write_audit(
    v_channel.server_id, 'CHANNEL_OVERRIDE_UPDATE', p_target_type, p_target_id,
    jsonb_build_object(
      'channel_id', p_channel_id,
      'allow', p_allow,
      'deny', p_deny,
      'propagated_to_synced_children', v_channel.kind = 'category'
    )
  );
end;
$$;

create or replace function public.update_channel(
  p_channel_id uuid, p_name text, p_slowmode_seconds integer, p_private boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_channel public.channels%rowtype;
  v_everyone_id uuid;
  v_allow bigint;
  v_deny bigint;
begin
  select * into v_channel from public.channels where id = p_channel_id;
  if not found or v_channel.server_id is null or not (
    public.is_server_owner(v_channel.server_id)
    or public.has_server_permission(v_channel.server_id, 32768)
  ) then raise exception 'forbidden'; end if;
  if char_length(trim(p_name)) not between 1 and 100
     or p_slowmode_seconds not between 0 and 21600 then
    raise exception 'invalid channel settings';
  end if;

  update public.channels
  set name = trim(p_name), slowmode_seconds = p_slowmode_seconds,
      private = p_private
  where id = p_channel_id;

  if p_private is distinct from v_channel.private then
    select id into v_everyone_id
    from public.roles
    where server_id = v_channel.server_id and is_default;
    select coalesce(allow_mask, 0), coalesce(deny_mask, 0)
      into v_allow, v_deny
    from public.channel_permission_overrides
    where channel_id = p_channel_id
      and target_type = 'ROLE' and target_id = v_everyone_id;
    v_allow := coalesce(v_allow, 0) & ~1::bigint;
    if p_private then
      v_deny := coalesce(v_deny, 0) | 1::bigint;
    else
      v_deny := coalesce(v_deny, 0) & ~1::bigint;
    end if;
    perform public.set_channel_override(
      p_channel_id, 'ROLE', v_everyone_id, v_allow, v_deny
    );
  end if;

  perform public.write_audit(
    v_channel.server_id, 'CHANNEL_UPDATE', 'CHANNEL', p_channel_id,
    jsonb_build_object(
      'before', jsonb_build_object(
        'name', v_channel.name,
        'slowmode_seconds', v_channel.slowmode_seconds,
        'private', v_channel.private
      ),
      'after', jsonb_build_object(
        'name', trim(p_name),
        'slowmode_seconds', p_slowmode_seconds,
        'private', p_private
      )
    )
  );
end;
$$;

revoke all on function public.set_channel_override(uuid,text,uuid,bigint,bigint)
  from public, anon, authenticated;
revoke all on function public.update_channel(uuid,text,integer,boolean)
  from public, anon, authenticated;
grant execute on function public.set_channel_override(uuid,text,uuid,bigint,bigint)
  to authenticated;
grant execute on function public.update_channel(uuid,text,integer,boolean)
  to authenticated;

commit;
