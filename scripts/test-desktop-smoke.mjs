#!/usr/bin/env node
/**
 * Teste de fumaça da casca desktop.
 *
 * O aplicativo instalado deixou de embarcar uma cópia do bundle: ele carrega o
 * site publicado. Isso apagou os riscos que este teste cobria antes — `fetch`
 * de arquivo local recusado pelo Chromium, `window.location.origin` valendo a
 * string "null", CSP do arquivo sem casar com `file:` — e criou outros três,
 * todos silenciosos, que são o que ele cobre agora:
 *
 * 1. O endereço do site não é gravado no pacote. Sem ele a janela abre direto
 *    na tela de indisponibilidade, e nada no build reclama.
 * 2. `electron/offline.html` fica de fora do pacote. Aí um site fora do ar
 *    deixa a janela em branco, que é o sintoma que ninguém consegue depurar.
 * 3. O `preload` não expõe `retry`, e o botão da tela de aviso não faz nada.
 *
 * Os dois primeiros são estáticos e valem para o `app.asar` já empacotado:
 * `LILI_SMOKE_ASAR` aponta para ele. Sem essa variável o teste roda contra a
 * árvore do projeto, que é o que serve antes de empacotar.
 *
 * O terceiro precisa de Electron de verdade, então a janela carrega a própria
 * `offline.html` e confere que a ponte chegou. Roda com
 * `npx electron scripts/test-desktop-smoke.mjs`; sai diferente de zero quando
 * qualquer uma das três falha.
 */
import { app, BrowserWindow } from "electron";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const inspectionRoot = process.env.LILI_SMOKE_ASAR
  ? path.resolve(process.env.LILI_SMOKE_ASAR)
  : projectRoot;

const failures = [];
const log = (message) => process.stdout.write(`${message}\n`);

// ------------------------------------------------------------------
// 1 e 2. O que precisa estar dentro do pacote.
// ------------------------------------------------------------------
const manifestPath = path.join(inspectionRoot, "package.json");
if (!existsSync(manifestPath)) {
  failures.push(`package.json não encontrado em ${inspectionRoot}.`);
} else {
  let manifest = {};
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    failures.push(`package.json ilegível: ${error.message}`);
  }
  const configured = String(manifest.liliSiteUrl ?? "").trim();
  // Na árvore do projeto o campo não existe: ele é injetado pelo
  // electron-builder. A exigência só vale para o pacote.
  if (process.env.LILI_SMOKE_ASAR && !/^https:\/\//i.test(configured))
    failures.push(
      "liliSiteUrl ausente ou não-HTTPS no pacote: a janela abriria direto " +
        "na tela de indisponibilidade. Passe " +
        "--config.extraMetadata.liliSiteUrl=<url> ao electron-builder.",
    );
}

const offlinePage = path.join(inspectionRoot, "electron", "offline.html");
if (!existsSync(offlinePage))
  failures.push(
    `electron/offline.html não está em ${inspectionRoot}: sem ela, um site ` +
      "fora do ar deixa a janela em branco.",
  );

// ------------------------------------------------------------------
// 3. A ponte do preload chega à tela de aviso.
// ------------------------------------------------------------------
const consoleErrors = [];
const watchdog = setTimeout(() => {
  log("[falha] o teste travou antes de terminar");
  process.exit(2);
}, 60_000);

const finish = () => {
  clearTimeout(watchdog);
  for (const message of consoleErrors) log(`[console] ${message}`);
  if (failures.length) {
    for (const failure of failures) log(`[falha] ${failure}`);
    process.exit(1);
  }
  log(`Desktop: ${inspectionRoot} tem endereço de site, tela de aviso e ponte.`);
  process.exit(0);
};

app.whenReady().then(async () => {
  log(`[alvo] ${inspectionRoot}`);
  if (!existsSync(offlinePage)) return finish();

  const window_ = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(projectRoot, "electron", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window_.webContents.on("console-message", (_event, level, message) => {
    if (level >= 2) consoleErrors.push(message);
  });

  try {
    await window_.loadFile(offlinePage);
    const probe = await window_.webContents.executeJavaScript(`
      ({
        bridge: typeof window.janjaDesktop,
        retry: typeof window.janjaDesktop?.retry,
        button: Boolean(document.getElementById("retry")),
      })
    `);
    if (probe.bridge !== "object")
      failures.push(`o preload não expôs janjaDesktop (${probe.bridge}).`);
    if (probe.retry !== "function")
      failures.push(
        `janjaDesktop.retry ausente (${probe.retry}): o botão da tela de ` +
          "aviso não recarregaria o site.",
      );
    if (!probe.button)
      failures.push("a tela de aviso não tem o botão de nova tentativa.");
  } catch (error) {
    failures.push(`a tela de aviso não carregou: ${error.message}`);
  }
  if (consoleErrors.length)
    failures.push(`a tela de aviso registrou ${consoleErrors.length} erro(s).`);
  finish();
});
