import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { finishOnlineLogin } from "./navigation";

/**
 * O rename do produto para Lili migrou as chaves do navegador de `janja.*` para
 * `lili.*` e apagou a original; o rollback seguinte voltou o código aos nomes
 * antigos sem trazer os dados de volta. Quem abriu o aplicativo entre os dois
 * deploys ficou com a sessão viva sob um nome que ninguém mais lê.
 *
 * O sintoma não é só o logout: o refresh token abandonado continua válido, e
 * com rotação ligada ele invalida o token da sessão nova a cada renovação. As
 * duas morrem, todo RPC chega como `anon` e nenhuma mensagem entra ou sai.
 * Por isso o teste cobra as duas coisas — a sessão volta **e** o cofre órfão
 * deixa de existir.
 */
const status = JSON.parse(
  execFileSync(
    "powershell.exe",
    ["-NoProfile", "-Command", "npx supabase status --output json"],
    { encoding: "utf8" },
  ),
);
const apiUrl = status.API_URL as string;
const serviceRoleKey = (status.SECRET_KEY ?? status.SERVICE_ROLE_KEY) as string;

async function login(page: Page, email: string, password: string) {
  await page.goto("/");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await finishOnlineLogin(page);
}

test("sessão presa no nome do rename volta e o cofre órfão é apagado", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const admin = createClient(apiUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const runId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const email = `rollback-${runId}@lili.app`;
  const password = `Lili-${crypto.randomUUID()}-Aa1!`;
  const username = `rollback_${runId.replace(/\W/g, "")}`.slice(0, 30);

  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username, display_name: username },
  });
  if (created.error) throw new Error(created.error.message);
  const userId = created.data.user.id;
  const context = await browser.newContext();

  try {
    const page = await context.newPage();
    await login(page, email, password);

    // Reproduz exatamente o que a migração do deploy do rename fazia: copia
    // para o nome novo e remove o antigo.
    const moved = await page.evaluate(() => {
      const pairs: Array<[string, string]> = [
        ["janja.supabase.session", "lili.supabase.session"],
        ["janja-ui-preferences-v2", "lili-ui-preferences-v2"],
        ["janja.camera.quality", "lili.camera.quality"],
      ];
      const done: string[] = [];
      for (const [current, renamed] of pairs) {
        const value = localStorage.getItem(current);
        if (value === null) continue;
        localStorage.setItem(renamed, value);
        localStorage.removeItem(current);
        done.push(renamed);
      }
      return done;
    });
    expect(moved).toContain("lili.supabase.session");

    await page.reload();

    await expect(page.locator(".app-shell")).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(() =>
        page.evaluate(() => ({
          restaurada: localStorage.getItem("janja.supabase.session") !== null,
          orfa: localStorage.getItem("lili.supabase.session") !== null,
        })),
      )
      .toEqual({ restaurada: true, orfa: false });
  } finally {
    await context.close();
    await admin.auth.admin.deleteUser(userId);
  }
});
