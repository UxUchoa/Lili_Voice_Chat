import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
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
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await finishOnlineLogin(page);
}

/**
 * O tile do participante remoto. A chamada desenha um grid de
 * `.participant-tile`; o tile remoto é o que carrega a mídia recebida.
 */
const remoteTile = (page: Page) =>
  page.locator(
    ".participant-tile.camera-tile:has(video.remote-video)," +
      ".participant-tile.camera-tile:has(video.remote-audio)",
  );

/** O elemento de mídia do participante remoto. */
const remoteMedia = (page: Page) =>
  page.locator("video.remote-video, video.remote-audio");

const remoteScreenTile = (page: Page) =>
  page.locator(".participant-tile.screen-tile:has(video.remote-screen-video)");

/** Escolhe um dispositivo no menu ancorado ao chevron do controle. */
async function chooseDevice(
  page: Page,
  chevronLabel: string,
  groupLabel: string,
  index: number,
) {
  await page.getByRole("button", { name: chevronLabel }).click();
  const menu = page.locator(".device-menu");
  await expect(menu).toBeVisible();
  const group = menu
    .locator(".device-menu-group")
    .filter({ hasText: groupLabel });
  await expect
    .poll(() => group.getByRole("menuitemradio").count(), { timeout: 20_000 })
    .toBeGreaterThan(index);
  await group.getByRole("menuitemradio").nth(index).click();
  await expect(menu).toBeHidden();
}

async function enterLounge(page: Page) {
  await page.getByRole("button", { name: /Lounge/ }).click();
  const join = page.getByRole("button", { name: "Entrar no canal" });
  if (await join.isVisible()) await join.click();
  await expect(page.locator(".call-view")).toBeVisible();
  await expect(page.locator('[data-rtc-state="connected"]')).toBeVisible({
    timeout: 45_000,
  });
}

test("duas contas permanecem visíveis na mesma chamada local E2EE", async ({
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
  const password = `Lili-${crypto.randomUUID()}-Aa1!`;
  const ownerName = `Call Owner ${runId}`;
  const memberName = `Call Member ${runId}`;
  const ownerEmail = `call-owner-${runId}@lili.app`;
  const memberEmail = `call-member-${runId}@lili.app`;
  const userIds: string[] = [];
  let serverId = "";
  let ownerContext: BrowserContext | undefined;
  let memberContext: BrowserContext | undefined;

  try {
    for (const [index, input] of [
      { email: ownerEmail, displayName: ownerName },
      { email: memberEmail, displayName: memberName },
    ].entries()) {
      const created = await unwrap(
        admin.auth.admin.createUser({
          email: input.email,
          password,
          email_confirm: true,
          user_metadata: {
            username: `call_${index}_${runId}`.replace(/\W/g, "").slice(0, 30),
            display_name: input.displayName,
          },
        }),
        "criar conta da chamada",
      );
      userIds.push(created.user.id);
    }
    await unwrap(
      ownerApi.auth.signInWithPassword({ email: ownerEmail, password }),
      "login API do proprietário",
    );
    await unwrap(
      memberApi.auth.signInWithPassword({ email: memberEmail, password }),
      "login API do participante",
    );
    serverId = (await unwrap(
      ownerApi.rpc("create_server", { p_name: `Call UI ${runId}` }),
      "criar servidor da chamada",
    )) as string;
    const serverChannels = await unwrap(
      ownerApi.from("channels").select("id,kind").eq("server_id", serverId),
      "listar canais da chamada",
    );
    const textChannel = serverChannels.find(
      (channel) => channel.kind === "text",
    );
    const voiceChannel = serverChannels.find(
      (channel) => channel.kind === "voice",
    );
    if (!textChannel || !voiceChannel)
      throw new Error("Canais iniciais de texto/voz ausentes.");
    const destinationChannelId = (await unwrap(
      ownerApi.rpc("create_channel", {
        p_server_id: serverId,
        p_name: "Destino",
        p_kind: "voice",
        p_parent_id: null,
      }),
      "criar destino da chamada",
    )) as string;
    const invite = await unwrap(
      ownerApi.rpc("create_invite", {
        p_server_id: serverId,
        p_channel_id: textChannel.id,
        p_max_uses: 1,
        p_expires_in_minutes: 60,
      }),
      "criar convite da chamada",
    );
    await unwrap(
      memberApi.rpc("redeem_invite", { p_code: invite }),
      "entrar no servidor da chamada",
    );

    ownerContext = await browser.newContext({
      permissions: ["microphone", "camera"],
    });
    memberContext = await browser.newContext({
      permissions: ["microphone", "camera"],
    });
    const ownerPage = await ownerContext.newPage();
    const memberPage = await memberContext.newPage();

    // O proprietário entra primeiro. O segundo dispositivo só aparece depois;
    // isso cobre a reconciliação tardia do Welcome/epoch OpenMLS.
    await login(ownerPage, ownerEmail, password);
    await openServer(ownerPage, serverId);
    await enterLounge(ownerPage);
    await login(memberPage, memberEmail, password);
    await openServer(memberPage, serverId);
    await enterLounge(memberPage);

    await expect(remoteTile(ownerPage)).toContainText(memberName, {
      timeout: 30_000,
    });
    await expect(remoteTile(memberPage)).toContainText(ownerName, {
      timeout: 30_000,
    });
    for (const page of [ownerPage, memberPage]) {
      await expect(
        page
          .locator(".channel-row")
          .filter({ hasText: "Lounge" })
          .locator(".people-count"),
      ).toHaveText("2", { timeout: 20_000 });
    }

    await ownerPage
      .locator(".call-controls")
      .getByRole("button", { name: "Ativar microfone" })
      .click();
    await memberPage
      .locator(".call-controls")
      .getByRole("button", { name: "Ativar microfone" })
      .click();
    await expect(
      ownerPage
        .locator(".call-controls")
        .getByRole("button", { name: "Silenciar microfone" }),
    ).toBeVisible();
    await expect(
      memberPage
        .locator(".call-controls")
        .getByRole("button", { name: "Silenciar microfone" }),
    ).toBeVisible();
    for (const page of [ownerPage, memberPage]) {
      await expect
        .poll(
          () =>
            remoteMedia(page).evaluate(
              (video) =>
                (
                  (video as HTMLVideoElement).srcObject as MediaStream | null
                )?.getAudioTracks().length ?? 0,
            ),
          { timeout: 30_000 },
        )
        .toBeGreaterThan(0);
    }

    // Trocar o dispositivo de entrada deve substituir a faixa publicada sem
    // derrubar a chamada ou deixar o participante remoto sem áudio.
    await chooseDevice(ownerPage, "Dispositivos de áudio", "MICROFONE", 1);
    await expect(ownerPage.locator(".media-notice")).toContainText(
      "Microfone conectado.",
    );
    await expect
      .poll(
        () =>
          remoteMedia(memberPage).evaluate(
            (video) =>
              (
                (video as HTMLVideoElement).srcObject as MediaStream | null
              )?.getAudioTracks().length ?? 0,
          ),
        { timeout: 30_000 },
      )
      .toBeGreaterThan(0);

    await ownerPage
      .locator(".call-controls")
      .getByRole("button", { name: "Ligar câmera" })
      .click();
    await expect(
      ownerPage
        .locator(".call-controls")
        .getByRole("button", { name: "Desligar câmera" }),
    ).toBeVisible();
    await expect
      .poll(
        () =>
          remoteMedia(memberPage).evaluate(
            (video) =>
              (
                (video as HTMLVideoElement).srcObject as MediaStream | null
              )?.getVideoTracks().length ?? 0,
          ),
        { timeout: 30_000 },
      )
      .toBeGreaterThan(0);
    await chooseDevice(ownerPage, "Selecionar câmera", "CÂMERA", 1);
    await expect(ownerPage.locator(".media-notice")).toContainText(
      /Câmera conectada/,
    );
    await expect
      .poll(
        () =>
          remoteMedia(memberPage).evaluate(
            (video) =>
              (
                (video as HTMLVideoElement).srcObject as MediaStream | null
              )?.getVideoTracks().length ?? 0,
          ),
        { timeout: 30_000 },
      )
      .toBeGreaterThan(0);

    const outputDevices = await memberPage.evaluate(async () =>
      (await navigator.mediaDevices.enumerateDevices())
        .filter((device) => device.kind === "audiooutput")
        .map((device) => device.deviceId),
    );
    if (outputDevices.length < 2)
      throw new Error("O navegador não expôs uma saída de áudio de teste.");
    await chooseDevice(
      memberPage,
      "Dispositivos de áudio",
      "SAÍDA DE ÁUDIO",
      2,
    );
    await expect
      .poll(() =>
        remoteMedia(memberPage).evaluate(
          (video) => (video as HTMLMediaElement).sinkId,
        ),
      )
      .toBe(outputDevices[1]);

    await memberPage
      .locator(".call-controls")
      .getByRole("button", { name: "Ensurdecer" })
      .click();
    await expect(remoteMedia(memberPage)).toHaveJSProperty("muted", true);
    await memberPage
      .locator(".call-controls")
      .getByRole("button", { name: "Voltar a ouvir" })
      .click();
    await expect(remoteMedia(memberPage)).toHaveJSProperty("muted", false);

    // O compartilhamento usa getDisplayMedia de verdade no Edge. A faixa da
    // tela é publicada separadamente da câmera, renderizada pelo segundo
    // participante e removida novamente ao encerrar o compartilhamento.
    await ownerPage
      .locator(".call-controls")
      .getByRole("button", { name: "Compartilhar sua tela" })
      .click();
    await expect(
      ownerPage
        .locator(".call-controls")
        .getByRole("button", { name: "Parar compartilhamento" }),
    ).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(
        () =>
          memberPage
            .locator(".remote-screen-video")
            .evaluate(
              (video) =>
                (
                  (video as HTMLVideoElement).srcObject as MediaStream | null
                )?.getVideoTracks().length ?? 0,
            ),
        { timeout: 30_000 },
      )
      .toBe(1);
    await expect(remoteScreenTile(memberPage)).toContainText(
      `Tela de ${ownerName}`,
    );
    const remoteScreenFocus = memberPage.getByRole("button", {
      name: `Focar tela de ${ownerName}`,
    });
    await remoteScreenFocus.focus();
    await remoteScreenFocus.press("Enter");
    await expect(memberPage.locator(".call-stage")).toHaveClass(/has-focus/);
    await expect(remoteScreenTile(memberPage)).toHaveClass(/focused/);
    // Ao focar uma tela, os demais tiles descem para a faixa inferior — o
    // próprio e o do outro participante, ambos ainda visíveis.
    await expect(
      memberPage.locator(".tile-strip .participant-tile.camera-tile"),
    ).toHaveCount(2);
    await expect(
      memberPage.locator(
        ".tile-strip .participant-tile.camera-tile:has(video.remote-video)",
      ),
    ).toBeVisible();
    await expect
      .poll(
        () =>
          remoteMedia(memberPage).evaluate(
            (video) =>
              (
                (video as HTMLVideoElement).srcObject as MediaStream | null
              )?.getVideoTracks().length ?? 0,
          ),
        { timeout: 30_000 },
      )
      .toBe(1);
    await ownerPage
      .locator(".call-controls")
      .getByRole("button", { name: "Parar compartilhamento" })
      .click();
    await expect(
      ownerPage
        .locator(".call-controls")
        .getByRole("button", { name: "Compartilhar sua tela" }),
    ).toBeVisible();
    await expect
      .poll(() => memberPage.locator("video.remote-screen-video").count(), {
        timeout: 30_000,
      })
      .toBe(0);
    await expect(memberPage.locator(".call-stage")).not.toHaveClass(
      /has-focus/,
    );
    await expect(remoteTile(memberPage)).toBeVisible();

    // A hidratação do workspace ocorre a cada 2,5 s. A conexão não pode ser
    // derrubada por esse refresh nem esconder participantes sem mic publicado.
    await ownerPage.waitForTimeout(6_000);
    await expect
      .poll(async () => {
        const { data, error } = await admin
          .from("call_session_participants")
          .select("joined_at,last_seen_at")
          .is("left_at", null);
        if (error) throw error;
        return data.length === 2
          ? data.every(
              (participant) =>
                new Date(participant.last_seen_at).getTime() -
                  new Date(participant.joined_at).getTime() >=
                5_000,
            )
          : false;
      })
      .toBe(true);
    await expect(
      ownerPage.locator('[data-rtc-state="connected"]'),
    ).toBeVisible();
    await expect(
      memberPage.locator('[data-rtc-state="connected"]'),
    ).toBeVisible();
    await expect(remoteTile(ownerPage)).toContainText(memberName);
    await expect(remoteTile(memberPage)).toContainText(ownerName);

    // Uma queda real do servidor deve acionar o reconnect do SDK e republicar
    // as faixas desejadas quando o LiveKit voltar.
    execFileSync("docker.exe", ["restart", "livekit-livekit-1"], {
      encoding: "utf8",
      timeout: 30_000,
    });
    for (const page of [ownerPage, memberPage]) {
      await expect(page.locator('[data-rtc-state="connected"]')).toBeVisible({
        timeout: 60_000,
      });
      await expect(remoteTile(page)).toBeVisible({
        timeout: 60_000,
      });
      await expect
        .poll(
          () =>
            remoteMedia(page).evaluate(
              (video) =>
                (
                  (video as HTMLVideoElement).srcObject as MediaStream | null
                )?.getAudioTracks().length ?? 0,
            ),
          { timeout: 60_000 },
        )
        .toBeGreaterThan(0);
    }

    await expect
      .poll(async () => {
        const { data, error } = await admin
          .from("call_session_participants")
          .select("id,left_at,session_id");
        if (error) throw error;
        return data.filter((participant) => participant.left_at === null)
          .length;
      })
      .toBe(2);

    // Move é conduzido por um pedido Realtime persistido. O alvo troca de
    // canal no React, obtém outro token e deriva a chave E2EE do novo grupo.
    await unwrap(
      ownerApi.functions.invoke("livekit-moderate", {
        body: {
          channel_id: voiceChannel.id,
          target_user_id: userIds[1],
          action: "move",
          destination_channel_id: destinationChannelId,
        },
      }),
      "mover participante pela UI conectada",
    );
    await expect(memberPage.locator(".call-view h1")).toHaveText("Destino", {
      timeout: 45_000,
    });
    await expect(
      memberPage.locator('[data-rtc-state="connected"]'),
    ).toBeVisible({ timeout: 45_000 });
    await expect(remoteTile(ownerPage)).toHaveCount(0, {
      timeout: 30_000,
    });
    await expect(
      ownerPage
        .locator(".channel-row")
        .filter({ hasText: "Lounge" })
        .locator(".people-count"),
    ).toHaveText("1", { timeout: 20_000 });
    await expect(
      ownerPage
        .locator(".channel-row")
        .filter({ hasText: "Destino" })
        .locator(".people-count"),
    ).toHaveText("1", { timeout: 20_000 });
    await expect
      .poll(async () => {
        const { data, error } = await admin
          .from("call_session_participants")
          .select("left_at,call_sessions!inner(channel_id)");
        if (error) throw error;
        return data.filter((participant) => participant.left_at === null)
          .length;
      })
      .toBe(2);

    await Promise.all([
      ownerPage
        .locator(".call-controls")
        .getByRole("button", { name: "Desconectar da chamada" })
        .click(),
      memberPage
        .locator(".call-controls")
        .getByRole("button", { name: "Desconectar da chamada" })
        .click(),
    ]);
    await expect
      .poll(
        async () => {
          const { data, error } = await admin
            .from("call_sessions")
            .select("ended_at,call_session_participants(user_id,left_at)")
            .eq("channel_id", voiceChannel.id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (error || !data) return 0;
          return data.call_session_participants.filter(
            (participant) => participant.left_at,
          ).length;
        },
        { timeout: 20_000 },
      )
      .toBe(2);
    await expect
      .poll(
        async () => {
          const { data, error } = await admin
            .from("call_sessions")
            .select("ended_at,call_session_participants(left_at)")
            .eq("channel_id", destinationChannelId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (error || !data || !data.ended_at) return 0;
          return data.call_session_participants.filter(
            (participant) => participant.left_at,
          ).length;
        },
        { timeout: 20_000 },
      )
      .toBe(1);
    await expect
      .poll(async () => {
        const { data, error } = await admin
          .from("call_sessions")
          .select("ended_at")
          .eq("channel_id", voiceChannel.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .single();
        if (error) throw error;
        return Boolean(data.ended_at);
      })
      .toBe(true);

    await ownerPage.getByRole("button", { name: /^Início/ }).click();
    await expect(ownerPage.getByText("CHAMADAS RECENTES")).toBeVisible();
    const loungeHistory = ownerPage
      .locator(".recent-calls > button")
      .filter({ hasText: "Lounge" });
    await expect(loungeHistory).toContainText(ownerName);
    await expect(loungeHistory).toContainText(memberName);
    await expect(
      ownerPage
        .locator(".recent-calls > button")
        .filter({ hasText: "Destino" }),
    ).toContainText(memberName);
  } finally {
    await Promise.allSettled([ownerContext?.close(), memberContext?.close()]);
    if (serverId)
      await ownerApi.rpc("delete_server", { p_server_id: serverId });
    for (const userId of userIds.reverse())
      await admin.auth.admin.deleteUser(userId);
  }
});
