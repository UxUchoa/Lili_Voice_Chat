import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Monta o modal direto no `body`.
 *
 * Um modal aberto de dentro de outro (o editor de canal a partir das
 * configurações do servidor, o recorte de imagem a partir do modal de
 * criação) herdava o bloco de contenção do pai: `.modal-backdrop` usa
 * `backdrop-filter`, e isso faz qualquer descendente `position: fixed`
 * passar a se posicionar em relação a ele — o filho nascia deslocado pelo
 * padding do pai e a barra de ações ficava fora da tela.
 */
export function ModalPortal({ children }: { children: ReactNode }) {
  const [host] = useState(() =>
    typeof document === "undefined" ? null : document.createElement("div"),
  );

  useEffect(() => {
    if (!host) return;
    host.className = "modal-portal";
    document.body.append(host);
    return () => host.remove();
  }, [host]);

  if (!host) return null;
  return createPortal(children, host);
}
