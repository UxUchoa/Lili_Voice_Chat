#!/usr/bin/env node
/**
 * Barreira antes do build da web.
 *
 * Um build sem `VITE_SUPABASE_URL` compila normalmente e só quebra no
 * navegador do usuário, com a tela branca de `assertOnlineConfig`. Pior: uma
 * chave de service role colada no lugar da publishable key vaza o banco
 * inteiro para quem abrir o site, e nada no build reclama. As duas coisas são
 * baratas de detectar aqui.
 */
import process from "node:process";
import { loadEnv } from "vite";

const env = { ...loadEnv("production", process.cwd(), ""), ...process.env };
const errors = [];
const warnings = [];

const isVercelProduction = env.VERCEL_ENV === "production";
const strict = isVercelProduction || env.JANJA_STRICT_ENV === "true";

// ------------------------------------------------------------------
// 1. Nenhum segredo pode viajar num VITE_ — tudo com esse prefixo é servido
//    em texto puro dentro do bundle.
// ------------------------------------------------------------------
const SECRET_MARKERS = [
  "SERVICE_ROLE",
  "API_SECRET",
  "PRIVATE_KEY",
  "SECRET_KEY",
  "PUSH_DISPATCH_SECRET",
  "CSC_KEY_PASSWORD",
];
for (const key of Object.keys(env)) {
  if (!key.startsWith("VITE_")) continue;
  if (key === "VITE_TENOR_API_KEY") continue; // chave pública de leitura
  if (SECRET_MARKERS.some((marker) => key.includes(marker)))
    errors.push(
      `${key} não pode existir: todo VITE_* vai para o bundle público.`,
    );
}

const looksLikeServiceRole = (value) => {
  if (!value) return false;
  if (value.startsWith("sb_secret_")) return true;
  const [, payload] = value.split(".");
  if (!payload) return false;
  try {
    const decoded = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );
    return decoded.role === "service_role";
  } catch {
    return false;
  }
};

// ------------------------------------------------------------------
// 2. Supabase
// ------------------------------------------------------------------
const supabaseUrl = env.VITE_SUPABASE_URL?.trim() ?? "";
const supabaseKey = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";

if (!supabaseUrl) errors.push("VITE_SUPABASE_URL está vazia.");
else if (!/^https?:\/\//.test(supabaseUrl))
  errors.push(`VITE_SUPABASE_URL precisa ser uma URL http(s): ${supabaseUrl}`);
else if (strict && !supabaseUrl.startsWith("https://"))
  errors.push(
    `Em produção VITE_SUPABASE_URL precisa ser HTTPS, e não ${supabaseUrl}.`,
  );

if (!supabaseKey) errors.push("VITE_SUPABASE_PUBLISHABLE_KEY está vazia.");
else if (looksLikeServiceRole(supabaseKey))
  errors.push(
    "VITE_SUPABASE_PUBLISHABLE_KEY parece ser a chave de service role. " +
      "Ela ignora todas as políticas de RLS e não pode ir para o navegador: " +
      "use a publishable/anon key do projeto.",
  );

// ------------------------------------------------------------------
// 3. LiveKit — sem ele o aplicativo abre, mas nenhuma chamada conecta.
// ------------------------------------------------------------------
const livekitUrl = env.VITE_LIVEKIT_URL?.trim() ?? "";
if (!livekitUrl) {
  const message =
    "VITE_LIVEKIT_URL está vazia: voz, vídeo e tela não vão funcionar. " +
    "Defina JANJA_SKIP_LIVEKIT_CHECK=true para publicar assim mesmo.";
  if (env.JANJA_SKIP_LIVEKIT_CHECK === "true") warnings.push(message);
  else errors.push(message);
} else if (!/^wss?:\/\//.test(livekitUrl))
  errors.push(`VITE_LIVEKIT_URL precisa usar ws:// ou wss://: ${livekitUrl}`);
else if (strict && !livekitUrl.startsWith("wss://"))
  errors.push(`Em produção VITE_LIVEKIT_URL precisa ser wss://: ${livekitUrl}`);

// ------------------------------------------------------------------
// 4. Opcionais — degradam a experiência, não impedem o deploy.
// ------------------------------------------------------------------
if (!env.VITE_VAPID_PUBLIC_KEY?.trim())
  warnings.push(
    "VITE_VAPID_PUBLIC_KEY está vazia: sem push com o aplicativo fechado.",
  );
if (!env.VITE_TENOR_API_KEY?.trim())
  warnings.push(
    "VITE_TENOR_API_KEY está vazia: o seletor de GIFs abre explicando o que falta.",
  );

for (const warning of warnings) console.warn(`aviso: ${warning}`);
if (errors.length) {
  console.error("\nConfiguração pública inválida para o build da web:\n");
  for (const error of errors) console.error(`  - ${error}`);
  console.error(
    "\nDefina as variáveis no provedor (Vercel → Settings → Environment " +
      "Variables) ou em .env.local. Consulte docs/DEPLOYMENT.md.\n",
  );
  process.exit(1);
}
console.log(
  `Configuração pública validada (${new URL(supabaseUrl).host}` +
    `${livekitUrl ? `, ${new URL(livekitUrl).host}` : ""}).`,
);
