import { findAllowedOrigin, parseAllowedOrigins } from "./origins.ts";

/**
 * CORS das funções de borda.
 *
 * `ALLOWED_ORIGIN` aceita uma lista separada por vírgula porque uma
 * implantação real tem mais de uma origem legítima: o domínio de produção, a
 * pré-visualização da Vercel e o aplicativo desktop. Cada resposta só devolve
 * a origem que casou — nunca `*`, que o navegador recusa junto com
 * `Authorization`.
 *
 * Formatos aceitos em cada item:
 *   - origem exata           `https://lili.app`
 *   - subdomínio curinga     `https://*.vercel.app`
 *   - `null`                 o Electron empacotado carrega o `dist/` por
 *                            `file://`, e o Chromium manda `Origin: null`.
 *                            Sem isto, nenhuma chamada de voz funciona no
 *                            aplicativo instalado.
 */
const configured = parseAllowedOrigins(
  Deno.env.get("ALLOWED_ORIGIN") ?? "http://127.0.0.1:5173",
);

const BASE_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-push-secret, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  Vary: "Origin",
};

/** A origem da requisição, se estiver na lista. `null` quando não está. */
export function allowedOriginFor(request: Request): string | null {
  return findAllowedOrigin(configured, request.headers.get("Origin"));
}

function headersFor(origin: string | null): Record<string, string> {
  return origin
    ? { ...BASE_HEADERS, "Access-Control-Allow-Origin": origin }
    : { ...BASE_HEADERS };
}

/**
 * Cabeçalhos usados pelo `json()` das funções. A origem correta é aplicada
 * depois, por `withCors`, que é quem enxerga a requisição.
 */
export const corsHeaders = BASE_HEADERS;

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Envolve o handler: responde ao preflight e carimba a origem permitida em
 * tudo que sai. Quem chama de fora do navegador (cron, `curl`) não manda
 * `Origin` e não recebe cabeçalho nenhum — nem precisa.
 */
export function withCors(
  handler: (request: Request) => Response | Promise<Response>,
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    const origin = allowedOriginFor(request);
    const headers = headersFor(origin);
    if (request.method === "OPTIONS") return new Response("ok", { headers });
    const response = await handler(request);
    for (const [key, value] of Object.entries(headers))
      response.headers.set(key, value);
    return response;
  };
}
