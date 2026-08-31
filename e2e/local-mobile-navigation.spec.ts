import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

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

test("navegação mobile percorre início, servidor, texto e voz", async ({
  page,
}) => {
  const admin = createClient(apiUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const api = createClient(apiUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const runId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const email = `mobile-${runId}@janja.local`;
  const password = `Janja-${crypto.randomUUID()}-Aa1!`;
  const serverName = `Mobile ${runId}`;
  let userId = "";
  let serverId = "";

  try {
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        username: `mobile_${runId}`.replace(/\W/g, "").slice(0, 28),
        display_name: "Mobile QA",
      },
    });
    if (created.error) throw created.error;
    userId = created.data.user.id;
    const signed = await api.auth.signInWithPassword({ email, password });
    if (signed.error) throw signed.error;
    const server = await api.rpc("create_server", { p_name: serverName });
    if (server.error) throw server.error;
    serverId = server.data as string;

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Senha").fill(password);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(page.locator(".app-shell")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".server-rail")).toBeHidden();
    await expect(page.locator(".channel-sidebar")).toBeHidden();

    await page.getByRole("button", { name: "Abrir navegação" }).click();
    await expect(page.locator(".server-rail")).toBeVisible();
    await expect(page.locator(".channel-sidebar")).toBeVisible();
    await page.getByRole("button", { name: /^Início/ }).click();
    await expect(page.locator(".home-view")).toBeVisible();
    await expect(page.locator(".channel-sidebar")).toBeHidden();

    await page.getByRole("button", { name: "Abrir navegação" }).click();
    await page.getByRole("button", { name: serverName, exact: true }).click();
    await page.getByRole("button", { name: "geral", exact: true }).click();
    await expect(page.locator(".conversation h1")).toHaveText("geral");
    await expect(page.locator(".channel-sidebar")).toBeHidden();

    await page.getByRole("button", { name: "Abrir navegação" }).click();
    await page.getByRole("button", { name: /Lounge/ }).click();
    await expect(page.locator(".call-view h1")).toHaveText("Lounge");
    await expect(page.locator(".channel-sidebar")).toBeHidden();
    await page.getByRole("button", { name: "Desconectar da chamada" }).click();
  } finally {
    if (serverId) await api.rpc("delete_server", { p_server_id: serverId });
    if (userId) await admin.auth.admin.deleteUser(userId);
  }
});
