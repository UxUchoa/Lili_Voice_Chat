begin;

alter table public.messages
  drop constraint if exists messages_mls_epoch_check;

alter table public.messages
  add constraint messages_mls_epoch_check check (mls_epoch >= 0);

commit;
