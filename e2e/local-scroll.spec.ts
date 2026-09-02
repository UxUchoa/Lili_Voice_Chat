import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { finishOnlineLogin, openServer } from "./navigation";

/**
 * A última mensagem não pode ficar cortada.
 *
 * O sintoma é fácil de ver e difícil de descrever: manda-se uma mensagem e ela
 * aparece pela metade atrás do compositor, até se rolar à mão. Já teve duas
 * causas diferentes — o que cresce embaixo da lista tirando altura dela, e a
 * rolagem que para antes do fim —, então a garantia aqui é medida, e não
 * inspecionada: o retângulo da última linha precisa caber dentro do retângulo
 * visível da lista.
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

/** Sobra (ou falta) entre o fim da última linha e a borda de baixo da lista. */
async function bottomGap(page: Page) {
  return page.evaluate(() => {
    const list = document.querySelector(".message-list");
    if (!list) return null;
    const rows = list.querySelectorAll(".message");
    const last = rows[rows.length - 1];
    if (!last) return null;
    const listRect = list.getBoundingClientRect();
    const lastRect = last.getBoundingClientRect();
    return {
      gap: Math.round(listRect.bottom - lastRect.bottom),
      scrollLeftover: Math.round(
        list.scrollHeight - list.scrollTop - list.clientHeight,
      ),
      lastText: (last.textContent ?? "").slice(0, 40),
    };
  });
}

test("a mensagem enviada aparece inteira, sem rolar à mão", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const admin = createClient(apiUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const runId = `${Date.now()}`;
  const email = `scroll-${runId}@exemplo.test`;
  const password = "senha-inicial-123";

  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username: `scroll${runId}`.slice(0, 30), display_name: "Scroll" },
  });
  if (created.error) throw created.error;

  const owner = createClient(apiUrl, status.PUBLISHABLE_KEY ?? status.ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const session = await owner.auth.signInWithPassword({ email, password });
  if (session.error) throw session.error;
  const server = await owner.rpc("create_server", { p_name: `Scroll ${runId}` });
  if (server.error) throw server.error;
  const serverId = server.data as string;
  const channels = await owner
    .from("channels")
    .select("id,kind")
    .eq("server_id", serverId);
  if (channels.error) throw channels.error;
  const channelId = channels.data.find((item) => item.kind === "text")!.id;

  await login(page, email, password);
  await openServer(page, serverId);
  await page.goto(`/#/channels/${serverId}/${channelId}`);
  const composer = page.locator(".composer textarea");
  await expect(composer).toBeVisible({ timeout: 20_000 });

  // Passa do teto de 50 da primeira página, de propósito: é a partir daí que
  // uma mensagem nova empurra a mais antiga para fora da lista, e o total
  // deixa de mudar quando alguém envia. Enviadas pelo compositor porque é o
  // caminho em que o corte aparece — digitar e mandar.
  for (let index = 0; index < 56; index += 1) {
    await composer.fill(`linha ${index} — enchendo a lista para ela rolar`);
    await composer.press("Enter");
    await expect(page.locator(".message-list")).toContainText(
      `linha ${index} —`,
      { timeout: 20_000 },
    );
  }


  // 1. Ao abrir o canal, o fim da conversa é o que se vê.
  await page.waitForTimeout(1200);
  const aoAbrir = await bottomGap(page);
  expect(aoAbrir, "a lista precisa ter linhas").not.toBeNull();
  expect(
    aoAbrir!.gap,
    `ao abrir, a última linha ficou cortada (${JSON.stringify(aoAbrir)})`,
  ).toBeGreaterThanOrEqual(0);

  // 2. Enviar uma mensagem leva a lista até o fim, sem sobrar rolagem.
  await composer.fill("mensagem que precisa aparecer inteira");
  await composer.press("Enter");
  await expect(page.locator(".message-list")).toContainText(
    "mensagem que precisa aparecer inteira",
    { timeout: 20_000 },
  );
  await page.waitForTimeout(1200);
  const aoEnviar = await bottomGap(page);
  expect(
    aoEnviar!.gap,
    `depois de enviar, a última linha ficou cortada (${JSON.stringify(aoEnviar)})`,
  ).toBeGreaterThanOrEqual(0);
  expect(
    aoEnviar!.scrollLeftover,
    `sobrou rolagem depois de enviar (${JSON.stringify(aoEnviar)})`,
  ).toBeLessThanOrEqual(2);
});
