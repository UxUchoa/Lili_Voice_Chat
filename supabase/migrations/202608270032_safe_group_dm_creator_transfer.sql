begin;

create or replace function public.protect_channel_identity()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.id <> old.id
     or new.server_id is distinct from old.server_id
     or new.kind <> old.kind then
    raise exception 'immutable channel identity';
  end if;
  if new.created_by <> old.created_by and not (
    old.kind = 'gdm'
    and old.created_by = auth.uid()
    and not public.is_channel_member(old.id, old.created_by)
    and public.is_channel_member(old.id, new.created_by)
  ) then
    raise exception 'immutable channel identity';
  end if;
  return new;
end;
$$;

commit;
