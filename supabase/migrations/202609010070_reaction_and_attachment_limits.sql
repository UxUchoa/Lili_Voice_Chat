begin;

-- ============================================================
-- Tetos de reação e de anexo, impostos também no servidor
--
-- A validação do cliente é conveniência; ela não vale como garantia porque
-- qualquer um fala com a API direto. Estas duas regras são o que o banco
-- consegue impor sozinho.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Reação
--
-- O limite do produto é de 15 **grafemas** — o que a pessoa enxerga como um
-- caractere. Postgres não segmenta grafemas, então a contagem exata fica no
-- cliente (`src/domain/reactions.ts`) e aqui vai o que o banco sabe garantir:
--
--   * não vazia depois de tirar os espaços — hoje `'   '` passava, porque o
--     check só media `char_length`, e a reação entrava em branco;
--   * um teto duro de caracteres, para nada absurdo ser persistido.
--
-- 128 continua sendo o teto de caracteres: quinze grafemas cabem folgados
-- nele, mesmo em sequências ZWJ longas como 👨‍👩‍👧‍👦.
-- ------------------------------------------------------------
delete from public.message_reactions where btrim(emoji) = '';

alter table public.message_reactions
  drop constraint message_reactions_emoji_check;
alter table public.message_reactions
  add constraint message_reactions_emoji_check
  check (btrim(emoji) <> '' and char_length(emoji) <= 128);

-- ------------------------------------------------------------
-- 2. Anexo
--
-- O teto passa de 100 MB para 30 MB. O valor antigo carregava a folga do tag
-- do AEAD (104861696 = 100 MiB + 16 B), que existia porque o arquivo subia
-- cifrado; sem E2EE o tamanho gravado é o do próprio arquivo, então o teto é
-- exato.
--
-- As linhas existentes acima do novo teto não são apagadas: elas apontam para
-- arquivos que ainda estão no Storage e expiram sozinhas em 24 h. A constraint
-- entra como `not valid` para não recusar a migração por causa delas, e passa
-- a valer para toda inserção nova — que é o que o limite precisa cobrir.
-- ------------------------------------------------------------
alter table public.message_attachments
  drop constraint message_attachments_byte_size_check;
alter table public.message_attachments
  add constraint message_attachments_byte_size_check
  check (byte_size >= 1 and byte_size <= 31457280) not valid;

commit;
