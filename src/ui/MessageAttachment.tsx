import { useEffect, useRef, useState, type ReactElement } from "react";
import type { MessagePayload } from "../domain/types";
import {
  ATTACHMENT_AUTOPLAY_MAX_BYTES,
  attachmentKind,
  attachmentTimeLeft,
  formatBytes,
  isAttachmentExpired,
} from "../domain/attachments";
import { MediaLightbox } from "./MediaLightbox";
import { VoicePlayer } from "./VoicePlayer";
import { isVoiceMessage } from "../domain/voiceMessage";
import { IconClock, IconDownload, IconEyeOff, IconPaperclip } from "./icons";

type Attachment = MessagePayload["attachments"][number];

export interface AttachmentResendState {
  /** Pedido em aberto para este anexo, se houver. */
  requestId?: string;
  requesterName?: string;
  /** Se o pedido foi feito por quem está vendo agora. */
  mine: boolean;
}

/**
 * Um anexo dentro da mensagem.
 *
 * Imagem, vídeo e áudio aparecem tocáveis ali mesmo; o resto continua um
 * botão de download. O arquivo vive 24 h no servidor — passado esse prazo a
 * caixa vira o pedido de reenvio, porque não existe mais nada para baixar.
 */
export function MessageAttachment({
  attachment,
  createdAt,
  isAuthor,
  resend,
  onOpen,
  onDownload,
  onRequestResend,
  onResolveResend,
}: {
  attachment: Attachment;
  createdAt: string;
  isAuthor: boolean;
  resend?: AttachmentResendState;
  /** Baixa e devolve o blob do anexo. */
  onOpen: (attachment: Attachment) => Promise<Blob>;
  onDownload: (attachment: Attachment) => void;
  onRequestResend: (attachment: Attachment) => void;
  onResolveResend: (requestId: string) => void;
}) {
  const kind = attachmentKind(attachment.mime);
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [missing, setMissing] = useState(false);
  const [lightbox, setLightbox] = useState(false);
  /**
   * Item 13 — revelado é decisão de quem lê, e não sai deste cliente.
   * Sincronizar entre dispositivos não daria nada a ninguém: revelar no
   * celular não deveria revelar no desktop de quem está acompanhado.
   */
  const [revealed, setRevealed] = useState(false);
  const covered = Boolean(attachment.spoiler) && !revealed;
  const urlRef = useRef("");
  // O relógio local diz quando o prazo acabou, mas o arquivo pode ter saído
  // antes — a limpeza roda em lote e o download é a fonte da verdade.
  const expired = isAttachmentExpired(createdAt) || missing;

  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  const load = async () => {
    if (url || loading) return;
    setLoading(true);
    setError("");
    try {
      const blob = await onOpen(attachment);
      const next = URL.createObjectURL(blob);
      urlRef.current = next;
      setUrl(next);
    } catch (caught) {
      const message =
        caught instanceof Error
          ? caught.message
          : typeof (caught as { message?: unknown })?.message === "string"
            ? String((caught as { message: string }).message)
            : "";
      if (/not found|404|no such|does not exist/i.test(message))
        setMissing(true);
      else setError(message || "Não foi possível abrir o anexo.");
    } finally {
      setLoading(false);
    }
  };

  // Arquivos pequenos abrem sozinhos; os grandes esperam um clique, porque
  // exibir exige baixar o arquivo inteiro.
  const previewable = kind !== "file" && !expired;
  const autoLoad =
    previewable && attachment.size <= ATTACHMENT_AUTOPLAY_MAX_BYTES;
  useEffect(() => {
    if (autoLoad) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLoad, attachment.id]);

  if (expired) {
    return (
      <div className="attachment attachment-expired">
        <IconClock className="attachment-expired-icon" size={18} />
        <span>
          <b>{attachment.name}</b>
          <small>
            {missing && !isAttachmentExpired(createdAt)
              ? `Não está mais no servidor · ${formatBytes(attachment.size)}`
              : `Expirou depois de 24 h · ${formatBytes(attachment.size)}`}
          </small>
        </span>
        {resend?.requestId ? (
          isAuthor ? (
            <span className="attachment-resend-note">
              <b>{resend.requesterName ?? "Alguém"} pediu o reenvio</b>
              <button
                className="outline-button"
                onClick={() => onResolveResend(resend.requestId!)}
              >
                Já reenviei
              </button>
            </span>
          ) : (
            <span className="attachment-resend-note">
              <b>{resend.mine ? "Reenvio pedido" : "Reenvio já pedido"}</b>
            </span>
          )
        ) : isAuthor ? (
          <small className="attachment-resend-note">
            Envie de novo se alguém precisar.
          </small>
        ) : (
          <button
            className="outline-button"
            onClick={() => onRequestResend(attachment)}
          >
            Solicitar reenvio
          </button>
        )}
      </div>
    );
  }

  const meta = (
    <small>
      {formatBytes(attachment.size)} · {attachmentTimeLeft(createdAt)}
    </small>
  );

  /**
   * Envolve o anexo marcado como spoiler.
   *
   * A mídia continua montada e no tamanho real por baixo do desfoque: trocar
   * por uma caixa genérica fazia a mensagem pular de altura ao revelar, e o
   * vídeo perdia as dimensões que o próprio arquivo define.
   *
   * Enquanto coberto o conteúdo fica `inert`. Só esconder no CSS deixaria o
   * botão de download por baixo ainda alcançável pelo teclado.
   */
  const withSpoiler = (content: ReactElement) =>
    attachment.spoiler ? (
      <div className={`attachment-spoiler${covered ? " is-covered" : ""}`}>
        <div className="attachment-spoiler-content" inert={covered}>
          {content}
        </div>
        {covered ? (
          <button
            className="attachment-spoiler-reveal"
            onClick={() => setRevealed(true)}
            aria-label={`Mostrar ${attachment.name}, marcado como spoiler`}
          >
            <b>SPOILER</b>
          </button>
        ) : (
          <button
            className="attachment-spoiler-hide"
            onClick={() => setRevealed(false)}
            title="Marcar como spoiler de novo"
            aria-label={`Ocultar ${attachment.name} de novo`}
          >
            <IconEyeOff size={16} />
          </button>
        )}
      </div>
    ) : (
      content
    );

  // Mensagem de voz tem player proprio: a barra generica de audio nao mostra
  // velocidade nem trata a duracao ausente que o `MediaRecorder` deixa no
  // cabecalho. Audio que a pessoa subiu como arquivo continua no caminho comum.
  if (isVoiceMessage(attachment))
    return withSpoiler(
      <VoicePlayer
        name={attachment.name}
        onResolveUrl={async () =>
          URL.createObjectURL(await onOpen(attachment))
        }
      />,
    );

  if (kind === "image" || kind === "video" || kind === "audio") {
    return withSpoiler(
      <div className={`attachment-media attachment-media-${kind}`}>
        {url ? (
          kind === "image" ? (
            <button
              className="attachment-image"
              onClick={() => setLightbox(true)}
              aria-label={`Abrir ${attachment.name}`}
            >
              {/* Sem `loading="lazy"`: os bytes já estão em memória, então
                  adiar não economiza nada — e a URL do blob pode ser revogada
                  antes de o carregamento preguiçoso começar, deixando uma
                  imagem quebrada que nunca dispara `error`. */}
              <img
                src={url}
                alt={attachment.name}
                onError={() => setMissing(true)}
              />
            </button>
          ) : kind === "video" ? (
            <video
              src={url}
              controls
              playsInline
              preload="metadata"
              onError={() => setMissing(true)}
            />
          ) : (
            <audio
              src={url}
              controls
              preload="metadata"
              onError={() => setMissing(true)}
            />
          )
        ) : (
          <button
            className="attachment-placeholder"
            disabled={loading}
            onClick={() => void load()}
          >
            {loading
              ? "Carregando…"
              : error
                ? "Tentar de novo"
                : `Carregar ${kind === "image" ? "imagem" : kind === "video" ? "vídeo" : "áudio"} · ${formatBytes(attachment.size)}`}
          </button>
        )}
        <div className="attachment-media-meta">
          <b>{attachment.name}</b>
          {meta}
          <button
            className="attachment-download"
            title="Salvar"
            aria-label={`Salvar ${attachment.name}`}
            onClick={() => onDownload(attachment)}
          >
            <IconDownload size={16} />
          </button>
        </div>
        {error && (
          <small className="attachment-error" role="alert">
            {error}
          </small>
        )}
        {lightbox && url && (
          <MediaLightbox
            media={{
              url,
              name: attachment.name,
              mime: attachment.mime,
              size: attachment.size,
            }}
            onClose={() => setLightbox(false)}
            onDownload={() => onDownload(attachment)}
          />
        )}
      </div>,
    );
  }

  return withSpoiler(
    <button
      className="attachment"
      onClick={() => onDownload(attachment)}
      title={`Salvar ${attachment.name}`}
    >
      <IconPaperclip className="attachment-icon" size={20} />
      <span>
        <b>{attachment.name}</b>
        {meta}
      </span>
      <IconDownload className="attachment-arrow" size={18} />
    </button>,
  );
}
