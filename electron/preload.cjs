const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld(
  "janjaDesktop",
  Object.freeze({
    platform: process.platform,
    retry: () => ipcRenderer.send("shell:retry"),
    minimize: () => ipcRenderer.send("window:minimize"),
    maximize: () => ipcRenderer.send("window:maximize"),
    close: () => ipcRenderer.send("window:close"),
    notify: (title, body) =>
      ipcRenderer.send("notification:show", { title, body }),
    listScreenSources: () => ipcRenderer.invoke("screen:sources"),
    // Marca a fonte escolhida no processo principal. O `getDisplayMedia`
    // seguinte a consome; e o principal que decide o que sera capturado.
    prepareScreenShare: (sourceId, audio) =>
      ipcRenderer.invoke("screen:share", { sourceId, audio }),
    // Se o video esta sendo codificado na GPU ou na CPU. Um fallback para
    // software eleva o tempo de codificacao e e a primeira coisa a conferir
    // quando a transmissao engasga.
    mediaCapabilities: () => ipcRenderer.invoke("media:capabilities"),
    secretStatus: () => ipcRenderer.invoke("secret:status"),
    wrapSecret: (plaintext) => ipcRenderer.invoke("secret:wrap", plaintext),
    unwrapSecret: (wrapped) => ipcRenderer.invoke("secret:unwrap", wrapped),
    updateStatus: () => ipcRenderer.invoke("update:status"),
    checkForUpdates: () => ipcRenderer.invoke("update:check"),
    downloadUpdate: () => ipcRenderer.send("update:download"),
    installUpdate: () => ipcRenderer.send("update:install"),
    onUpdateState: (callback) => {
      const listener = (_event, state) => callback(state);
      ipcRenderer.on("update:state", listener);
      return () => ipcRenderer.removeListener("update:state", listener);
    },
  }),
);
