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
