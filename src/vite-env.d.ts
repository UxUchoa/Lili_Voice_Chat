/// <reference types="vite/client" />

interface Window {
  __liliReactRoot?: import("react-dom/client").Root;
  liliDesktop?: {
    platform: string;
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
    | "downloading"
    | "current"
    | "ready"
    | "error"
    | "denied";
  version: string;
  progress: number;
  error?: string;
}
