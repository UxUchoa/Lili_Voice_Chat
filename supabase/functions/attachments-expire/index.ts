import { createClient } from "npm:@supabase/supabase-js@2";
import { json, withCors } from "../_shared/cors.ts";

/**
 * Apaga os anexos que passaram das 24 h.
 *
 * O Postgres não serve para isto: o Supabase instala um gatilho que recusa
 * `delete` direto em `storage.objects` ("Direct deletion from storage tables
 * is not allowed"). Só a API de Storage remove o arquivo de verdade, e ela
 * precisa da service role — daí a função de borda.
 *
 * Duas portas de entrada, ambas legítimas:
 *
 *   1. `pg_cron` em produção, com `x-cron-secret` igual a
 *      `ATTACHMENTS_EXPIRE_SECRET`. É o caminho que garante que o arquivo some
 *      mesmo quando ninguém abre o aplicativo por um dia inteiro.
 *   2. Qualquer sessão autenticada, que continua valendo para a instância sem
 *      agendador: a função não recebe parâmetro nenhum e só faz o que já
 *      deveria acontecer sozinho.
 *
 * `verify_jwt` está desligado no `config.toml` justamente porque o cron não tem
 * sessão de usuário; a autorização é decidida aqui dentro.
 */
const BATCH = 500;

Deno.serve(
  withCors(async (request) => {
    if (request.method !== "POST")
      return json({ error: "method_not_allowed" }, 405);

    const cronSecret = Deno.env.get("ATTACHMENTS_EXPIRE_SECRET") ?? "";
    const scheduled =
      cronSecret.length > 0 &&
      request.headers.get("x-cron-secret") === cronSecret;

    const authorization = request.headers.get("Authorization");
    if (!scheduled && !authorization?.startsWith("Bearer "))
      return json({ error: "unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const publishableKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !publishableKey || !serviceKey)
      return json({ error: "server_not_configured" }, 503);

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    if (!scheduled) {
      const scoped = createClient(supabaseUrl, publishableKey, {
        global: { headers: { Authorization: authorization as string } },
        auth: { persistSession: false },
      });
      const { data: authData, error: authError } = await scoped.auth.getUser();
      if (authError || !authData.user)
        return json({ error: "unauthorized" }, 401);
    }

    const { data: expired, error: listError } = await admin
      .from("message_attachments")
      .select("id, storage_object")
      .lte("expires_at", new Date().toISOString())
      .limit(BATCH);
    if (listError) return json({ error: listError.message }, 500);
    if (!expired || expired.length === 0) return json({ removed: 0 });

    const paths = expired.map((row) => row.storage_object as string);
    const { error: storageError } = await admin.storage
      .from("attachments")
      .remove(paths);
    // Um objeto que já não existe não é motivo para manter a linha: o efeito
    // desejado (arquivo fora do ar) já está valendo.
    if (storageError && !/not found/i.test(storageError.message))
      return json({ error: storageError.message }, 500);

    const { error: deleteError } = await admin
      .from("message_attachments")
      .delete()
      .in(
        "id",
        expired.map((row) => row.id as string),
      );
    if (deleteError) return json({ error: deleteError.message }, 500);

    return json({ removed: paths.length });
  }),
);
