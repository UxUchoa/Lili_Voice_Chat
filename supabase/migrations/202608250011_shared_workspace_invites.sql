begin;

-- Workspace state must be visible to other signed-in clients immediately.
-- RLS remains the authorization boundary for every published row.
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','servers','server_members','roles','member_roles','channels',
    'channel_members','friendships','blocks','bans','invites',
    'channel_permission_overrides','notification_settings','audit_logs'
  ] loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

create or replace function public.redeem_invite(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.invites%rowtype;
  v_inserted_count integer := 0;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;

  select * into v_invite
  from public.invites
  where code = trim(p_code)
  for update;

  if not found
    or v_invite.revoked_at is not null
    or (v_invite.expires_at is not null and v_invite.expires_at <= now())
    or (v_invite.max_uses is not null and v_invite.uses >= v_invite.max_uses)
  then
    raise exception 'invalid invite';
  end if;

  if exists (
    select 1 from public.bans
    where server_id = v_invite.server_id and user_id = auth.uid()
  ) then
    raise exception 'banned';
  end if;

  insert into public.server_members(server_id, user_id, join_source)
  values(v_invite.server_id, auth.uid(), 'invite:' || v_invite.code)
  on conflict do nothing;
  get diagnostics v_inserted_count = row_count;

  if v_inserted_count = 1 then
    update public.invites set uses = uses + 1 where id = v_invite.id;
    perform public.write_audit(
      v_invite.server_id,
      'MEMBER_JOIN',
      'MEMBER',
      auth.uid(),
      jsonb_build_object('source', 'invite', 'invite_id', v_invite.id)
    );
  end if;

  return v_invite.server_id;
end;
$$;

create or replace function public.revoke_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_invite public.invites%rowtype;
begin
  select * into v_invite
  from public.invites
  where id = p_invite_id
  for update;

  if not found then raise exception 'invite not found'; end if;
  if not public.has_server_permission(v_invite.server_id, 262144) then
    raise exception 'forbidden';
  end if;

  update public.invites
  set revoked_at = coalesce(revoked_at, now())
  where id = p_invite_id;

  perform public.write_audit(
    v_invite.server_id,
    'INVITE_REVOKE',
    'INVITE',
    v_invite.id,
    jsonb_build_object('code', v_invite.code)
  );
end;
$$;

revoke all on function public.revoke_invite(uuid) from public, anon, authenticated;
grant execute on function public.revoke_invite(uuid) to authenticated;

commit;
