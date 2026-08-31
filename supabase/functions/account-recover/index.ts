import { createClient } from "npm:@supabase/supabase-js@2";
import { json, withCors } from "../_shared/cors.ts";

/**
 * Troca a senha provando posse da chave de recuperação.
 *
 * Sem sessão e sem e-mail: é a única porta de volta para dentro da conta, e
 * por isso é a que mais precisa se comportar bem quando alguém a ataca.
 *
 * Três decisões que valem explicar:
 *
 * 1. **A resposta é sempre a mesma para falha.** Chave errada, conta que não
 *    existe e conta que virou lápide devolvem o mesmo 401. Distinguir os casos
 *    entregaria a lista de quem tem conta a quem ficasse perguntando.
 * 2. **O servidor nunca vê a chave.** O cliente manda o SHA-256 da chave
 *    normalizada, tanto da atual quanto da nova. Este código compara e grava
 *    hashes; a chave em si só existe na mão do usuário.
 * 3. **`verify_jwt` está desligado** porque quem chega aqui perdeu a senha e
 *    não tem sessão nenhuma. A autorização é a própria chave, e o bloqueio
 *    após cinco erros mora no banco.
 */
Deno.serve(
  withCors(async (request) => {
    if (request.method !== "POST")
      return json({ error: "method_not_allowed" }, 405);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !serviceKey)
      return json({ error: "server_not_configured" }, 503);

    let body: {
      email?: string;
      keyHash?: string;
      nextKeyHash?: string;
      newPassword?: string;
    };
    try {
      body = await request.json();
    } catch {
      return json({ error: "invalid_body" }, 400);
    }

    const email = (body.email ?? "").trim().toLowerCase();
    const keyHash = (body.keyHash ?? "").trim();
    const nextKeyHash = (body.nextKeyHash ?? "").trim();
    const newPassword = body.newPassword ?? "";

    if (!email || keyHash.length < 32 || nextKeyHash.length < 32)
      return json({ error: "invalid_body" }, 400);
    // O mesmo piso do Supabase Auth (`minimum_password_length = 8`), conferido
    // aqui para a mensagem de erro sair antes de qualquer trabalho.
    if (newPassword.length < 8) return json({ error: "weak_password" }, 400);

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: verified, error: verifyError } = await admin.rpc(
      "verify_recovery_key",
      { p_email: email, p_key_hash: keyHash },
    );
    if (verifyError) return json({ error: "verification_failed" }, 500);

    const outcome = Array.isArray(verified) ? verified[0] : verified;
    if (outcome?.status === "locked")
      return json({ error: "too_many_attempts" }, 429);
    if (outcome?.status !== "ok" || !outcome?.user_id)
      return json({ error: "unauthorized" }, 401);

    const userId = outcome.user_id as string;

    const { error: passwordError } = await admin.auth.admin.updateUserById(
      userId,
      { password: newPassword },
    );
    if (passwordError) return json({ error: "password_update_failed" }, 500);

    // Derruba as sessões vivas e grava a chave nova. Se isto falhar depois da
    // senha já ter mudado, o usuário entra com a senha nova e a chave antiga
    // continua valendo — degradação preferível a devolver erro para quem
    // acabou de recuperar o acesso com sucesso.
    const { error: completeError } = await admin.rpc("complete_recovery", {
      p_user_id: userId,
      p_next_key_hash: nextKeyHash,
    });
    if (completeError) return json({ ok: true, rotated: false });

    return json({ ok: true, rotated: true });
  }),
);
