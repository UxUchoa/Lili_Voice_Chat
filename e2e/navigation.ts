import { expect, type Page } from "@playwright/test";

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
  await page
    .getByRole("menuitem", { name: "Config. do servidor" })
    .click();
  await expect(page.locator(".settings-panel")).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole("button", { name: tab, exact: true }).click();
}
