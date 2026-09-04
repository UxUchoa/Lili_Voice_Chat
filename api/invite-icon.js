/**
 * O ícone do servidor, para o cartão do convite.
 *
 * O balde `server-icons` é privado: só membros baixam, e continua assim. O que
 * a migração `invite_preview` abriu é estreito — uma leitura anônima do ícone
 * de um servidor que tem convite vivo — e é exatamente a condição em que o
 * ícone já está sendo publicado por quem criou o convite.
 *
 * Mesmo assim o robô que monta o cartão não sabe mandar cabeçalho de API, então
 * quem busca o arquivo é esta função, com a chave publicável, e devolve os
 * bytes num endereço estável. A alternativa seria uma URL assinada no
 * `og:image`, que expira — e um cartão que funciona hoje e mostra imagem
 * quebrada daqui a uma semana é pior do que não ter imagem.
 *
 * O endereço só aceita o código do convite. O caminho do ícone nunca aparece
 * do lado de fora, então não dá para pedir o ícone de um servidor qualquer.
 */

import { fetchPreview } from "./invite.js";

const SUPABASE_URL = (
  process.env.VITE_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  ""
).replace(/\/+$/, "");
const SUPABASE_KEY =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  "";

const CODE = /^[A-Za-z0-9_-]{4,64}$/;
/** Só imagem sai daqui, aconteça o que acontecer com o balde. */
const IMAGE = /^image\/(png|jpeg|webp|gif|avif)$/;

export default async function handler(request, response) {
  const url = new URL(request.url ?? "/", "http://localhost");
  const code = url.searchParams.get("code") ?? "";
  if (!CODE.test(code) || !SUPABASE_URL || !SUPABASE_KEY) {
    response.statusCode = 404;
    response.end();
    return;
  }

  try {
    const preview = await fetchPreview(code);
    if (!preview || !preview.server_icon_path) {
      response.statusCode = 404;
      response.end();
      return;
    }
    const file = await fetch(
      `${SUPABASE_URL}/storage/v1/object/server-icons/${preview.server_icon_path
        .split("/")
        .map(encodeURIComponent)
        .join("/")}`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          authorization: `Bearer ${SUPABASE_KEY}`,
        },
      },
    );
    const type = file.headers.get("content-type") ?? "";
    if (!file.ok || !IMAGE.test(type)) {
      response.statusCode = 404;
      response.end();
      return;
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    response.statusCode = 200;
    response.setHeader("content-type", type);
    response.setHeader("content-length", String(bytes.length));
    // Mais longo que o da página: a imagem muda menos que o convite, e é o
    // pedido que mais se repete quando um link circula.
    response.setHeader(
      "cache-control",
      "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
    );
    response.end(bytes);
  } catch {
    response.statusCode = 404;
    response.end();
  }
}
