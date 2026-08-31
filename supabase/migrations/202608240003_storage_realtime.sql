begin;

insert into storage.buckets (id, name, public, file_size_limit)
values
  ('attachments', 'attachments', false, 26214400),
  ('avatars', 'avatars', false, 5242880),
  ('banners', 'banners', false, 10485760)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit;

create policy attachments_download
on storage.objects for select to authenticated
using (
  bucket_id = 'attachments'
  and public.has_channel_permission(((storage.foldername(name))[1])::uuid, 1)
);

create policy attachments_upload
on storage.objects for insert to authenticated
with check (
  bucket_id = 'attachments'
  and owner_id = (select auth.uid()::text)
  and public.has_channel_permission(((storage.foldername(name))[1])::uuid, 1048576)
);

create policy attachments_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'attachments'
  and (
    owner_id = (select auth.uid()::text)
    or public.has_channel_permission(((storage.foldername(name))[1])::uuid, 4)
  )
);

create policy profile_media_download
on storage.objects for select to authenticated
using (
  bucket_id in ('avatars','banners')
  and public.can_view_profile(((storage.foldername(name))[1])::uuid)
);

create policy profile_media_upload
on storage.objects for insert to authenticated
with check (
  bucket_id in ('avatars','banners')
  and owner_id = (select auth.uid()::text)
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

create policy profile_media_update
on storage.objects for update to authenticated
using (
  bucket_id in ('avatars','banners')
  and owner_id = (select auth.uid()::text)
)
with check (
  bucket_id in ('avatars','banners')
  and owner_id = (select auth.uid()::text)
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

create policy profile_media_delete
on storage.objects for delete to authenticated
using (bucket_id in ('avatars','banners') and owner_id = (select auth.uid()::text));

do $$
declare t text;
begin
  foreach t in array array[
    'messages','message_attachments','message_reactions','message_pins',
    'read_states','channel_key_envelopes','call_sessions'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

create policy janja_realtime_receive
on realtime.messages for select to authenticated
using (
  exists (
    select 1 from public.channels c
    where realtime.topic() = 'channel:' || c.id::text
      and public.has_channel_permission(c.id, 1)
  )
  or realtime.topic() = 'user:' || (select auth.uid())::text
);

create policy janja_realtime_send
on realtime.messages for insert to authenticated
with check (
  exists (
    select 1 from public.channels c
    where realtime.topic() = 'channel:' || c.id::text
      and public.has_channel_permission(c.id, 1)
  )
  or realtime.topic() = 'user:' || (select auth.uid())::text
);

commit;
