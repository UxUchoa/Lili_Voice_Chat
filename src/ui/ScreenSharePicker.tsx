import { useEffect, useState } from "react";
import { IconMonitor, IconSettings, IconWindow, IconX } from "./icons";

export type ShareResolution = 720 | 1080 | 1440;
export type ShareFrameRate = 15 | 30 | 60;

export interface ShareQuality {
  resolution: ShareResolution;
  frameRate: ShareFrameRate;
}

export interface ShareSelection extends ShareQuality {
  /** Presente apenas no desktop, onde escolhemos a fonte nós mesmos. */
  sourceId?: string;
  sourceName?: string;
}

const RESOLUTIONS: ShareResolution[] = [720, 1080, 1440];
const FRAME_RATES: ShareFrameRate[] = [15, 30, 60];

export function ScreenSharePicker({
  quality,
  onQualityChange,
  onCancel,
  onShare,
}: {
  quality: ShareQuality;
  onQualityChange: (quality: ShareQuality) => void;
  onCancel: () => void;
  onShare: (selection: ShareSelection) => void;
}) {
  const [tab, setTab] = useState<"window" | "screen">("window");
  const [sources, setSources] = useState<LiliScreenSource[] | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const desktop = window.liliDesktop;
    if (!desktop) return;
    let active = true;
    const load = () =>
      void desktop
        .listScreenSources()
        .then((list) => active && setSources(list))
        .catch(
          () =>
            active && setError("Não foi possível listar as janelas abertas."),
        );
    load();
    // As miniaturas envelhecem rápido; atualizamos enquanto o seletor está
    // aberto para o usuário reconhecer a janela certa.
    const timer = window.setInterval(load, 3000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [onCancel]);

  const visible = (sources ?? []).filter((source) => source.kind === tab);

  return (
    <div className="modal-backdrop share-backdrop" onClick={onCancel}>
      <section
        className="share-picker"
        role="dialog"
        aria-modal="true"
        aria-label="Compartilhar tela"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="share-header">
          <div className="share-tabs" role="tablist">
            <button
              role="tab"
              aria-selected={tab === "window"}
              className={tab === "window" ? "active" : ""}
              onClick={() => setTab("window")}
            >
              <IconWindow size={18} />
              Aplicativos
            </button>
            <button
              role="tab"
              aria-selected={tab === "screen"}
              className={tab === "screen" ? "active" : ""}
              onClick={() => setTab("screen")}
            >
              <IconMonitor size={18} />
              Tela inteira
            </button>
          </div>
          <button className="icon-button" aria-label="Fechar" onClick={onCancel}>
            <IconX size={20} />
          </button>
        </header>

        <div className="share-body">
          {error && (
            <p className="share-error" role="alert">
              {error}
            </p>
          )}
          {sources === null ? (
            <p className="share-loading">Procurando janelas abertas…</p>
          ) : visible.length === 0 ? (
            <p className="share-loading">
              {tab === "window"
                ? "Nenhuma janela aberta encontrada."
                : "Nenhum monitor encontrado."}
            </p>
          ) : (
            <div className="share-grid">
              {visible.map((source) => (
                <div className="share-source" key={source.id}>
                  <div className="share-thumb">
                    <img src={source.thumbnail} alt="" />
                    {/* Compartilhar é uma ação só: o botão aparece sobre a
                        miniatura e dispensa uma etapa de confirmação. */}
                    <button
                      className="share-thumb-action"
                      onClick={() =>
                        onShare({
                          ...quality,
                          sourceId: source.id,
                          sourceName: source.name,
                        })
                      }
                    >
                      Compartilhar tela
                    </button>
                  </div>
                  <span className="share-source-name">
                    {source.icon && <img src={source.icon} alt="" />}
                    <span>{source.name}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <footer className="share-footer">
          <div className="share-quality">
            <b>Personalizada</b>
            <span>
              {quality.resolution}p · {quality.frameRate} fps
            </span>
          </div>
          <button
            className={`icon-button share-settings ${settingsOpen ? "active" : ""}`}
            aria-label="Ajustar qualidade"
            aria-expanded={settingsOpen}
            title="Ajustar qualidade"
            onClick={() => setSettingsOpen((open) => !open)}
          >
            <IconSettings size={20} />
          </button>
          {settingsOpen && (
            <div className="share-quality-panel">
              <span className="device-menu-label">RESOLUÇÃO</span>
              <div className="share-segmented" role="group">
                {RESOLUTIONS.map((resolution) => (
                  <button
                    key={resolution}
                    aria-pressed={quality.resolution === resolution}
                    className={quality.resolution === resolution ? "active" : ""}
                    onClick={() => onQualityChange({ ...quality, resolution })}
                  >
                    {resolution}p
                  </button>
                ))}
              </div>
              <span className="device-menu-label">TAXA DE QUADROS</span>
              <div className="share-segmented" role="group">
                {FRAME_RATES.map((frameRate) => (
                  <button
                    key={frameRate}
                    aria-pressed={quality.frameRate === frameRate}
                    className={quality.frameRate === frameRate ? "active" : ""}
                    onClick={() => onQualityChange({ ...quality, frameRate })}
                  >
                    {frameRate} fps
                  </button>
                ))}
              </div>
            </div>
          )}
        </footer>
      </section>
    </div>
  );
}
