begin;

grant usage on schema public to service_role;
grant select, insert, update on public.call_sessions to service_role;
grant select, update on public.notification_envelopes to service_role;
grant select, delete on public.push_subscriptions to service_role;

commit;
