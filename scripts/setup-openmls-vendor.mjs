#!/usr/bin/env node
/**
 * Prepara `vendor/openmls` a partir do upstream fixado + o patch local.
 *
 * O clone do OpenMLS não entra no repositório: ele traz o histórico inteiro de
 * um projeto de terceiros e, depois de um `cargo build`, mais de 1 GB em
 * `target/`. O que é nosso cabe num arquivo — `patches/openmls-wasm.patch`,
 * que adiciona export/restore de estado do provider e os acessórios usados
 * pelo wrapper WASM.
 *
 * O `.wasm` compilado está versionado em `src/crypto/openmls-wasm/`, então nem
 * o build do site nem o do desktop precisam de Rust. Este script só é
 * necessário para recompilar o wrapper ou rodar `cargo test` (CI).
 */
import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const COMMIT = "47dbedecad0c1fd8eb5368d582250ebfcc1e1ce6"; // openmls-v0.8.1
const REMOTE = "https://github.com/openmls/openmls.git";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vendor = path.join(root, "vendor", "openmls");
const patch = path.join(root, "patches", "openmls-wasm.patch");

const run = (args, cwd = root) =>
  execFileSync("git", args, { cwd, stdio: "inherit" });
const capture = (args, cwd = root) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

const force = process.argv.includes("--force");

if (existsSync(path.join(vendor, ".git")) && !force) {
  const head = capture(["rev-parse", "HEAD"], vendor);
  if (head !== COMMIT) {
    console.error(
      `vendor/openmls está em ${head}, e não no commit fixado ${COMMIT}.\n` +
        "Rode com --force para recriar (o diretório será apagado).",
    );
    process.exit(1);
  }
  const dirty = capture(["status", "--porcelain", "--", "openmls-wasm"], vendor);
  if (!dirty) {
    console.log("vendor/openmls no commit fixado, sem o patch. Aplicando…");
    run(["apply", patch], vendor);
  }
  console.log("vendor/openmls pronto.");
  process.exit(0);
}

if (force && existsSync(vendor)) rmSync(vendor, { recursive: true, force: true });

console.log(`Clonando OpenMLS ${COMMIT.slice(0, 7)} em vendor/openmls…`);
run(["init", "--quiet", vendor]);
run(["remote", "add", "origin", REMOTE], vendor);
run(["fetch", "--quiet", "--depth", "1", "origin", COMMIT], vendor);
run(["checkout", "--quiet", "--detach", "FETCH_HEAD"], vendor);
console.log("Aplicando patches/openmls-wasm.patch…");
run(["apply", patch], vendor);
console.log("vendor/openmls pronto.");
