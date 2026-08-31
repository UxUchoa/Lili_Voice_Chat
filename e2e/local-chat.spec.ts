import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { openServer, openServerSettings } from "./navigation";

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

async function waitFor(check: () => Promise<boolean>, message: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(message);
}

test("duas sessões isoladas trocam mensagens OpenMLS no mesmo canal", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const admin = createClient(apiUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const ownerApi = createClient(apiUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const memberApi = createClient(apiUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const thirdApi = createClient(apiUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const fourthApi = createClient(apiUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const runId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const password = `Janja-${crypto.randomUUID()}-Aa1!`;
  const ownerEmail = `chat-owner-${runId}@janja.local`;
  const memberEmail = `chat-member-${runId}@janja.local`;
  const thirdEmail = `chat-third-${runId}@janja.local`;
  const fourthEmail = `chat-fourth-${runId}@janja.local`;
  const ownerUsername = `chat_owner_${runId.replace(/\W/g, "")}`.slice(0, 30);
  const memberUsername = `chat_member_${runId.replace(/\W/g, "")}`.slice(0, 30);
  const thirdUsername = `chat_third_${runId.replace(/\W/g, "")}`.slice(0, 30);
  const fourthUsername = `chat_fourth_${runId.replace(/\W/g, "")}`.slice(0, 30);
  const serverName = `Chat E2E ${runId}`;
  const userIds: string[] = [];
  let serverId = "";
  let mentionRoleId = "";
  let ownerContext: BrowserContext | undefined;
  let memberContext: BrowserContext | undefined;

  try {
    for (const [email, username] of [
      [ownerEmail, ownerUsername],
      [memberEmail, memberUsername],
      [thirdEmail, thirdUsername],
      [fourthEmail, fourthUsername],
    ]) {
      const created = await unwrap(
        admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: {
            username: username.slice(0, 30),
            display_name: username,
          },
        }),
        "criar usuário E2E",
      );
      userIds.push(created.user.id);
    }
    await unwrap(
      ownerApi.auth.signInWithPassword({ email: ownerEmail, password }),
      "login API owner",
    );
    await unwrap(
      memberApi.auth.signInWithPassword({ email: memberEmail, password }),
      "login API member",
    );
    await unwrap(
      thirdApi.auth.signInWithPassword({ email: thirdEmail, password }),
      "login API terceiro membro",
    );
    await unwrap(
      fourthApi.auth.signInWithPassword({ email: fourthEmail, password }),
      "login API quarto membro",
    );
    for (const [friendId, friendApi] of [
      [userIds[1], memberApi],
      [userIds[2], thirdApi],
      [userIds[3], fourthApi],
    ] as const) {
      const friendshipId = (await unwrap(
        ownerApi.rpc("request_friend", { p_addressee_id: friendId }),
        "solicitar amizade para GDM E2E",
      )) as string;
      await unwrap(
        friendApi.rpc("respond_friend_request", {
          p_friendship_id: friendshipId,
          p_accept: true,
        }),
        "aceitar amizade para GDM E2E",
      );
    }
    serverId = (await unwrap(
      ownerApi.rpc("create_server", { p_name: serverName }),
      "criar servidor E2E",
    )) as string;
    const channels = await unwrap(
      ownerApi.from("channels").select("id,kind").eq("server_id", serverId),
      "listar canais E2E",
    );
    const textChannel = channels.find((channel) => channel.kind === "text");
    if (!textChannel) throw new Error("Canal de texto inicial não foi criado.");
    const inviteCode = await unwrap(
      ownerApi.rpc("create_invite", {
        p_server_id: serverId,
        p_channel_id: textChannel.id,
        p_max_uses: 1,
        p_expires_in_minutes: 60,
      }),
      "criar convite E2E",
    );
    await unwrap(
      memberApi.rpc("redeem_invite", { p_code: inviteCode }),
      "entrar no servidor E2E",
    );
    mentionRoleId = (await unwrap(
      ownerApi.rpc("create_role", {
        p_server_id: serverId,
        p_name: "Guardiões E2E",
      }),
      "criar cargo mencionável E2E",
    )) as string;
    await unwrap(
      ownerApi.rpc("update_role", {
        p_role_id: mentionRoleId,
        p_name: "Guardiões E2E",
        p_color: "#7c5cff",
        p_permissions: 0,
        p_hoist: false,
        p_mentionable: true,
      }),
      "tornar cargo mencionável E2E",
    );
    await unwrap(
      ownerApi.rpc("set_member_role", {
        p_server_id: serverId,
        p_target_id: userIds[1],
        p_role_id: mentionRoleId,
        p_assign: true,
      }),
      "atribuir cargo E2E",
    );

    ownerContext = await browser.newContext();
    memberContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    const memberPage = await memberContext.newPage();
    await login(ownerPage, ownerEmail, password);
    await openServer(ownerPage, serverId);
    await expect(ownerPage.locator(".composer textarea")).toBeVisible({
      timeout: 20_000,
    });
    await waitFor(async () => {
      const result = await ownerApi
        .from("mls_groups")
        .select("channel_id")
        .eq("channel_id", textChannel.id);
      return !result.error && result.data.length === 1;
    }, "O dispositivo proprietário não inicializou o grupo MLS.");

    await login(memberPage, memberEmail, password);
    await openServer(memberPage, serverId);
    await expect(memberPage.locator(".composer textarea")).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      ownerPage.locator(".member-group-title").first(),
    ).toContainText("ONLINE — 2", { timeout: 20_000 });
    await waitFor(async () => {
      const result = await ownerApi.rpc("channel_recipient_devices", {
        p_channel_id: textChannel.id,
      });
      return !result.error && result.data.length === 2;
    }, "O segundo dispositivo não publicou seu KeyPackage MLS.");
    const memberProfile = await unwrap(
      ownerApi
        .from("profiles")
        .select("id,username")
        .eq("id", userIds[1])
        .single(),
      "resolver username do membro E2E",
    );

    const ownerComposer = ownerPage.locator(".composer textarea");
    const memberComposer = memberPage.locator(".composer textarea");
    await expect(ownerComposer).toBeVisible({ timeout: 20_000 });
    await expect(memberComposer).toBeVisible({ timeout: 20_000 });
    await expect(ownerComposer).toHaveAttribute("maxlength", "8000");
    await expect(
      memberPage.getByLabel("Criar canal de texto", { exact: true }),
    ).toHaveCount(0);
    await expect(
      memberPage.getByLabel("Criar canal de voz", { exact: true }),
    ).toHaveCount(0);
    await memberPage.getByLabel("Opções do servidor").click();
    await memberPage
      .getByRole("menuitem", { name: "Config. do servidor" })
      .click();
    const memberSettings = memberPage.locator(".settings-panel");
    await expect(memberSettings).toBeVisible({ timeout: 20_000 });
    await expect(
      memberSettings.getByRole("button", { name: "Canais", exact: true }),
    ).toHaveCount(0);
    await expect(
      memberSettings.getByRole("button", { name: "Cargos", exact: true }),
    ).toHaveCount(0);
    await expect(
      memberSettings.getByRole("button", { name: "Convites", exact: true }),
    ).toBeVisible();
    await expect(
      memberSettings.getByRole("button", { name: "Salvar perfil", exact: true }),
    ).toHaveCount(0);
    await expect(
      memberSettings.getByRole("button", { name: "Sair do servidor", exact: true }),
    ).toBeVisible();
    await memberSettings.locator(".close-settings").click();
    await memberPage.evaluate(() => {
      window.dispatchEvent(
        new PromiseRejectionEvent("unhandledrejection", {
          promise: Promise.resolve(),
          reason: new Error("falha visível de teste"),
        }),
      );
    });
    await expect(memberPage.locator(".runtime-alert")).toContainText(
      "falha visível de teste",
    );
    await memberPage.getByLabel("Fechar aviso de erro").click();
    await expect(memberPage.locator(".runtime-alert")).toHaveCount(0);

    await memberPage.evaluate(() => {
      const notifications: Array<{ title: string; body: string }> = [];
      (window as any).__janjaNotifications = notifications;
      Object.defineProperty(window, "janjaDesktop", {
        configurable: true,
        value: {
          platform: "win32",
          notify: (title: string, body: string) =>
            notifications.push({ title, body }),
        },
      });
    });
    // Sair para a Home precisa desmontar o contexto do servidor por inteiro:
    // sem canais, sem categorias e sem a lista de membros na tela.
    await memberPage.getByRole("button", { name: /^Início/ }).click();
    await expect(
      memberPage.getByRole("heading", { name: "Amigos" }),
    ).toBeVisible();
    await expect(memberPage.locator(".dm-sidebar")).toBeVisible();
    await expect(memberPage.locator(".server-heading")).toHaveCount(0);
    await expect(memberPage.locator(".member-sidebar")).toHaveCount(0);
    await expect(memberPage).toHaveURL(/#\/channels\/@me$/);

    const firstMessage = `mensagem-owner-${runId}`;
    await ownerComposer.fill(firstMessage);
    await ownerComposer.press("Enter");
    await expect(
      ownerPage.getByText(firstMessage, { exact: true }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      memberPage.getByRole("button", { name: `Chat E2E ${runId}` }).first(),
    ).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(
        () =>
          memberPage.evaluate(() =>
            (window as any).__janjaNotifications?.at(-1),
          ),
        { timeout: 30_000 },
      )
      .toMatchObject({ body: firstMessage });
    await memberPage
      .getByRole("button", { name: `Chat E2E ${runId}` })
      .first()
      .click();
    await expect(
      memberPage.getByText(firstMessage, { exact: true }),
    ).toBeVisible({
      timeout: 30_000,
    });

    const attachmentName = `segredo-${runId}.txt`;
    const attachmentContents = `conteúdo-confidencial-${runId}`;
    const attachmentMessage = `anexo-owner-${runId}`;
    await ownerPage.locator('.composer input[type="file"]').setInputFiles({
      name: attachmentName,
      mimeType: "text/plain",
      buffer: Buffer.from(attachmentContents),
    });
    await ownerComposer.fill(attachmentMessage);
    await ownerComposer.press("Enter");
    const memberAttachmentRow = memberPage
      .locator(".message")
      .filter({ hasText: attachmentMessage });
    await expect(memberAttachmentRow.getByText(attachmentName)).toBeVisible({
      timeout: 30_000,
    });
    const downloadPromise = memberPage.waitForEvent("download");
    await memberAttachmentRow.getByText(attachmentName).click();
    const downloadedAttachment = await downloadPromise;
    const downloadedPath = await downloadedAttachment.path();
    if (!downloadedPath) throw new Error("Download E2EE não gerou arquivo.");
    expect(await readFile(downloadedPath, "utf8")).toBe(attachmentContents);

    const attachmentMetadata = await unwrap(
      ownerApi
        .from("message_attachments")
        .select("storage_object")
        .eq("channel_id", textChannel.id)
        .single(),
      "localizar metadado do anexo E2E",
    );
    const encryptedObject = await admin.storage
      .from("attachments")
      .download(attachmentMetadata.storage_object);
    if (encryptedObject.error) throw encryptedObject.error;
    const storedBytes = Buffer.from(await encryptedObject.data.arrayBuffer());
    expect(storedBytes.includes(Buffer.from(attachmentContents))).toBe(false);

    const editedAttachmentMessage = `${attachmentMessage}-editada`;
    const ownerAttachmentRow = ownerPage
      .locator(".message")
      .filter({ hasText: attachmentMessage });
    await ownerAttachmentRow.hover();
    ownerPage.once("dialog", (dialog) =>
      dialog.accept(editedAttachmentMessage),
    );
    await ownerAttachmentRow.getByTitle("Editar").click();
    const editedAttachmentRow = memberPage
      .locator(".message")
      .filter({ hasText: editedAttachmentMessage });
    await expect(editedAttachmentRow).toBeVisible({ timeout: 30_000 });
    await expect(editedAttachmentRow.getByText(attachmentName)).toBeVisible();

    const twiceEditedAttachmentMessage = `${attachmentMessage}-editada-2`;
    const ownerEditedAttachmentRow = ownerPage
      .locator(".message")
      .filter({ hasText: editedAttachmentMessage });
    await ownerEditedAttachmentRow.hover();
    ownerPage.once("dialog", (dialog) =>
      dialog.accept(twiceEditedAttachmentMessage),
    );
    await ownerEditedAttachmentRow.getByTitle("Editar").click();
    const twiceEditedAttachmentRow = memberPage
      .locator(".message")
      .filter({ hasText: twiceEditedAttachmentMessage });
    await expect(twiceEditedAttachmentRow).toBeVisible({ timeout: 30_000 });
    await expect(
      twiceEditedAttachmentRow.getByText(attachmentName),
    ).toBeVisible();

    const replyMessage = `resposta-member-${runId}`;
    const memberOriginalRow = memberPage
      .locator(".message")
      .filter({ hasText: firstMessage });
    await memberOriginalRow.hover();
    await memberOriginalRow.getByTitle("Responder").click();
    await expect(memberPage.locator(".replying-bar")).toBeVisible();
    await memberComposer.fill(replyMessage);
    await memberComposer.press("Enter");
    await expect(
      memberPage.getByText(replyMessage, { exact: true }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      ownerPage.getByText(replyMessage, { exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      ownerPage
        .locator(".message")
        .filter({ hasText: replyMessage })
        .locator(".reply-reference"),
    ).toContainText(firstMessage);

    const mentionMessage = `@${memberProfile.username} confirmação`;
    await memberPage.getByRole("button", { name: "Início" }).click();
    await ownerComposer.fill(mentionMessage);
    await ownerComposer.press("Enter");
    await memberPage.getByRole("button", { name: "Inbox" }).click();
    const inbox = memberPage.locator(".inbox-panel");
    await inbox.getByRole("button", { name: /Menções/ }).click();
    await expect(inbox.getByText(mentionMessage, { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await inbox.getByText(mentionMessage, { exact: true }).click();
    await expect(
      memberPage.getByText(mentionMessage, { exact: true }),
    ).toBeVisible({ timeout: 30_000 });

    const groupMentionMessage = "@Guardiões E2E @everyone @here chamada geral";
    await ownerComposer.fill(groupMentionMessage);
    await ownerComposer.press("Enter");
    await expect(
      memberPage.getByText(groupMentionMessage, { exact: true }),
    ).toBeVisible({ timeout: 30_000 });

    const editableMentionMessage = `@${memberProfile.username} temporária`;
    await ownerComposer.fill(editableMentionMessage);
    await ownerComposer.press("Enter");
    const editableMentionRow = ownerPage
      .locator(".message")
      .filter({ hasText: editableMentionMessage });
    await expect(editableMentionRow).toBeVisible({ timeout: 20_000 });
    const editableMentionRecord = await unwrap(
      ownerApi
        .from("messages")
        .select("id")
        .eq("channel_id", textChannel.id)
        .eq("author_id", userIds[0])
        .order("created_at", { ascending: false })
        .limit(1)
        .single(),
      "localizar mensagem com menção editável",
    );
    const mentionRemovedMessage = `menção-removida-${runId}`;
    await editableMentionRow.hover();
    ownerPage.once("dialog", (dialog) => dialog.accept(mentionRemovedMessage));
    await editableMentionRow.getByTitle("Editar").click();
    await expect(
      memberPage.getByText(mentionRemovedMessage, { exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(async () => {
        const record = await unwrap(
          ownerApi
            .from("messages")
            .select("mention_recipient_ids,mention_user_ids")
            .eq("id", editableMentionRecord.id)
            .single(),
          "verificar menção removida na edição",
        );
        return [
          record.mention_recipient_ids.length,
          record.mention_user_ids.length,
        ];
      })
      .toEqual([0, 0]);

    const rows = await unwrap(
      ownerApi
        .from("messages")
        .select(
          "ciphertext,mention_recipient_ids,mention_role_ids,mention_here_recipient_ids,mentions_everyone,mentions_here",
        )
        .eq("channel_id", textChannel.id),
      "verificar ciphertext",
    );
    expect(rows).toHaveLength(6);
    expect(
      rows.every(
        (row) =>
          !row.ciphertext.includes(firstMessage) &&
          !row.ciphertext.includes(editedAttachmentMessage) &&
          !row.ciphertext.includes(twiceEditedAttachmentMessage) &&
          !row.ciphertext.includes(attachmentContents) &&
          !row.ciphertext.includes(replyMessage) &&
          !row.ciphertext.includes(mentionMessage) &&
          !row.ciphertext.includes(groupMentionMessage) &&
          !row.ciphertext.includes(editableMentionMessage) &&
          !row.ciphertext.includes(mentionRemovedMessage),
      ),
    ).toBe(true);
    expect(
      rows.some((row) => row.mention_recipient_ids.includes(userIds[1])),
    ).toBe(true);
    const groupMentionRow = rows.find((row) => row.mentions_everyone);
    expect(groupMentionRow).toBeDefined();
    expect(groupMentionRow?.mentions_here).toBe(true);
    expect(groupMentionRow?.mention_role_ids).toContain(mentionRoleId);
    expect(groupMentionRow?.mention_here_recipient_ids).toContain(userIds[1]);
    expect(groupMentionRow?.mention_recipient_ids).toContain(userIds[1]);

    const markdownMessage = [
      "# Markdown QA",
      "**forte** e *itálico* com `código inline` e [documentação](https://example.com/docs)",
      "> citação segura",
      "- primeiro item",
      "- segundo item",
      "```ts",
      "const e2ee = true;",
      "```",
    ].join("\n");
    await ownerComposer.fill(markdownMessage);
    await ownerComposer.press("Enter");
    const markdownRow = ownerPage
      .locator(".message")
      .filter({ hasText: "Markdown QA" })
      .last();
    await expect(
      markdownRow.getByRole("heading", { name: "Markdown QA" }),
    ).toBeVisible({
      timeout: 20_000,
    });
    await expect(markdownRow.locator("strong")).toHaveText("forte");
    await expect(markdownRow.locator("em")).toHaveText("itálico");
    await expect(markdownRow.locator("p code")).toHaveText("código inline");
    await expect(markdownRow.locator("blockquote")).toContainText(
      "citação segura",
    );
    await expect(markdownRow.locator("ul li")).toHaveCount(2);
    await expect(markdownRow.locator("pre code")).toContainText(
      "const e2ee = true;",
    );
    await expect(
      markdownRow.getByRole("link", { name: "documentação" }),
    ).toHaveAttribute("href", "https://example.com/docs");
    await markdownRow.hover();
    ownerPage.once("dialog", (dialog) => dialog.accept("🔥"));
    await markdownRow.getByTitle("Reagir").click();
    await expect(markdownRow.getByRole("button", { name: "🔥 1" })).toBeVisible(
      {
        timeout: 20_000,
      },
    );
    await markdownRow.hover();
    await markdownRow.getByTitle("Fixar").click();
    await expect(markdownRow.locator(".message-meta")).toContainText("fixada", {
      timeout: 20_000,
    });
    await ownerPage.getByTitle("Mensagens fixadas").click();
    const pinsPanel = ownerPage.locator(".pins-panel");
    await expect(pinsPanel).toContainText("Markdown QA");
    await pinsPanel.locator("button").first().click();

    const deleteMessage = `apagar-${runId}`;
    await ownerComposer.fill(deleteMessage);
    await ownerComposer.press("Enter");
    const deleteRow = ownerPage
      .locator(".message")
      .filter({ hasText: deleteMessage });
    await expect(deleteRow).toBeVisible();
    await deleteRow.hover();
    await deleteRow.getByTitle("Apagar").click();
    await expect(deleteRow).toHaveCount(0, { timeout: 20_000 });
    await expect(
      memberPage.getByText(deleteMessage, { exact: true }),
    ).toHaveCount(0, { timeout: 30_000 });
    await expect
      .poll(async () => {
        const result = await ownerApi
          .from("messages")
          .select("deleted_at")
          .eq("channel_id", textChannel.id)
          .not("deleted_at", "is", null)
          .single();
        return Boolean(result.data?.deleted_at);
      })
      .toBe(true);

    await openServerSettings(ownerPage, "Cargos");
    const roleSearch = ownerPage.getByLabel("Pesquisar cargos");
    await roleSearch.fill("cargo que não existe");
    await expect(ownerPage.getByText("Nenhum cargo encontrado.")).toBeVisible();
    await roleSearch.fill("Guardiões");
    await expect(ownerPage.locator(".role-list-row")).toHaveCount(1);
    await ownerPage
      .locator(".role-item")
      .filter({ hasText: "Guardiões E2E" })
      .click();
    await ownerPage.getByRole("button", { name: /ADMINISTRATOR/ }).click();
    await ownerPage.getByRole("button", { name: "Salvar alterações" }).click();
    // A revisão de segurança virou modal do app; o `confirm` do navegador
    // saiu de cena.
    const revisao = ownerPage.getByRole("alertdialog", {
      name: "Revisão de segurança",
    });
    await expect(revisao).toBeVisible({ timeout: 20_000 });
    await expect(revisao).toContainText("ADMINISTRATOR");
    await revisao.getByRole("button", { name: "Cancelar" }).click();
    await expect(revisao).toHaveCount(0);
    const unchangedDangerousRole = await unwrap(
      ownerApi
        .from("roles")
        .select("permissions")
        .eq("id", mentionRoleId)
        .single(),
      "confirmar cancelamento de permissão perigosa",
    );
    expect(BigInt(unchangedDangerousRole.permissions)).toBe(0n);
    await ownerPage.getByRole("button", { name: /ADMINISTRATOR/ }).click();
    await ownerPage.getByLabel("Ícone Unicode do cargo").fill("🛡️");
    await ownerPage.getByRole("button", { name: "Salvar alterações" }).click();
    await expect
      .poll(async () => {
        const result = await ownerApi
          .from("roles")
          .select("unicode_emoji")
          .eq("id", mentionRoleId)
          .single();
        return result.data?.unicode_emoji;
      })
      .toBe("🛡️");
    await ownerPage.locator(".settings-panel .close-settings").click();

    await ownerPage.getByRole("button", { name: /^Início/ }).click();
    await ownerPage.keyboard.press("Control+K");
    const serverSearch = ownerPage.getByRole("dialog", {
      name: "Busca rápida",
    });
    await serverSearch.getByRole("textbox").fill(serverName);
    await expect(
      serverSearch.getByRole("button", { name: new RegExp(serverName) }),
    ).toBeVisible();
    await serverSearch.getByRole("textbox").press("ArrowDown");
    await ownerPage.keyboard.press("Enter");
    await expect(serverSearch).toHaveCount(0);
    await expect(ownerPage.locator(".composer textarea")).toBeVisible();

    await ownerPage.keyboard.press("Control+K");
    const profileSearch = ownerPage.getByRole("dialog", {
      name: "Busca rápida",
    });
    await profileSearch.getByRole("textbox").fill(memberUsername);
    await expect(
      profileSearch.getByRole("button", {
        name: new RegExp(memberUsername),
      }),
    ).toBeVisible();
    await profileSearch.getByRole("textbox").press("ArrowDown");
    await ownerPage.keyboard.press("Enter");
    await expect(profileSearch).toHaveCount(0, { timeout: 20_000 });
    await expect(
      ownerPage.getByRole("heading", { name: memberUsername, exact: true }),
    ).toBeVisible({ timeout: 20_000 });
    await unwrap(
      ownerApi
        .from("blocks")
        .insert({ blocker_id: userIds[0], blocked_id: userIds[1] }),
      "bloquear participante da DM existente",
    );
    // Bloqueio troca o compositor por um aviso e retira os botões de chamada.
    await expect(ownerPage.locator(".composer-blocked")).toBeVisible({
      timeout: 20_000,
    });
    await expect(ownerPage.locator(".composer textarea")).toHaveCount(0);
    await expect(
      ownerPage.getByRole("button", { name: "Iniciar chamada de voz" }),
    ).toHaveCount(0);
    await expect(
      ownerPage.getByRole("button", { name: "Iniciar chamada de vídeo" }),
    ).toHaveCount(0);
    await unwrap(
      ownerApi
        .from("blocks")
        .delete()
        .eq("blocker_id", userIds[0])
        .eq("blocked_id", userIds[1]),
      "desbloquear participante da DM",
    );
    await expect(ownerPage.locator(".composer textarea")).toBeEnabled({
      timeout: 20_000,
    });
    await expect(
      ownerPage.getByRole("button", { name: "Iniciar chamada de voz" }),
    ).toBeVisible();
    await expect(
      ownerPage.getByRole("button", { name: "Iniciar chamada de vídeo" }),
    ).toBeVisible();
    // Bloquear encerra a amizade — é o comportamento esperado. Para o grupo
    // mais adiante, a amizade precisa ser refeita depois do desbloqueio.
    const restoredFriendshipId = (await unwrap(
      ownerApi.rpc("request_friend", { p_addressee_id: userIds[1] }),
      "refazer amizade depois do desbloqueio",
    )) as string;
    await unwrap(
      memberApi.rpc("respond_friend_request", {
        p_friendship_id: restoredFriendshipId,
        p_accept: true,
      }),
      "aceitar amizade refeita",
    );

    await ownerPage.keyboard.press("Control+K");
    const returnSearch = ownerPage.getByRole("dialog", {
      name: "Busca rápida",
    });
    await returnSearch.getByRole("textbox").fill(serverName);
    await returnSearch.getByRole("textbox").press("ArrowDown");
    await ownerPage.keyboard.press("Enter");
    await expect(returnSearch).toHaveCount(0);

    await ownerPage.getByRole("button", { name: /^Início/ }).click();
    await ownerPage
      .getByRole("button", { name: "Nova conversa", exact: true })
      .click();
    const createGroupPanel = ownerPage.locator(".create-group-panel");
    await expect(createGroupPanel).toBeVisible();
    await createGroupPanel
      .locator(".create-group-friends label")
      .filter({ hasText: memberUsername })
      .getByRole("checkbox")
      .check();
    await createGroupPanel
      .locator(".create-group-friends label")
      .filter({ hasText: thirdUsername })
      .getByRole("checkbox")
      .check();
    const initialGroupName = `Grupo local ${runId}`;
    await createGroupPanel.getByLabel("Nome do grupo").fill(initialGroupName);
    await createGroupPanel
      .getByRole("button", { name: "Criar grupo cifrado" })
      .click();
    await expect(
      ownerPage.getByRole("heading", { name: initialGroupName, exact: true }),
    ).toBeVisible({ timeout: 20_000 });
    // O grupo é comunicação privada: ele aparece na Home, não dentro do
    // servidor onde o outro participante estava.
    await memberPage.getByRole("button", { name: /^Início/ }).click();
    await expect(memberPage.locator(".dm-sidebar")).toBeVisible();
    await expect(
      memberPage.getByText(initialGroupName, { exact: true }),
    ).toBeVisible({ timeout: 20_000 });

    await ownerPage.getByRole("button", { name: "Configurar grupo" }).click();
    const groupPanel = ownerPage.locator(".group-dm-panel");
    const renamedGroup = `GDM verificado ${runId}`;
    await groupPanel.getByLabel("Nome do grupo").fill(renamedGroup);
    await groupPanel.locator('input[type="file"]').setInputFiles({
      name: "group-icon.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
    });
    await groupPanel.getByRole("button", { name: "Salvar grupo" }).click();
    await expect(groupPanel.getByRole("status")).toContainText(
      "Grupo atualizado",
      { timeout: 20_000 },
    );
    await groupPanel.getByLabel("Adicionar amigo").selectOption(userIds[3]);
    await groupPanel
      .getByRole("button", { name: "Adicionar", exact: true })
      .click();
    const fourthMemberRow = groupPanel
      .locator(".group-dm-members > div")
      .filter({ hasText: fourthUsername });
    await expect(fourthMemberRow).toBeVisible({ timeout: 20_000 });

    const groupRow = await unwrap(
      ownerApi
        .from("channels")
        .select("id,name,icon_path")
        .eq("name", renamedGroup)
        .single(),
      "verificar GDM persistido",
    );
    expect(groupRow.icon_path).toMatch(new RegExp(`^${groupRow.id}/`));
    const groupMembers = await unwrap(
      ownerApi
        .from("channel_members")
        .select("user_id")
        .eq("channel_id", groupRow.id),
      "verificar membros do GDM",
    );
    expect(groupMembers.map((item) => item.user_id)).toEqual(
      expect.arrayContaining(userIds),
    );
    await fourthMemberRow.getByRole("button", { name: "Remover" }).click();
    await expect(fourthMemberRow).toHaveCount(0);
    await groupPanel.locator(".close-settings").click();

    await memberPage.getByText(renamedGroup, { exact: true }).click();
    const ownerGroupComposer = ownerPage.locator(".composer textarea");
    const memberGroupComposer = memberPage.locator(".composer textarea");
    await expect(memberGroupComposer).toBeVisible({ timeout: 20_000 });
    const groupMessage = `mensagem-gdm-${runId}`;
    await ownerGroupComposer.fill(groupMessage);
    await ownerGroupComposer.press("Enter");
    await expect(
      memberPage.getByText(groupMessage, { exact: true }),
    ).toBeVisible({ timeout: 30_000 });
  } finally {
    await Promise.allSettled([ownerContext?.close(), memberContext?.close()]);
    if (serverId)
      await ownerApi.rpc("delete_server", { p_server_id: serverId });
    for (const userId of userIds.reverse())
      await admin.auth.admin.deleteUser(userId);
  }
});
