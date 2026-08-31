export const onlineConfig = Object.freeze({
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL?.trim() ?? "",
  supabasePublishableKey:
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "",
  livekitUrl: import.meta.env.VITE_LIVEKIT_URL?.trim() ?? "",
  forceTurn: import.meta.env.VITE_FORCE_TURN === "true",
  vapidPublicKey: import.meta.env.VITE_VAPID_PUBLIC_KEY?.trim() ?? "",
  /**
   * Chave da API de GIFs (Tenor v2). Sem ela o seletor abre explicando o que
   * falta em vez de quebrar: nenhuma outra parte do app depende disto.
   */
  tenorApiKey: import.meta.env.VITE_TENOR_API_KEY?.trim() ?? "",
});

export function assertOnlineConfig() {
  if (!onlineConfig.supabaseUrl || !onlineConfig.supabasePublishableKey)
    throw new Error(
      "Lili requer VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY da instância Supabase configurada.",
    );
}
