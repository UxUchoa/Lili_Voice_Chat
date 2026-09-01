/**
 * Fuma o `dist/` do jeito que o aplicativo instalado o carrega: por `file://`.
 *
 * O build da web é servido por HTTP, e quase tudo que quebra no desktop quebra
 * só por causa do esquema. Três coisas, em particular, não aparecem em nenhum
 * teste de navegador:
 *
 * 1. `fetch()` de um arquivo local é recusado pelo Chromium. É assim que o
 *    o bundle carrega seus assets, então uma falha aqui significa aplicativo
 *    instalado abrindo em branco.
 * 2. `window.location.origin` vale a string "null" numa página `file://`.
 * 3. A meta de CSP é reescrita no build com as origens de produção, e um
 *    `'self'` que não casa com `file:` bloqueia o próprio bundle.
 *
 * Roda com `npx electron scripts/test-desktop-smoke.mjs`; sai diferente de zero
 * quando o renderer não monta, quando um asset não carrega ou quando o console
 * registra erro.
 *
 * `LILI_SMOKE_DIST` aponta para outro `dist/` — é assim que o
 * `build-desktop.ps1` fuma o bundle de dentro do `app.asar` já empacotado, e
 * não só a pasta que o Vite acabou de escrever. O empacotamento é justamente
 * onde o caminho dos assets pode mudar de novo.
 */
import { app, BrowserWindow, dialog } from "electron";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const distributionRoot = process.env.LILI_SMOKE_DIST
  ? path.resolve(process.env.LILI_SMOKE_DIST)
  : path.join(projectRoot, "dist");
const failures = [];
const consoleErrors = [];
const log = (line) => process.stdout.write(`${line}\n`);

const publicConfig = (() => {
  const names = [
    "VITE_SUPABASE_URL",
    "VITE_SUPABASE_PUBLISHABLE_KEY",
    "VITE_LIVEKIT_URL",
  ];
  const values = Object.fromEntries(
    names.map((name) => [name, process.env[name]?.trim() ?? ""]),
  );
  const localEnvironment = path.join(projectRoot, ".env.production");
  if (names.some((name) => !values[name])) {
    try {
      for (const line of readFileSync(localEnvironment, "utf8").split(
        /\r?\n/,
      )) {
        const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
        if (match && names.includes(match[1]) && !values[match[1]])
          values[match[1]] = match[2].trim();
      }
    } catch {
      // No CI os valores vêm do ambiente. A ausência é reportada abaixo com
      // o nome exato, sem transformar um problema de configuração em ENOENT.
    }
  }
  return values;
})();

// Um diálogo modal de erro trava a execução sem imprimir nada: o processo fica
// esperando um clique que ninguém vai dar.
dialog.showErrorBox = (title, content) =>
  log(`[dialog] ${title} :: ${content}`);

// Um asset qualquer do bundle serve de sonda: o que se quer detectar é o
// `fetch()` de arquivo local recusado pelo Chromium, não este arquivo em
// particular. O `.js` do bundle sempre existe depois de um build.
const probeAsset = (() => {
  try {
    return readdirSync(path.join(distributionRoot, "assets")).find((name) =>
      name.endsWith(".js"),
    );
  } catch {
    return undefined;
  }
})();

const watchdog = setTimeout(() => {
  log("[falha] o teste travou antes de terminar");
  process.exit(2);
}, 60_000);

const finish = () => {
  clearTimeout(watchdog);
  for (const message of consoleErrors) log(`[console] ${message}`);
  if (failures.length) {
    log("\nO dist não sobrevive ao carregamento por file://:\n");
    for (const failure of failures) log(`  - ${failure}`);
    app.exit(1);
    return;
  }
  log(
    `Desktop: ${distributionRoot} carregado por file://, renderer montado e ` +
      "serviços de produção acessíveis.",
  );
  app.exit(0);
};

app
  .whenReady()
  .then(async () => {
    log(`[alvo] ${distributionRoot}`);
    if (!probeAsset)
      failures.push(
        `nenhum asset .js em ${path.join(distributionRoot, "assets")} — ` +
          "rode `npm run build` antes.",
      );
    for (const [name, value] of Object.entries(publicConfig))
      if (!value) failures.push(`${name} ausente no smoke de produção.`);

    const window_ = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: path.join(projectRoot, "electron", "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    window_.webContents.on("console-message", (...parameters) => {
      const [first] = parameters;
      const structured =
        first && typeof first === "object" && "message" in first;
      const level = structured ? first.level : parameters[1];
      const message = structured ? first.message : parameters[2];
      // A violação de CSP é registrada como erro do console e de mais lugar
      // nenhum: sem olhar aqui, um script bloqueado passa por tela em branco.
      if (
        level === "error" ||
        level === 3 ||
        /refused to|blocked/i.test(message)
      )
        consoleErrors.push(String(message).slice(0, 400));
    });
    window_.webContents.on("render-process-gone", (_event, details) =>
      failures.push(`o renderer morreu: ${JSON.stringify(details)}`),
    );

    await window_.loadFile(path.join(distributionRoot, "index.html"));
    // O React monta depois do primeiro quadro; o asset é buscado logo em
    // seguida. Esperar aqui é mais barato que reagir a um evento por elemento.
    await new Promise((resolve) => setTimeout(resolve, 8_000));

    const probe = await window_.webContents.executeJavaScript(`(async () => {
      const config = ${JSON.stringify(publicConfig)};
      const request = async (url, init) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        try {
          const response = await fetch(url, { ...init, signal: controller.signal });
          return { status: response.status, body: (await response.text()).slice(0, 160) };
        } catch (error) {
          return { error: error instanceof Error ? error.message : String(error) };
        } finally {
          clearTimeout(timeout);
        }
      };
      const logo = document.querySelector('.brand img');
      const policy = document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content ?? '';
      const result = {
        origin: window.location.origin,
        secureContext: window.isSecureContext,
        renderedCharacters: (document.getElementById("root")?.innerHTML ?? "").length,
        desktopBridge: Boolean(window.janjaDesktop),
        stylesheets: document.styleSheets.length,
        logo: logo ? {
          src: logo.getAttribute('src'),
          complete: logo.complete,
          naturalWidth: logo.naturalWidth,
        } : null,
        livekitAllowedByCsp: policy.includes(config.VITE_LIVEKIT_URL),
        visibleText: (document.body.innerText ?? "").replace(/\\s+/g, " ").slice(0, 200),
      };
      try {
        const response = await fetch(${JSON.stringify(`./assets/${probeAsset ?? ""}`)});
        result.asset = response.ok
          ? \`ok (\${response.headers.get("content-type") ?? "sem content-type"})\`
          : \`HTTP \${response.status}\`;
      } catch (error) {
        result.asset = \`ERRO: \${error.message}\`;
      }
      try {
        window.localStorage.setItem("lili.smoke", "1");
        result.localStorage = window.localStorage.getItem("lili.smoke") === "1";
        window.localStorage.removeItem("lili.smoke");
      } catch (error) {
        result.localStorage = \`ERRO: \${error.message}\`;
      }
      try {
        const database = await new Promise((resolve, reject) => {
          const request = indexedDB.open("lili-smoke", 1);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error ?? new Error("indexedDB"));
        });
        database.close();
        indexedDB.deleteDatabase("lili-smoke");
        result.indexedDB = true;
      } catch (error) {
        result.indexedDB = \`ERRO: \${error.message}\`;
      }
      if (config.VITE_SUPABASE_URL && config.VITE_SUPABASE_PUBLISHABLE_KEY) {
        const commonHeaders = {
          apikey: config.VITE_SUPABASE_PUBLISHABLE_KEY,
          Authorization: \`Bearer \${config.VITE_SUPABASE_PUBLISHABLE_KEY}\`,
        };
        result.auth = await request(
          \`\${config.VITE_SUPABASE_URL}/auth/v1/token?grant_type=password\`,
          {
            method: 'POST',
            headers: { apikey: config.VITE_SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: 'lili-desktop-smoke@example.invalid',
              password: 'invalid-desktop-smoke-password',
            }),
          },
        );
        result.rest = await request(
          \`\${config.VITE_SUPABASE_URL}/rest/v1/profiles?select=id&limit=1\`,
          { headers: commonHeaders },
        );
        result.edgeFunction = await request(
          \`\${config.VITE_SUPABASE_URL}/functions/v1/livekit-token\`,
          {
            method: 'POST',
            headers: { ...commonHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ channel_id: '00000000-0000-0000-0000-000000000000' }),
          },
        );
      }
      return result;
    })()`);

    log(`[sonda] ${JSON.stringify(probe, null, 1)}`);

    if (probe.renderedCharacters < 200)
      failures.push(
        `o renderer não montou (${probe.renderedCharacters} caracteres em #root): ` +
          `"${probe.visibleText}"`,
      );
    if (!probe.desktopBridge)
      failures.push(
        "o preload não expôs a ponte do desktop (window.janjaDesktop).",
      );
    if (probe.stylesheets < 1)
      failures.push("nenhuma folha de estilo foi carregada.");
    if (!probe.logo || !probe.logo.complete || probe.logo.naturalWidth < 1)
      failures.push(
        `o logo público não carregou por file:// (${JSON.stringify(probe.logo)}).`,
      );
    if (!probe.livekitAllowedByCsp)
      failures.push("a origem do LiveKit não está no connect-src da CSP.");
    if (probe.asset !== undefined && !String(probe.asset).startsWith("ok"))
      failures.push(
        `o bundle não carrega seus assets por file:// (${probe.asset}): o ` +
          "aplicativo instalado abriria em branco.",
      );
    if (probe.localStorage !== true)
      failures.push(`localStorage indisponível (${probe.localStorage}).`);
    if (probe.indexedDB !== true)
      failures.push(`IndexedDB indisponível (${probe.indexedDB}).`);
    if (
      probe.auth?.status !== 400 ||
      !/invalid[_ ]credentials/i.test(probe.auth.body ?? "")
    )
      failures.push(
        `Supabase Auth inacessível (${JSON.stringify(probe.auth)}).`,
      );
    if (!Number.isInteger(probe.rest?.status))
      failures.push(
        `Supabase REST inacessível (${JSON.stringify(probe.rest)}).`,
      );
    if (!Number.isInteger(probe.edgeFunction?.status))
      failures.push(
        `Edge Function inacessível com Origin null (${JSON.stringify(probe.edgeFunction)}).`,
      );
    if (consoleErrors.length)
      failures.push(`${consoleErrors.length} erro(s) no console do renderer.`);

    finish();
  })
  .catch((error) => {
    log(`[falha] ${error instanceof Error ? error.stack : String(error)}`);
    clearTimeout(watchdog);
    app.exit(2);
  });
