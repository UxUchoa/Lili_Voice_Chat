begin;

alter table public.channels
  add column icon_path text check (icon_path is null or char_length(icon_path) <= 512);

insert into storage.buckets(id, name, public, file_size_limit)
values ('gdm-icons', 'gdm-icons', false, 5242880)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit;

create policy gdm_icons_download
on storage.objects for select to authenticated
using (
  bucket_id = 'gdm-icons'
  and public.is_channel_member(((storage.foldername(name))[1])::uuid)
);

create policy gdm_icons_upload
on storage.objects for insert to authenticated
with check (
  bucket_id = 'gdm-icons'
  and owner_id = (select auth.uid()::text)
  and public.is_channel_member(((storage.foldername(name))[1])::uuid)
  and exists (
    select 1 from public.channels channel_row
    where channel_row.id = ((storage.foldername(name))[1])::uuid
      and channel_row.kind = 'gdm'
  )
);

create policy gdm_icons_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'gdm-icons'
  and (
    owner_id = (select auth.uid()::text)
    or exists (
      select 1 from public.channels channel_row
      where channel_row.id = ((storage.foldername(name))[1])::uuid
        and channel_row.kind = 'gdm'
        and channel_row.created_by = (select auth.uid())
    )
  )
);

create function public.update_group_dm(
  p_channel_id uuid,
  p_name text,
  p_icon_path text default null
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.channels channel_row
    join public.channel_members member on member.channel_id = channel_row.id
    where channel_row.id = p_channel_id
      and channel_row.kind = 'gdm'
      and member.user_id = auth.uid()
  ) then
    raise exception 'group dm not found or forbidden';
  end if;
  if char_length(trim(coalesce(p_name, ''))) not between 1 and 100 then
    raise exception 'group dm name must contain 1-100 characters';
  end if;
  if p_icon_path is not null and (
    char_length(p_icon_path) > 512
    or p_icon_path not like p_channel_id::text || '/%'
  ) then
    raise exception 'invalid group dm icon path';
  end if;
  update public.channels
  set name = trim(p_name), icon_path = p_icon_path, updated_at = now()
  where id = p_channel_id;
end;
$$;

create function public.add_group_dm_member(
  p_channel_id uuid,
  p_user_id uuid
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_channel public.channels%rowtype;
begin
  select * into v_channel from public.channels
  where id = p_channel_id for update;
  if not found or v_channel.kind <> 'gdm'
     or not public.is_channel_member(p_channel_id, auth.uid()) then
    raise exception 'group dm not found or forbidden';
  end if;
  if public.is_channel_member(p_channel_id, p_user_id) then return; end if;
  if (select count(*) from public.channel_members where channel_id = p_channel_id) >= 20 then
    raise exception 'group dm member limit reached';
  end if;
  if not public.can_direct_message(p_user_id, auth.uid()) then
    raise exception 'direct messages are not allowed for target';
  end if;
  insert into public.channel_members(channel_id, user_id)
  values (p_channel_id, p_user_id);
end;
$$;

create function public.remove_group_dm_member(
  p_channel_id uuid,
  p_user_id uuid
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_channel public.channels%rowtype;
  v_next_creator uuid;
begin
  select * into v_channel from public.channels
  where id = p_channel_id for update;
  if not found or v_channel.kind <> 'gdm'
     or not public.is_channel_member(p_channel_id, auth.uid()) then
    raise exception 'group dm not found or forbidden';
  end if;
  if not public.is_channel_member(p_channel_id, p_user_id) then
    raise exception 'group dm member not found';
  end if;
  if p_user_id <> auth.uid() and v_channel.created_by <> auth.uid() then
    raise exception 'only the group creator can remove another member';
  end if;

  delete from public.channel_members
  where channel_id = p_channel_id and user_id = p_user_id;

  select member.user_id into v_next_creator
  from public.channel_members member
  where member.channel_id = p_channel_id
  order by member.joined_at, member.user_id
  limit 1;
  if v_next_creator is null then
    delete from public.channels where id = p_channel_id;
  elsif p_user_id = v_channel.created_by then
    update public.channels
    set created_by = v_next_creator, updated_at = now()
    where id = p_channel_id;
  end if;
end;
$$;

revoke all on function public.update_group_dm(uuid, text, text),
  public.add_group_dm_member(uuid, uuid),
  public.remove_group_dm_member(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.update_group_dm(uuid, text, text),
  public.add_group_dm_member(uuid, uuid),
  public.remove_group_dm_member(uuid, uuid)
to authenticated;

commit;
