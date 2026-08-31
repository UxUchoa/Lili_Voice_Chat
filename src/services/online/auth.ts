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
  return accountFromUser(data.user!);
}

export async function loginOnlineAccount(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error) throw error;
  return accountFromUser(data.user);
}

export async function requestOnlinePasswordReset(email: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(
    email.trim().toLowerCase(),
    { redirectTo: `${window.location.origin}/auth/reset` },
  );
  if (error) throw error;
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
