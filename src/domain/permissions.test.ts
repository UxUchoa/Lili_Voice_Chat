import { describe, expect, it } from "vitest";
import {
  Permissions,
  canGrantPermissions,
  canManageRole,
  canModerateMember,
  hasPermission,
  resolvePermissions,
} from "./permissions";

describe("permission engine", () => {
  const everyone = {
    id: "everyone",
    position: 0,
    permissions: Permissions.VIEW_CHANNEL | Permissions.SEND_MESSAGES,
  };
  const moderator = {
    id: "moderator",
    position: 10,
    permissions: Permissions.KICK_MEMBERS | Permissions.MANAGE_ROLES,
  };

  it("combines everyone and member roles", () => {
    const result = resolvePermissions({
      userId: "member",
      ownerId: "owner",
      everyoneRole: everyone,
      memberRoles: [moderator],
    });
    expect(hasPermission(result, Permissions.SEND_MESSAGES)).toBe(true);
    expect(hasPermission(result, Permissions.KICK_MEMBERS)).toBe(true);
  });

  it("applies role deny before member allow", () => {
    const result = resolvePermissions({
      userId: "member",
      ownerId: "owner",
      everyoneRole: everyone,
      memberRoles: [moderator],
      overwrites: [
        {
          targetType: "ROLE",
          targetId: "moderator",
          allow: 0n,
          deny: Permissions.SEND_MESSAGES,
        },
        {
          targetType: "MEMBER",
          targetId: "member",
          allow: Permissions.SEND_MESSAGES,
          deny: 0n,
        },
      ],
    });
    expect(hasPermission(result, Permissions.SEND_MESSAGES)).toBe(true);
  });

  it("administrator and owner bypass channel denies", () => {
    const admin = {
      id: "admin",
      position: 20,
      permissions: Permissions.ADMINISTRATOR,
    };
    const deny = [
      {
        targetType: "ROLE" as const,
        targetId: "everyone",
        allow: 0n,
        deny: Permissions.VIEW_CHANNEL,
      },
    ];
    expect(
      hasPermission(
        resolvePermissions({
          userId: "admin-user",
          ownerId: "owner",
          everyoneRole: everyone,
          memberRoles: [admin],
          overwrites: deny,
        }),
        Permissions.VIEW_CHANNEL,
      ),
    ).toBe(true);
    expect(
      hasPermission(
        resolvePermissions({
          userId: "owner",
          ownerId: "owner",
          everyoneRole: everyone,
          memberRoles: [],
          overwrites: deny,
        }),
        Permissions.VIEW_CHANNEL,
      ),
    ).toBe(true);
  });

  it("enforces role and moderation hierarchy", () => {
    expect(canManageRole(10, 9, moderator.permissions)).toBe(true);
    expect(canManageRole(10, 10, moderator.permissions)).toBe(false);
    expect(canModerateMember(10, 9, moderator.permissions, "kick")).toBe(true);
    expect(canModerateMember(10, 11, moderator.permissions, "kick")).toBe(
      false,
    );
  });

  it("prevents granting permissions the actor does not possess", () => {
    expect(
      canGrantPermissions(moderator.permissions, Permissions.KICK_MEMBERS),
    ).toBe(true);
    expect(
      canGrantPermissions(moderator.permissions, Permissions.BAN_MEMBERS),
    ).toBe(false);
    expect(
      canGrantPermissions(
        Permissions.ADMINISTRATOR,
        Permissions.BAN_MEMBERS | Permissions.MANAGE_SERVER,
      ),
    ).toBe(true);
  });
});
