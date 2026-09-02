import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "./client";
import { humanizeAuthError } from "./authErrors";
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

/**
 * Resultado do cadastro.
 *
 * `pending` é o caso em que a confirmação de e-mail está ligada: a conta
 * existe, mas só entra depois que o link for aberto. Isso não é erro, e
 * tratá-lo como erro — que era o que acontecia — avisa o usuário de que deu
 * errado exatamente quando deu certo.
 */
export type RegistrationResult =
  | { status: "active"; account: OnlineAccount; recoveryKey: string }
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
  if (error) throw humanizeAuthError(error);
  // Sem sessão o cadastro depende de confirmação por e-mail e a chave não pode
  // ser registrada ainda; quem entrar depois recebe a dele no primeiro login.
  if (!data.session) return { status: "pending", email };
  return {
    status: "active",
    account: await accountFromUser(data.user!),
    recoveryKey: await issueRecoveryKey(),
  };
}

/**
 * Sorteia uma chave, grava só o hash dela e devolve a chave em claro.
 *
 * O valor devolvido é a única cópia que existirá: o servidor guarda o SHA-256
 * e mais nada. Quem chama precisa mostrá-la antes de deixar o usuário seguir.
 */
async function issueRecoveryKey() {
  const recoveryKey = generateRecoveryKey();
  const { error } = await supabase.rpc("set_recovery_key", {
    p_key_hash: await hashRecoveryKey(recoveryKey),
  });
  if (error) throw error;
  return recoveryKey;
}

/** Estado da chave do usuário logado. O hash nunca volta do servidor. */
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
 * Sorteia uma chave nova e invalida a anterior na mesma operação.
 *
 * Serve para quem acha que a chave vazou, para quem nunca chegou a guardá-la e
 * para as contas criadas antes de a chave existir — nesse caso é o primeiro
 * login que a emite.
 */
export async function rotateOnlineRecoveryKey() {
  return issueRecoveryKey();
}

/**
 * Troca a senha provando posse da chave, sem sessão e sem e-mail.
 *
 * A função de borda responde a mesma coisa para chave errada e para conta
 * inexistente: distinguir as duas entregaria a lista de quem tem conta. Ao
 * final a chave é substituída — uma chave usada já esteve no meio do caminho.
 */
export async function recoverOnlineAccountWithKey(input: {
  email: string;
  recoveryKey: string;
  newPassword: string;
}) {
  if (!isRecoveryKeyShaped(input.recoveryKey))
    throw new Error("A chave de recuperação tem 32 caracteres.");
  if (input.newPassword.length < 8)
    throw new Error("A senha nova precisa ter pelo menos 8 caracteres.");

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
    throw new Error("E-mail ou chave de recuperação não conferem.");
  }
  if (!data?.ok)
    throw new Error("E-mail ou chave de recuperação não conferem.");
  return nextKey;
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
    // Sem `emailRedirectTo`: o modelo de e-mail manda o código, e um link de
    // volta ao site só existiria para não ser usado. O desktop empacotado
    // agradece — ele vive em `file://` e não tem endereço de retorno.
  });
  // Limite de envio é informação útil e não revela nada sobre quem tem conta:
  // dizer "reenviamos" quando nada foi enviado deixaria a pessoa esperando um
  // e-mail que não existe. Só o "usuário não encontrado" é engolido, porque aí
  // sim a resposta entregaria quais endereços estão cadastrados.
  if (error && !/user not found|not found/i.test(error.message))
    throw humanizeAuthError(error);
}

export async function loginOnlineAccount(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error) throw humanizeAuthError(error);
  return accountFromUser(data.user);
}

/**
 * Manda o código de redefinição de senha.
 *
 * Sem `redirectTo`: o modelo de e-mail carrega `{{ .Token }}`, e o código é
 * conferido por `confirmOnlineRecoveryCode`. O link deixou de ser usado porque
 * o desktop empacotado vive em `file://` — nenhum provedor de e-mail sabe
 * abrir esse endereço, então o retorno só funcionava pelo site.
 *
 * A resposta é a mesma para e-mail cadastrado e desconhecido: distinguir os
 * dois transformaria o formulário num consultor de quem tem conta aqui.
 */
export async function requestOnlinePasswordReset(email: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(
    email.trim().toLowerCase(),
  );
  if (error) throw humanizeAuthError(error);
}

/**
 * Confirma o cadastro com o código recebido por e-mail.
 *
 * `verifyOtp` devolve uma sessão já autenticada, então a chave de recuperação
 * pode ser emitida aqui — é o mesmo ponto do fluxo em que ela sairia se o
 * cadastro não exigisse confirmação. Quem confirma recebe a dele na hora, e
 * não "no primeiro login".
 */
export async function confirmOnlineSignupCode(email: string, code: string) {
  const { data, error } = await supabase.auth.verifyOtp({
    email: email.trim().toLowerCase(),
    token: code,
    type: "signup",
  });
  if (error) throw humanizeAuthError(error);
  if (!data.user)
    throw new Error("A confirmação não devolveu a conta. Tente entrar.");
  return {
    account: await accountFromUser(data.user),
    recoveryKey: await issueRecoveryKey(),
  };
}

/**
 * Confere o código de recuperação e deixa a sessão pronta para trocar a senha.
 *
 * A sessão que nasce aqui é o que autoriza `updateOnlinePassword` — sem ela o
 * Supabase recusa a troca. Quem chama precisa mostrar a tela de senha nova
 * logo em seguida: a pessoa fica autenticada com a senha **antiga** ainda
 * valendo até trocar.
 */
export async function confirmOnlineRecoveryCode(email: string, code: string) {
  const { data, error } = await supabase.auth.verifyOtp({
    email: email.trim().toLowerCase(),
    token: code,
    type: "recovery",
  });
  if (error) throw humanizeAuthError(error);
  if (!data.session)
    throw new Error("O código não abriu a sessão. Peça um novo.");
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
