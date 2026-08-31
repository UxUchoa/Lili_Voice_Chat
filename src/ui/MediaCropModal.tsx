import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { IconReset, IconX, IconZoomIn, IconZoomOut } from "./icons";
import { ModalPortal } from "./ModalPortal";

// Editor de recorte para avatar (1:1, máscara circular) e banner (proporção
// real do cabeçalho de perfil). O resultado exportado usa exatamente a mesma
// matemática do preview, então o que se vê é o que é salvo.

const VIEWPORTS = {
  avatar: { width: 320, height: 320, outWidth: 512, outHeight: 512 },
  banner: { width: 480, height: 192, outWidth: 1200, outHeight: 480 },
  // Ícone de servidor: mesmo quadrado do avatar, com máscara de quadrado
  // arredondado — é assim que ele aparece na barra de servidores.
  server: { width: 320, height: 320, outWidth: 512, outHeight: 512 },
} as const;

const CROP_LABELS = {
  avatar: { eyebrow: "EDITAR AVATAR", title: "Ajuste sua foto de perfil" },
  banner: { eyebrow: "EDITAR BANNER", title: "Ajuste seu banner" },
  server: { eyebrow: "ÍCONE DO SERVIDOR", title: "Ajuste o ícone" },
} as const;

const MAX_ZOOM = 4;

interface CropState {
  zoom: number;
  offsetX: number;
  offsetY: number;
}

export function MediaCropModal({
  file,
  kind,
  busy = false,
  onCancel,
  onConfirm,
}: {
  file: File;
  kind: "avatar" | "banner" | "server";
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (blob: Blob) => void;
}) {
  const viewport = VIEWPORTS[kind];
  const [image, setImage] = useState<ImageBitmap | null>(null);
  const [loadError, setLoadError] = useState("");
  const [crop, setCrop] = useState<CropState>({
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
  });
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    baseOffsetX: number;
    baseOffsetY: number;
  } | null>(null);

  useEffect(() => {
    let disposed = false;
    let bitmap: ImageBitmap | undefined;
    // createImageBitmap respeita a orientação EXIF do arquivo original.
    createImageBitmap(file, { imageOrientation: "from-image" })
      .then((created) => {
        if (disposed) {
          created.close();
          return;
        }
        bitmap = created;
        setImage(created);
        setCrop({ zoom: 1, offsetX: 0, offsetY: 0 });
      })
      .catch(() =>
        setLoadError("Não foi possível abrir esta imagem. Tente outro arquivo."),
      );
    return () => {
      disposed = true;
      bitmap?.close();
    };
  }, [file]);

  // Escala mínima em que a imagem cobre todo o viewport (impede áreas vazias).
  const coverScale = useMemo(() => {
    if (!image) return 1;
    return Math.max(viewport.width / image.width, viewport.height / image.height);
  }, [image, viewport.height, viewport.width]);

  const clampOffsets = useCallback(
    (state: CropState): CropState => {
      if (!image) return state;
      const scale = coverScale * state.zoom;
      const maxX = Math.max(0, (image.width * scale - viewport.width) / 2);
      const maxY = Math.max(0, (image.height * scale - viewport.height) / 2);
      return {
        zoom: state.zoom,
        offsetX: Math.min(maxX, Math.max(-maxX, state.offsetX)),
        offsetY: Math.min(maxY, Math.max(-maxY, state.offsetY)),
      };
    },
    [coverScale, image, viewport.height, viewport.width],
  );

  // O zoom é sempre derivado do estado corrente: calcular a partir do valor
  // capturado no render fazia cliques rápidos no +/- perderem passos.
  const setZoom = useCallback(
    (next: number | ((current: number) => number)) =>
      setCrop((current) =>
        clampOffsets({
          ...current,
          zoom: Math.min(
            MAX_ZOOM,
            Math.max(
              1,
              typeof next === "function" ? next(current.zoom) : next,
            ),
          ),
        }),
      ),
    [clampOffsets],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const scale = coverScale * crop.zoom;
    context.clearRect(0, 0, viewport.width, viewport.height);
    context.imageSmoothingQuality = "high";
    context.drawImage(
      image,
      viewport.width / 2 - (image.width * scale) / 2 + crop.offsetX,
      viewport.height / 2 - (image.height * scale) / 2 + crop.offsetY,
      image.width * scale,
      image.height * scale,
    );
  }, [coverScale, crop, image, viewport.height, viewport.width]);

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      baseOffsetX: crop.offsetX,
      baseOffsetY: crop.offsetY,
    };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setCrop((current) =>
      clampOffsets({
        ...current,
        offsetX: drag.baseOffsetX + (event.clientX - drag.startX),
        offsetY: drag.baseOffsetY + (event.clientY - drag.startY),
      }),
    );
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  };
  const onWheel = (event: ReactWheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.08 : 1 / 1.08;
    setZoom((current) => current * factor);
  };

  const exportCrop = async () => {
    if (!image) return;
    const scale = coverScale * crop.zoom;
    const sourceWidth = viewport.width / scale;
    const sourceHeight = viewport.height / scale;
    const sourceX = image.width / 2 - sourceWidth / 2 - crop.offsetX / scale;
    const sourceY = image.height / 2 - sourceHeight / 2 - crop.offsetY / scale;
    const output = document.createElement("canvas");
    output.width = viewport.outWidth;
    output.height = viewport.outHeight;
    const context = output.getContext("2d");
    if (!context) return;
    context.imageSmoothingQuality = "high";
    context.drawImage(
      image,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      viewport.outWidth,
      viewport.outHeight,
    );
    const mime = file.type === "image/png" ? "image/png" : "image/jpeg";
    const blob = await new Promise<Blob | null>((resolve) =>
      output.toBlob(resolve, mime, 0.92),
    );
    if (blob) onConfirm(blob);
  };

  return (
    <ModalPortal>
      <div className="modal-backdrop crop-backdrop" onClick={onCancel}>
      <section
        className="crop-modal"
        role="dialog"
        aria-modal="true"
        aria-label={CROP_LABELS[kind].title}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="crop-header">
          <div>
            <span className="eyebrow">{CROP_LABELS[kind].eyebrow}</span>
            <h2>{CROP_LABELS[kind].title}</h2>
          </div>
          <button
            className="icon-button"
            aria-label="Cancelar edição"
            onClick={onCancel}
          >
            <IconX size={20} />
          </button>
        </header>
        {loadError ? (
          <p className="crop-error" role="alert">
            {loadError}
          </p>
        ) : (
          <>
            <div
              className={`crop-stage ${kind === "avatar" ? "crop-stage-avatar" : ""} ${kind === "server" ? "crop-stage-server" : ""}`}
              style={{ width: viewport.width, height: viewport.height }}
            >
              <canvas
                ref={canvasRef}
                width={viewport.width}
                height={viewport.height}
                className="crop-canvas"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onWheel={onWheel}
              />
              {kind === "avatar" && (
                <div className="crop-circle-mask" aria-hidden="true" />
              )}
              {kind === "server" && (
                <div className="crop-square-mask" aria-hidden="true" />
              )}
            </div>
            <div className="crop-zoom-row">
              <button
                className="icon-button"
                aria-label="Diminuir zoom"
                onClick={() => setZoom((current) => current / 1.2)}
              >
                <IconZoomOut size={20} />
              </button>
              <input
                type="range"
                aria-label="Zoom"
                min={1}
                max={MAX_ZOOM}
                step={0.01}
                value={crop.zoom}
                onChange={(event) => setZoom(Number(event.target.value))}
              />
              <button
                className="icon-button"
                aria-label="Aumentar zoom"
                onClick={() => setZoom((current) => current * 1.2)}
              >
                <IconZoomIn size={20} />
              </button>
              <button
                className="icon-button"
                aria-label="Redefinir enquadramento"
                title="Redefinir"
                onClick={() => setCrop({ zoom: 1, offsetX: 0, offsetY: 0 })}
              >
                <IconReset size={20} />
              </button>
            </div>
            <p className="crop-hint">
              Arraste para reposicionar · role para ajustar o zoom
            </p>
          </>
        )}
        <footer className="crop-actions">
          <button className="outline-button" onClick={onCancel} disabled={busy}>
            Cancelar
          </button>
          <button
            className="primary-button"
            onClick={() => void exportCrop()}
            disabled={busy || !image}
          >
            {busy ? "Enviando…" : "Aplicar"}
          </button>
        </footer>
      </section>
      </div>
    </ModalPortal>
  );
}
