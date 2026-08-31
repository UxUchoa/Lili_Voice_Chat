import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const statusProcess = spawnSync(
  process.platform === "win32" ? "powershell.exe" : "npx",
  process.platform === "win32"
    ? ["-NoProfile", "-Command", "npx supabase status --output json"]
    : ["supabase", "status", "--output", "json"],
  { cwd: process.cwd(), encoding: "utf8" },
);
if (statusProcess.status !== 0) throw new Error("Supabase local não está ativo.");

const status = JSON.parse(statusProcess.stdout);
const apiUrl = status.API_URL;
const publishableKey = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
const serviceRoleKey = status.SECRET_KEY ?? status.SERVICE_ROLE_KEY;
if (!apiUrl || !publishableKey || !serviceRoleKey)
  throw new Error("Credenciais do Supabase local não foram encontradas.");

const admin = createClient(apiUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const owner = createClient(apiUrl, publishableKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const member = createClient(apiUrl, publishableKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const password = `Janja-${crypto.randomUUID()}-Aa1!`;
const createdUserIds = [];
let serverId;

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const unwrap = async (promise, label) => {
  const result = await promise;
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
};

try {
  for (const input of [
    { email: `owner-${runId}@janja.local`, username: `owner_${runId.replace(/\W/g, "")}` },
    { email: `member-${runId}@janja.local`, username: `member_${runId.replace(/\W/g, "")}` },
  ]) {
    const data = await unwrap(
      admin.auth.admin.createUser({
        email: input.email,
        password,
        email_confirm: true,
        user_metadata: { username: input.username.slice(0, 30), display_name: input.username },
      }),
      "criar conta de teste",
    );
    createdUserIds.push(data.user.id);
  }

  await unwrap(
    owner.auth.signInWithPassword({ email: `owner-${runId}@janja.local`, password }),
    "login do proprietário",
  );
  await unwrap(
    member.auth.signInWithPassword({ email: `member-${runId}@janja.local`, password }),
    "login do participante",
  );

  serverId = await unwrap(owner.rpc("create_server", { p_name: `E2E ${runId}` }), "criar servidor");
  const channels = await unwrap(
    owner.from("channels").select("id,kind").eq("server_id", serverId),
    "listar canais",
  );
  const textChannel = channels.find((channel) => channel.kind === "text");
  assert(textChannel, "Servidor não criou um canal de texto.");

  const inviteCode = await unwrap(
    owner.rpc("create_invite", {
      p_server_id: serverId,
      p_channel_id: textChannel.id,
      p_max_uses: 3,
      p_expires_in_minutes: 60,
    }),
    "criar convite",
  );

  let realtimeObserved = false;
  const workspaceChannel = owner
    .channel(`e2e-workspace-${runId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "server_members" },
      (event) => {
        if (event.new?.server_id === serverId && event.new?.user_id === createdUserIds[1])
          realtimeObserved = true;
      },
    );
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Realtime não conectou.")), 8_000);
    workspaceChannel.subscribe((state) => {
      if (state === "SUBSCRIBED") {
        clearTimeout(timeout);
        resolve();
      } else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT") {
        clearTimeout(timeout);
        reject(new Error(`Realtime retornou ${state}.`));
      }
    });
  });

  const joinedServerId = await unwrap(
    member.rpc("redeem_invite", { p_code: inviteCode }),
    "resgatar convite",
  );
  assert(joinedServerId === serverId, "O convite direcionou para outro servidor.");

  for (let attempt = 0; attempt < 100 && !realtimeObserved; attempt += 1)
    await new Promise((resolve) => setTimeout(resolve, 100));

  const [memberServers, memberChannels, ownerMembership] = await Promise.all([
    unwrap(member.from("servers").select("id").eq("id", serverId), "servidor do participante"),
    unwrap(member.from("channels").select("id").eq("server_id", serverId), "canais do participante"),
    unwrap(
      owner
        .from("server_members")
        .select("user_id")
        .eq("server_id", serverId)
        .eq("user_id", createdUserIds[1]),
      "associação vista pelo proprietário",
    ),
  ]);

  assert(memberServers.length === 1, "O segundo cliente não consegue ler o servidor.");
  assert(memberChannels.length >= 2, "O segundo cliente não consegue ler os canais.");
  assert(ownerMembership.length === 1, "O proprietário não enxerga o novo membro.");
  await owner.removeChannel(workspaceChannel);
  console.log(
    `PASS shared-workspace: 2 contas, 1 servidor, ${memberChannels.length} canais; Realtime=${realtimeObserved ? "confirmado" : "fallback de reconciliação necessário"}.`,
  );
} finally {
  await Promise.all([owner.removeAllChannels(), member.removeAllChannels()]);
  if (serverId) await owner.rpc("delete_server", { p_server_id: serverId });
  for (const userId of createdUserIds.reverse())
    await admin.auth.admin.deleteUser(userId);
}
