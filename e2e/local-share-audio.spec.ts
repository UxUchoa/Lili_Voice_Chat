import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { finishOnlineLogin, openServer } from "./navigation";

/**
 * O som do que está sendo compartilhado.
 *
 * O defeito era de padrão, não de código: a preferência vinha desligada e uma
 * migração antiga a tinha forçado para desligada em todo mundo que já havia
 * aberto o aplicativo. Quem compartilha é a única pessoa que não ouve o
 * resultado — ninguém percebe o próprio silêncio —, então isso podia durar
 * indefinidamente sem virar reclamação.
 *
 * Aqui o `getDisplayMedia` é substituído por uma fonte sintética com vídeo
 * **e** áudio. A parte trocada é exatamente a que é limitação de plataforma (o
 * Windows não separa o som por janela, e o navegador em modo automático não
 * marca a caixa de áudio); tudo depois dela é o nosso caminho de verdade:
 * publicação como `ScreenShareAudio`, travessia pelo LiveKit e reprodução no
 * outro lado.
 *
 * A asserção que importa é dupla. Uma faixa de áudio da tela **e** uma faixa
 * de microfone, no mesmo participante, ao mesmo tempo: compartilhar não pode
 * substituir a voz de quem compartilha, e a voz não pode substituir o som do
 * jogo.
 */

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

/**
 * Troca a captura de tela por uma fonte sintética com áudio.
 *
 * Um canvas animado dá a faixa de vídeo; um oscilador dá a de áudio. O canvas
 * precisa mudar de quadro, senão o encoder não tem o que enviar e a track
 * chega parada do outro lado.
 */
async function stubDisplayMediaWithAudio(page: Page) {
  await page.addInitScript(() => {
    navigator.mediaDevices.getDisplayMedia = async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 1280;
      canvas.height = 720;
      const context = canvas.getContext("2d")!;
      let frame = 0;
      const draw = () => {
        frame += 1;
        context.fillStyle = frame % 2 ? "#123" : "#345";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = "#fff";
        context.fillRect((frame * 7) % canvas.width, 100, 80, 80);
        requestAnimationFrame(draw);
      };
      draw();
      const video = (
        canvas as HTMLCanvasElement & {
          captureStream: (fps: number) => MediaStream;
        }
      ).captureStream(60);
      const audioContext = new AudioContext();
      const oscillator = audioContext.createOscillator();
      const destination = audioContext.createMediaStreamDestination();
      oscillator.frequency.value = 440;
      oscillator.connect(destination);
      oscillator.start();
      return new MediaStream([
        ...video.getVideoTracks(),
        ...destination.stream.getAudioTracks(),
      ]);
    };
  });
}

async function login(page: Page, email: string, password: string) {
  await page.goto("/");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await finishOnlineLogin(page);
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

/** Conta as faixas de um elemento de mídia por tipo. */
const trackCount = (page: Page, selector: string, kind: "audio" | "video") =>
  page.locator(selector).first().evaluate(
    (video, wanted) => {
      const stream = (video as HTMLVideoElement).srcObject as MediaStream | null;
      if (!stream) return 0;
      return wanted === "audio"
        ? stream.getAudioTracks().length
        : stream.getVideoTracks().length;
    },
    kind,
  );

test("o áudio do compartilhamento chega junto do microfone", async ({
  browser,
}) => {
  test.setTimeout(180_000);
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
  const ownerEmail = `share-owner-${runId}@lili.app`;
  const memberEmail = `share-member-${runId}@lili.app`;
  const userIds: string[] = [];
  let serverId = "";
  let ownerContext: BrowserContext | undefined;
  let memberContext: BrowserContext | undefined;

  try {
    for (const [index, email] of [ownerEmail, memberEmail].entries()) {
      const created = await unwrap(
        admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: {
            username: `sa${index}${runId}`.replace(/\W/g, "").slice(0, 30),
            display_name:
              index === 0 ? `SA Owner ${runId}` : `SA Member ${runId}`,
          },
        }),
        "criar conta",
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
      ownerApi.rpc("create_server", { p_name: `Sala SA ${runId}` }),
      "criar servidor",
    )) as string;
    const serverChannels = await unwrap(
      ownerApi.from("channels").select("id,kind").eq("server_id", serverId),
      "listar canais",
    );
    const textChannel = serverChannels.find((item) => item.kind === "text");
    if (!textChannel) throw new Error("Canal de texto inicial ausente.");
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

    ownerContext = await browser.newContext({
      permissions: ["microphone", "camera"],
    });
    memberContext = await browser.newContext({
      permissions: ["microphone", "camera"],
    });
    const ownerPage = await ownerContext.newPage();
    const memberPage = await memberContext.newPage();
    await stubDisplayMediaWithAudio(ownerPage);

    await login(ownerPage, ownerEmail, password);
    await openServer(ownerPage, serverId);
    await enterLounge(ownerPage);
    await login(memberPage, memberEmail, password);
    await openServer(memberPage, serverId);
    await enterLounge(memberPage);
    await expect(memberPage.locator(".participant-tile.camera-tile")).toHaveCount(
      2,
      { timeout: 30_000 },
    );

    // O microfone entra primeiro: o compartilhamento não pode substituí-lo.
    await ownerPage
      .locator(".call-controls")
      .getByRole("button", { name: "Ativar microfone" })
      .click();
    await expect
      .poll(
        () => trackCount(memberPage, "video.remote-video, video.remote-audio", "audio"),
        { timeout: 30_000 },
      )
      .toBe(1);

    await ownerPage
      .locator(".call-controls")
      .getByRole("button", { name: "Compartilhar sua tela" })
      .click();
    await expect(
      ownerPage
        .locator(".call-controls")
        .getByRole("button", { name: "Parar compartilhamento" }),
    ).toBeVisible({ timeout: 20_000 });

    // O aviso relata o que foi capturado de fato, e não o que foi pedido.
    await expect(ownerPage.locator(".media-notice")).toContainText(
      /com o som/,
      { timeout: 20_000 },
    );

    // A tela chega com vídeo…
    await expect
      .poll(() => trackCount(memberPage, "video.remote-screen-video", "video"), {
        timeout: 30_000,
      })
      .toBe(1);
    // …e com áudio, que é o que faltava.
    await expect
      .poll(() => trackCount(memberPage, "video.remote-screen-video", "audio"), {
        timeout: 30_000,
        message: "a tela chegou muda do outro lado",
      })
      .toBe(1);
    // E o microfone continua lá, numa faixa separada: um não substitui o outro.
    await expect
      .poll(
        () => trackCount(memberPage, "video.remote-video, video.remote-audio", "audio"),
        { timeout: 30_000, message: "o compartilhamento comeu o microfone" },
      )
      .toBe(1);

    // Parar o compartilhamento leva as duas faixas da tela embora, e deixa a
    // voz onde estava.
    await ownerPage
      .locator(".call-controls")
      .getByRole("button", { name: "Parar compartilhamento" })
      .click();
    await expect
      .poll(() => memberPage.locator("video.remote-screen-video").count(), {
        timeout: 30_000,
      })
      .toBe(0);
    await expect
      .poll(
        () => trackCount(memberPage, "video.remote-video, video.remote-audio", "audio"),
        { timeout: 30_000 },
      )
      .toBe(1);

    // Recomeçar não pode duplicar nada: as faixas anteriores foram destruídas.
    await ownerPage
      .locator(".call-controls")
      .getByRole("button", { name: "Compartilhar sua tela" })
      .click();
    await expect
      .poll(() => trackCount(memberPage, "video.remote-screen-video", "audio"), {
        timeout: 30_000,
      })
      .toBe(1);
    await expect
      .poll(() => trackCount(memberPage, "video.remote-screen-video", "video"), {
        timeout: 30_000,
      })
      .toBe(1);
  } finally {
    // Fechar os contextos primeiro faz os clientes saírem da sala; o
    // `delete_server` é o mesmo caminho dos outros testes e é ele que leva
    // junto canais, sessões e participantes. Apagar a linha do servidor por
    // fora deixava participantes com `left_at` nulo, e o teste de limite de
    // voz — que conta isso globalmente — falhava por causa deste aqui.
    await Promise.allSettled([ownerContext?.close(), memberContext?.close()]);
    if (serverId)
      await ownerApi.rpc("delete_server", { p_server_id: serverId });
    for (const id of userIds.reverse()) await admin.auth.admin.deleteUser(id);
  }
});
