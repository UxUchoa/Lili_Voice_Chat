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

/**
 * Guarda toda `RTCPeerConnection` criada pela página.
 *
 * O objetivo é medir o que **de fato** está sendo transmitido, e não repetir os
 * números que a interface mostra — foi exatamente essa diferença que deixou o
 * compartilhamento rodando a ~15 quadros com o menu anunciando 60. O gancho é
 * do teste: nada disto existe no código do aplicativo.
 */
const spyOnPeerConnections = `
  (() => {
    const Original = window.RTCPeerConnection;
    window.__pcs = [];
    const Spy = function (...args) {
      const pc = new Original(...args);
      window.__pcs.push(pc);
      return pc;
    };
    Spy.prototype = Original.prototype;
    window.RTCPeerConnection = Spy;
  })();
`;

/** O que o sender do compartilhamento está realmente configurado para fazer. */
async function screenSenderReport(page: Page) {
  return page.evaluate(async () => {
    const pcs =
      (window as unknown as { __pcs?: RTCPeerConnection[] }).__pcs ?? [];
    for (const pc of pcs) {
      for (const sender of pc.getSenders()) {
        const track = sender.track;
        if (!track || track.kind !== "video") continue;
        const settings = track.getSettings();
        // A câmera falsa do Playwright é 640×480; o compartilhamento vem do
        // getDisplayMedia e é bem maior. É como se separam as duas tracks.
        if ((settings.height ?? 0) < 500) continue;
        const parameters = sender.getParameters();
        const stats = await sender.getStats();
        let outbound: Record<string, number> | null = null;
        stats.forEach((report: Record<string, number> & { type: string }) => {
          if (report.type === "outbound-rtp")
            outbound = {
              frameWidth: report.frameWidth ?? 0,
              frameHeight: report.frameHeight ?? 0,
              framesPerSecond: report.framesPerSecond ?? 0,
              framesEncoded: report.framesEncoded ?? 0,
              framesSent: report.framesSent ?? 0,
              bytesSent: report.bytesSent ?? 0,
            };
        });
        return {
          settings: {
            width: settings.width ?? 0,
            height: settings.height ?? 0,
            frameRate: Math.round(settings.frameRate ?? 0),
          },
          encoding: {
            maxFramerate: parameters.encodings?.[0]?.maxFramerate ?? 0,
            maxBitrate: parameters.encodings?.[0]?.maxBitrate ?? 0,
          },
          degradationPreference: String(parameters.degradationPreference ?? ""),
          outbound,
        };
      }
    }
    return null;
  });
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

test("o preset escolhido chega à captura e ao encoder", async ({ browser }) => {
  test.setTimeout(300_000);
  const admin = createClient(apiUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const api = createClient(apiUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const runId = `${Date.now()}`;
  const password = `Lili-${crypto.randomUUID()}-Aa1!`;
  const contas = [
    { email: `share-a-${runId}@lili.app`, name: `Share A ${runId}` },
    { email: `share-b-${runId}@lili.app`, name: `Share B ${runId}` },
  ];
  const userIds: string[] = [];
  let serverId = "";
  const contexts: BrowserContext[] = [];

  try {
    for (const [index, conta] of contas.entries()) {
      const created = await admin.auth.admin.createUser({
        email: conta.email,
        password,
        email_confirm: true,
        user_metadata: {
          username: `share${index}${runId}`.slice(0, 24),
          display_name: conta.name,
        },
      });
      if (created.error) throw created.error;
      userIds.push(created.data.user.id);
    }
    const signed = await api.auth.signInWithPassword({
      email: contas[0].email,
      password,
    });
    if (signed.error) throw signed.error;
    const server = await api.rpc("create_server", { p_name: `Share ${runId}` });
    if (server.error) throw server.error;
    serverId = server.data as string;

    const pages: Page[] = [];
    for (const conta of contas) {
      const context = await browser.newContext({
        permissions: ["camera", "microphone"],
      });
      contexts.push(context);
      const page = await context.newPage();
      await page.addInitScript(spyOnPeerConnections);
      await page.goto("/");
      await page.getByLabel("E-mail").fill(conta.email);
      await page.getByLabel("Senha", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Entrar", exact: true }).click();
      await finishOnlineLogin(page);
      pages.push(page);
    }
    const [pageA, pageB] = pages;

    // A segunda conta entra pelo mesmo caminho que uma pessoa usaria: o
    // convite. Inserir em `server_members` direto é recusado, e com razão —
    // nem o service_role escreve nessa tabela.
    const channels = await api
      .from("channels")
      .select("id,kind")
      .eq("server_id", serverId);
    if (channels.error) throw channels.error;
    const textChannel = (channels.data ?? []).find(
      (channel) => channel.kind === "text",
    );
    if (!textChannel) throw new Error("o servidor nasceu sem canal de texto");
    const invite = await api.rpc("create_invite", {
      p_server_id: serverId,
      p_channel_id: textChannel.id,
      p_max_uses: 1,
      p_expires_in_minutes: 60,
    });
    if (invite.error) throw invite.error;
    const apiB = createClient(apiUrl, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const signedB = await apiB.auth.signInWithPassword({
      email: contas[1].email,
      password,
    });
    if (signedB.error) throw signedB.error;
    const redeemed = await apiB.rpc("redeem_invite", { p_code: invite.data });
    if (redeemed.error) throw redeemed.error;
    await pageB.reload();
    await finishOnlineLogin(pageB);

    for (const page of pages) {
      await openServer(page, serverId);
      await enterLounge(page);
    }

    // --- O fluxo do item 11: começar sem tocar em configuração nenhuma ---
    await pageA.getByRole("button", { name: "Compartilhar tela" }).click();
    await expect
      .poll(async () => (await screenSenderReport(pageA)) !== null, {
        timeout: 60_000,
      })
      .toBe(true);

    // Alguns segundos antes de ler: framesPerSecond só existe depois de haver
    // quadros suficientes para uma média.
    await pageA.waitForTimeout(8000);
    const padrao = await screenSenderReport(pageA);
    console.log("PADRAO", JSON.stringify(padrao, null, 2));

    expect(padrao, "o compartilhamento publicou uma track").not.toBeNull();
    expect(padrao!.settings.height).toBe(720);
    expect(padrao!.settings.width).toBe(1280);
    expect(padrao!.settings.frameRate).toBe(60);
    expect(padrao!.encoding.maxFramerate).toBe(60);
    expect(padrao!.encoding.maxBitrate).toBe(2_300_000);
    expect(padrao!.degradationPreference).toBe("maintain-framerate");
    expect(padrao!.outbound, "há estatísticas de saída").not.toBeNull();
    expect(padrao!.outbound!.framesEncoded).toBeGreaterThan(0);
    expect(padrao!.outbound!.bytesSent).toBeGreaterThan(0);

    // --- Trocar de preset no meio, que era o que não mudava nada ---
    await pageA.getByLabel("Qualidade do compartilhamento").click();
    await pageA.getByRole("menuitemradio", { name: "1080p" }).click();
    await pageA.getByRole("menuitemradio", { name: "30 fps" }).click();
    await expect
      .poll(
        async () => (await screenSenderReport(pageA))?.encoding.maxFramerate,
        { timeout: 30_000 },
      )
      .toBe(30);
    const trocado = await screenSenderReport(pageA);
    console.log("TROCADO", JSON.stringify(trocado, null, 2));
    expect(trocado!.encoding.maxBitrate).toBe(2_500_000);

    // --- O outro cliente recebe, e a chamada dele continua de pé ---
    const recebido = await pageB.evaluate(async () => {
      const pcs =
        (window as unknown as { __pcs?: RTCPeerConnection[] }).__pcs ?? [];
      let melhor = { framesReceived: 0, framesDecoded: 0, frameHeight: 0 };
      for (const pc of pcs) {
        const stats = await pc.getStats();
        stats.forEach((report: Record<string, number> & { type: string }) => {
          if (
            report.type === "inbound-rtp" &&
            (report.framesReceived ?? 0) > melhor.framesReceived
          )
            melhor = {
              framesReceived: report.framesReceived ?? 0,
              framesDecoded: report.framesDecoded ?? 0,
              frameHeight: report.frameHeight ?? 0,
            };
        });
      }
      return melhor;
    });
    console.log("RECEBIDO", JSON.stringify(recebido, null, 2));
    expect(recebido.framesReceived).toBeGreaterThan(0);
    expect(recebido.framesDecoded).toBeGreaterThan(0);
    await expect(pageB.locator('[data-rtc-state="connected"]')).toBeVisible();

    // --- Parar de compartilhar não pode derrubar a chamada ---
    await pageA.getByRole("button", { name: "Parar de compartilhar" }).click();
    await expect(pageA.locator('[data-rtc-state="connected"]')).toBeVisible();
    await expect(pageB.locator('[data-rtc-state="connected"]')).toBeVisible();
    await expect(pageA.locator(".call-view")).toBeVisible();
  } finally {
    await Promise.allSettled(contexts.map((context) => context.close()));
    if (serverId) await api.rpc("delete_server", { p_server_id: serverId });
    for (const id of userIds) await admin.auth.admin.deleteUser(id);
  }
});
