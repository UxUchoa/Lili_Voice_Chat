import { describe, expect, it } from "vitest";
import {
  composeRail,
  flattenRail,
  moveEntry,
  type ServerFolder,
  type ServerPlacement,
} from "./serverLayout";

const server = (id: string) => ({ id, name: id });
const folder = (
  id: string,
  position: number,
  extra: Partial<ServerFolder> = {},
): ServerFolder => ({ id, name: id, position, ...extra });

const names = (entries: ReturnType<typeof composeRail>) =>
  entries.map((entry) =>
    entry.kind === "server"
      ? entry.server.id
      : `${entry.folder.id}[${entry.servers.map((item) => item.id).join(",")}]`,
  );

describe("composeRail", () => {
  it("intercala pastas e servidores soltos pela mesma posição", () => {
    const rail = composeRail(
      [server("a"), server("b"), server("c")],
      [folder("f1", 1)],
      [
        { serverId: "a", position: 0 },
        { serverId: "b", folderId: "f1", position: 0 },
        { serverId: "c", position: 2 },
      ] satisfies ServerPlacement[],
    );

    expect(names(rail)).toEqual(["a", "f1[b]", "c"]);
  });

  it("põe no fim o servidor que ainda não foi arrastado", () => {
    // Entrar num servidor novo nao pode reorganizar a barra de quem ja tinha
    // a dele arrumada — e o servidor tambem nao pode sumir.
    const rail = composeRail(
      [server("novo"), server("antigo")],
      [],
      [{ serverId: "antigo", position: 0 }],
    );

    expect(names(rail)).toEqual(["antigo", "novo"]);
  });

  it("ordena os servidores dentro da pasta pela posição interna", () => {
    const rail = composeRail(
      [server("x"), server("y")],
      [folder("f", 0)],
      [
        { serverId: "x", folderId: "f", position: 1 },
        { serverId: "y", folderId: "f", position: 0 },
      ],
    );

    expect(names(rail)).toEqual(["f[y,x]"]);
  });

  it("trata pasta inexistente como solto, e não como erro", () => {
    // A pasta pode ter sido dissolvida em outra aba enquanto esta lia.
    const rail = composeRail(
      [server("a")],
      [],
      [{ serverId: "a", folderId: "sumiu", position: 0 }],
    );

    expect(names(rail)).toEqual(["a"]);
  });

  it("mantém a pasta vazia na barra", () => {
    const rail = composeRail([], [folder("f", 0)], []);
    expect(names(rail)).toEqual(["f[]"]);
  });
});

describe("flattenRail", () => {
  it("devolve o arranjo no formato que o banco grava", () => {
    const rail = composeRail(
      [server("a"), server("b"), server("c")],
      [folder("f1", 1)],
      [
        { serverId: "a", position: 0 },
        { serverId: "b", folderId: "f1", position: 0 },
        { serverId: "c", folderId: "f1", position: 1 },
      ],
    );

    expect(flattenRail(rail)).toEqual({
      folders: [{ id: "f1", position: 1 }],
      servers: [
        { id: "a", folder_id: null, position: 0 },
        { id: "b", folder_id: "f1", position: 0 },
        { id: "c", folder_id: "f1", position: 1 },
      ],
    });
  });

  it("sobrevive a uma volta completa", () => {
    const original = composeRail(
      [server("a"), server("b")],
      [folder("f", 0)],
      [
        { serverId: "a", folderId: "f", position: 0 },
        { serverId: "b", position: 1 },
      ],
    );
    const flat = flattenRail(original);
    const again = composeRail(
      [server("a"), server("b")],
      [folder("f", flat.folders[0].position)],
      flat.servers.map((entry) => ({
        serverId: entry.id,
        folderId: entry.folder_id ?? undefined,
        position: entry.position,
      })),
    );

    expect(names(again)).toEqual(names(original));
  });
});

describe("moveEntry", () => {
  it("move preservando o resto da ordem", () => {
    expect(moveEntry(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveEntry(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
  });

  it("não faz nada quando a origem é o destino", () => {
    const items = ["a", "b"];
    expect(moveEntry(items, 1, 1)).toBe(items);
  });

  it("ignora índice fora da lista", () => {
    const items = ["a"];
    expect(moveEntry(items, 5, 0)).toBe(items);
  });
});
