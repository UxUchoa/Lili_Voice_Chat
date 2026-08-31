#!/usr/bin/env node
/**
 * Baixa o binário do Electron depois do `npm ci`, quando ele faz sentido.
 *
 * O install do Electron é um download de ~150 MB que só serve para o
 * aplicativo desktop. Um build de site (Vercel) ou um `npm ci --omit=dev` não
 * têm o pacote instalado, e chamar `node node_modules/electron/install.js`
 * direto quebrava o install inteiro com "Cannot find module".
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import process from "node:process";

if (process.env.VERCEL || process.env.JANJA_SKIP_ELECTRON_DOWNLOAD === "true") {
  console.log("postinstall: download do Electron dispensado neste ambiente.");
  process.exit(0);
}

const require = createRequire(import.meta.url);
let installer;
try {
  installer = require.resolve("electron/install.js");
} catch {
  console.log("postinstall: Electron não está instalado, nada a fazer.");
  process.exit(0);
}

if (!existsSync(installer)) {
  console.log("postinstall: electron/install.js ausente, nada a fazer.");
  process.exit(0);
}

await import(pathToFileURL(installer).href);
