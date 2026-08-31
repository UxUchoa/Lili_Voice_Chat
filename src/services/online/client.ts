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
      storageKey: "janja.supabase.session",
    },
    realtime: { params: { eventsPerSecond: 20 } },
  },
);
