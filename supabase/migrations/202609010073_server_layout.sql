begin;

-- ============================================================
-- Ordem e pastas da barra de servidores — itens 6 e 7
--
-- A organização é **de cada pessoa**, não do servidor: dois membros do mesmo
-- servidor arrastam para onde quiserem sem interferir um no outro. Por isso
-- tudo aqui é escopado por `user_id` e a RLS não deixa ninguém ler nem
-- escrever o arranjo alheio.
--
-- Pastas e servidores soltos dividem o **mesmo espaço de posição** no topo,
-- que é o que permite intercalar os dois como no Discord. Um servidor dentro
-- de pasta usa `position` para a ordem interna dela.
-- ============================================================

create table public.server_folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  -- Hex de 6 dígitos, ou nulo para a cor padrão do tema.
  color text,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  constraint server_folders_name_length
    check (btrim(name) <> '' and char_length(name) <= 60),
  constraint server_folders_color_format
    check (color is null or color ~ '^#[0-9a-fA-F]{6}$')
);
create index server_folders_user_idx on public.server_folders(user_id, position);

create table public.server_placements (
  user_id uuid not null references public.profiles(id) on delete cascade,
  server_id uuid not null references public.servers(id) on delete cascade,
  -- Nulo = solto no topo. A pasta precisa ser da mesma pessoa; a checagem
  -- vive na função que grava, porque a FK sozinha não sabe disso.
  folder_id uuid references public.server_folders(id) on delete set null,
  position integer not null default 0,
  primary key (user_id, server_id)
);
create index server_placements_user_idx
  on public.server_placements(user_id, folder_id, position);

alter table public.server_folders enable row level security;
alter table public.server_placements enable row level security;

-- Só a própria pessoa enxerga e mexe no próprio arranjo.
create policy server_folders_select on public.server_folders
  for select to authenticated using (user_id = (select auth.uid()));
create policy server_placements_select on public.server_placements
  for select to authenticated using (user_id = (select auth.uid()));

-- A escrita passa pelas funções abaixo, que validam dono e destino. Sem
-- política de insert/update/delete, nenhuma escrita direta é aceita.

-- ------------------------------------------------------------
-- Pastas
-- ------------------------------------------------------------
create or replace function public.create_server_folder(
  p_name text,
  p_color text default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
begin
  if v_user is null then raise exception 'authentication required'; end if;
  insert into public.server_folders(user_id, name, color, position)
  values (
    v_user,
    btrim(p_name),
    nullif(btrim(coalesce(p_color, '')), ''),
    -- Nasce no fim da barra; a ordem definitiva vem do arrasto seguinte.
    coalesce(
      (select max(position) + 1 from public.server_folders where user_id = v_user),
      0
    )
  )
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.update_server_folder(
  p_folder_id uuid,
  p_name text default null,
  p_color text default null
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_user uuid := auth.uid();
begin
  update public.server_folders
  set
    name = coalesce(nullif(btrim(p_name), ''), name),
    color = case
      when p_color is null then color
      when btrim(p_color) = '' then null
      else btrim(p_color)
    end
  where id = p_folder_id and user_id = v_user;
  if not found then raise exception 'folder not found'; end if;
end $$;

/**
 * Apaga a pasta sem tocar nos servidores.
 *
 * Uma pasta é organização, não pertencimento: dissolvê-la devolve os
 * servidores ao topo. Sair de um servidor é outra ação, e nem passa por aqui.
 */
create or replace function public.delete_server_folder(p_folder_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_user uuid := auth.uid();
begin
  if not exists (
    select 1 from public.server_folders
    where id = p_folder_id and user_id = v_user
  ) then
    raise exception 'folder not found';
  end if;
  -- O `on delete set null` já soltaria os servidores; isto deixa explícito e
  -- não depende de o leitor conhecer a FK.
  update public.server_placements
  set folder_id = null
  where user_id = v_user and folder_id = p_folder_id;
  delete from public.server_folders where id = p_folder_id and user_id = v_user;
end $$;

-- ------------------------------------------------------------
-- Arranjo
--
-- O arranjo chega inteiro, e não como "moveu um". Mandar tudo torna a
-- operação idempotente e imune a corrida entre duas abas da mesma conta: as
-- duas terminam num estado que alguém pediu, em vez de num intercalado que
-- ninguém pediu.
-- ------------------------------------------------------------
create or replace function public.save_server_layout(
  p_folders jsonb default '[]'::jsonb,
  p_servers jsonb default '[]'::jsonb
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'authentication required'; end if;
  if jsonb_array_length(coalesce(p_folders, '[]'::jsonb)) > 200
     or jsonb_array_length(coalesce(p_servers, '[]'::jsonb)) > 500 then
    raise exception 'layout too large';
  end if;

  update public.server_folders as folder
  set position = (entry->>'position')::integer
  from jsonb_array_elements(coalesce(p_folders, '[]'::jsonb)) as entry
  where folder.id = (entry->>'id')::uuid and folder.user_id = v_user;

  -- Só servidores dos quais a pessoa é membro, e só pastas dela. Um id de
  -- fora é ignorado em silêncio em vez de derrubar o arrasto inteiro.
  insert into public.server_placements(user_id, server_id, folder_id, position)
  select
    v_user,
    (entry->>'id')::uuid,
    nullif(entry->>'folder_id', '')::uuid,
    (entry->>'position')::integer
  from jsonb_array_elements(coalesce(p_servers, '[]'::jsonb)) as entry
  where exists (
      select 1 from public.server_members member
      where member.server_id = (entry->>'id')::uuid
        and member.user_id = v_user
    )
    and (
      entry->>'folder_id' is null
      or entry->>'folder_id' = ''
      or exists (
        select 1 from public.server_folders folder
        where folder.id = (entry->>'folder_id')::uuid
          and folder.user_id = v_user
      )
    )
  on conflict (user_id, server_id) do update
  set folder_id = excluded.folder_id, position = excluded.position;
end $$;

revoke all on function public.create_server_folder(text, text)
  from public, anon, authenticated;
revoke all on function public.update_server_folder(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.delete_server_folder(uuid)
  from public, anon, authenticated;
revoke all on function public.save_server_layout(jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.create_server_folder(text, text) to authenticated;
grant execute on function public.update_server_folder(uuid, text, text) to authenticated;
grant execute on function public.delete_server_folder(uuid) to authenticated;
grant execute on function public.save_server_layout(jsonb, jsonb) to authenticated;

grant select on public.server_folders to authenticated;
grant select on public.server_placements to authenticated;

commit;
