begin;

drop policy if exists gdm_icons_download on storage.objects;
drop policy if exists gdm_icons_upload on storage.objects;
drop policy if exists gdm_icons_delete on storage.objects;

create policy gdm_icons_download
on storage.objects for select to authenticated
using (
  bucket_id = 'gdm-icons'
  and public.is_channel_member(
    ((storage.foldername(storage.objects.name))[1])::uuid
  )
);

create policy gdm_icons_upload
on storage.objects for insert to authenticated
with check (
  bucket_id = 'gdm-icons'
  and owner_id = (select auth.uid()::text)
  and public.is_channel_member(
    ((storage.foldername(storage.objects.name))[1])::uuid
  )
  and exists (
    select 1 from public.channels channel_row
    where channel_row.id =
      ((storage.foldername(storage.objects.name))[1])::uuid
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
      where channel_row.id =
        ((storage.foldername(storage.objects.name))[1])::uuid
        and channel_row.kind = 'gdm'
        and channel_row.created_by = (select auth.uid())
    )
  )
);

commit;
