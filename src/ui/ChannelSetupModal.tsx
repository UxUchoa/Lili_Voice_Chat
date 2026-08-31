import { useEffect, useMemo, useState } from "react";
import type { Channel } from "../domain/types";
import { IconHash, IconVolume, IconX } from "./icons";
import { createOnlineChannel } from "../services/online/data";
import { ModalPortal } from "./ModalPortal";

export type NewChannelKind = "text" | "voice" | "category";

const KINDS: Array<{
  kind: NewChannelKind;
  title: string;
  description: string;
  icon: typeof IconHash;
}> = [
  {
    kind: "text",
    title: "Texto",
    description: "Converse por mensagens, anexos e menções.",
    icon: IconHash,
  },
  {
    kind: "voice",
    title: "Voz",
    description: "Fale por áudio, vídeo e compartilhamento de tela.",
    icon: IconVolume,
  },
];

/**
 * Canais de texto do Discord usam nomes em minúsculas com hífen. Normalizar
 * enquanto a pessoa digita evita a surpresa de ver o nome mudar depois de
 * salvo.
 */
export function channelSlug(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9-\s]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-")
    .slice(0, 100);
}

/**
 * Criação de canal com tipo, nome, categoria e privacidade — nada é criado
 * antes de a pessoa confirmar. Antes o "+" criava na hora um `novo-canal-3`
 * que precisava ser renomeado depois.
 */
export function ChannelSetupModal({
  serverId,
  categories,
  defaultKind = "text",
  defaultCategoryId = "",
  allowCategory = true,
  onClose,
  onCreated,
}: {
  serverId: string;
  categories: Channel[];
  defaultKind?: NewChannelKind;
  defaultCategoryId?: string;
  /** Permite criar categorias por este mesmo modal. */
  allowCategory?: boolean;
  onClose: () => void;
  onCreated: (channelId: string, kind: NewChannelKind) => void;
}) {
  const [kind, setKind] = useState<NewChannelKind>(defaultKind);
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState(defaultCategoryId);
  const [isPrivate, setIsPrivate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [busy, onClose]);

  const displayName = useMemo(
    () => (kind === "text" ? channelSlug(name) : name.slice(0, 100)),
    [kind, name],
  );
  const nameInvalid = name.length > 0 && !displayName.trim();

  const create = async () => {
    const finalName = displayName.trim();
    if (!finalName) {
      setError("Informe um nome para o canal.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const channelId = await createOnlineChannel({
        serverId,
        name: finalName,
        kind,
        parentId: kind === "category" ? undefined : categoryId || undefined,
        private: kind === "category" ? isPrivate : isPrivate,
      });
      onCreated(channelId, kind);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Não foi possível criar o canal.",
      );
    } finally {
      setBusy(false);
    }
  };

  const parentCategory = categories.find((item) => item.id === categoryId);

  return (
    <ModalPortal>
      <div className="modal-backdrop" role="presentation">
      <section
        className="channel-setup-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="channel-setup-title"
      >
        <header>
          <div>
            <h2 id="channel-setup-title">
              {kind === "category" ? "Criar categoria" : "Criar canal"}
            </h2>
            {parentCategory && kind !== "category" && (
              <p>em {parentCategory.name}</p>
            )}
          </div>
          <button
            className="icon-button"
            aria-label="Fechar"
            disabled={busy}
            onClick={onClose}
          >
            <IconX size={20} />
          </button>
        </header>

        {allowCategory && (
          <div className="channel-kind-picker" role="radiogroup" aria-label="Tipo de canal">
            <span className="eyebrow">TIPO DE CANAL</span>
            {KINDS.map((option) => {
              const Icon = option.icon;
              const selected = kind === option.kind;
              return (
                <button
                  key={option.kind}
                  role="radio"
                  aria-checked={selected}
                  className={`channel-kind ${selected ? "selected" : ""}`}
                  disabled={busy}
                  onClick={() => setKind(option.kind)}
                >
                  <span className="channel-kind-mark" aria-hidden="true" />
                  <Icon size={20} />
                  <span className="channel-kind-copy">
                    <b>{option.title}</b>
                    <small>{option.description}</small>
                  </span>
                </button>
              );
            })}
            <button
              role="radio"
              aria-checked={kind === "category"}
              className={`channel-kind ${kind === "category" ? "selected" : ""}`}
              disabled={busy}
              onClick={() => setKind("category")}
            >
              <span className="channel-kind-mark" aria-hidden="true" />
              <span className="channel-kind-glyph" aria-hidden="true">
                ▾
              </span>
              <span className="channel-kind-copy">
                <b>Categoria</b>
                <small>Agrupe canais e defina permissões de uma vez.</small>
              </span>
            </button>
          </div>
        )}

        <label className="channel-setup-field">
          <span>
            {kind === "category" ? "Nome da categoria" : "Nome do canal"}{" "}
            <em aria-hidden="true">*</em>
          </span>
          <div className="channel-name-input">
            {kind === "text" && <IconHash size={17} />}
            {kind === "voice" && <IconVolume size={17} />}
            <input
              autoFocus
              value={name}
              maxLength={100}
              disabled={busy}
              aria-invalid={nameInvalid}
              placeholder={
                kind === "text"
                  ? "novo-canal"
                  : kind === "voice"
                    ? "Sala de voz"
                    : "Nova categoria"
              }
              onChange={(event) => {
                setName(event.target.value);
                setError("");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && displayName.trim()) void create();
              }}
            />
          </div>
          {kind === "text" && displayName && displayName !== name && (
            <small className="channel-name-preview">
              Será criado como <b>#{displayName}</b>
            </small>
          )}
          {nameInvalid && (
            <p className="field-error" role="alert">
              Use letras, números ou hífens.
            </p>
          )}
        </label>

        {kind !== "category" && categories.length > 0 && (
          <label className="channel-setup-field">
            <span>Categoria</span>
            <select
              value={categoryId}
              disabled={busy}
              onChange={(event) => setCategoryId(event.target.value)}
            >
              <option value="">Sem categoria</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="channel-private-toggle">
          <span>
            <b>
              {kind === "category" ? "Categoria privada" : "Canal privado"}
            </b>
            <small>
              {kind === "voice"
                ? "Somente cargos e membros autorizados poderão ver e entrar."
                : "Somente cargos e membros autorizados poderão ver este canal."}
            </small>
          </span>
          <input
            type="checkbox"
            role="switch"
            checked={isPrivate}
            disabled={busy}
            onChange={(event) => setIsPrivate(event.target.checked)}
          />
          <i className="switch-track" aria-hidden="true" />
        </label>

        {error && (
          <div className="auth-error" role="alert">
            {error}
          </div>
        )}

        <footer className="channel-setup-actions">
          <button className="outline-button" disabled={busy} onClick={onClose}>
            Cancelar
          </button>
          <button
            className="primary-button"
            disabled={busy || !displayName.trim()}
            onClick={() => void create()}
          >
            {busy
              ? "Criando…"
              : kind === "category"
                ? "Criar categoria"
                : "Criar canal"}
          </button>
        </footer>
      </section>
      </div>
    </ModalPortal>
  );
}
