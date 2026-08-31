/// <reference types="vite/client" />

interface Window {
  __janjaReactRoot?: import("react-dom/client").Root;
  janjaDesktop?: {
    platform: string;
    minimize: () => void;
    maximize: () => void;
    close: () => void;
    notify: (title: string, body: string) => void;
    listScreenSources: () => Promise<JanjaScreenSource[]>;
    secretStatus: () => Promise<{ available: boolean; backend: string }>;
    wrapSecret: (plaintext: string) => Promise<string>;
    unwrapSecret: (wrapped: string) => Promise<string>;
    updateStatus: () => Promise<JanjaUpdateState>;
    checkForUpdates: () => Promise<JanjaUpdateState>;
    installUpdate: () => void;
    onUpdateState: (callback: (state: JanjaUpdateState) => void) => () => void;
  };
}

interface JanjaScreenSource {
  id: string;
  name: string;
  kind: "screen" | "window";
  thumbnail: string;
  icon?: string;
}

interface JanjaUpdateState {
  status:
    | "idle"
    | "development"
    | "unconfigured"
    | "checking"
    | "downloading"
    | "current"
    | "ready"
    | "error"
    | "denied";
  version: string;
  progress: number;
  error?: string;
}
