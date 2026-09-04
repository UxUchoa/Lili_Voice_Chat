begin;

-- ============================================================
-- Prévia pública de um convite
--
-- Um link de convite colado no Discord, no WhatsApp ou em qualquer lugar que
-- desdobre endereços virava sempre o mesmo cartão: "Lili — Voice Chat" no
-- título e "Lili — Voice Chat" na descrição, que são o `<title>` e a
-- `<meta description>` do site. Quem recebia não sabia para qual servidor
-- estava sendo chamado — e um convite que não diz para onde leva é um convite
-- que ninguém aceita.
--
-- Para o cartão mostrar o servidor, alguém precisa responder "que servidor é
-- este?" a um robô que não fez login. Daí esta função, que é a **primeira
-- superfície anônima** deste banco. Por isso o cuidado abaixo é maior do que
-- o tamanho dela sugere.
--
-- O que ela entrega: nome do servidor, caminho do ícone, quantidade de membros
-- e o nome do canal de entrada. Nada de ids, nada de quem são os membros, nada
-- do dono, nada de mensagem. É o mesmo conjunto que o Discord mostra, e é o
-- que qualquer pessoa veria de qualquer forma ao aceitar o convite.
--
-- O que a protege: o código. São 9 bytes aleatórios (72 bits) em base64url —
-- não se adivinha e não se enumera. Quem tem o código já foi convidado; a
-- prévia não conta nada que entrar no servidor não contasse.
--
-- Convite revogado, expirado ou esgotado não devolve linha nenhuma. O cartão
-- volta a ser o genérico do site, que é o certo: um convite morto não deve
-- continuar anunciando o servidor por aí.
-- ============================================================

create or replace function public.invite_preview(p_code text)
returns table (
  server_name text,
  server_icon_path text,
  server_description text,
  channel_name text,
  member_count integer
)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select
    s.name,
    s.icon_path,
    s.description,
    c.name,
    (select count(*)::integer from public.server_members m where m.server_id = s.id)
  from public.invites i
  join public.servers s on s.id = i.server_id
  join public.channels c on c.id = i.channel_id
  where i.code = p_code
    and i.revoked_at is null
    and (i.expires_at is null or i.expires_at > now())
    and (i.max_uses is null or i.uses < i.max_uses);
$$;

-- `public` inclui todo papel presente e futuro; os dois que podem chamar são
-- nomeados um a um. `anon` porque o desdobramento do link não tem sessão.
revoke all on function public.invite_preview(text) from public;
grant execute on function public.invite_preview(text) to anon, authenticated;

-- ============================================================
-- O ícone do servidor na prévia
--
-- O balde `server-icons` é privado e só membros baixam — e assim continua. O
-- que a política abaixo abre é estreito: uma leitura anônima de um ícone cujo
-- servidor tem convite vivo. É a mesma condição da função acima, e a mesma
-- decisão de quem criou o convite: quem publica um convite está publicando o
-- nome e a cara do servidor junto.
--
-- Some sozinha quando o convite morre, porque a condição é avaliada a cada
-- leitura — revogar o convite volta a esconder o ícone no mesmo instante.
--
-- A condição não pode ser escrita direto na política. Uma política roda com os
-- privilégios de quem está lendo, e `anon` não tem — nem pode ter — `select`
-- em `public.invites`: seria entregar a lista de todos os códigos de convite
-- do banco a qualquer um. Escrita direto, a política falhava com
--
--     permission denied for table invites
--
-- e o ícone nunca aparecia. Quem responde é a função `security definer` abaixo,
-- que lê `invites` como dona e devolve só um sim ou não.
--
-- Ela mora fora de `public` de propósito: o PostgREST expõe `public`, `storage`
-- e `graphql_public`, e uma função em `public` liberada para `anon` viraria um
-- endpoint. Em `private` ela continua chamável de dentro da política e
-- inalcançável de fora.
-- ============================================================

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated;

create or replace function private.server_has_live_invite(p_server_id uuid)
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select exists (
    select 1
    from public.invites i
    where i.server_id = p_server_id
      and i.revoked_at is null
      and (i.expires_at is null or i.expires_at > now())
      and (i.max_uses is null or i.uses < i.max_uses)
  );
$$;

revoke all on function private.server_has_live_invite(uuid) from public;
grant execute on function private.server_has_live_invite(uuid) to anon, authenticated;

drop policy if exists server_icons_invite_preview on storage.objects;
create policy server_icons_invite_preview
on storage.objects for select to anon
using (
  bucket_id = 'server-icons'
  and private.server_has_live_invite(
    ((storage.foldername(storage.objects.name))[1])::uuid
  )
);

commit;
