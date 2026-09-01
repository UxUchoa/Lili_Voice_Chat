import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Política permissiva usada em desenvolvimento e em qualquer build sem backend
 * configurado. O `dev` fala com Supabase, LiveKit e Vite por HTTP/WS em
 * 127.0.0.1, e enumerar isso não protege ninguém.
 */
const PERMISSIVE_CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: http: https:",
  "media-src 'self' blob: http: https:",
  "connect-src 'self' http: https: ws: wss:",
  "worker-src 'self' blob:",
].join("; ");

/**
 * `https://x.supabase.co` → `["https://x.supabase.co", "wss://x.supabase.co"]`.
 *
 * O esquema segue o da origem: um build apontado para a pilha local
 * (`http://127.0.0.1:54321`) precisa de `http:`/`ws:` liberados, e forçar
 * `https:` aqui bloquearia todas as requisições do desktop instalado.
 */
function bothSchemes(raw: string): string[] {
  const value = raw.trim();
  if (!value) return [];
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return [];
  }
  const secure = url.protocol === "https:" || url.protocol === "wss:";
  return [
    `${secure ? "https" : "http"}://${url.host}`,
    `${secure ? "wss" : "ws"}://${url.host}`,
  ];
}

/** Só a forma http(s): `img-src` e `media-src` não conhecem WebSocket. */
function httpOnly(raw: string): string[] {
  return bothSchemes(raw).slice(0, 1);
}

/**
 * Política de produção: só as origens que este build realmente usa.
 *
 * `connect-src` é o que importa — é por ali que dados sairiam se algum dia
 * entrasse script de terceiro. Storage entrega avatar, ícone e banner por URL
 * assinada, então a origem do Supabase precisa estar também em `img-src` e
 * `media-src`. O Tenor aparece porque o seletor de GIFs busca na API e baixa o
 * arquivo para reenviá-lo cifrado; nada do conteúdo do usuário passa por lá.
 */
function productionCsp(supabaseUrl: string, livekitUrl: string): string {
  const supabase = bothSchemes(supabaseUrl);
  const supabaseMedia = httpOnly(supabaseUrl);
  const livekit = bothSchemes(livekitUrl);
  const tenor = ["https://tenor.googleapis.com", "https://*.tenor.com"];
  const join = (...parts: string[][]) => parts.flat().filter(Boolean).join(" ");

  return [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    `img-src ${join(["'self'", "data:", "blob:"], supabaseMedia, tenor)}`,
    `media-src ${join(["'self'", "blob:", "data:"], supabaseMedia)}`,
    `connect-src ${join(
      ["'self'", "blob:", "data:"],
      supabase,
      livekit,
      tenor,
      ["https://fonts.googleapis.com", "https://fonts.gstatic.com"],
    )}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // `frame-ancestors` não vale em meta — o navegador ignora e ainda registra
    // um erro no console a cada carregamento, escondendo os que importam. Quem
    // recusa o enquadramento é o cabeçalho, em vercel.json.
  ].join("; ");
}

/**
 * Reescreve a meta CSP do `index.html` no build.
 *
 * Vale para a web e para o Electron, que carrega o `dist/` por `file://` e não
 * tem cabeçalho HTTP nenhum para receber a política.
 */
function cspPlugin(policy: string): Plugin {
  return {
    name: "lili-csp",
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        const meta =
          /(<meta http-equiv="Content-Security-Policy" content=")[^"]*(")/;
        if (!meta.test(html))
          throw new Error(
            "index.html perdeu a meta de Content-Security-Policy.",
          );
        return html.replace(meta, `$1${policy}$2`);
      },
    },
  };
}

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const configured = Boolean(env.VITE_SUPABASE_URL?.trim());
  const forDesktop = env.LILI_DESKTOP_BUILD === "true";
  const policy =
    command === "build" && configured
      ? productionCsp(env.VITE_SUPABASE_URL ?? "", env.VITE_LIVEKIT_URL ?? "")
      : PERMISSIVE_CSP;

  return {
    // O desktop empacotado abre o `dist/` por `file://`, onde o `/assets/...`
    // do padrão vira `file:///C:/assets/...` e não existe: a janela abre em
    // branco, sem erro visível. A web precisa do caminho absoluto porque o
    // `rewrites` da Vercel serve o index.html em qualquer profundidade, e ali
    // um caminho relativo apontaria para fora de `/assets`.
    base: forDesktop ? "./" : "/",
    plugins: [react(), cspPlugin(policy)],
    server: {
      host: "127.0.0.1",
      port: 5173,
    },
    build: {
      // Publicar o sourcemap entrega o código-fonte inteiro a quem abrir o
      // site. Ligue com LILI_SOURCEMAP=true quando precisar depurar um build.
      sourcemap: env.LILI_SOURCEMAP === "true",
    },
  };
});
