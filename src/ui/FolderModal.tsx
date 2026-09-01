import { useEffect, useRef, useState } from "react";
import { ModalPortal } from "./ModalPortal";
import type { ServerFolder } from "../domain/serverLayout";

/** Paleta curta: cor de pasta é etiqueta, não personalização livre. */
const COLORS = [
  { value: "", label: "Padrão" },
  { value: "#f00c14", label: "Vermelho" },
  { value: "#fbc605", label: "Amarelo" },
  { value: "#22c55e", label: "Verde" },
  { value: "#3b82f6", label: "Azul" },
  { value: "#a855f7", label: "Roxo" },
];

/**
 * Renomear, colorir ou dissolver uma pasta.
 *
 * Dissolver devolve os servidores ao topo e não remove nenhum: pasta é
 * organização, não pertencimento. O texto do botão diz isso, para ninguém
 * hesitar achando que vai sair dos servidores junto.
 */
export function FolderModal({
  folder,
  onSave,
  onDissolve,
  onClose,
}: {
  folder: ServerFolder;
  onSave: (name: string, color: string | null) => void;
  onDissolve: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(folder.name);
  const [color, setColor] = useState(folder.color ?? "");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const invalid = !name.trim();

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const accept = () => {
    if (invalid) return;
    onSave(name.trim(), color || null);
    onClose();
  };

  return (
    <ModalPortal>
      <div
        className="modal-backdrop confirm-backdrop"
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <div
          className="confirm-modal folder-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="folder-modal-title"
        >
          <h2 id="folder-modal-title">Pasta de servidores</h2>
          <label className="folder-modal-field">
            <span>Nome</span>
            <input
              ref={inputRef}
              value={name}
              maxLength={60}
              aria-label="Nome da pasta"
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") accept();
              }}
            />
          </label>
          <fieldset className="folder-modal-colors">
            <legend>Cor</legend>
            {COLORS.map((option) => (
              <label key={option.value || "default"}>
                <input
                  type="radio"
                  name="folder-color"
                  checked={color === option.value}
                  onChange={() => setColor(option.value)}
                />
                <span
                  className="folder-swatch"
                  style={
                    option.value ? { background: option.value } : undefined
                  }
                  aria-label={option.label}
                  title={option.label}
                />
              </label>
            ))}
          </fieldset>
          <div className="confirm-actions folder-modal-actions">
            <button
              className="outline-button danger-text"
              onClick={() => {
                onDissolve();
                onClose();
              }}
            >
              Dissolver pasta
            </button>
            <span className="folder-modal-spacer" />
            <button className="outline-button" onClick={onClose}>
              Cancelar
            </button>
            <button
              className="primary-button"
              disabled={invalid}
              onClick={accept}
            >
              Salvar
            </button>
          </div>
          <small className="folder-modal-note">
            Dissolver devolve os servidores para a barra. Nenhum servidor é
            removido.
          </small>
        </div>
      </div>
    </ModalPortal>
  );
}
