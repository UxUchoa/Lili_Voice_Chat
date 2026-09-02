import { describe, expect, it } from "vitest";
import {
  groupMembers,
  hoistRoleOf,
  isOffline,
  nameColorOf,
} from "./memberList";
import type { Role, ServerMember } from "./types";

const role = (over: Partial<Role> & Pick<Role, "id" | "name">): Role => ({
  serverId: "s1",
  position: 0,
  permissions: "0",
  color: "",
  hoist: false,
  mentionable: true,
  isDefault: false,
  ...over,
});

const roles: Role[] = [
  role({ id: "admin", name: "Admin", position: 30, hoist: true, color: "#f00" }),
  role({ id: "mod", name: "Moderação", position: 20, hoist: true, color: "#0f0" }),
  // Colore sem destacar: não abre grupo, mas pinta o nome.
  role({ id: "vip", name: "VIP", position: 25, hoist: false, color: "#00f" }),
  role({ id: "everyone", name: "@everyone", position: 0, isDefault: true }),
];

const member = (userId: string, roleIds: string[]): ServerMember => ({
  serverId: "s1",
  userId,
  roleIds,
  joinedAt: "2026-01-01T00:00:00Z",
});

const members = [
  member("u1", ["admin"]),
  member("u2", ["mod"]),
  member("u3", []),
  member("u4", ["vip"]),
  member("u5", ["mod"]),
];

const person = (id: string, status: "online" | "offline" | "invisible" | "idle") => ({
  id,
  status,
});

describe("isOffline", () => {
  it("trata invisível como offline", () => {
    // Quem escolheu invisível some da barra igual a quem está offline.
    expect(isOffline("invisible")).toBe(true);
    expect(isOffline("offline")).toBe(true);
    expect(isOffline("dnd")).toBe(false);
  });
});

describe("hoistRoleOf", () => {
  it("devolve o cargo destacado de maior posição", () => {
    expect(hoistRoleOf(member("x", ["mod", "admin"]), roles)?.id).toBe("admin");
  });

  it("ignora cargo que não destaca", () => {
    expect(hoistRoleOf(member("x", ["vip"]), roles)).toBeUndefined();
  });

  it("ignora o cargo padrão", () => {
    expect(hoistRoleOf(member("x", ["everyone"]), roles)).toBeUndefined();
  });
});

describe("nameColorOf", () => {
  it("usa o cargo colorido mais alto, mesmo sem destaque", () => {
    // VIP está acima de Moderação e colore, ainda que não abra grupo.
    expect(nameColorOf(member("x", ["mod", "vip"]), roles)).toBe("#00f");
  });

  it("não devolve cor quando nenhum cargo tem uma", () => {
    expect(nameColorOf(member("x", ["everyone"]), roles)).toBeUndefined();
  });
});

describe("groupMembers", () => {
  it("abre um grupo por cargo destacado, na ordem da hierarquia", () => {
    const groups = groupMembers(
      [person("u1", "online"), person("u2", "online")],
      members,
      roles,
    );
    expect(groups.map((group) => group.title)).toEqual(["Admin", "Moderação"]);
  });

  it("junta quem não tem cargo destacado em Online", () => {
    const groups = groupMembers(
      [person("u3", "online"), person("u4", "idle")],
      members,
      roles,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBe("Online");
    expect(groups[0].people.map((p) => p.id)).toEqual(["u3", "u4"]);
  });

  it("manda todo mundo offline para um grupo só, no fim", () => {
    // Separar offline por cargo encheria a barra de títulos com uma pessoa.
    const groups = groupMembers(
      [person("u1", "offline"), person("u2", "invisible"), person("u3", "online")],
      members,
      roles,
    );
    expect(groups.map((group) => group.title)).toEqual(["Online", "Offline"]);
    expect(groups[1].people.map((p) => p.id)).toEqual(["u1", "u2"]);
  });

  it("não cria título para cargo sem ninguém online", () => {
    const groups = groupMembers([person("u2", "online")], members, roles);
    expect(groups.map((group) => group.title)).toEqual(["Moderação"]);
  });

  it("leva a cor do cargo para o título do grupo", () => {
    const groups = groupMembers([person("u1", "online")], members, roles);
    expect(groups[0].color).toBe("#f00");
  });

  it("não perde ninguém pelo caminho", () => {
    const todos = [
      person("u1", "online"),
      person("u2", "online"),
      person("u3", "idle"),
      person("u4", "offline"),
      person("u5", "invisible"),
    ];
    const total = groupMembers(todos, members, roles).reduce(
      (sum, group) => sum + group.people.length,
      0,
    );
    expect(total).toBe(todos.length);
  });

  it("põe em Online quem não tem registro de membro", () => {
    // Perfil que chegou antes da lista de membros não pode sumir da barra.
    const groups = groupMembers([person("u9", "online")], members, roles);
    expect(groups[0].title).toBe("Online");
    expect(groups[0].people.map((p) => p.id)).toEqual(["u9"]);
  });
});
