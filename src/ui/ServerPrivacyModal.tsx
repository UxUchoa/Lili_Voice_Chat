import { useEffect } from "react";
import type { ServerPrivacy } from "../services/online/contacts";
import { IconX } from "./icons";
import { ModalPortal } from "./ModalPortal";

interface Toggle {
  key: keyof Omit<ServerPrivacy, "serverId">;
  title: string;
  description: string;
}

const TOGGLES: Toggle[] = [
  {
    key: "allowDirectMessages",
    title: "Mensagens diretas",
    description: "Permitir DMs de outros membros deste servidor.",
  },
  {
    key: "filterMessageRequests",
    title: "Solicitações de mensagens",
    description:
      "Filtrar mensagens de membros do servidor que você talvez não conheça.",
  },
  {
    key: "shareActivity",
    title: "Compartilhar minha atividade",
    description:
      "Mostrar aos membros deste servidor quando você está em uma chamada ou compartilhando a tela.",
  },
  {
    key: "allowActivityJoin",
    title: "Participar de atividades",
    description:
      "Permite que membros entrem na chamada em que você está neste servidor.",
  },
];

export function ServerPrivacyModal({
  serverName,
  privacy,
  onChange,
  onClose,
}: {
  serverName: string;
  privacy: Omit<ServerPrivacy, "serverId">;
  onChange: (changes: Partial<Omit<ServerPrivacy, "serverId">>) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [onClose]);

  return (
    <ModalPortal>
      <div className="modal-backdrop" onClick={onClose}>
      <section
        className="privacy-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Configurações de privacidade de ${serverName}`}
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <h2>Config. de privacidade — {serverName}</h2>
          <button
            className="icon-button"
            aria-label="Fechar"
            onClick={onClose}
          >
            <IconX size={20} />
          </button>
        </header>
        <div className="privacy-toggles">
          {TOGGLES.map((toggle) => (
            <label className="privacy-toggle" key={toggle.key}>
              <span>
                <b>{toggle.title}</b>
                <small>{toggle.description}</small>
              </span>
              <input
                type="checkbox"
                role="switch"
                checked={privacy[toggle.key]}
                onChange={(event) =>
                  onChange({ [toggle.key]: event.target.checked })
                }
              />
              <i className="switch-track" aria-hidden="true" />
            </label>
          ))}
        </div>
        <button className="primary-button" onClick={onClose}>
          Pronto
        </button>
      </section>
      </div>
    </ModalPortal>
  );
}
