import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "./client";

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

/**
 * Resultado do cadastro.
 *
 * `pending` é o caso em que a confirmação de e-mail está ligada: a conta
 * existe, mas só entra depois que o link for aberto. Isso não é erro, e
 * tratá-lo como erro — que era o que acontecia — avisa o usuário de que deu
 * errado exatamente quando deu certo.
 */
export type RegistrationResult =
  | { status: "active"; account: OnlineAccount }
  | { status: "pending"; email: string };

export async function registerOnlineAccount(input: {
  email: string;
  username: string;
  displayName: string;
  password: string;
}): Promise<RegistrationResult> {
  const email = input.email.trim().toLowerCase();
  const { data, error } = await supabase.auth.signUp({
    email,
    password: input.password,
    options: {
      data: {
        username: input.username.trim().toLowerCase(),
        display_name: input.displayName.trim(),
      },
    },
  });
  if (error) throw error;
  if (!data.session) return { status: "pending", email };
  return { status: "active", account: await accountFromUser(data.user!) };
}

/**
 * Reenvia o e-mail de confirmação do cadastro.
 *
 * Existe porque a primeira mensagem se perde com frequência — filtro de spam,
 * limite de envio do provedor, endereço digitado e corrigido depois. Sem um
 * botão, a conta fica criada e inacessível, e a pessoa não tem o que fazer
 * além de criar outra com outro e-mail.
 *
 * Responde igual para e-mail cadastrado e desconhecido, como o pedido de
 * redefinição: o formulário não pode virar um consultor de quem tem conta.
 */
export async function resendOnlineConfirmationEmail(email: string) {
  const { error } = await supabase.auth.resend({
    type: "signup",
    email: email.trim().toLowerCase(),
    options: { emailRedirectTo: `${window.location.origin}/` },
  });
  // "For security purposes" e afins são a resposta do limite de envio. Deixar
  // vazar essa distinção diria quais endereços existem.
  if (error && !/security purposes|rate limit/i.test(error.message))
    throw error;
}

export async function loginOnlineAccount(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error) throw error;
  return accountFromUser(data.user);
}

/**
 * Manda o link de redefinição de senha.
 *
 * O `redirectTo` aponta para a raiz do site. O Supabase acrescenta o token no
 * fragmento da URL, o cliente o consome ao carregar a página e a sessão nasce
 * já autenticada — por isso a tela de senha nova precisa aparecer sozinha,
 * antes de o aplicativo abrir. Quem percebe isso é `isPasswordRecoveryLink`.
 *
 * A resposta é a mesma para e-mail cadastrado e desconhecido: distinguir os
 * dois transformaria o formulário num consultor de quem tem conta aqui.
 */
export async function requestOnlinePasswordReset(email: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(
    email.trim().toLowerCase(),
    { redirectTo: `${window.location.origin}/` },
  );
  if (error) throw error;
}

/**
 * O usuário chegou por um link de recuperação?
 *
 * O Supabase marca o retorno com `type=recovery` no fragmento. Sem olhar para
 * isso, quem clica em "esqueci a senha" simplesmente entra no aplicativo com a
 * senha antiga ainda valendo: funciona, mas não é o que a pessoa pediu, e ela
 * sai de lá sem ter trocado nada.
 *
 * A leitura precisa acontecer antes de o supabase-js limpar o fragmento, então
 * o resultado é guardado na primeira chamada.
 */
let recoveryLinkDetected: boolean | null = null;

export function isPasswordRecoveryLink(): boolean {
  if (recoveryLinkDetected === null) {
    const fragment = window.location.hash.replace(/^#/, "");
    recoveryLinkDetected =
      new URLSearchParams(fragment).get("type") === "recovery";
  }
  return recoveryLinkDetected;
}

/** Esquece o marcador depois que a senha foi trocada. */
export function clearPasswordRecoveryLink() {
  recoveryLinkDetected = false;
  if (window.location.hash.includes("type=recovery"))
    history.replaceState(null, "", window.location.pathname);
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
