import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import {
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

const unwrap = async <T>(
  promise: PromiseLike<{ data: T; error: { message: string } | null }>,
  label: string,
) => {
  const result = await promise;
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
};

test("categorias podem ser editadas, ocultadas e excluídas pela UI", async ({
  page,
}) => {
  const admin = createClient(apiUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const ownerApi = createClient(apiUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const runId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const password = `Lili-${crypto.randomUUID()}-Aa1!`;
  const email = `category-owner-${runId}@lili.app`;
  const username = `category_${runId.replace(/\W/g, "")}`.slice(0, 24);
  let userId = "";
  let serverId = "";

  try {
    const created = await unwrap(
      admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { username, display_name: "Category owner" },
      }),
      "criar proprietário de categoria",
    );
    userId = created.user.id;
    await unwrap(
      ownerApi.auth.signInWithPassword({ email, password }),
      "autenticar proprietário de categoria",
    );
    serverId = (await unwrap(
      ownerApi.rpc("create_server", { p_name: `Categories E2E ${runId}` }),
      "criar servidor de categoria",
    )) as string;

    await page.goto("/");
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Senha", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await finishOnlineLogin(page);

    await openServer(page, serverId);
    await openServerSettings(page, "Canais");
    const loungeRow = page
      .locator(".channel-admin-row > div > b")
      .filter({ hasText: /^Lounge$/ })
      .locator("../..");
    // O limite de voz agora é ajustado no editor do canal, não num prompt.
    await loungeRow.getByRole("button", { name: "Editar" }).click();
    const channelEditor = page.locator(".channel-settings-modal");
    await expect(channelEditor).toBeVisible({ timeout: 20_000 });
    await channelEditor
      .getByRole("slider", { name: /Limite de usuários/ })
      .fill("1");
    await channelEditor
      .getByRole("button", { name: "Salvar alterações" })
      .click();
    await expect(channelEditor.getByRole("status")).toContainText(
      "Canal atualizado.",
      { timeout: 20_000 },
    );
    await channelEditor.getByRole("button", { name: "Fechar" }).click();
    await expect(channelEditor).toHaveCount(0);
    await expect(loungeRow).toContainText("limite 1", { timeout: 10_000 });
    const limitedVoice = await unwrap(
      ownerApi
        .from("channels")
        .select("user_limit")
        .eq("server_id", serverId)
        .eq("name", "Lounge")
        .single(),
      "verificar limite do canal de voz",
    );
    expect(limitedVoice.user_limit).toBe(1);

    await page
      .locator(".settings-panel")
      .getByRole("button", { name: "Criar categoria", exact: true })
      .click();
    const channelSetup = page.locator(".channel-setup-modal");
    await expect(channelSetup).toBeVisible({ timeout: 20_000 });
    await channelSetup.getByRole("textbox").fill("Categoria 1");
    await channelSetup
      .getByRole("button", { name: "Criar categoria", exact: true })
      .click();
    await expect(channelSetup).toHaveCount(0, { timeout: 20_000 });
    // A criação abre o editor do canal novo; fechamos para seguir na lista.
    const createdEditor = page.locator(".channel-settings-modal");
    await expect(createdEditor).toBeVisible({ timeout: 20_000 });
    await createdEditor.getByRole("button", { name: "Fechar" }).click();
    await expect(createdEditor).toHaveCount(0, { timeout: 20_000 });

    let categoryRow = page
      .locator(".channel-admin-row > div > b")
      .filter({ hasText: /^Categoria 1$/ })
      .locator("../..");
    await expect(categoryRow).toBeVisible({ timeout: 10_000 });

    // Renomear passa pelo editor do canal, com nome e permissões no mesmo
    // lugar — o prompt do navegador saiu de cena.
    await categoryRow.getByRole("button", { name: "Editar" }).click();
    const categoryEditor = page.locator(".channel-settings-modal");
    await expect(categoryEditor).toBeVisible({ timeout: 20_000 });
    await categoryEditor
      .getByRole("textbox", { name: /Nome da categoria/ })
      .fill("Operações E2E");
    await categoryEditor
      .getByRole("button", { name: "Salvar alterações" })
      .click();
    await expect(categoryEditor.getByRole("status")).toContainText(
      "Canal atualizado.",
      { timeout: 20_000 },
    );
    await categoryEditor.getByRole("button", { name: "Fechar" }).click();
    await expect(categoryEditor).toHaveCount(0);
    categoryRow = page
      .locator(".channel-admin-row > div > b")
      .filter({ hasText: /^Operações E2E$/ })
      .locator("../..");
    await expect(categoryRow).toBeVisible({ timeout: 10_000 });

    await page.keyboard.press("Control+K");
    const quickSearch = page.getByRole("dialog", { name: "Busca rápida" });
    await quickSearch.getByRole("textbox").fill("Operações E2E");
    await expect(quickSearch.locator(".search-suggestions button")).toHaveCount(
      0,
    );
    await expect(quickSearch.getByText("Nenhum resultado.")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(quickSearch).toHaveCount(0);

    // Privacidade, ordem e exclusão saíram da linha e vivem no menu "⋯": oito
    // controles por linha não deixavam espaço para o nome nem para o seletor
    // de categoria.
    const abrirMenuDaCategoria = () =>
      categoryRow.getByRole("button", { name: /^Ações para/ }).click();
    await abrirMenuDaCategoria();
    await page.getByRole("menuitem", { name: "Ocultar categoria" }).click();
    await expect(categoryRow).toContainText("Categoria · oculta", {
      timeout: 10_000,
    });

    const persisted = await unwrap(
      ownerApi
        .from("channels")
        .select("id,name,private")
        .eq("server_id", serverId)
        .eq("kind", "category")
        .single(),
      "verificar categoria persistida",
    );
    expect(persisted.name).toBe("Operações E2E");
    expect(persisted.private).toBe(true);

    // Item 9 — excluir categoria nunca leva os canais junto por acidente. O
    // canal criado aqui dentro tem que sobreviver com o destino padrão.
    const canalDentro = await unwrap(
      ownerApi.rpc("create_channel", {
        p_server_id: serverId,
        p_name: "sobrevivente",
        p_kind: "text",
        p_parent_id: persisted.id,
        p_private: false,
      }),
      "criar canal dentro da categoria",
    );

    await abrirMenuDaCategoria();
    await page.getByRole("menuitem", { name: "Excluir categoria" }).click();
    const deleteModal = page.getByRole("alertdialog", {
      name: "Excluir categoria",
    });
    await expect(deleteModal).toBeVisible({ timeout: 10_000 });
    await expect(deleteModal.getByText("#sobrevivente")).toBeVisible();
    // O padrão é soltar os canais, não apagá-los.
    await expect(
      deleteModal.getByRole("radio", { name: /Sem categoria/ }),
    ).toBeChecked();
    await deleteModal
      .getByRole("button", { name: "Excluir categoria" })
      .click();
    await expect(categoryRow).toHaveCount(0, { timeout: 10_000 });

    const { count, error: countError } = await ownerApi
      .from("channels")
      .select("id", { count: "exact", head: true })
      .eq("id", persisted.id);
    if (countError)
      throw new Error(`verificar exclusão de categoria: ${countError.message}`);
    expect(count).toBe(0);

    const sobrevivente = await unwrap(
      ownerApi
        .from("channels")
        .select("id,parent_id")
        .eq("id", canalDentro)
        .single(),
      "verificar canal preservado",
    );
    expect(sobrevivente.parent_id).toBeNull();
  } finally {
    if (serverId)
      await ownerApi.rpc("delete_server", { p_server_id: serverId });
    if (userId) await admin.auth.admin.deleteUser(userId);
  }
});
