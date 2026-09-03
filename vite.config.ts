import { readFileSync } from "node:fs";
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
 * `media-src`.
 *
 * O Giphy entra nos dois: `img-src` porque a grade do seletor desenha as
 * prévias direto do CDN, e `connect-src` porque `downloadGifAsFile` busca o
 * arquivo escolhido no navegador para reenviá-lo como anexo nosso. A API do
 * Giphy não aparece aqui — quem fala com ela é a função de borda, para a chave
 * não viajar no pacote público.
 *
 * Esta lista já ficou para trás uma vez: liberava o Tenor, o provedor anterior,
 * enquanto o seletor já buscava no Giphy. Como o `dev` usa a política
 * permissiva, tudo funcionava na máquina de quem programava e nada carregava em
 * produção nem no desktop — os dois únicos lugares onde esta função roda.
 */
export function productionCsp(supabaseUrl: string, livekitUrl: string): string {
  const supabase = bothSchemes(supabaseUrl);
  const supabaseMedia = httpOnly(supabaseUrl);
  const livekit = bothSchemes(livekitUrl);
  const giphy = ["https://*.giphy.com"];
  const join = (...parts: string[][]) => parts.flat().filter(Boolean).join(" ");

  return [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    `img-src ${join(["'self'", "data:", "blob:"], supabaseMedia, giphy)}`,
    `media-src ${join(["'self'", "blob:", "data:"], supabaseMedia)}`,
    `connect-src ${join(
      ["'self'", "blob:", "data:"],
      supabase,
      livekit,
      giphy,
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

/**
 * As notas da versão que este build está empacotando.
 *
 * Depois de instalar uma atualização, o `electron-updater` não tem mais nada a
 * dizer: ele anuncia o que está por vir, não o que acabou de chegar. O aviso
 * de "atualizado para a versão X" ficava sem como mostrar o que mudou —
 * justamente no momento em que a pessoa quer saber.
 *
 * Recortar aqui resolve porque o texto passa a viajar dentro do próprio
 * pacote: a versão instalada sempre sabe as próprias notas, sem rede e sem
 * depender da release do GitHub. O corte é o mesmo de
 * `scripts/release-notes.mjs`, que continua sendo a autoridade na publicação.
 *
 * Uma versão sem seção não derruba o build: aqui a ausência de notas é um
 * aviso a menos, enquanto na publicação é um erro — lá a release nasceria sem
 * dizer o que mudou.
 *
 * **O changelog sumir é outra coisa, e derruba.** O `catch` devolvia a mesma
 * string vazia para "esta versão não tem seção" e para "o arquivo não existe
 * aqui", e a segunda aconteceu em produção sem ninguém ver: `.vercelignore`
 * excluía `docs/` inteiro, então todo build da Vercel embarcava notas vazias.
 * Como o desktop passou a carregar o site publicado, era esse build o que
 * chegava a quem instalava — e a tela de novidades ficou vazia para todo mundo,
 * em silêncio, exatamente o modo de falha que este projeto já pagou caro três
 * vezes. Ler o arquivo é condição do build de produção, não uma tentativa.
 */
function releaseNotesFor(version: string, required: boolean): string {
  let changelog: string;
  try {
    changelog = readFileSync("docs/CHANGELOG.md", "utf8");
  } catch (caught) {
    if (required)
      throw new Error(
        "docs/CHANGELOG.md não foi encontrado neste build. Sem ele o " +
          "aplicativo instalado abre a tela de novidades vazia. Confira se " +
          `o arquivo chegou ao contexto do build (${String(caught)}).`,
      );
    return "";
  }
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex(
    (line) =>
      line.trim() === `## ${version}` || line.trim() === `## v${version}`,
  );
  if (start < 0) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^## /.test(line));
  return (end < 0 ? rest : rest.slice(0, end))
    .join(String.fromCharCode(10))
    .trim();
}

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const configured = Boolean(env.VITE_SUPABASE_URL?.trim());
  const forDesktop = env.LILI_DESKTOP_BUILD === "true";
  const version = JSON.parse(readFileSync("package.json", "utf8")).version;
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
    define: {
      __LILI_VERSION__: JSON.stringify(version),
      __LILI_RELEASE_NOTES__: JSON.stringify(
        releaseNotesFor(version, command === "build"),
      ),
    },
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
