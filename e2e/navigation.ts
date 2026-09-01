import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Helpers de navegação para os testes de UI.
 *
 * A aplicação abre na Home (amigos e conversas diretas) e nunca entra num
 * servidor sozinha — é o mesmo contrato do Discord. Os testes que precisam do
 * contexto de servidor pedem por ele explicitamente, o que também exercita os
 * links diretos `#/channels/<servidor>/<canal>`.
 */

export async function openServer(page: Page, serverId: string) {
  await page.goto(`/#/channels/${serverId}`);
  await expect(page.locator(".channel-sidebar .server-heading")).toBeVisible({
    timeout: 20_000,
  });
}

export async function openHome(page: Page) {
  await page.goto("/#/channels/@me");
  await expect(page.locator(".dm-sidebar")).toBeVisible({ timeout: 20_000 });
}

/**
 * Contas criadas pela API de teste ainda não possuem chave de recuperação.
 * No primeiro login a aplicação emite uma; o teste confirma que a guardou e
 * só então continua para a área autenticada.
 */
export async function finishOnlineLogin(page: Page) {
  await expect(page.locator(".app-shell, .recovery-card")).toBeVisible({
    timeout: 20_000,
  });
  if (await page.locator(".recovery-card").isVisible()) {
    await page.locator(".recovery-ack input").check();
    await page
      .locator(".recovery-card")
      .getByRole("button", { name: "Entrar", exact: true })
      .click();
  }
  await expect(page.locator(".app-shell")).toBeVisible({ timeout: 20_000 });
}

/** Recorta e confirma a imagem escolhida para avatar, banner ou ícone. */
export async function applyCrop(page: Page) {
  const modal = page.locator(".crop-modal");
  await expect(modal).toBeVisible({ timeout: 20_000 });
  await modal.getByRole("button", { name: "Aplicar" }).click();
  await expect(modal).toBeHidden({ timeout: 20_000 });
}

/** Abre as configurações do servidor numa aba específica. */
export async function openServerSettings(page: Page, tab: string) {
  await page.getByLabel("Opções do servidor").click();
  await page.getByRole("menuitem", { name: "Config. do servidor" }).click();
  await expect(page.locator(".settings-panel")).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole("button", { name: tab, exact: true }).click();
}

/**
 * Escolhe um valor na lista suspensa do design system.
 *
 * O `<select>` nativo saiu do projeto — o popup dele é desenhado pelo sistema
 * operacional e não aceita CSS. Com isso `selectOption` deixou de funcionar:
 * agora é um `button` que abre um `listbox`, então o teste clica e escolhe a
 * opção como uma pessoa faria.
 */
export async function chooseInSelect(
  scope: Page | Locator,
  accessibleName: string | RegExp,
  optionName: string | RegExp,
) {
  await scope.getByRole("button", { name: accessibleName }).click();
  // A lista e montada dentro do proprio componente, entao vive no mesmo
  // escopo do gatilho.
  const list = scope.getByRole("listbox", { name: accessibleName });
  await expect(list).toBeVisible({ timeout: 10_000 });
  await list.getByRole("option", { name: optionName }).click();
  await expect(list).toBeHidden({ timeout: 10_000 });
}
