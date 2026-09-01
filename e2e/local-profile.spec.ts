import { execFileSync } from "node:child_process";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import {
  applyCrop,
  chooseInSelect,
  finishOnlineLogin,
  openServer,
  openServerSettings,
} from "./navigation";

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

test("perfil P0 e mídia privada persistem no Supabase local", async ({
  page,
}) => {
  const admin = createClient(apiUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const api = createClient(apiUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const runId = `${Date.now()}${crypto.randomUUID().replace(/\W/g, "").slice(0, 5)}`;
  const email = `profile-${runId}@lili.app`;
  const password = `Lili-${crypto.randomUUID()}-Aa1!`;
  const username = `perfil_${runId}`.slice(0, 24);
  let userId = "";
  let serverId = "";
  let avatarPath = "";
  let bannerPath = "";

  try {
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        username: `qa_${runId}`.slice(0, 24),
        display_name: "Perfil QA",
      },
    });
    if (created.error) throw created.error;
    userId = created.data.user.id;
    const signed = await api.auth.signInWithPassword({ email, password });
    if (signed.error) throw signed.error;
    const server = await api.rpc("create_server", {
      p_name: "Perfil QA local",
    });
    if (server.error) throw server.error;
    serverId = server.data as string;

    await page.goto("/");
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Senha", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await finishOnlineLogin(page);
    await page.locator(".user-panel").click();
    await expect(page.locator(".profile-panel")).toBeVisible();
    await page.getByText("Segurança, senha e dispositivos").click();
    await expect(page.getByText("SESSÕES DA CONTA — 2")).toBeVisible({
      timeout: 20_000,
    });
    await page.getByRole("button", { name: "Encerrar outras" }).click();
    await expect(page.getByText("1 sessão encerrada.")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText("SESSÕES DA CONTA — 1")).toBeVisible();

    await page.getByLabel("Nome de exibição").fill("Perfil Completo QA");
    await page.getByLabel("Username").fill(username);
    await page.getByLabel("Pronomes (opcional)").fill("ela/dela");
    await page.getByLabel("Status personalizado").fill("Testando em local");
    await chooseInSelect(page, "Presença", "Não perturbe");
    const logo = path.resolve("public/logo-vetorizada.png");
    await page.getByLabel("Alterar avatar").setInputFiles(logo);
    await applyCrop(page);
    await page.getByLabel("Alterar banner").setInputFiles(logo);
    await applyCrop(page);
    await page.getByRole("button", { name: "Salvar perfil" }).click();
    await expect(page.getByText("Perfil salvo no servidor local.")).toBeVisible(
      {
        timeout: 20_000,
      },
    );
    await expect(
      page.locator(".profile-banner-preview .avatar img"),
    ).toBeVisible();

    const profileResult = await api
      .from("profiles")
      .select(
        "username,display_name,bio,pronouns,custom_status,presence,avatar_path,banner_path",
      )
      .eq("id", userId)
      .single();
    if (profileResult.error) throw profileResult.error;
    expect(profileResult.data).toMatchObject({
      username,
      display_name: "Perfil Completo QA",
      pronouns: "ela/dela",
      custom_status: "Testando em local",
      presence: "dnd",
    });
    avatarPath = profileResult.data.avatar_path ?? "";
    bannerPath = profileResult.data.banner_path ?? "";
    expect(avatarPath.startsWith(`${userId}/`)).toBe(true);
    expect(bannerPath.startsWith(`${userId}/`)).toBe(true);

    await page.reload();
    await expect(page.locator(".app-shell")).toBeVisible({ timeout: 20_000 });
    await page.locator(".user-panel").click();
    await expect(page.getByLabel("Username")).toHaveValue(username);
    await expect(page.getByLabel("Pronomes (opcional)")).toHaveValue(
      "ela/dela",
    );
    await expect(
      page.locator(".profile-banner-preview .avatar img"),
    ).toBeVisible();
    await page.locator(".profile-panel .close-settings").click();
    await openServer(page, serverId);
    await openServerSettings(page, "Quota");
    await expect(page.getByText("Banco PostgreSQL")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.locator(".quota-card")).toHaveCount(2);
    await expect(
      page.locator(".quota-card").getByRole("progressbar", { name: /Uso de/ }),
    ).toHaveCount(2);
  } finally {
    if (avatarPath) await api.storage.from("avatars").remove([avatarPath]);
    if (bannerPath) await api.storage.from("banners").remove([bannerPath]);
    if (serverId) await api.rpc("delete_server", { p_server_id: serverId });
    if (userId) await admin.auth.admin.deleteUser(userId);
  }
});
