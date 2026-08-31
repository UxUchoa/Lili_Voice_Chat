begin;

-- ============================================================
-- Cota por servidor e limpeza do que é mais antigo
--
-- A cota existia só no nível da instância: um painel dizia quanto do banco e
-- do Storage estava em uso, e nada mais. Numa implantação em plano gratuito,
-- onde todos os servidores dividem o mesmo teto, isso não ajuda ninguém — o
-- dono do servidor que está consumindo demais não tem como saber que é ele, e
-- não tem o que fazer a respeito.
--
-- Aqui cada servidor passa a ter uma fatia, e ela é dinâmica: o teto da
-- instância dividido pelo número de servidores. Criar um servidor novo encolhe
-- a fatia de todos, o que é exatamente o que "dividir a mesma banda"
-- significa — e é melhor que o rateio fique visível do que aconteça em
-- silêncio até alguém bater no teto.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Arquivo órfão: um bug que já existia
--
-- `message_attachments` cai por CASCADE quando a mensagem ou o canal somem, e
-- só a API de Storage apaga o arquivo — o Postgres recusa `delete` direto em
-- `storage.objects`. Ou seja: toda mensagem apagada desde sempre deixou o
-- anexo dela ocupando espaço para sempre, sem nenhuma linha apontando para
-- ele. A limpeza por cota tornaria isso muito pior, então o caminho passa a
-- ser registrado antes de a linha sumir.
-- ------------------------------------------------------------
create table if not exists public.pending_storage_deletions (
  id uuid primary key default gen_random_uuid(),
  bucket text not null,
  path text not null,
  created_at timestamptz not null default now(),
  unique (bucket, path)
);

alter table public.pending_storage_deletions enable row level security;
revoke all on public.pending_storage_deletions from public, anon, authenticated;
grant select, delete on public.pending_storage_deletions to service_role;

create or replace function public.capture_orphaned_attachment()
returns trigger language plpgsql set search_path = public as $$
begin
  insert into public.pending_storage_deletions(bucket, path)
  values ('attachments', old.storage_object)
  on conflict (bucket, path) do nothing;
  return old;
end;
$$;

drop trigger if exists message_attachments_capture_orphan on public.message_attachments;
create trigger message_attachments_capture_orphan
after delete on public.message_attachments
for each row execute function public.capture_orphaned_attachment();

-- ------------------------------------------------------------
-- 2. Quanto cada servidor está consumindo
--
-- A fatia é o teto da instância dividido pelo número de servidores. Os níveis
-- reaproveitam `quota_alert_level`, para que o servidor e a instância falem a
-- mesma língua: OK, NOTICE em 70%, WARNING em 85%, CRITICAL em 95%.
-- ------------------------------------------------------------
create or replace function public.server_quota_status(p_server_id uuid)
returns table(
  used_bytes bigint,
  share_bytes bigint,
  percent numeric,
  level text,
  message_count bigint,
  oldest_message_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_limit bigint;
  v_servers bigint;
  v_share bigint;
  v_used bigint;
begin
  -- 1 = VIEW_CHANNEL não basta: saber o consumo do servidor é informação de
  -- administração. 65536 = MANAGE_SERVER.
  if not public.has_server_permission(p_server_id, 65536) then
    raise exception 'forbidden';
  end if;

  select database_limit_bytes into v_limit
  from public.instance_quota_config where singleton;
  select greatest(count(*), 1) into v_servers from public.servers;
  v_share := greatest(v_limit / v_servers, 1);

  select
    coalesce(sum(octet_length(m.ciphertext)), 0)
      + coalesce((
        select sum(a.ciphertext_size)
        from public.message_attachments a
        join public.channels c on c.id = a.channel_id
        where c.server_id = p_server_id
      ), 0),
    count(*),
    min(m.created_at)
  into v_used, message_count, oldest_message_at
  from public.messages m
  join public.channels c on c.id = m.channel_id
  where c.server_id = p_server_id and m.deleted_at is null;

  return query select
    v_used,
    v_share,
    round(v_used::numeric * 100 / v_share, 2),
    public.quota_alert_level(v_used, v_share),
    message_count,
    oldest_message_at;
end;
$fn$;

-- ------------------------------------------------------------
-- 3. A limpeza
--
-- Da mensagem mais antiga para a mais nova, até o servidor caber na fatia.
-- Mensagem fixada é pulada: alguém marcou aquilo como o que vale guardar, e
-- uma limpeza automática não deveria discordar.
--
-- Apagar de verdade, e não marcar `deleted_at`, é o ponto: o soft delete não
-- devolve um byte, e devolver espaço é a razão de esta função existir.
-- ------------------------------------------------------------
create or replace function public.prune_server_messages(
  p_server_id uuid,
  p_target_percent numeric default 70
)
returns table(deleted_count integer, freed_bytes bigint)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_share bigint;
  v_used bigint;
  v_target bigint;
  v_row record;
  v_deleted integer := 0;
  v_freed bigint := 0;
begin
  if not public.has_server_permission(p_server_id, 65536) then
    raise exception 'forbidden';
  end if;

  select s.used_bytes, s.share_bytes into v_used, v_share
  from public.server_quota_status(p_server_id) s;
  v_target := (v_share * least(greatest(p_target_percent, 10), 100) / 100)::bigint;
  if v_used <= v_target then return query select 0, 0::bigint; return; end if;

  for v_row in
    select m.id,
           octet_length(m.ciphertext)
             + coalesce((
               select sum(a.ciphertext_size)
               from public.message_attachments a where a.message_id = m.id
             ), 0) as bytes
    from public.messages m
    join public.channels c on c.id = m.channel_id
    where c.server_id = p_server_id
      and m.deleted_at is null
      and not exists (
        select 1 from public.message_pins p where p.message_id = m.id
      )
    order by m.created_at, m.id
  loop
    exit when v_used - v_freed <= v_target;
    -- O gatilho da seção 1 registra o anexo para a função de borda apagar do
    -- Storage antes de a linha sumir por CASCADE.
    delete from public.messages where id = v_row.id;
    v_deleted := v_deleted + 1;
    v_freed := v_freed + v_row.bytes;
  end loop;

  return query select v_deleted, v_freed;
end;
$fn$;

-- ------------------------------------------------------------
-- 4. Permissões
-- ------------------------------------------------------------
revoke all on function public.server_quota_status(uuid) from public, anon;
grant execute on function public.server_quota_status(uuid) to authenticated;

revoke all on function public.prune_server_messages(uuid, numeric) from public, anon;
grant execute on function public.prune_server_messages(uuid, numeric) to authenticated;

revoke all on function public.capture_orphaned_attachment() from public, anon, authenticated;

commit;
