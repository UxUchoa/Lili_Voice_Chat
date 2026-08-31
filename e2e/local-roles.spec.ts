import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
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

/**
 * O @everyone é o único cargo de um servidor recém-criado. Enquanto
 * `update_role` reusava `can_manage_role` (que nega o cargo padrão de
 * propósito), a aba "Cargos" era inteiramente inútil: cor, ícone e permissões
 * voltavam com "forbidden".
 */
test("o cargo @everyone aceita cor, ícone e permissões pela UI", async ({
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
  const email = `role-owner-${runId}@lili.app`;
  const username = `role_${runId.replace(/\W/g, "")}`.slice(0, 24);
  let userId = "";
  let serverId = "";

  try {
    const created = await unwrap(
      admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { username, display_name: "Role owner" },
      }),
      "criar proprietário de cargo",
    );
    userId = created.user.id;
    await unwrap(
      ownerApi.auth.signInWithPassword({ email, password }),
      "autenticar proprietário de cargo",
    );
    serverId = (await unwrap(
      ownerApi.rpc("create_server", { p_name: `Roles E2E ${runId}` }),
      "criar servidor de cargo",
    )) as string;

    await page.goto("/");
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Senha").fill(password);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await openServer(page, serverId);
    await openServerSettings(page, "Cargos");

    const editor = page.locator(".role-editor");
    await expect(editor).toBeVisible({ timeout: 20_000 });
    // A lista abre no cargo mais alto (Administração, criado junto com o
    // servidor); o @everyone fica no fim, como no Discord.
    await page
      .locator(".roles-list .role-item", { hasText: "@everyone" })
      .click();
    await expect(editor.getByText("CARGO PADRÃO")).toBeVisible();

    // O nome do @everyone é fixo; o resto não.
    await expect(editor.getByLabel("Nome do cargo")).toBeDisabled();

    await editor.locator('input[type="color"]').fill("#2fbf71");
    await editor.getByLabel("Ícone Unicode do cargo").fill("🛡️");
    await editor
      .locator(".permission-grid button", { hasText: "PIN MESSAGES" })
      .click();

    const bar = editor.locator(".editor-actions");
    await expect(bar.getByRole("status")).toHaveText("Alterações não salvas.");
    await bar.getByRole("button", { name: "Salvar alterações" }).click();
    await expect(bar.getByRole("status")).toHaveText("Cargo salvo.", {
      timeout: 20_000,
    });

    const persisted = await unwrap(
      ownerApi
        .from("roles")
        .select("color,unicode_emoji,permissions,hoist,name")
        .eq("server_id", serverId)
        .eq("is_default", true)
        .single(),
      "verificar cargo padrão persistido",
    );
    expect(persisted.color).toBe("#2fbf71");
    expect(persisted.unicode_emoji).toBe("🛡️");
    expect(persisted.name).toBe("@everyone");
    expect(persisted.hoist).toBe(false);
    // PIN_MESSAGES = 1 << 3.
    expect(BigInt(persisted.permissions) & 8n).toBe(8n);
  } finally {
    if (serverId)
      await ownerApi.rpc("delete_server", { p_server_id: serverId });
    if (userId) await admin.auth.admin.deleteUser(userId);
  }
});
