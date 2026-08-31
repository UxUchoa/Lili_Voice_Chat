begin;

create or replace function public.record_voice_moderation(
  p_server_id uuid, p_target_id uuid, p_channel_id uuid,
  p_action text, p_destination_channel_id uuid default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_permission bigint;
begin
  if p_action not in ('mute', 'unmute', 'deafen', 'undeafen', 'disconnect', 'move') then
    raise exception 'invalid voice moderation action';
  end if;
  v_permission := case
    when p_action in ('mute', 'unmute') then 256
    when p_action in ('deafen', 'undeafen') then 512
    else 1024 end;
  if not public.can_moderate_member(p_server_id, p_target_id, v_permission) then raise exception 'forbidden'; end if;
  if not exists(select 1 from public.channels where id = p_channel_id and server_id = p_server_id and kind = 'voice') then
    raise exception 'invalid voice channel';
  end if;
  if p_action = 'move' and not exists(
    select 1 from public.channels where id = p_destination_channel_id and server_id = p_server_id and kind = 'voice'
  ) then raise exception 'invalid destination channel'; end if;

  if p_action in ('mute', 'unmute') then
    update public.server_members set server_muted = p_action = 'mute'
    where server_id = p_server_id and user_id = p_target_id;
  elsif p_action in ('deafen', 'undeafen') then
    update public.server_members set server_deafened = p_action = 'deafen'
    where server_id = p_server_id and user_id = p_target_id;
  end if;
  perform public.write_audit(
    p_server_id, 'VOICE_' || upper(p_action), 'MEMBER', p_target_id,
    jsonb_build_object('channel_id', p_channel_id, 'destination_channel_id', p_destination_channel_id)
  );
end $$;

revoke all on function public.record_voice_moderation(uuid,uuid,uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.record_voice_moderation(uuid,uuid,uuid,text,uuid) to authenticated;

commit;
