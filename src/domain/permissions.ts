export const Permissions = {
  VIEW_CHANNEL: 1n << 0n,
  SEND_MESSAGES: 1n << 1n,
  MANAGE_MESSAGES: 1n << 2n,
  PIN_MESSAGES: 1n << 3n,
  BYPASS_SLOWMODE: 1n << 4n,
  CONNECT: 1n << 5n,
  SPEAK: 1n << 6n,
  STREAM: 1n << 7n,
  MUTE_MEMBERS: 1n << 8n,
  DEAFEN_MEMBERS: 1n << 9n,
  MOVE_MEMBERS: 1n << 10n,
  KICK_MEMBERS: 1n << 11n,
  BAN_MEMBERS: 1n << 12n,
  TIMEOUT_MEMBERS: 1n << 13n,
  MANAGE_ROLES: 1n << 14n,
  MANAGE_CHANNELS: 1n << 15n,
  MANAGE_SERVER: 1n << 16n,
  VIEW_AUDIT_LOG: 1n << 17n,
  CREATE_INVITES: 1n << 18n,
  ADD_REACTIONS: 1n << 19n,
  ATTACH_FILES: 1n << 20n,
  EMBED_LINKS: 1n << 21n,
  READ_HISTORY: 1n << 22n,
  MENTION_EVERYONE: 1n << 23n,
  CHANGE_NICKNAME: 1n << 24n,
  MANAGE_NICKNAMES: 1n << 25n,
  CREATE_PUBLIC_THREADS: 1n << 26n,
  CREATE_PRIVATE_THREADS: 1n << 27n,
  SEND_IN_THREADS: 1n << 28n,
  MANAGE_THREADS: 1n << 29n,
  USE_VAD: 1n << 30n,
  PRIORITY_SPEAKER: 1n << 31n,
  SET_VOICE_STATUS: 1n << 32n,
  CREATE_POLLS: 1n << 33n,
  CREATE_EVENTS: 1n << 34n,
  MANAGE_EVENTS: 1n << 35n,
  CREATE_EXPRESSIONS: 1n << 36n,
  MANAGE_EXPRESSIONS: 1n << 37n,
  USE_EXTERNAL_EMOJIS: 1n << 38n,
  USE_EXTERNAL_STICKERS: 1n << 39n,
  REQUEST_TO_SPEAK: 1n << 40n,
  MANAGE_STAGE: 1n << 41n,
  USE_APPS: 1n << 42n,
  USE_ACTIVITIES: 1n << 43n,
  ADMINISTRATOR: 1n << 60n,
} as const;

export type PermissionName = keyof typeof Permissions;

export interface PermissionRole {
  id: string;
  position: number;
  permissions: bigint;
}

export interface PermissionOverwrite {
  targetType: "ROLE" | "MEMBER";
  targetId: string;
  allow: bigint;
  deny: bigint;
}

const ALL_PERMISSIONS = Object.values(Permissions).reduce(
  (mask, permission) => mask | permission,
  0n,
);

export function hasPermission(mask: bigint, permission: bigint) {
  return (mask & permission) === permission;
}

export function resolvePermissions(input: {
  userId: string;
  ownerId: string;
  everyoneRole: PermissionRole;
  memberRoles: PermissionRole[];
  overwrites?: PermissionOverwrite[];
}) {
  if (input.userId === input.ownerId) return ALL_PERMISSIONS;

  let permissions = input.everyoneRole.permissions;
  for (const role of input.memberRoles) permissions |= role.permissions;
  if (hasPermission(permissions, Permissions.ADMINISTRATOR))
    return ALL_PERMISSIONS;

  const overwrites = input.overwrites ?? [];
  const everyoneOverwrite = overwrites.find(
    (item) =>
      item.targetType === "ROLE" && item.targetId === input.everyoneRole.id,
  );
  if (everyoneOverwrite) {
    permissions &= ~everyoneOverwrite.deny;
    permissions |= everyoneOverwrite.allow;
  }

  let roleAllow = 0n;
  let roleDeny = 0n;
  const roleIds = new Set(input.memberRoles.map((role) => role.id));
  for (const overwrite of overwrites) {
    if (overwrite.targetType === "ROLE" && roleIds.has(overwrite.targetId)) {
      roleAllow |= overwrite.allow;
      roleDeny |= overwrite.deny;
    }
  }
  permissions &= ~roleDeny;
  permissions |= roleAllow;

  const memberOverwrite = overwrites.find(
    (item) => item.targetType === "MEMBER" && item.targetId === input.userId,
  );
  if (memberOverwrite) {
    permissions &= ~memberOverwrite.deny;
    permissions |= memberOverwrite.allow;
  }
  return permissions;
}

export function canManageRole(
  actorHighestPosition: number,
  targetPosition: number,
  actorPermissions: bigint,
) {
  return (
    hasPermission(actorPermissions, Permissions.MANAGE_ROLES) &&
    actorHighestPosition > targetPosition
  );
}

export function canGrantPermissions(
  actorPermissions: bigint,
  requestedPermissions: bigint,
) {
  if (hasPermission(actorPermissions, Permissions.ADMINISTRATOR)) return true;
  return (requestedPermissions & ~actorPermissions) === 0n;
}

export function canModerateMember(
  actorHighestPosition: number,
  targetHighestPosition: number,
  actorPermissions: bigint,
  action: "kick" | "ban" | "timeout",
) {
  const permission =
    action === "kick"
      ? Permissions.KICK_MEMBERS
      : action === "ban"
        ? Permissions.BAN_MEMBERS
        : Permissions.TIMEOUT_MEMBERS;
  return (
    hasPermission(actorPermissions, permission) &&
    actorHighestPosition > targetHighestPosition
  );
}
