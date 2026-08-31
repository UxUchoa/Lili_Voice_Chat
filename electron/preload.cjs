const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld(
  "liliDesktop",
  Object.freeze({
    platform: process.platform,
    minimize: () => ipcRenderer.send("window:minimize"),
    maximize: () => ipcRenderer.send("window:maximize"),
    close: () => ipcRenderer.send("window:close"),
    notify: (title, body) =>
      ipcRenderer.send("notification:show", { title, body }),
    listScreenSources: () => ipcRenderer.invoke("screen:sources"),
    secretStatus: () => ipcRenderer.invoke("secret:status"),
    wrapSecret: (plaintext) => ipcRenderer.invoke("secret:wrap", plaintext),
    unwrapSecret: (wrapped) => ipcRenderer.invoke("secret:unwrap", wrapped),
    updateStatus: () => ipcRenderer.invoke("update:status"),
    checkForUpdates: () => ipcRenderer.invoke("update:check"),
    installUpdate: () => ipcRenderer.send("update:install"),
    onUpdateState: (callback) => {
      const listener = (_event, state) => callback(state);
      ipcRenderer.on("update:state", listener);
      return () => ipcRenderer.removeListener("update:state", listener);
    },
  }),
);
