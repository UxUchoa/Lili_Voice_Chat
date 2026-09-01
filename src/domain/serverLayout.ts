export interface ServerFolder {
  id: string;
  name: string;
  color?: string;
  position: number;
}

export interface ServerPlacement {
  serverId: string;
  folderId?: string;
  position: number;
}

/** O que a barra desenha: ou um servidor solto, ou uma pasta com os dela. */
export type RailEntry<TServer extends { id: string }> =
  | { kind: "server"; server: TServer }
  | { kind: "folder"; folder: ServerFolder; servers: TServer[] };

/**
 * Monta a barra a partir dos servidores e do arranjo salvo.
 *
 * Pastas e servidores soltos dividem o mesmo espaço de posição no topo — é o
 * que permite intercalar os dois. Servidor sem arranjo salvo vai para o fim na
 * ordem em que veio: entrar num servidor novo não pode reorganizar a barra de
 * quem já tinha a dele arrumada, e o servidor também não pode sumir só porque
 * ninguém arrastou ele ainda.
 *
 * Um `folderId` que não existe mais é tratado como solto, e não como erro: a
 * pasta pode ter sido dissolvida em outra aba enquanto esta lia.
 */
export function composeRail<TServer extends { id: string }>(
  servers: TServer[],
  folders: ServerFolder[],
  placements: ServerPlacement[],
): Array<RailEntry<TServer>> {
  const byId = new Map(servers.map((server) => [server.id, server]));
  const knownFolders = new Map(folders.map((folder) => [folder.id, folder]));
  const placementOf = new Map(
    placements.map((placement) => [placement.serverId, placement]),
  );

  const insideFolders = new Map<string, Array<{ server: TServer; at: number }>>();
  const loose: Array<{ server: TServer; at: number }> = [];
  const unplaced: TServer[] = [];

  for (const server of servers) {
    const placement = placementOf.get(server.id);
    if (!placement) {
      unplaced.push(server);
      continue;
    }
    const folderId =
      placement.folderId && knownFolders.has(placement.folderId)
        ? placement.folderId
        : undefined;
    if (folderId) {
      const bucket = insideFolders.get(folderId) ?? [];
      bucket.push({ server, at: placement.position });
      insideFolders.set(folderId, bucket);
    } else {
      loose.push({ server, at: placement.position });
    }
  }

  const byPosition = <T extends { at: number }>(left: T, right: T) =>
    left.at - right.at;

  const top: Array<{ at: number; entry: RailEntry<TServer> }> = [];
  for (const folder of folders)
    top.push({
      at: folder.position,
      entry: {
        kind: "folder",
        folder,
        servers: (insideFolders.get(folder.id) ?? [])
          .sort(byPosition)
          .map((item) => item.server),
      },
    });
  for (const item of loose)
    top.push({ at: item.at, entry: { kind: "server", server: item.server } });

  return [
    ...top.sort(byPosition).map((item) => item.entry),
    ...unplaced.map((server) => ({ kind: "server" as const, server })),
  ].filter(
    // Uma pasta cujo servidor sumiu continua na barra: ela é organização de
    // quem a criou, e apagá-la sozinha perderia o nome e a cor.
    (entry) => entry.kind === "folder" || byId.has(entry.server.id),
  );
}

/** Achata a barra de volta para o formato que o banco grava. */
export function flattenRail<TServer extends { id: string }>(
  entries: Array<RailEntry<TServer>>,
): {
  folders: Array<{ id: string; position: number }>;
  servers: Array<{ id: string; folder_id: string | null; position: number }>;
} {
  const folders: Array<{ id: string; position: number }> = [];
  const servers: Array<{
    id: string;
    folder_id: string | null;
    position: number;
  }> = [];
  entries.forEach((entry, index) => {
    if (entry.kind === "server") {
      servers.push({ id: entry.server.id, folder_id: null, position: index });
      return;
    }
    folders.push({ id: entry.folder.id, position: index });
    entry.servers.forEach((server, inner) => {
      servers.push({
        id: server.id,
        folder_id: entry.folder.id,
        position: inner,
      });
    });
  });
  return { folders, servers };
}

/** Move um item de uma posição para outra, preservando o resto da ordem. */
export function moveEntry<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= items.length) return items;
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, moved);
  return next;
}
