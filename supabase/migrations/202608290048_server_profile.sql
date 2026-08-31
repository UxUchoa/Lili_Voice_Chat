begin;

-- ============================================================
-- Perfil do servidor: nome, ícone e descrição
--
-- A tabela `servers` já tinha `icon_path` e `description` desde o schema
-- inicial, mas nenhuma RPC os escrevia e o cliente mostrava sempre o mesmo
-- SVG do produto. Aqui o perfil passa a ser real: definido no modal de
-- criação, editável por quem tem MANAGE_SERVER e persistido no banco/Storage.
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit)
values ('server-icons', 'server-icons', false, 5242880)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit;

drop policy if exists server_icons_download on storage.objects;
drop policy if exists server_icons_upload on storage.objects;
drop policy if exists server_icons_delete on storage.objects;

-- Qualquer membro precisa baixar o ícone para desenhar a barra de servidores.
create policy server_icons_download
on storage.objects for select to authenticated
using (
  bucket_id = 'server-icons'
  and public.is_server_member(
    ((storage.foldername(storage.objects.name))[1])::uuid
  )
);

-- O cliente reserva o id do servidor antes de subir o ícone, porque a pasta
-- do bucket é "<server_id>/". Enquanto o servidor não existe ninguém é membro
-- dele, então a política aceita a pasta reservada e, depois de criado, exige
-- permissão de administração.
create policy server_icons_upload
on storage.objects for insert to authenticated
with check (
  bucket_id = 'server-icons'
  and owner_id = (select auth.uid()::text)
  and (
    not exists (
      select 1 from public.servers server_row
      where server_row.id =
        ((storage.foldername(storage.objects.name))[1])::uuid
    )
    or public.is_server_owner(
      ((storage.foldername(storage.objects.name))[1])::uuid
    )
    or public.has_server_permission(
      ((storage.foldername(storage.objects.name))[1])::uuid, 65536
    )
  )
  and public.can_accept_storage_upload(
    case
      when metadata ->> 'size' ~ '^[0-9]+$'
        then (metadata ->> 'size')::bigint
      else 0
    end
  )
);

create policy server_icons_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'server-icons'
  and (
    owner_id = (select auth.uid()::text)
    or public.is_server_owner(
      ((storage.foldername(storage.objects.name))[1])::uuid
    )
    or public.has_server_permission(
      ((storage.foldername(storage.objects.name))[1])::uuid, 65536
    )
  )
);

-- ------------------------------------------------------------
-- Id reservado para o upload do ícone antes da criação do servidor.
-- Não cria nada: se a criação falhar, o cliente remove o arquivo órfão.
-- ------------------------------------------------------------
create or replace function public.reserve_server_id()
returns uuid
language sql
volatile
as $fn$ select gen_random_uuid(); $fn$;

-- ------------------------------------------------------------
-- create_server passa a receber o perfil inteiro. A assinatura antiga de um
-- argumento é removida: com parâmetros opcionais, `create_server('nome')`
-- continua resolvendo para esta função sem ambiguidade.
-- ------------------------------------------------------------
drop function if exists public.create_server(text);

create or replace function public.create_server(
  p_name text,
  p_description text default '',
  p_icon_path text default null,
  p_server_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_server_id uuid := coalesce(p_server_id, gen_random_uuid());
  v_everyone_id uuid := gen_random_uuid();
  v_user uuid := auth.uid();
  v_name text := trim(coalesce(p_name, ''));
  v_description text := trim(coalesce(p_description, ''));
  -- VIEW_CHANNEL, SEND_MESSAGES, CREATE_INVITES, ADD_REACTIONS,
  -- ATTACH_FILES, EMBED_LINKS, READ_HISTORY, CONNECT, SPEAK,
  -- STREAM and USE_VAD.
  v_base bigint := 1081868515::bigint;
begin
  if v_user is null then raise exception 'authentication required'; end if;
  if char_length(v_name) not between 1 and 100 then
    raise exception 'invalid server name';
  end if;
  if char_length(v_description) > 1000 then
    raise exception 'invalid server description';
  end if;
  -- O caminho do ícone é sempre "<server_id>/<arquivo>"; recusar outro
  -- prefixo impede apontar o perfil para o arquivo de outro servidor.
  if p_icon_path is not null
     and p_icon_path !~ ('^' || v_server_id::text || '/') then
    raise exception 'invalid server icon path';
  end if;
  insert into public.servers(id, owner_id, name, description, icon_path)
    values(v_server_id, v_user, v_name, v_description, p_icon_path);
  insert into public.server_members(server_id, user_id, join_source)
    values(v_server_id, v_user, 'owner-created-server');
  insert into public.roles(id, server_id, name, position, permissions, is_default)
    values(v_everyone_id, v_server_id, '@everyone', 0, v_base, true);
  insert into public.channels(server_id, name, kind, position, created_by)
    values (v_server_id, 'geral', 'text', 0, v_user),
           (v_server_id, 'Lounge', 'voice', 1, v_user);
  perform public.write_audit(
    v_server_id, 'SERVER_CREATE', 'SERVER', v_server_id,
    jsonb_build_object('name', v_name, 'description', v_description)
  );
  return v_server_id;
end;
$fn$;

-- ------------------------------------------------------------
-- update_server: nome, descrição e ícone
-- ------------------------------------------------------------
drop function if exists public.update_server(uuid, text);

create or replace function public.update_server(
  p_server_id uuid,
  p_name text,
  p_description text default null,
  p_icon_path text default null,
  p_clear_icon boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_before public.servers%rowtype;
  v_name text := trim(coalesce(p_name, ''));
  v_description text;
  v_icon_path text;
begin
  if not (
    public.is_server_owner(p_server_id)
    or public.has_server_permission(p_server_id, 65536)
  ) then
    raise exception 'forbidden';
  end if;
  select * into v_before from public.servers where id = p_server_id;
  if not found then raise exception 'server not found'; end if;
  if char_length(v_name) not between 1 and 100 then
    raise exception 'invalid server name';
  end if;
  v_description := case
    when p_description is null then v_before.description
    else trim(p_description)
  end;
  if char_length(v_description) > 1000 then
    raise exception 'invalid server description';
  end if;
  v_icon_path := case
    when p_clear_icon then null
    when p_icon_path is null then v_before.icon_path
    else p_icon_path
  end;
  if v_icon_path is not null
     and v_icon_path !~ ('^' || p_server_id::text || '/') then
    raise exception 'invalid server icon path';
  end if;
  update public.servers
  set name = v_name,
      description = v_description,
      icon_path = v_icon_path,
      updated_at = now()
  where id = p_server_id;
  perform public.write_audit(
    p_server_id, 'SERVER_UPDATE', 'SERVER', p_server_id,
    jsonb_build_object(
      'before', jsonb_build_object(
        'name', v_before.name,
        'description', v_before.description,
        'icon_path', v_before.icon_path
      ),
      'after', jsonb_build_object(
        'name', v_name,
        'description', v_description,
        'icon_path', v_icon_path
      )
    )
  );
end;
$fn$;

revoke all on function public.create_server(text, text, text, uuid)
  from public, anon;
grant execute on function public.create_server(text, text, text, uuid)
  to authenticated;
revoke all on function public.update_server(uuid, text, text, text, boolean)
  from public, anon;
grant execute on function public.update_server(uuid, text, text, text, boolean)
  to authenticated;
revoke all on function public.reserve_server_id() from public, anon;
grant execute on function public.reserve_server_id() to authenticated;

commit;
