begin;

drop policy if exists janja_realtime_receive on realtime.messages;
drop policy if exists janja_realtime_send on realtime.messages;

create policy janja_realtime_receive
on realtime.messages for select to authenticated
using (
  exists (
    select 1 from public.channels c
    where realtime.topic() in (
        'channel:' || c.id::text,
        'presence:channel:' || c.id::text,
        'typing:channel:' || c.id::text
      )
      and public.has_channel_permission(c.id, 1)
  )
  or realtime.topic() = 'user:' || (select auth.uid())::text
);

create policy janja_realtime_send
on realtime.messages for insert to authenticated
with check (
  exists (
    select 1 from public.channels c
    where realtime.topic() in (
        'channel:' || c.id::text,
        'presence:channel:' || c.id::text,
        'typing:channel:' || c.id::text
      )
      and public.has_channel_permission(c.id, 1)
  )
  or realtime.topic() = 'user:' || (select auth.uid())::text
);

commit;
