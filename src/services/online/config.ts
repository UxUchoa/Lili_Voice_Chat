const configuredSiteUrl = import.meta.env.VITE_SITE_URL?.trim() ?? "";

/**
 * Endereço público do site, sem a barra final.
 *
 * O desktop empacotado carrega o `dist/` por `file://`, e ali
 * `window.location.origin` vale a string `"file://"`. Montar endereço em cima
 * disso produz `file:///#/invite/CODE` no convite que o usuário copia e um
 * `redirectTo` que o Supabase recusa — em ambos os casos sem erro visível, só
 * um link que não leva a lugar nenhum. `VITE_SITE_URL` é o que o build do
 * desktop usa no lugar; na web ele pode ficar vazio, porque ali a origem já é
 * o próprio site.
 */
export function resolveSiteUrl(configured: string, origin: string): string {
  const clean = (value: string) => value.trim().replace(/\/+$/, "");
  const candidate = clean(configured);
  if (/^https?:\/\//i.test(candidate)) return candidate;
  const fallback = clean(origin);
  return /^https?:\/\//i.test(fallback) ? fallback : "";
}

export const onlineConfig = Object.freeze({
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL?.trim() ?? "",
  supabasePublishableKey:
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "",
  livekitUrl: import.meta.env.VITE_LIVEKIT_URL?.trim() ?? "",
  forceTurn: import.meta.env.VITE_FORCE_TURN === "true",
  vapidPublicKey: import.meta.env.VITE_VAPID_PUBLIC_KEY?.trim() ?? "",
  /**
   * Onde o aplicativo vive na web. Vazio só em build sem `VITE_SITE_URL`
   * servido por um esquema que não é http(s) — o validador de
   * `npm run build:web` recusa esse caso quando o alvo é o desktop.
   */
  siteUrl: resolveSiteUrl(configuredSiteUrl, globalThis.location?.origin ?? ""),
});

export function assertOnlineConfig() {
  if (!onlineConfig.supabaseUrl || !onlineConfig.supabasePublishableKey)
    throw new Error(
      "Lili requer VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY da instância Supabase configurada.",
    );
}
