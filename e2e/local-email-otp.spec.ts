import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { finishOnlineLogin } from "./navigation";

const status = JSON.parse(
  execFileSync(
    "powershell.exe",
    ["-NoProfile", "-Command", "npx supabase status --output json"],
    { encoding: "utf8" },
  ),
);
const apiUrl = status.API_URL as string;
const serviceRoleKey = (status.SECRET_KEY ?? status.SERVICE_ROLE_KEY) as string;
/** Mailpit, o servidor de e-mail da pilha local. Nada sai para a internet. */
const mailUrl = (status.MAILPIT_URL ?? status.INBUCKET_URL) as string;

/**
 * Lê o código de verificação da última mensagem enviada a este endereço.
 *
 * Sem isto o fluxo de OTP não teria como ser testado de ponta a ponta: o
 * código só existe dentro do e-mail. É a diferença entre provar que o cadastro
 * se completa e apenas provar que a tela aparece.
 */
async function readCodeFor(email: string): Promise<string> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const list = await fetch(
      `${mailUrl}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
    ).then((response) => response.json() as Promise<{
      messages?: Array<{ ID: string; Created: string }>;
    }>);
    const newest = (list.messages ?? []).sort((a, b) =>
      b.Created.localeCompare(a.Created),
    )[0];
    if (newest) {
      const message = (await fetch(
        `${mailUrl}/api/v1/message/${newest.ID}`,
      ).then((response) => response.json())) as { Text?: string; HTML?: string };
      // O corpo é HTML; o código é a única sequência de seis dígitos isolada.
      const body = `${message.Text ?? ""} ${message.HTML ?? ""}`;
      const found = body.match(/(?<!\d)(\d{6})(?!\d)/);
      if (found) return found[1];
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Nenhum código chegou para ${email}.`);
}

/** Apaga a caixa para o teste não ler o código de uma rodada anterior. */
async function clearMailbox() {
  await fetch(`${mailUrl}/api/v1/messages`, { method: "DELETE" });
}

async function fillSignup(
  page: Page,
  fields: { email: string; username: string; password: string },
) {
  const card = page.locator(".auth-card");
  await card.getByRole("button", { name: "Criar conta" }).click();
  await card.getByLabel("Nome de exibição").fill(fields.username);
  await card.getByLabel("Username").fill(fields.username);
  await card.getByLabel("E-mail").fill(fields.email);
  await card.getByLabel("Senha", { exact: true }).fill(fields.password);
}

test("cadastro só se completa com o código do e-mail", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const admin = createClient(apiUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const runId = `${Date.now()}`;
  const email = `otp-${runId}@exemplo.test`;
  const username = `otp${runId}`.slice(0, 20);
  const password = "senha-inicial-123";

  await clearMailbox();
  await page.goto("/");
  await expect(page.locator(".auth-card")).toBeVisible({ timeout: 20_000 });

  await fillSignup(page, { email, username, password });
  await page
    .locator(".auth-card")
    .getByRole("button", { name: "Criar conta" })
    .click();

  // O cadastro não entra direto: sem o código a conta fica pendente.
  const otpCard = page.locator(".otp-card");
  await expect(otpCard).toBeVisible({ timeout: 30_000 });
  await expect(otpCard).toContainText(email);

  // O reenvio nasce em espera — o servidor recusa dois envios seguidos, e o
  // botão liberado só geraria um erro que a pessoa não causou.
  await expect(
    otpCard.getByRole("button", { name: /Reenviar em \d+s/ }),
  ).toBeDisabled();

  // Código errado não pode passar, e a mensagem não diz se ele existia.
  await otpCard.getByLabel(/Código recebido por e-mail/).fill("000000");
  await otpCard.getByRole("button", { name: "Confirmar" }).click();
  await expect(otpCard.locator(".auth-error")).toContainText(
    /não confere ou já expirou/,
    { timeout: 20_000 },
  );

  const code = await readCodeFor(email);
  await otpCard.getByLabel(/Código recebido por e-mail/).fill(code);
  await otpCard.getByRole("button", { name: "Confirmar" }).click();

  // Confirmou: a chave de recuperação é entregue e a conta entra.
  await finishOnlineLogin(page);

  const created = await admin.auth.admin.listUsers();
  if (created.error) throw created.error;
  const user = created.data.users.find((item) => item.email === email);
  expect(user, "a conta confirmada precisa existir").toBeTruthy();
  expect(
    user!.email_confirmed_at,
    "o código tinha que confirmar o e-mail no servidor",
  ).toBeTruthy();

});

test("recuperação de senha usa código, e a senha nova passa a valer", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const admin = createClient(apiUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const runId = `${Date.now()}`;
  const email = `otp-rec-${runId}@exemplo.test`;
  const senhaAntiga = "senha-antiga-123";
  const senhaNova = "senha-trocada-456";

  // A conta nasce confirmada pelo service role: quem está sob teste aqui é a
  // recuperação, e não o cadastro — esse tem o teste dele.
  const created = await admin.auth.admin.createUser({
    email,
    password: senhaAntiga,
    email_confirm: true,
    user_metadata: {
      username: `rec${runId}`.slice(0, 20),
      display_name: "Recuperação E2E",
    },
  });
  if (created.error) throw created.error;

  await clearMailbox();
  await page.goto("/");
  await expect(page.locator(".auth-card")).toBeVisible({ timeout: 20_000 });

  await page.locator(".auth-card").getByLabel("E-mail").fill(email);
  await page.getByRole("button", { name: "Esqueci a senha" }).click();

  const otpCard = page.locator(".otp-card");
  await expect(otpCard).toBeVisible({ timeout: 30_000 });
  await expect(otpCard).toContainText(/senha nova/);

  const code = await readCodeFor(email);
  await otpCard.getByLabel(/Código recebido por e-mail/).fill(code);
  await otpCard.getByRole("button", { name: "Confirmar" }).click();

  // A tela da senha nova vem antes de o aplicativo abrir: sem isso a pessoa
  // entraria com a senha antiga ainda valendo, que não é o que ela pediu.
  await expect(
    page.getByRole("heading", { name: /senha nova/i }),
  ).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Senha nova").fill(senhaNova);
  await page.getByLabel("Repita a senha").fill(senhaNova);
  await page
    .locator(".auth-card")
    .getByRole("button", { name: "Trocar a senha" })
    .click();

  // Espera a tela sair antes de conferir no servidor. Sem isto o teste
  // consultava o login enquanto a troca ainda estava em voo, e falhava com
  // "credenciais inválidas" — que aponta para o lugar errado.
  await expect(page.locator(".auth-card .auth-error")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: /senha nova/i }),
  ).toBeHidden({ timeout: 30_000 });

  // A prova de que a troca valeu: a senha nova entra e a antiga não.
  const comNova = await admin.auth.signInWithPassword({
    email,
    password: senhaNova,
  });
  expect(comNova.error, "a senha nova tinha que entrar").toBeNull();

  const comAntiga = await admin.auth.signInWithPassword({
    email,
    password: senhaAntiga,
  });
  expect(comAntiga.error, "a senha antiga não pode continuar valendo").not.toBeNull();
});
