import { useEffect, useRef, useState } from "react";
import { IconPencil, IconTrash, IconUpload } from "./icons";
import { MediaCropModal } from "./MediaCropModal";
import { serverColor, serverMonogram } from "./ServerIcon";
import {
  SERVER_ICON_MAX_BYTES,
  assertServerIconFile,
} from "../services/online/servers";

export interface ServerProfileDraft {
  name: string;
  description: string;
  /** Imagem recortada aguardando envio. */
  icon: Blob | null;
  /** URL de preview do ícone atual ou do recorte pendente. */
  iconPreview: string;
  /** O usuário pediu para remover o ícone que já estava salvo. */
  removeIcon: boolean;
}

export const emptyServerProfileDraft = (
  overrides: Partial<ServerProfileDraft> = {},
): ServerProfileDraft => ({
  name: "",
  description: "",
  icon: null,
  iconPreview: "",
  removeIcon: false,
  ...overrides,
});

const ACCEPTED = "image/jpeg,image/png,image/webp,image/gif";

/**
 * Campos do perfil do servidor, compartilhados entre o modal de criação e as
 * configurações. Manter um componente só evita que criar e editar divirjam —
 * as mesmas validações, o mesmo recorte e o mesmo preview nos dois lugares.
 */
export function ServerProfileFields({
  draft,
  onChange,
  disabled = false,
  nameError = "",
  autoFocusName = false,
}: {
  draft: ServerProfileDraft;
  onChange: (next: ServerProfileDraft) => void;
  disabled?: boolean;
  nameError?: string;
  autoFocusName?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [iconError, setIconError] = useState("");
  // O preview vive numa object URL; sem revogar, trocar de imagem várias
  // vezes deixaria blobs presos na memória da aba.
  const ownedPreviewRef = useRef("");

  useEffect(
    () => () => {
      if (ownedPreviewRef.current) URL.revokeObjectURL(ownedPreviewRef.current);
    },
    [],
  );

  const setPreview = (blob: Blob | null) => {
    if (ownedPreviewRef.current) URL.revokeObjectURL(ownedPreviewRef.current);
    ownedPreviewRef.current = blob ? URL.createObjectURL(blob) : "";
    return ownedPreviewRef.current;
  };

  const chooseFile = (file: File | null) => {
    setIconError("");
    if (!file) return;
    try {
      assertServerIconFile(file);
    } catch (caught) {
      setIconError(
        caught instanceof Error ? caught.message : "Imagem não suportada.",
      );
      return;
    }
    setPendingFile(file);
  };

  const applyCrop = (blob: Blob) => {
    setPendingFile(null);
    // O recorte sai do canvas como JPEG/PNG; revalidar garante que o
    // resultado ainda cabe no limite do bucket.
    try {
      assertServerIconFile(blob as Blob & { name?: string });
    } catch (caught) {
      setIconError(
        caught instanceof Error ? caught.message : "Imagem não suportada.",
      );
      return;
    }
    onChange({
      ...draft,
      icon: blob,
      iconPreview: setPreview(blob),
      removeIcon: false,
    });
  };

  const clearIcon = () => {
    setIconError("");
    onChange({
      ...draft,
      icon: null,
      iconPreview: setPreview(null),
      removeIcon: true,
    });
  };

  const monogram = serverMonogram(draft.name || "Servidor");

  return (
    <div className="server-profile-fields">
      <div className="server-icon-editor">
        <div
          className="server-icon-preview"
          style={{ "--server-icon-color": serverColor(draft.name) } as never}
        >
          {draft.iconPreview ? (
            <img src={draft.iconPreview} alt="Pré-visualização do ícone" />
          ) : (
            <b>{monogram}</b>
          )}
        </div>
        <div className="server-icon-actions">
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPTED}
            className="visually-hidden-input"
            aria-label="Escolher ícone do servidor"
            disabled={disabled}
            onChange={(event) => {
              chooseFile(event.target.files?.[0] ?? null);
              // Permite reescolher o mesmo arquivo depois de cancelar.
              event.target.value = "";
            }}
          />
          <button
            type="button"
            className="outline-button"
            disabled={disabled}
            onClick={() => fileRef.current?.click()}
          >
            {draft.iconPreview ? (
              <>
                <IconPencil size={17} /> Trocar ícone
              </>
            ) : (
              <>
                <IconUpload size={17} /> Enviar ícone
              </>
            )}
          </button>
          {draft.iconPreview && (
            <button
              type="button"
              className="outline-button danger-text"
              disabled={disabled}
              onClick={clearIcon}
            >
              <IconTrash size={17} /> Remover
            </button>
          )}
          <small>
            JPEG, PNG, WebP ou GIF · até{" "}
            {Math.round(SERVER_ICON_MAX_BYTES / (1024 * 1024))} MB
          </small>
          {iconError && (
            <p className="field-error" role="alert">
              {iconError}
            </p>
          )}
        </div>
      </div>
      <label className="server-profile-field">
        <span>
          Nome do servidor <em aria-hidden="true">*</em>
        </span>
        <input
          autoFocus={autoFocusName}
          value={draft.name}
          maxLength={100}
          disabled={disabled}
          aria-invalid={Boolean(nameError)}
          aria-describedby={nameError ? "server-name-error" : undefined}
          placeholder="Equipe Janja"
          onChange={(event) => onChange({ ...draft, name: event.target.value })}
        />
        {nameError && (
          <p className="field-error" id="server-name-error" role="alert">
            {nameError}
          </p>
        )}
      </label>
      <label className="server-profile-field">
        <span>Descrição</span>
        <textarea
          rows={3}
          value={draft.description}
          maxLength={1000}
          disabled={disabled}
          placeholder="Conte em uma linha do que se trata este servidor."
          onChange={(event) =>
            onChange({ ...draft, description: event.target.value })
          }
        />
        <small>{draft.description.trim().length}/1000</small>
      </label>
      {pendingFile && (
        <MediaCropModal
          file={pendingFile}
          kind="server"
          onCancel={() => setPendingFile(null)}
          onConfirm={applyCrop}
        />
      )}
    </div>
  );
}
