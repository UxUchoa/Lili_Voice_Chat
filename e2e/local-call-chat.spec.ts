import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import {
  expect,
  test,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { finishOnlineLogin, openServer } from "./navigation";

/**
 * O chat que se abre **dentro** da chamada.
 *
 * Dois defeitos moravam aqui, e os dois eram invisíveis para quem os causava.
 *
 * O primeiro: imagem e GIF enviados durante a chamada não apareciam. A
 * mensagem chegava, a legenda aparecia, a mídia não — e voltava inteira ao
 * sair da chamada, o que fazia parecer atraso de sincronização. Era outra
 * coisa: o painel da chamada era uma segunda implementação do chat, que só
 * sabia desenhar texto. Por isso o teste não checa "a mensagem chegou": ele
 * checa que existe um `<img>` carregado **dentro do painel da chamada**, ainda
 * em chamada, nos dois lados.
 *
 * O segundo: a voz saía duplicada. Ligar o microfone leva centenas de
 * milissegundos — o supressor precisa carregar o WebAssembly — e nesse
 * intervalo o botão continua mostrando "silenciado". Clicar de novo abria uma
 * segunda captura, e as duas iam ao ar. Do outro lado isso chega como duas
 * faixas de áudio no mesmo participante, então é assim que se mede: o
 * participante remoto tem que ter exatamente uma.
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

/** PNG 1x1, pequeno o bastante para o anexo abrir sozinho. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
/** GIF 1x1, que é como o seletor de GIFs entrega o arquivo escolhido. */
const GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

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

/** O painel de chat da chamada, aberto pelo botão do canto superior direito. */
async function openCallChat(page: Page) {
  // Ancorado no cabeçalho da chamada: "Chat da chamada" também casaria com
  // um servidor que se chamasse assim na barra lateral.
  await page
    .locator(".call-header")
    .getByRole("button", { name: "Chat da chamada" })
    .click();
  const panel = page.locator(".voice-text-panel");
  await expect(panel).toBeVisible({ timeout: 15_000 });
  return panel;
}

/** Quantas faixas de áudio o participante remoto está entregando. */
const remoteAudioTracks = (page: Page) =>
  page
    .locator("video.remote-video, video.remote-audio")
    .first()
    .evaluate(
      (video) =>
        (
          (video as HTMLVideoElement).srcObject as MediaStream | null
        )?.getAudioTracks().length ?? 0,
    );

/**
 * A mídia de uma mensagem, dentro de um painel específico.
 *
 * O painel importa: era exatamente a diferença entre "aparece na conversa
 * cheia" e "aparece na chamada".
 */
const mediaOf = (panel: Locator, texto: string) =>
  panel
    .locator(".message")
    .filter({ hasText: texto })
    .locator(".attachment-media-image img");

test("o chat da chamada mostra mídia e o microfone não duplica", async ({
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
  const ownerEmail = `chat-owner-${runId}@lili.app`;
  const memberEmail = `chat-member-${runId}@lili.app`;
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
            username: `cc${index}${runId}`.replace(/\W/g, "").slice(0, 30),
            display_name:
              index === 0 ? `CC Owner ${runId}` : `CC Member ${runId}`,
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
      ownerApi.rpc("create_server", { p_name: `Sala CC ${runId}` }),
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

    await login(ownerPage, ownerEmail, password);
    await openServer(ownerPage, serverId);
    await enterLounge(ownerPage);
    await login(memberPage, memberEmail, password);
    await openServer(memberPage, serverId);
    await enterLounge(memberPage);
    for (const page of [ownerPage, memberPage])
      await expect(page.locator(".participant-tile.camera-tile")).toHaveCount(
        2,
        { timeout: 30_000 },
      );

    const ownerPanel = await openCallChat(ownerPage);
    const memberPanel = await openCallChat(memberPage);

    // 1. Texto continua funcionando nos dois sentidos, sem sair da chamada.
    const texto = `texto-na-chamada-${runId}`;
    await ownerPanel.locator(".composer textarea").fill(texto);
    await ownerPanel.locator(".composer textarea").press("Enter");
    await expect(memberPanel.getByText(texto, { exact: true })).toBeVisible({
      timeout: 30_000,
    });

    // 2. Imagem. É este o caso que aparecia vazio: a mensagem chegava e a
    //    mídia não. A asserção é sobre o `<img>` renderizado dentro do painel
    //    da chamada, com o blob resolvido — e não sobre o nome do arquivo, que
    //    o painel antigo também não mostrava.
    const legenda = `com-imagem-${runId}`;
    await ownerPanel.locator('.composer input[type="file"]').setInputFiles({
      name: `foto-${runId}.png`,
      mimeType: "image/png",
      buffer: PNG,
    });
    await ownerPanel.locator(".composer textarea").fill(legenda);
    await ownerPanel.locator(".composer textarea").press("Enter");

    for (const [quem, painel] of [
      ["remetente", ownerPanel],
      ["destinatário", memberPanel],
    ] as const) {
      const img = mediaOf(painel, legenda);
      await expect(img, `a imagem não renderizou no ${quem}`).toBeVisible({
        timeout: 30_000,
      });
      await expect
        .poll(
          () => img.evaluate((node) => (node as HTMLImageElement).naturalWidth),
          { timeout: 30_000, message: `a imagem não carregou no ${quem}` },
        )
        .toBeGreaterThan(0);
    }

    // 3. Mídia sem legenda — é assim que o seletor de GIFs envia o arquivo.
    const gif = `animado-${runId}.gif`;
    await ownerPanel
      .locator('.composer input[type="file"]')
      .setInputFiles({ name: gif, mimeType: "image/gif", buffer: GIF });
    await ownerPanel.locator(".composer textarea").press("Enter");
    await expect(
      mediaOf(memberPanel, gif),
      "o GIF sem legenda não renderizou para quem recebe",
    ).toBeVisible({ timeout: 30_000 });

    // 4. Uma capacidade que o painel antigo não tinha, para provar que o que
    //    roda aqui é a conversa inteira e não uma cópia enxuta dela.
    const linhaDoTexto = memberPanel
      .locator(".message")
      .filter({ hasText: texto });
    await linhaDoTexto.hover();
    await linhaDoTexto.getByTitle("Reagir").click();
    await memberPage.getByRole("textbox", { name: "Reação" }).fill("🔥");
    await memberPage
      .getByRole("button", { name: "Reagir", exact: true })
      .click();
    await expect(
      ownerPanel
        .locator(".message")
        .filter({ hasText: texto })
        .locator(".message-reactions button"),
      "a reação feita na chamada não chegou ao outro lado",
    ).toBeVisible({ timeout: 30_000 });

    // 5. A voz fantasma. Dois cliques rápidos enquanto o supressor carrega
    //    abriam duas capturas do mesmo microfone, e as duas iam ao ar. Três
    //    cliques terminam com o microfone ligado.
    const mic = () =>
      ownerPage
        .locator(".call-controls")
        .getByRole("button", { name: /microfone/i });
    await mic().click();
    await mic().click();
    await mic().click();
    await expect(
      ownerPage
        .locator(".call-controls")
        .getByRole("button", { name: "Silenciar microfone" }),
      "os cliques repetidos deixaram o microfone num estado inconsistente",
    ).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(() => remoteAudioTracks(memberPage), { timeout: 30_000 })
      .toBeGreaterThan(0);
    // Uma, e exatamente uma. Duas é a voz fantasma.
    await expect
      .poll(() => remoteAudioTracks(memberPage), {
        timeout: 15_000,
        message: "o participante remoto recebeu mais de uma faixa de microfone",
      })
      .toBe(1);

    // 6. Fechar e reabrir o painel não pode perder a mídia já recebida.
    await ownerPanel.getByRole("button", { name: "Fechar chat" }).click();
    await expect(ownerPanel).toBeHidden();
    await expect(
      mediaOf(await openCallChat(ownerPage), legenda),
      "a imagem sumiu ao reabrir o painel",
    ).toBeVisible({ timeout: 30_000 });

    // 7. Sair da chamada com o painel aberto não pode travar nada: a saída
    //    passa pela mesma fila que serializa as capturas de microfone, e uma
    //    captura em voo terminaria depois da limpeza se não passasse por ela.
    await ownerPage
      .locator(".call-controls")
      .getByRole("button", { name: "Desconectar da chamada" })
      .click();
    await expect(ownerPage.locator(".call-view")).toHaveCount(0, {
      timeout: 30_000,
    });
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
