begin;

create or replace function public.move_channel_to_category(
  p_channel_id uuid, p_category_id uuid default null, p_sync_permissions boolean default true
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_channel public.channels%rowtype;
  v_category public.channels%rowtype;
  v_before_parent uuid;
begin
  select * into v_channel from public.channels where id = p_channel_id;
  if not found or v_channel.server_id is null or v_channel.kind in ('category', 'dm', 'gdm') or not (
    public.is_server_owner(v_channel.server_id) or public.has_server_permission(v_channel.server_id, 32768)
  ) then raise exception 'forbidden'; end if;
  v_before_parent := v_channel.parent_id;
  if p_category_id is not null then
    select * into v_category from public.channels where id = p_category_id;
    if not found or v_category.kind <> 'category' or v_category.server_id <> v_channel.server_id then
      raise exception 'invalid category';
    end if;
  end if;

  update public.channels
  set parent_id = p_category_id, permissions_synced = p_sync_permissions
  where id = p_channel_id;
  if p_sync_permissions then
    delete from public.channel_permission_overrides where channel_id = p_channel_id;
    if p_category_id is not null then
      insert into public.channel_permission_overrides(channel_id, target_type, target_id, allow_mask, deny_mask)
      select p_channel_id, target_type, target_id, allow_mask, deny_mask
      from public.channel_permission_overrides where channel_id = p_category_id;
    end if;
  end if;
  perform public.write_audit(
    v_channel.server_id, 'CHANNEL_UPDATE', 'CHANNEL', p_channel_id,
    jsonb_build_object('parent_before', v_before_parent, 'parent_after', p_category_id,
      'permissions_synced', p_sync_permissions)
  );
end $$;

revoke all on function public.move_channel_to_category(uuid,uuid,boolean) from public, anon, authenticated;
grant execute on function public.move_channel_to_category(uuid,uuid,boolean) to authenticated;

commit;
