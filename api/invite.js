/**
 * O cartão que aparece quando alguém cola um convite do Lili em outro lugar.
 *
 * Um link colado no Discord, no WhatsApp ou no Slack vira um cartão montado a
 * partir das etiquetas Open Graph da página. Como todo convite era
 * `https://site/#/invite/CODE`, e um fragmento **nunca** chega ao servidor,
 * todos eles pediam a mesma página inicial e recebiam o mesmo cartão: "Lili —
 * Voice Chat" no título e "Lili — Voice Chat" na descrição. Quem recebia o
 * convite não tinha como saber para onde estava sendo chamado.
 *
 * Agora o convite mora em `/invite/<codigo>`, que é caminho e chega até aqui.
 * Esta função responde com o nome do servidor, a quantidade de membros e o
 * ícone — e só então manda a pessoa para dentro do aplicativo.
 *
 * O desvio é feito por script e por `meta refresh`, e não por HTTP 302, porque
 * um 302 seria seguido também pelo robô que veio buscar o cartão: ele acabaria
 * na página do aplicativo e leria de novo as etiquetas genéricas. Robô não
 * executa script; pessoa não vê a diferença.
 *
 * Só a chave publicável entra aqui. A prévia é uma função `security definer`
 * liberada para `anon` (ver a migração `invite_preview`), então esta função não
 * precisa — e não deve — carregar segredo nenhum.
 */

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

const SITE_NAME = "Lili — Voice Chat";

/** Um código inventado não deve nem virar chamada ao banco. */
const CODE = /^[A-Za-z0-9_-]{4,64}$/;

const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/**
 * O código do pedido, do parâmetro que a reescrita da Vercel monta ou do
 * caminho, quando a função é chamada direto.
 *
 * O caminho é conferido inteiro, e não pelo último pedaço. Pegar o último
 * segmento parecia equivalente e não era: `new URL` normaliza `..`, então
 * `/invite/../../etc/passwd` virava `/etc/passwd` e o "código" saía como
 * `passwd` — um valor que não abre nada, mas que também não deveria ter
 * chegado até a consulta.
 */
const PATH = /^\/invite\/([A-Za-z0-9_-]{4,64})\/?$/;

export async function inviteCodeFrom(request) {
  const url = new URL(request.url ?? "/", "http://localhost");
  const fromQuery = url.searchParams.get("code");
  if (fromQuery) return CODE.test(fromQuery) ? fromQuery : "";
  return PATH.exec(url.pathname)?.[1] ?? "";
}

/** O que o banco sabe contar sobre este convite, ou `null` se ele não vale. */
export async function fetchPreview(code, fetchImpl = fetch) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const response = await fetchImpl(
    `${SUPABASE_URL}/rest/v1/rpc/invite_preview`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: SUPABASE_KEY,
        authorization: `Bearer ${SUPABASE_KEY}`,
      },
      body: JSON.stringify({ p_code: code }),
    },
  );
  if (!response.ok) return null;
  const rows = await response.json();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

/**
 * A descrição do cartão.
 *
 * "12 membros · entra em #geral" diz mais, em menos espaço, do que a descrição
 * que o servidor escreveu — e a maioria dos servidores não escreveu nenhuma.
 * Quando existe, ela vem depois.
 */
export function describeInvite(preview) {
  const people =
    preview.member_count === 1 ? "1 membro" : `${preview.member_count} membros`;
  const head = preview.channel_name
    ? `${people} · entra em #${preview.channel_name}`
    : people;
  const own = (preview.server_description ?? "").trim();
  return own ? `${head} — ${own}` : head;
}

export function invitePage({ code, preview, origin }) {
  const target = `${origin}/#/invite/${encodeURIComponent(code)}`;
  const title = preview ? preview.server_name : "Convite para o Lili";
  const description = preview
    ? describeInvite(preview)
    : "Este convite não vale mais, ou nunca existiu.";
  const image =
    preview && preview.server_icon_path
      ? `${origin}/api/invite-icon?code=${encodeURIComponent(code)}`
      : `${origin}/logo-vetorizada.png`;
  const safe = {
    title: escapeHtml(title),
    description: escapeHtml(description),
    image: escapeHtml(image),
    target: escapeHtml(target),
    site: escapeHtml(SITE_NAME),
  };
  // `summary`, e não `summary_large_image`: o ícone de um servidor é quadrado e
  // pequeno, e esticá-lo numa faixa larga entrega um borrão.
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safe.title}</title>
    <meta name="description" content="${safe.description}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="${safe.site}" />
    <meta property="og:title" content="${safe.title}" />
    <meta property="og:description" content="${safe.description}" />
    <meta property="og:image" content="${safe.image}" />
    <meta property="og:url" content="${safe.target}" />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="${safe.title}" />
    <meta name="twitter:description" content="${safe.description}" />
    <meta name="twitter:image" content="${safe.image}" />
    <meta name="theme-color" content="#030202" />
    <meta http-equiv="refresh" content="0; url=${safe.target}" />
    <link rel="icon" href="/logo-vetorizada.ico" />
  </head>
  <body style="margin:0;background:#030202;color:#e8e8ea;font:14px system-ui,sans-serif">
    <p style="padding:24px">
      Abrindo o convite… <a style="color:#f23f42" href="${safe.target}">continuar</a>
    </p>
    <script>location.replace(${JSON.stringify(target)});</script>
  </body>
</html>`;
}

export default async function handler(request, response) {
  const code = await inviteCodeFrom(request);
  const host =
    request.headers["x-forwarded-host"] || request.headers.host || "";
  const proto = request.headers["x-forwarded-proto"] || "https";
  const origin = host ? `${proto}://${host}` : "";

  if (!code) {
    response.statusCode = 302;
    response.setHeader("location", "/");
    response.end();
    return;
  }

  let preview = null;
  try {
    preview = await fetchPreview(code);
  } catch {
    // O banco fora do ar não pode impedir a pessoa de entrar: sem prévia o
    // cartão fica genérico, e o desvio para o aplicativo acontece igual.
  }

  response.statusCode = 200;
  response.setHeader("content-type", "text/html; charset=utf-8");
  // Curto de propósito: um convite revogado precisa parar de anunciar o
  // servidor por aí, e quem guarda esta resposta é a borda, não o navegador.
  response.setHeader(
    "cache-control",
    "public, max-age=0, s-maxage=120, stale-while-revalidate=600",
  );
  response.end(invitePage({ code, preview, origin }));
}
