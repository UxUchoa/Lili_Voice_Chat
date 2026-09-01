#!/usr/bin/env node
/**
 * Sobe o backend inteiro para o projeto hospedado, na ordem que funciona.
 *
 * O passo a passo do docs/DEPLOYMENT.md dava para esquecer metade: as funções
 * `livekit-moderate` e `attachments-expire` não estavam sequer listadas, e uma
 * função implantada com `verify_jwt` diferente do `config.toml` muda a
 * autorização sem avisar. Aqui a lista sai do próprio diretório e cada
 * `verify_jwt` sai do `config.toml`.
 *
 *   node scripts/deploy-supabase.mjs --project-ref abcdefghijklmnop
 *
 * Opções: --skip-db, --skip-secrets, --skip-functions, --dry-run.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const functionsDir = path.join(root, "supabase", "functions");
const secretsFile = path.join(functionsDir, ".env.production");

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};

const projectRef =
  option("project-ref") ?? process.env.SUPABASE_PROJECT_REF ?? "";
if (!projectRef) {
  console.error(
    "Informe o projeto: --project-ref <ref> ou SUPABASE_PROJECT_REF.\n" +
      "O ref aparece na URL do painel: https://supabase.com/dashboard/project/<ref>",
  );
  process.exit(1);
}
if (!/^[a-z]{20}$/.test(projectRef))
  console.warn(
    `aviso: "${projectRef}" não parece um project ref (20 letras minúsculas).`,
  );

const dryRun = flag("dry-run");
function supabase(...cliArgs) {
  console.log(`\n$ npx supabase ${cliArgs.join(" ")}`);
  if (dryRun) return;
  execFileSync("npx", ["--yes", "supabase", ...cliArgs], {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}

/** Lê `[functions.nome] verify_jwt` do config.toml sem trazer um parser TOML. */
function verifyJwtSettings() {
  const toml = readFileSync(path.join(root, "supabase", "config.toml"), "utf8");
  const settings = new Map();
  const pattern = /\[functions\.([a-z0-9-]+)\]([\s\S]*?)(?=\n\[|$)/g;
  for (const [, name, body] of toml.matchAll(pattern))
    settings.set(name, !/verify_jwt\s*=\s*false/.test(body));
  return settings;
}

const functions = readdirSync(functionsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
  .map((entry) => entry.name)
  .sort();
const verifyJwt = verifyJwtSettings();
const undeclared = functions.filter((name) => !verifyJwt.has(name));
if (undeclared.length) {
  console.error(
    `Funções sem bloco [functions.<nome>] no config.toml: ${undeclared.join(", ")}.\n` +
      "Declare cada uma antes de implantar — o edge runtime local também lê essa lista.",
  );
  process.exit(1);
}

console.log(`Projeto: ${projectRef}`);
console.log(`Funções: ${functions.join(", ")}`);

supabase("link", "--project-ref", projectRef);

if (!flag("skip-db")) supabase("db", "push");
else console.log("\n(db push pulado)");

if (flag("skip-secrets")) console.log("\n(secrets pulado)");
else if (existsSync(secretsFile))
  supabase("secrets", "set", "--env-file", "supabase/functions/.env.production");
else
  console.warn(
    `\naviso: ${path.relative(root, secretsFile)} não existe, segredos não foram enviados.\n` +
      "Crie o arquivo a partir de .env.example (seção Edge Functions) ou use\n" +
      "`npx supabase secrets set CHAVE=valor`. Ele é ignorado pelo git.",
  );

if (!flag("skip-functions"))
  for (const name of functions)
    supabase(
      "functions",
      "deploy",
      name,
      ...(verifyJwt.get(name) ? [] : ["--no-verify-jwt"]),
    );
else console.log("\n(functions pulado)");

console.log(`
Feito. O que o CLI não faz por você:

  1. SQL Editor → supabase/snippets/schedule_push_dispatch.sql
  2. SQL Editor → supabase/snippets/schedule_attachments_expire.sql
  3. SQL Editor → update public.instance_quota_config (limites reais da quota)
  4. Authentication → URL Configuration: Site URL e Redirect URLs do domínio
     de produção. O desktop não precisa de entrada própria: o link do e-mail
     vai para o site, e de lá a pessoa entra no aplicativo
  5. Settings → Storage: Upload limit em 101 MiB, senão o teto de 100 MB do
     bucket é recusado antes de chegar na política

Confira depois: npx supabase db lint --linked --schema public --level warning`);
