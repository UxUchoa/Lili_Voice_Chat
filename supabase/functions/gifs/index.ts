import { createClient } from "npm:@supabase/supabase-js@2";
import { json, withCors } from "../_shared/cors.ts";
import {
  clampLimit,
  giphyUrl,
  isGifMode,
  toGifCategories,
  toGifResults,
} from "./giphy.ts";

/**
 * Proxy da busca de GIFs.
 *
 * A chave do Giphy fica aqui e não no navegador. Uma variável `VITE_` é
 * embutida no pacote público — qualquer pessoa a leria no devtools e gastaria
 * a cota da conta. Aqui ela nunca sai do servidor.
 *
 * Exige sessão: sem isto o endereço da função seria um proxy aberto para o
 * Giphy, cortesia da nossa cota, para quem descobrisse a URL.
 */

/** O mesmo teto de anexo do chat, em bytes. Um GIF maior não teria como ser
    enviado, então nem entra na lista. */
const ATTACHMENT_MAX_BYTES = 30 * 1024 * 1024;

interface GifRequest {
  mode?: unknown;
  query?: unknown;
  limit?: unknown;
}

Deno.serve(
  withCors(async (request) => {
    if (request.method !== "POST")
      return json({ error: "method_not_allowed" }, 405);

    const authorization = request.headers.get("Authorization");
    if (!authorization?.startsWith("Bearer "))
      return json({ error: "unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const publishableKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const apiKey = Deno.env.get("GIF_API_KEY") ?? "";
    if (!supabaseUrl || !publishableKey)
      return json({ error: "server_not_configured" }, 503);

    const scoped = createClient(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    });
    const { data: authData, error: authError } = await scoped.auth.getUser();
    if (authError || !authData.user)
      return json({ error: "unauthorized" }, 401);

    // Depois da sessão, de propósito: quem não entrou não descobre nem se a
    // busca está configurada. O cliente recebe este código e mostra um aviso
    // próprio, apontando o caminho do anexo, em vez de uma grade vazia.
    if (!apiKey) return json({ error: "gifs_not_configured" }, 503);

    let body: GifRequest;
    try {
      body = await request.json();
    } catch {
      return json({ error: "invalid_json" }, 400);
    }

    const mode = body.mode;
    if (!isGifMode(mode)) return json({ error: "invalid_mode" }, 400);

    const query = typeof body.query === "string" ? body.query.trim() : "";
    if (mode === "search" && !query)
      return json({ error: "empty_query" }, 400);
    if (query.length > 120) return json({ error: "query_too_long" }, 400);

    let payload: unknown;
    try {
      const response = await fetch(
        giphyUrl(mode, {
          apiKey,
          query,
          limit: clampLimit(body.limit),
        }),
      );
      if (!response.ok) {
        // A chave recusada é problema de configuração do servidor, e não da
        // pessoa que está buscando — o cliente precisa saber a diferença.
        console.error("[gifs] Giphy respondeu", response.status);
        return json(
          {
            error:
              response.status === 401 || response.status === 403
                ? "gifs_key_rejected"
                : "gifs_upstream_error",
          },
          response.status === 429 ? 429 : 502,
        );
      }
      payload = await response.json();
    } catch (caught) {
      console.error("[gifs] falha ao falar com o Giphy", caught);
      return json({ error: "gifs_upstream_error" }, 502);
    }

    return json(
      mode === "categories"
        ? {
            categories: toGifCategories(
              payload as { data?: Parameters<typeof toGifCategories>[0] },
            ),
          }
        : {
            results: toGifResults(
              payload as Parameters<typeof toGifResults>[0],
              ATTACHMENT_MAX_BYTES,
            ),
          },
    );
  }),
);
