import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { openServer } from "./navigation";

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

const unwrap = async <T>(
  promise: PromiseLike<{ data: T; error: { message: string } | null }>,
  label: string,
) => {
  const result = await promise;
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
};

async function login(page: Page, email: string, password: string) {
  await page.goto("/");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.locator(".app-shell")).toBeVisible({ timeout: 20_000 });
}

test("limite de usuário do canal de voz é imposto no backend", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const admin = createClient(apiUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const ownerApi = createClient(apiUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const memberApi = createClient(apiUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const runId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const password = `Janja-${crypto.randomUUID()}-Aa1!`;
  const emails = [
    `limit-owner-${runId}@janja.local`,
    `limit-member-${runId}@janja.local`,
  ];
  const userIds: string[] = [];
  let serverId = "";
  let ownerContext: BrowserContext | undefined;
  let memberContext: BrowserContext | undefined;

  try {
    for (const [index, email] of emails.entries()) {
      const created = await unwrap(
        admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: {
            username: `limit_${index}_${runId}`.replace(/\W/g, "").slice(0, 30),
            display_name: `Limit ${index}`,
          },
        }),
        "criar usuário do limite de voz",
      );
      userIds.push(created.user.id);
    }
    await unwrap(
      ownerApi.auth.signInWithPassword({ email: emails[0], password }),
      "login API do owner",
    );
    await unwrap(
      memberApi.auth.signInWithPassword({ email: emails[1], password }),
      "login API do member",
    );
    serverId = (await unwrap(
      ownerApi.rpc("create_server", { p_name: `Voice limit ${runId}` }),
      "criar servidor",
    )) as string;
    const channels = await unwrap(
      ownerApi.from("channels").select("id,kind").eq("server_id", serverId),
      "listar canais",
    );
    const textChannel = channels.find((channel) => channel.kind === "text");
    const voiceChannel = channels.find((channel) => channel.kind === "voice");
    if (!textChannel || !voiceChannel)
      throw new Error("Canais iniciais ausentes.");
    await unwrap(
      ownerApi.rpc("update_channel", {
        p_channel_id: voiceChannel.id,
        p_name: "Lounge",
        p_slowmode_seconds: 0,
        p_private: false,
        p_user_limit: 1,
      }),
      "configurar limite",
    );
    const invite = await unwrap(
      ownerApi.rpc("create_invite", {
        p_server_id: serverId,
        p_channel_id: textChannel.id,
        p_max_uses: 1,
        p_expires_in_minutes: 60,
      }),
      "criar convite",
    );
    await unwrap(
      memberApi.rpc("redeem_invite", { p_code: invite }),
      "entrar no servidor",
    );

    ownerContext = await browser.newContext({ permissions: ["microphone"] });
    memberContext = await browser.newContext({ permissions: ["microphone"] });
    const ownerPage = await ownerContext.newPage();
    const memberPage = await memberContext.newPage();
    await login(ownerPage, emails[0], password);
    await openServer(ownerPage, serverId);
    await login(memberPage, emails[1], password);
    await openServer(memberPage, serverId);

    await ownerPage.getByRole("button", { name: /Lounge/ }).click();
    await expect(ownerPage.locator('[data-rtc-state="connected"]')).toBeVisible(
      {
        timeout: 45_000,
      },
    );
    await memberPage.getByRole("button", { name: /Lounge/ }).click();
    await expect(memberPage.locator('[data-rtc-state="error"]')).toBeVisible({
      timeout: 60_000,
    });
    await expect(memberPage.getByRole("status")).toContainText(
      "O canal de voz atingiu o limite de participantes.",
    );
    // O participante recusado nunca chega a aparecer como tile remoto.
    await expect(
      ownerPage.locator(
        ".participant-tile.camera-tile:has(video.remote-video)," +
          ".participant-tile.camera-tile:has(video.remote-audio)",
      ),
    ).toHaveCount(0, { timeout: 30_000 });
    await expect
      .poll(async () => {
        const { data, error } = await admin
          .from("call_session_participants")
          .select("left_at");
        if (error) throw error;
        return data.filter((participant) => participant.left_at === null)
          .length;
      })
      .toBe(1);
    await ownerPage.getByRole("button", { name: "Desconectar da chamada" }).click();
  } finally {
    await Promise.allSettled([ownerContext?.close(), memberContext?.close()]);
    if (serverId)
      await ownerApi.rpc("delete_server", { p_server_id: serverId });
    for (const userId of userIds.reverse())
      await admin.auth.admin.deleteUser(userId);
  }
});
