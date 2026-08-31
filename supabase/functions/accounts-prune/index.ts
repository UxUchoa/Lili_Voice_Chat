import { createClient } from "npm:@supabase/supabase-js@2";
import { json, withCors } from "../_shared/cors.ts";

/**
 * Transforma em lápide a conta parada há mais de 90 dias.
 *
 * "Apagada" aqui quer dizer que o acesso é destruído — login, senha, sessões,
 * dispositivos, chaves e a chave de recuperação — e a identidade é anonimizada.
 * A linha do perfil permanece, e isso não é meia medida: `messages.author_id`,
 * `servers.owner_id` e `channels.created_by` são NO ACTION de propósito, para
 * que a conversa de trinta pessoas não evapore porque quem criou o servidor
 * sumiu por três meses. O servidor órfão passa para o administrador mais
 * antigo; sem ninguém, é apagado.
 *
 * Sem porta para o navegador: só o agendador, com `x-cron-secret`. Um expurgo
 * disparável por qualquer um seria uma arma.
 *
 * `{"dryRun": true}` devolve quem seria atingido sem tocar em nada. Existe
 * porque a alternativa é descobrir o alcance de um job destrutivo executando
 * ele — e ninguém deveria ligar este agendador sem antes olhar a lista.
 */
const DEFAULT_DAYS = 90;
const BATCH = 50;

Deno.serve(
  withCors(async (request) => {
    if (request.method !== "POST")
      return json({ error: "method_not_allowed" }, 405);

    const cronSecret = Deno.env.get("ACCOUNTS_PRUNE_SECRET") ?? "";
    if (!cronSecret) return json({ error: "server_not_configured" }, 503);
    if (request.headers.get("x-cron-secret") !== cronSecret)
      return json({ error: "unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !serviceKey)
      return json({ error: "server_not_configured" }, 503);

    let dryRun = false;
    if (request.headers.get("content-length") !== "0") {
      try {
        dryRun = Boolean((await request.json())?.dryRun);
      } catch {
        // Corpo ausente ou malformado é o caso normal do cron, que manda `{}`.
      }
    }

    const days = Number(Deno.env.get("ACCOUNTS_PRUNE_DAYS") ?? DEFAULT_DAYS);
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: inactive, error: listError } = await admin.rpc(
      "list_inactive_accounts",
      { p_days: Number.isFinite(days) && days > 0 ? days : DEFAULT_DAYS },
    );
    if (listError) return json({ error: listError.message }, 500);

    const targets = (inactive ?? []).slice(0, BATCH) as {
      user_id: string;
      inactive_since: string;
    }[];
    if (dryRun)
      return json({
        dryRun: true,
        days: Number.isFinite(days) && days > 0 ? days : DEFAULT_DAYS,
        matching: (inactive ?? []).length,
        batch: targets.length,
        oldest: targets[0]?.inactive_since ?? null,
      });

    if (targets.length === 0) return json({ tombstoned: 0 });

    let tombstoned = 0;
    let transferred = 0;
    let deleted = 0;
    const failures: string[] = [];

    for (const target of targets) {
      // O SQL primeiro: transferir servidor, anonimizar o perfil e apagar
      // dispositivos e chaves. Só depois o acesso é bloqueado. Nesta ordem, uma
      // falha no meio deixa a conta bloqueada mas ainda identificável — o
      // inverso deixaria uma conta anônima com login funcionando.
      const { data: result, error: tombstoneError } = await admin.rpc(
        "tombstone_account",
        { p_user_id: target.user_id },
      );
      if (tombstoneError) {
        failures.push(target.user_id);
        continue;
      }
      const counts = Array.isArray(result) ? result[0] : result;
      transferred += Number(counts?.servers_transferred ?? 0);
      deleted += Number(counts?.servers_deleted ?? 0);

      // `banned_until` é como o GoTrue recusa o login sem apagar a linha, que
      // é justamente o que não podemos fazer: o perfil pende dela por FK.
      const { error: banError } = await admin.auth.admin.updateUserById(
        target.user_id,
        { ban_duration: "876000h" },
      );
      if (banError) {
        failures.push(target.user_id);
        continue;
      }
      tombstoned += 1;
    }

    return json({
      tombstoned,
      servers_transferred: transferred,
      servers_deleted: deleted,
      failures: failures.length,
      remaining: Math.max((inactive ?? []).length - targets.length, 0),
    });
  }),
);
