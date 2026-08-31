import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "./client";
import {
  generateRecoveryKey,
  hashRecoveryKey,
  isRecoveryKeyShaped,
} from "./recoveryKey";

export interface OnlineAccount {
  id: string;
  profileId: string;
  username: string;
  email: string;
  mode: "online";
}

export interface OnlineAuthSession {
  id: string;
  createdAt: string;
  updatedAt: string;
  userAgent?: string;
  ip?: string;
  isCurrent: boolean;
}

async function accountFromUser(user: User): Promise<OnlineAccount> {
  const { data, error } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", user.id)
    .single();
  if (error) throw error;
  return {
    id: user.id,
    profileId: user.id,
    username: data.username,
    email: user.email ?? "",
    mode: "online",
  };
}

export async function onlineAccountFromSession(session: Session | null) {
  return session ? accountFromUser(session.user) : null;
}

export async function getCurrentOnlineAccount() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return onlineAccountFromSession(data.session);
}

export async function registerOnlineAccount(input: {
  email: string;
  username: string;
  displayName: string;
  password: string;
}) {
  const { data, error } = await supabase.auth.signUp({
    email: input.email.trim().toLowerCase(),
    password: input.password,
    options: {
      data: {
        username: input.username.trim().toLowerCase(),
        display_name: input.displayName.trim(),
      },
    },
  });
  if (error) throw error;
  if (!data.session)
    throw new Error("Conta criada. Confirme o e-mail antes de entrar.");

  // A chave nasce aqui e é mostrada uma única vez. Se o registro dela falhar,
  // a conta fica sem caminho de volta — melhor deixar o cadastro falhar alto
  // do que entregar uma conta que ninguém consegue recuperar.
  const recoveryKey = generateRecoveryKey();
  const { error: keyError } = await supabase.rpc("set_recovery_key", {
    p_key_hash: await hashRecoveryKey(recoveryKey),
  });
  if (keyError) {
    await supabase.auth.signOut();
    throw new Error(
      "A conta foi criada, mas a chave de recuperação não pôde ser registrada. " +
        "Entre em contato antes de usar a conta.",
    );
  }

  return { account: await accountFromUser(data.user!), recoveryKey };
}

/**
 * Estado da chave do usuário logado. O hash nunca volta do servidor; isto
 * responde apenas se existe e quando foi criada ou usada.
 */
export async function getRecoveryKeyStatus() {
  const { data, error } = await supabase.rpc("recovery_key_status");
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    hasKey: Boolean(row?.has_key),
    createdAt: (row?.created_at as string | null) ?? null,
    lastUsedAt: (row?.last_used_at as string | null) ?? null,
  };
}

/**
 * Sorteia uma chave nova e invalida a anterior na mesma operação. Usado por
 * quem acha que a chave vazou e por quem nunca chegou a guardá-la.
 */
export async function rotateOnlineRecoveryKey() {
  const recoveryKey = generateRecoveryKey();
  const { error } = await supabase.rpc("set_recovery_key", {
    p_key_hash: await hashRecoveryKey(recoveryKey),
  });
  if (error) throw error;
  return recoveryKey;
}

/**
 * Troca a senha provando posse da chave, sem sessão e sem e-mail.
 *
 * A função de borda responde a mesma coisa para chave errada e para conta
 * inexistente: distinguir as duas entregaria a lista de quem tem conta a quem
 * perguntar. Ao final a chave é substituída — uma chave usada é uma chave que
 * já esteve no meio do caminho.
 */
export async function recoverOnlineAccountWithKey(input: {
  email: string;
  recoveryKey: string;
  newPassword: string;
}) {
  if (!isRecoveryKeyShaped(input.recoveryKey))
    throw new Error("A chave de recuperação tem 32 caracteres.");

  // A chave nova é sorteada aqui, e só o hash dela viaja: o servidor conclui a
  // recuperação sem nunca ver nenhuma das duas chaves.
  const nextKey = generateRecoveryKey();
  const { data, error } = await supabase.functions.invoke<{ ok?: boolean }>(
    "account-recover",
    {
      body: {
        email: input.email.trim().toLowerCase(),
        keyHash: await hashRecoveryKey(input.recoveryKey),
        nextKeyHash: await hashRecoveryKey(nextKey),
        newPassword: input.newPassword,
      },
    },
  );

  if (error) {
    const status = (error as { context?: { status?: number } }).context?.status;
    if (status === 429)
      throw new Error(
        "Muitas tentativas com chave errada. Espere quinze minutos.",
      );
    if (status === 400)
      throw new Error("A senha nova precisa ter pelo menos 8 caracteres.");
    // 401 e qualquer outra falha de identificação chegam com a mesma
    // mensagem, porque o servidor não distingue os casos de propósito.
    throw new Error("E-mail ou chave de recuperação não conferem.");
  }
  if (!data?.ok)
    throw new Error("E-mail ou chave de recuperação não conferem.");
  return nextKey;
}

export async function loginOnlineAccount(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error) throw error;
  return accountFromUser(data.user);
}

export async function updateOnlinePassword(password: string) {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
  const { error: revokeError } = await supabase.rpc(
    "revoke_other_account_sessions",
  );
  if (revokeError) throw revokeError;
}

export async function listOnlineAccountSessions() {
  const { data, error } = await supabase.rpc("list_account_sessions");
  if (error) throw error;
  return (data ?? []).map(
    (session: {
      id: string;
      created_at: string;
      updated_at: string;
      user_agent: string | null;
      ip: string | null;
      is_current: boolean;
    }) => ({
      id: session.id,
      createdAt: session.created_at,
      updatedAt: session.updated_at,
      userAgent: session.user_agent ?? undefined,
      ip: session.ip ?? undefined,
      isCurrent: session.is_current,
    }),
  ) satisfies OnlineAuthSession[];
}

export async function revokeOnlineAccountSession(sessionId: string) {
  const { error } = await supabase.rpc("revoke_account_session", {
    p_session_id: sessionId,
  });
  if (error) throw error;
}

export async function revokeOtherOnlineAccountSessions() {
  const { data, error } = await supabase.rpc("revoke_other_account_sessions");
  if (error) throw error;
  return Number(data ?? 0);
}

export async function logoutOnlineAccount() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}
