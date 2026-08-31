begin;

-- ============================================================
-- Anexos: 100 MB, validade de um dia e pedido de reenvio
--
-- O limite era 25 MB e não havia validade nenhuma: todo arquivo enviado ficava
-- no bucket para sempre, e a única forma de ver um anexo era baixá-lo. Agora o
-- arquivo vive 24 h; depois disso ele some do armazenamento e quem quiser vê-lo
-- pede o reenvio a quem mandou.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Teto de 100 MB
--    O ciphertext do AES-GCM é o arquivo + 16 bytes de tag; a folga de 4 KB
--    cobre isso sem deixar passar um arquivo de verdade maior que o limite.
-- ------------------------------------------------------------
alter table public.message_attachments
  drop constraint if exists message_attachments_ciphertext_size_check;
alter table public.message_attachments
  add constraint message_attachments_ciphertext_size_check
  check (ciphertext_size between 1 and 104861696);

update storage.buckets
set file_size_limit = 104861696
where id = 'attachments';

-- ------------------------------------------------------------
-- 2. Validade
-- ------------------------------------------------------------
alter table public.message_attachments
  add column if not exists expires_at timestamptz not null
  default (now() + interval '1 day');

create index if not exists message_attachments_expires_idx
  on public.message_attachments(expires_at);

-- A limpeza **não** mora aqui. O Supabase instala um gatilho que recusa
-- `delete` direto em `storage.objects` ("Direct deletion from storage tables is
-- not allowed"), então apagar a linha da tabela deixaria o arquivo no bucket.
-- Quem remove de verdade é a função de borda `attachments-expire`, que usa a
-- API de Storage com a service role. Este `drop` existe para o caso de a versão
-- anterior desta migração já ter criado a função em algum banco.
drop function if exists public.expire_message_attachments();

-- Esta instância não dá acesso amplo ao service_role: cada tabela é liberada
-- na mão. A função de borda precisa ler o que venceu e apagar a linha depois
-- de remover o arquivo.
grant select, delete on public.message_attachments to service_role;

-- ------------------------------------------------------------
-- 3. Pedido de reenvio
-- ------------------------------------------------------------
create table if not exists public.attachment_resend_requests (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  channel_id uuid not null references public.channels(id) on delete cascade,
  -- O id do anexo vive dentro do payload cifrado; aqui ele é só uma etiqueta.
  attachment_id text not null check (char_length(attachment_id) between 1 and 100),
  attachment_name text not null check (char_length(attachment_name) between 1 and 255),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (message_id, attachment_id, requester_id)
);
create index if not exists attachment_resend_open_idx
  on public.attachment_resend_requests(channel_id, resolved_at);

alter table public.attachment_resend_requests enable row level security;

-- Quem vê o canal vê os pedidos dele: o aviso aparece na própria mensagem,
-- para os dois lados da conversa. O `drop` antes do `create` é o que torna
-- esta migração repetível: sem ele, aplicar de novo num banco que já tem a
-- política aborta a transação inteira e nada mais desta migração entra.
drop policy if exists attachment_resend_select on public.attachment_resend_requests;
create policy attachment_resend_select
on public.attachment_resend_requests for select to authenticated
using (public.has_channel_permission(channel_id, 1));

grant select on public.attachment_resend_requests to authenticated;

create or replace function public.request_attachment_resend(
  p_message_id uuid,
  p_attachment_id text,
  p_attachment_name text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_message public.messages%rowtype;
  v_id uuid;
begin
  select * into v_message from public.messages where id = p_message_id;
  if not found or v_message.deleted_at is not null then
    raise exception 'message not found';
  end if;
  -- 1 = VIEW_CHANNEL.
  if not public.has_channel_permission(v_message.channel_id, 1) then
    raise exception 'forbidden';
  end if;
  if v_message.author_id = auth.uid() then
    raise exception 'cannot request a resend from yourself';
  end if;

  insert into public.attachment_resend_requests(
    message_id, channel_id, attachment_id, attachment_name,
    requester_id, owner_id
  )
  values(
    p_message_id, v_message.channel_id,
    left(trim(coalesce(p_attachment_id, '')), 100),
    left(trim(coalesce(p_attachment_name, '')), 255),
    auth.uid(), v_message.author_id
  )
  on conflict (message_id, attachment_id, requester_id) do update
    set created_at = now(), resolved_at = null
  returning id into v_id;
  return v_id;
end;
$fn$;

/** Quem mandou o arquivo encerra o pedido depois de reenviar. */
create or replace function public.resolve_attachment_resend(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare v_request public.attachment_resend_requests%rowtype;
begin
  select * into v_request
  from public.attachment_resend_requests where id = p_request_id;
  if not found then raise exception 'request not found'; end if;
  if v_request.owner_id <> auth.uid() and v_request.requester_id <> auth.uid() then
    raise exception 'forbidden';
  end if;
  update public.attachment_resend_requests
  set resolved_at = now() where id = p_request_id;
end;
$fn$;

revoke all on function public.request_attachment_resend(uuid, text, text)
  from public, anon;
grant execute on function public.request_attachment_resend(uuid, text, text)
  to authenticated;
revoke all on function public.resolve_attachment_resend(uuid) from public, anon;
grant execute on function public.resolve_attachment_resend(uuid) to authenticated;

do $do$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'attachment_resend_requests'
  ) then
    alter publication supabase_realtime add table public.attachment_resend_requests;
  end if;
end $do$;

commit;
