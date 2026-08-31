begin;

create or replace function public.verify_device(p_target_device_id uuid, p_short_code text)
returns void language plpgsql security definer set search_path = public as $$
declare v_device public.devices%rowtype; v_expected text; v_supplied text;
begin
  select * into v_device from public.devices
  where id = p_target_device_id and user_id = auth.uid() and revoked_at is null;
  if not found then raise exception 'device not found'; end if;
  v_expected := upper(substr(regexp_replace(v_device.fingerprint, '[^A-Za-z0-9]', '', 'g'), 1, 20));
  v_supplied := upper(regexp_replace(coalesce(p_short_code, ''), '[^A-Za-z0-9]', '', 'g'));
  if char_length(v_supplied) <> 20 or v_supplied <> v_expected then
    raise exception 'verification code does not match';
  end if;
  update public.devices set verified_at = now() where id = p_target_device_id;
end $$;

revoke all on function public.verify_device(uuid,text) from public, anon, authenticated;
grant execute on function public.verify_device(uuid,text) to authenticated;

commit;
