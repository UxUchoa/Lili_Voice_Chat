begin;

create or replace function public.enforce_channel_pin_limit()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.channel_id::text, 0));
  if (
    select count(*) >= 250
    from public.message_pins pin
    where pin.channel_id = new.channel_id
  ) then
    raise exception 'channel pin limit reached';
  end if;
  return new;
end;
$$;

drop trigger if exists message_pins_enforce_limit on public.message_pins;
create trigger message_pins_enforce_limit
before insert on public.message_pins
for each row execute function public.enforce_channel_pin_limit();

revoke all on function public.enforce_channel_pin_limit()
from public, anon, authenticated;

commit;
