import type { CSSProperties } from "react";
import type { Server } from "../domain/types";

/**
 * Ícone do servidor. Sem imagem própria ele mostra o monograma do nome, como
 * no Discord — antes todos os servidores apareciam com o logotipo do produto
 * e ficavam indistinguíveis na barra lateral.
 */

export function serverMonogram(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return words
    .slice(0, 3)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

const PALETTE = ["#f00c14", "#ffb020", "#7c5cff", "#23c483", "#2d9cdb"];

export function serverColor(id: string) {
  if (!id) return PALETTE[0];
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) % 997;
  return PALETTE[hash % PALETTE.length];
}

export function ServerIcon({
  server,
  size = 44,
  className = "",
}: {
  server: Pick<Server, "id" | "name" | "iconUrl">;
  size?: number;
  className?: string;
}) {
  const style = {
    "--server-icon-size": `${size}px`,
    "--server-icon-color": serverColor(server.id),
  } as CSSProperties;
  return (
    <span className={`server-icon ${className}`} style={style}>
      {server.iconUrl ? (
        <img src={server.iconUrl} alt="" />
      ) : (
        <b>{serverMonogram(server.name)}</b>
      )}
    </span>
  );
}
