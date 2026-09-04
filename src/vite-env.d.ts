/** Versão empacotada e as notas dela, recortadas do CHANGELOG pelo build. */
declare const __LILI_VERSION__: string;
declare const __LILI_RELEASE_NOTES__: string;
/// <reference types="vite/client" />

interface Window {
  __liliReactRoot?: import("react-dom/client").Root;
  janjaDesktop?: {
    platform: string;
    /** Recarrega o site. Só a tela de indisponibilidade do Electron usa. */
    retry: () => void;
    minimize: () => void;
    maximize: () => void;
    close: () => void;
    notify: (title: string, body: string) => void;
    listScreenSources: () => Promise<LiliScreenSource[]>;
    /**
     * Registra no processo principal a fonte que será capturada em seguida.
     *
     * Devolve se haverá som e de onde ele virá: `application` é o loopback do
     * processo dono da janela escolhida — o som daquele aplicativo e de mais
     * nada; `system` é a saída inteira do Windows, que é o que sobra quando a
     * fonte é um monitor ou quando o processo da janela não foi identificado.
     * Quem compartilha é a única pessoa que não ouve o resultado, então a
     * diferença precisa chegar à tela.
     */
    prepareScreenShare: (
      sourceId: string,
      audio: boolean,
    ) => Promise<{
      audioAvailable: boolean;
      audioMode: "application" | "system" | "none";
    }>;
    /** Se o Chromium codifica vídeo na GPU ou caiu para a CPU. */
    mediaCapabilities: () => Promise<{
      videoEncode: string;
      videoDecode: string;
      gpuCompositing: string;
    } | null>;
    secretStatus: () => Promise<{ available: boolean; backend: string }>;
    wrapSecret: (plaintext: string) => Promise<string>;
    unwrapSecret: (wrapped: string) => Promise<string>;
    updateStatus: () => Promise<LiliUpdateState>;
    checkForUpdates: () => Promise<LiliUpdateState>;
    downloadUpdate: () => void;
    installUpdate: () => void;
    onUpdateState: (callback: (state: LiliUpdateState) => void) => () => void;
  };
}

interface LiliScreenSource {
  id: string;
  name: string;
  kind: "screen" | "window";
  thumbnail: string;
  icon?: string;
}

interface LiliUpdateState {
  /** A versão que está rodando agora. Não muda quando outra é anunciada. */
  appVersion?: string;
  status:
    | "idle"
    | "development"
    | "unconfigured"
    | "checking"
    /** Versão nova anunciada, esperando a pessoa mandar baixar. */
    | "available"
    | "downloading"
    | "current"
    | "ready"
    | "error"
    | "denied";
  version: string;
  progress: number;
  error?: string;
  /** Corpo da release no GitHub — o texto de `docs/CHANGELOG.md`. */
  notes?: string;
  /** Página da release, para baixar à mão quando o updater não puder. */
  releaseUrl?: string;
}
