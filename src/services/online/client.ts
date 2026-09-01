import { createClient } from "@supabase/supabase-js";
import { assertOnlineConfig, onlineConfig } from "./config";
import { migrateLegacyStorageKeysOnce } from "../storageMigration";

assertOnlineConfig();

// Precisa acontecer antes de `createClient`: é ele quem lê o storageKey abaixo.
// Se a sessão ainda estiver sob o nome do rename, este é o momento de trazê-la
// de volta — e de apagar o cofre abandonado, que senão continua renovando o
// mesmo refresh token por fora e derrubando esta sessão.
migrateLegacyStorageKeysOnce();

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
