import { createClient } from "@supabase/supabase-js";
import { assertOnlineConfig, onlineConfig } from "./config";

assertOnlineConfig();

export const supabase = createClient(
  onlineConfig.supabaseUrl,
  onlineConfig.supabasePublishableKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      // **Não** acompanha o rename do produto, pelo mesmo motivo do nome do
      // IndexedDB: renomear cria um segundo cofre de sessão. Enquanto houver
      // uma aba aberta com o nome antigo, as duas guardam o mesmo refresh
      // token — e com rotação ligada, cada renovação invalida a da outra. As
      // duas sessões morrem, todo RPC passa a chegar como `anon` e o servidor
      // responde "permission denied for function". Foi exatamente o que
      // derrubou as chamadas de voz em produção.
      storageKey: "janja.supabase.session",
    },
    realtime: { params: { eventsPerSecond: 20 } },
  },
);
