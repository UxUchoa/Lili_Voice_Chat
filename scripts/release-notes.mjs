#!/usr/bin/env node
/**
 * Recorta de `docs/CHANGELOG.md` a seção de uma versão.
 *
 *   node scripts/release-notes.mjs 0.1.5
 *
 * É o corpo da release no GitHub. O workflow chama este script e passa a saída
 * ao `gh release create --notes-file`; antes disso a release nascia com a
 * linha "Versao X" e nada mais, então quem baixava o instalador não tinha como
 * saber o que havia mudado.
 *
 * Sai com código 1 quando a versão não tem seção. É de propósito: publicar sem
 * notas é o mesmo problema de antes, só que silencioso.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const changelog = resolve(root, "docs/CHANGELOG.md");

/** Aceita `0.1.5` e `v0.1.5`: a tag chega das duas formas. */
const version = String(process.argv[2] ?? "")
  .trim()
  .replace(/^v/i, "");

if (!version) {
  console.error("Informe a versão: node scripts/release-notes.mjs 0.1.5");
  process.exit(1);
}

let text;
try {
  text = readFileSync(changelog, "utf8");
} catch {
  console.error(`Não encontrei ${changelog}.`);
  process.exit(1);
}

// As seções são `## <versão>`; a próxima `##` fecha a anterior. O corte é por
// linha, e não por regex sobre o texto todo, para que um `##` dentro de um
// bloco de código não parta a seção ao meio.
const lines = text.split(/\r?\n/);
const start = lines.findIndex(
  (line) => line.trim() === `## ${version}` || line.trim() === `## v${version}`,
);
if (start < 0) {
  console.error(
    `docs/CHANGELOG.md não tem uma seção "## ${version}". ` +
      "Escreva as notas antes de publicar a versão.",
  );
  process.exit(1);
}

const rest = lines.slice(start + 1);
const end = rest.findIndex((line) => /^## /.test(line));
const body = (end < 0 ? rest : rest.slice(0, end)).join("\n").trim();

if (!body) {
  console.error(`A seção "## ${version}" está vazia.`);
  process.exit(1);
}

process.stdout.write(`${body}\n`);
