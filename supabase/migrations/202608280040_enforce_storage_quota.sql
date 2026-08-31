begin;

update public.instance_quota_config
set
  database_limit_bytes = 524288000,
  storage_limit_bytes = 1073741824,
  updated_at = now()
where singleton
  and database_limit_bytes = 10737418240
  and storage_limit_bytes = 10737418240;

create or replace function public.can_accept_storage_upload(
  p_size_bytes bigint default 0
) returns boolean
language sql
volatile
security definer
set search_path = public, storage, pg_temp
as $$
  select coalesce((
    select (
      coalesce((
        select sum(
          case
            when object_row.metadata ->> 'size' ~ '^[0-9]+$'
              then (object_row.metadata ->> 'size')::bigint
            else 0
          end
        )
        from storage.objects object_row
      ), 0) + greatest(coalesce(p_size_bytes, 0), 0)
    )::numeric / config.storage_limit_bytes < 0.95
    from public.instance_quota_config config
    where config.singleton
  ), false);
$$;

revoke all on function public.can_accept_storage_upload(bigint)
from public, anon;
grant execute on function public.can_accept_storage_upload(bigint)
to authenticated, service_role;

drop policy if exists attachments_upload on storage.objects;
create policy attachments_upload
on storage.objects for insert to authenticated
with check (
  bucket_id = 'attachments'
  and owner_id = (select auth.uid()::text)
  and public.has_channel_permission(
    ((storage.foldername(storage.objects.name))[1])::uuid,
    1048576
  )
  and public.can_accept_storage_upload(
    case
      when metadata ->> 'size' ~ '^[0-9]+$'
        then (metadata ->> 'size')::bigint
      else 0
    end
  )
);

drop policy if exists profile_media_upload on storage.objects;
create policy profile_media_upload
on storage.objects for insert to authenticated
with check (
  bucket_id in ('avatars','banners')
  and owner_id = (select auth.uid()::text)
  and (storage.foldername(storage.objects.name))[1] = (select auth.uid()::text)
  and public.can_accept_storage_upload(
    case
      when metadata ->> 'size' ~ '^[0-9]+$'
        then (metadata ->> 'size')::bigint
      else 0
    end
  )
);

drop policy if exists profile_media_update on storage.objects;
create policy profile_media_update
on storage.objects for update to authenticated
using (
  bucket_id in ('avatars','banners')
  and owner_id = (select auth.uid()::text)
)
with check (
  bucket_id in ('avatars','banners')
  and owner_id = (select auth.uid()::text)
  and (storage.foldername(storage.objects.name))[1] = (select auth.uid()::text)
  and public.can_accept_storage_upload(
    case
      when metadata ->> 'size' ~ '^[0-9]+$'
        then (metadata ->> 'size')::bigint
      else 0
    end
  )
);

drop policy if exists gdm_icons_upload on storage.objects;
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
  and public.can_accept_storage_upload(
    case
      when metadata ->> 'size' ~ '^[0-9]+$'
        then (metadata ->> 'size')::bigint
      else 0
    end
  )
);

commit;
