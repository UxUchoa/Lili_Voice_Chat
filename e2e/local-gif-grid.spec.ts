import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { finishOnlineLogin, openServer } from "./navigation";

const status = JSON.parse(
  execFileSync(
    "powershell.exe",
    ["-NoProfile", "-Command", "npx supabase status --output json"],
    { encoding: "utf8" },
  ),
);
const apiUrl = status.API_URL as string;
const publishableKey = (status.PUBLISHABLE_KEY ?? status.ANON_KEY) as string;
const serviceRoleKey = (status.SECRET_KEY ?? status.SERVICE_ROLE_KEY) as string;

/**
 * Um GIF de 1×1 transparente, servido no lugar do arquivo do provedor.
 *
 * O teste é sobre o layout da lista, não sobre o Giphy: sair para a internet
 * tornaria o resultado dependente de rede, de cota e de uma chave que o
 * ambiente local não tem.
 */
const PIXEL =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/** Formatos variados de propósito: é o que faz a coluna crescer desigual. */
function fakeGifs(count: number, seed: number) {
  return Array.from({ length: count }, (_, index) => {
    const tall = (index + seed) % 3 === 0;
    return {
      id: `gif-${seed}-${index}`,
      description: `GIF ${index}`,
      previewUrl: PIXEL,
      url: PIXEL,
      width: 200,
      height: tall ? 360 : 120,
      bytes: 1024,
    };
  });
}

/** Responde à função de borda `gifs` sem sair da máquina. */
async function stubGifs(page: Page) {
  await page.route("**/functions/v1/gifs", async (route) => {
    const body = route.request().postDataJSON() as {
      mode: string;
      query?: string;
    };
    if (body.mode === "categories")
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          categories: Array.from({ length: 8 }, (_, index) => ({
            searchTerm: `tema${index}`,
            label: `Tema ${index}`,
            imageUrl: PIXEL,
          })),
        }),
      });
    // Cada categoria devolve uma quantidade diferente: era justamente ao trocar
    // de categoria que a lista mudava de forma.
    const count = body.query ? 40 + body.query.length : 24;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: fakeGifs(count, body.query?.length ?? 0) }),
    });
  });
}

/** O que precisa ser verdade em qualquer categoria e em qualquer busca. */
async function assertVerticalGrid(page: Page, momento: string) {
  const grid = page.locator(".gif-grid");
  await expect(grid.locator("button").first()).toBeVisible({ timeout: 15_000 });
  const medida = await grid.evaluate((element) => ({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
    colunas: element.querySelectorAll(".gif-column").length,
    itens: element.querySelectorAll("button").length,
  }));
  // Um único pixel de estouro horizontal já é a barra de rolagem lateral
  // aparecendo — foi assim que a lista virou carrossel.
  expect(medida.scrollWidth, `${momento}: sem estouro horizontal`).toBeLessThanOrEqual(
    medida.clientWidth + 1,
  );
  expect(medida.scrollHeight, `${momento}: rola na vertical`).toBeGreaterThan(
    medida.clientHeight,
  );
  expect(medida.colunas, `${momento}: duas colunas`).toBe(2);
  return medida;
}

test("a lista de GIFs rola na vertical em qualquer categoria", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const admin = createClient(apiUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const api = createClient(apiUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const runId = `${Date.now()}`;
  const email = `gif-${runId}@lili.app`;
  const password = `Lili-${crypto.randomUUID()}-Aa1!`;
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      username: `gif${runId}`.slice(0, 20),
      display_name: "GIF QA",
    },
  });
  if (created.error) throw created.error;
  const signed = await api.auth.signInWithPassword({ email, password });
  if (signed.error) throw signed.error;
  const server = await api.rpc("create_server", { p_name: "GIF QA" });
  if (server.error) throw server.error;

  await stubGifs(page);
  await page.goto("/");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await finishOnlineLogin(page);
  await openServer(page, server.data as string);
  await expect(page.locator(".composer textarea")).toBeVisible({
    timeout: 20_000,
  });

  await page.getByLabel("GIFs e emoji").click();
  const inicial = await assertVerticalGrid(page, "abertura");

  // Trocar de categoria: era aqui que a forma mudava. A espera é pela lista
  // trocar de tamanho, e não pelo clique: entre os dois há o atraso da busca,
  // e medir antes disso mediria a lista anterior.
  await page.locator(".gif-categories button").nth(3).click();
  await expect
    .poll(() => page.locator(".gif-grid button").count(), { timeout: 15_000 })
    .not.toBe(inicial.itens);
  await assertVerticalGrid(page, "categoria");

  // Busca digitada, com outra quantidade de resultados ainda.
  const antes = await page.locator(".gif-grid button").count();
  await page.getByLabel("Buscar GIFs").fill("gatinhos correndo");
  await expect
    .poll(() => page.locator(".gif-grid button").count(), { timeout: 15_000 })
    .not.toBe(antes);
  await assertVerticalGrid(page, "busca");

  // E a rolagem chega ao fim de verdade, não só na última linha.
  const grid = page.locator(".gif-grid");
  await grid.evaluate((element) => element.scrollTo(0, element.scrollHeight));
  const fim = await grid.evaluate((element) => ({
    topo: element.scrollTop,
    limite: element.scrollHeight - element.clientHeight,
    lateral: element.scrollLeft,
  }));
  expect(Math.abs(fim.topo - fim.limite)).toBeLessThanOrEqual(2);
  expect(fim.lateral).toBe(0);

  await admin.auth.admin.deleteUser(created.data.user.id);
});
