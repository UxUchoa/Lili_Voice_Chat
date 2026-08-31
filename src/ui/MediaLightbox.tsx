import { useEffect } from "react";
import { ModalPortal } from "./ModalPortal";
import { formatBytes } from "../domain/attachments";

export interface LightboxMedia {
  url: string;
  name: string;
  mime: string;
  size: number;
}

/** Tela cheia para imagem ou vídeo, com salvar e fechar. */
export function MediaLightbox({
  media,
  onClose,
  onDownload,
}: {
  media: LightboxMedia;
  onClose: () => void;
  onDownload: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const isVideo = media.mime.startsWith("video/");

  return (
    <ModalPortal>
      <div
        className="modal-backdrop lightbox-backdrop"
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <div className="lightbox" role="dialog" aria-label={media.name}>
          <div className="lightbox-stage">
            {isVideo ? (
              // `controls` sem `autoPlay`: abrir o visualizador não deve
              // começar a tocar som sozinho.
              <video src={media.url} controls playsInline />
            ) : (
              <img src={media.url} alt={media.name} />
            )}
          </div>
          <div className="lightbox-bar">
            <span>
              <b>{media.name}</b>
              <small>{formatBytes(media.size)}</small>
            </span>
            <button className="outline-button" onClick={onDownload}>
              Salvar
            </button>
            <button
              className="outline-button"
              aria-label="Fechar"
              onClick={onClose}
            >
              Fechar
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
