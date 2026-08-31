import {
  app,
  BrowserWindow,
  desktopCapturer,
  Menu,
  ipcMain,
  nativeImage,
  Notification,
  safeStorage,
  shell,
  Tray,
} from "electron";
import electronUpdater from "electron-updater";
import { appendFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { autoUpdater } = electronUpdater;

const directory = path.dirname(fileURLToPath(import.meta.url));
const isDevelopment = !app.isPackaged;
const executableDirectory = path.dirname(path.resolve(process.execPath));
const possibleUpdateTestRoot = path.dirname(executableDirectory);
const updateTestRootName = path.basename(possibleUpdateTestRoot);
const isolatedUpdateTest =
  app.isPackaged &&
  path.dirname(possibleUpdateTestRoot) === path.resolve(os.tmpdir()) &&
  updateTestRootName.startsWith("janja-update-");
const testArgument = (name) => {
  const prefix = `--${name}=`;
  return process.argv
    .find((argument) => argument.startsWith(prefix))
    ?.slice(prefix.length);
};
const updateTestMode =
  isolatedUpdateTest ||
  process.env.JANJA_UPDATE_TEST_MODE === "1" ||
  process.argv.includes("--janja-update-test");
const configuredTestResult =
  process.env.JANJA_UPDATE_TEST_RESULT ??
  testArgument("janja-update-result") ??
  (isolatedUpdateTest
    ? path.join(
        possibleUpdateTestRoot,
        `janja-update-result-${updateTestRootName.slice("janja-update-".length)}.jsonl`,
      )
    : null);
const updateTestResult = (() => {
  if (!updateTestMode || !configuredTestResult) return null;
  const candidate = path.resolve(configuredTestResult);
  const tempRoot = path.resolve(os.tmpdir()) + path.sep;
  return candidate.startsWith(tempRoot) &&
    path.basename(candidate).startsWith("janja-update-result-")
    ? candidate
    : null;
})();
let mainWindow = null;
let tray = null;
let isQuitting = false;
let updateState = { status: "idle", version: app.getVersion(), progress: 0 };

const hasPackagedUpdateConfiguration = () =>
  existsSync(path.join(process.resourcesPath, "app-update.yml"));

const recordUpdateTest = (event, details = {}) => {
  if (!updateTestResult) return;
  appendFileSync(
    updateTestResult,
    `${JSON.stringify({ event, version: app.getVersion(), ...details })}\n`,
    "utf8",
  );
};

recordUpdateTest("module-start");

const publishUpdateState = (patch) => {
  updateState = { ...updateState, ...patch };
  recordUpdateTest("state", updateState);
  mainWindow?.webContents.send("update:state", updateState);
};

const checkForUpdates = async () => {
  if (!app.isPackaged) {
    publishUpdateState({ status: "development", error: undefined });
    return updateState;
  }
  if (!updateTestMode && !hasPackagedUpdateConfiguration()) {
    publishUpdateState({
      status: "unconfigured",
      error: "Esta build local não possui um canal de atualização configurado.",
    });
    return updateState;
  }
  publishUpdateState({ status: "checking", error: undefined });
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    publishUpdateState({
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return updateState;
};

function setupAutoUpdater() {
  if (!app.isPackaged) return;
  if (!updateTestMode && !hasPackagedUpdateConfiguration()) {
    publishUpdateState({
      status: "unconfigured",
      error: "Esta build local não possui um canal de atualização configurado.",
    });
    return;
  }
  if (updateTestMode) {
    const testFeed =
      process.env.JANJA_UPDATE_FEED_URL ??
      testArgument("janja-update-feed") ??
      "";
    if (!/^http:\/\/127\.0\.0\.1:\d+\/$/.test(testFeed)) {
      publishUpdateState({
        status: "error",
        error: "invalid local update test feed",
      });
      return;
    }
    autoUpdater.setFeedURL({ provider: "generic", url: testFeed });
    autoUpdater.disableDifferentialDownload = true;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = console;
  autoUpdater.on("checking-for-update", () =>
    publishUpdateState({ status: "checking", error: undefined }),
  );
  autoUpdater.on("update-available", (info) =>
    publishUpdateState({
      status: "downloading",
      version: info.version,
      progress: 0,
    }),
  );
  autoUpdater.on("update-not-available", (info) =>
    publishUpdateState({
      status: "current",
      version: info.version,
      progress: 100,
    }),
  );
  autoUpdater.on("download-progress", (progress) =>
    publishUpdateState({
      status: "downloading",
      progress: Math.round(progress.percent),
    }),
  );
  autoUpdater.on("update-downloaded", (info) => {
    publishUpdateState({
      status: "ready",
      version: info.version,
      progress: 100,
    });
    if (updateTestMode) {
      recordUpdateTest("update-downloaded", { targetVersion: info.version });
      isQuitting = true;
      autoUpdater.quitAndInstall(true, true);
      return;
    }
    const notification = new Notification({
      title: "Atualização da Janja pronta",
      body: `Versão ${info.version} baixada. Clique para reiniciar e instalar.`,
      icon: assetPath("logo-vetorizada.png"),
    });
    notification.on("click", () => {
      isQuitting = true;
      autoUpdater.quitAndInstall(false, true);
    });
    notification.show();
  });
  autoUpdater.on("error", (error) =>
    publishUpdateState({ status: "error", error: error.message }),
  );
  const configuredDelay = Number(process.env.JANJA_UPDATE_CHECK_DELAY_MS);
  const checkDelay =
    updateTestMode && Number.isFinite(configuredDelay)
      ? Math.max(250, Math.min(configuredDelay, 5000))
      : 10_000;
  setTimeout(() => void checkForUpdates(), checkDelay);
  setInterval(() => void checkForUpdates(), 6 * 60 * 60 * 1000);
}

const assetPath = (fileName) =>
  isDevelopment
    ? path.join(directory, "../public", fileName)
    : path.join(process.resourcesPath, "public", fileName);

const hasLock = app.requestSingleInstanceLock();
recordUpdateTest("single-instance-lock", { acquired: hasLock });
if (!hasLock) app.quit();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1000,
    minHeight: 650,
    backgroundColor: "#030202",
    titleBarStyle: "hidden",
    titleBarOverlay: { color: "#080607", symbolColor: "#b8b2b5", height: 54 },
    icon: assetPath("logo-vetorizada.ico"),
    webPreferences: {
      preload: path.join(directory, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const allowed = isDevelopment
      ? url.startsWith("http://127.0.0.1:5173")
      : url.startsWith("file:");
    if (!allowed) event.preventDefault();
  });
  if (isDevelopment) void mainWindow.loadURL("http://127.0.0.1:5173");
  else void mainWindow.loadFile(path.join(directory, "../dist/index.html"));
  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
}

app
  .whenReady()
  .then(() => {
    app.setAppUserModelId("chat.janja.desktop");
    recordUpdateTest("startup");
    createWindow();
    setupAutoUpdater();
    tray = new Tray(
      nativeImage.createFromPath(assetPath("logo-vetorizada.ico")),
    );
    tray.setToolTip("Janja — Voice Chat");
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: "Abrir Janja",
          click: () => {
            mainWindow?.show();
            mainWindow?.focus();
          },
        },
        { type: "separator" },
        {
          label: "Verificar atualizações",
          click: () => void checkForUpdates(),
        },
        { type: "separator" },
        {
          label: "Sair",
          click: () => {
            isQuitting = true;
            app.quit();
          },
        },
      ]),
    );
    tray.on("click", () => {
      mainWindow?.show();
      mainWindow?.focus();
    });
  })
  .catch((error) => {
    recordUpdateTest("startup-error", {
      error: error instanceof Error ? error.message : String(error),
    });
    app.exit(1);
  });

app.on("second-instance", () => {
  mainWindow?.show();
  mainWindow?.focus();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", () => {
  isQuitting = true;
});

ipcMain.on("window:minimize", (event) => {
  if (event.sender === mainWindow?.webContents) mainWindow.minimize();
});
ipcMain.on("window:maximize", (event) => {
  if (event.sender !== mainWindow?.webContents) return;
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});
ipcMain.on("window:close", (event) => {
  if (event.sender === mainWindow?.webContents) mainWindow.hide();
});
ipcMain.on("notification:show", (event, input) => {
  if (
    event.sender !== mainWindow?.webContents ||
    typeof input?.title !== "string" ||
    typeof input?.body !== "string"
  )
    return;
  new Notification({
    title: input.title.slice(0, 80),
    body: input.body.slice(0, 240),
    icon: assetPath("logo-vetorizada.png"),
  }).show();
});

// Fontes de captura para o seletor de compartilhamento de tela. O
// desktopCapturer só existe no processo principal; o renderer recebe apenas
// id, nome e miniatura — nunca acesso direto à API.
ipcMain.handle("screen:sources", async (event) => {
  if (event.sender !== mainWindow?.webContents) return [];
  const sources = await desktopCapturer.getSources({
    types: ["window", "screen"],
    thumbnailSize: { width: 640, height: 360 },
    fetchWindowIcons: true,
  });
  return sources
    .filter((source) => !source.thumbnail.isEmpty())
    .map((source) => ({
      id: source.id,
      name: source.name,
      kind: source.id.startsWith("screen:") ? "screen" : "window",
      thumbnail: source.thumbnail.toDataURL(),
      icon: source.appIcon?.isEmpty() ? undefined : source.appIcon?.toDataURL(),
    }));
});

ipcMain.handle("secret:status", (event) => {
  if (event.sender !== mainWindow?.webContents)
    return { available: false, backend: "denied" };
  const backend =
    process.platform === "linux" &&
    typeof safeStorage.getSelectedStorageBackend === "function"
      ? safeStorage.getSelectedStorageBackend()
      : process.platform === "win32"
        ? "dpapi"
        : process.platform === "darwin"
          ? "keychain"
          : "unknown";
  return { available: safeStorage.isEncryptionAvailable(), backend };
});
ipcMain.handle("secret:wrap", (event, plaintext) => {
  if (
    event.sender !== mainWindow?.webContents ||
    typeof plaintext !== "string" ||
    plaintext.length > 4096 ||
    !safeStorage.isEncryptionAvailable()
  )
    throw new Error("Proteção do sistema indisponível.");
  return safeStorage.encryptString(plaintext).toString("base64");
});
ipcMain.handle("secret:unwrap", (event, wrapped) => {
  if (
    event.sender !== mainWindow?.webContents ||
    typeof wrapped !== "string" ||
    wrapped.length > 16384 ||
    !safeStorage.isEncryptionAvailable()
  )
    throw new Error("Proteção do sistema indisponível.");
  return safeStorage.decryptString(Buffer.from(wrapped, "base64"));
});
ipcMain.handle("update:status", (event) => {
  if (event.sender !== mainWindow?.webContents)
    return { status: "denied", version: app.getVersion(), progress: 0 };
  return updateState;
});
ipcMain.handle("update:check", (event) => {
  if (event.sender !== mainWindow?.webContents)
    throw new Error("Acesso negado.");
  return checkForUpdates();
});
ipcMain.on("update:install", (event) => {
  if (
    event.sender !== mainWindow?.webContents ||
    updateState.status !== "ready"
  )
    return;
  isQuitting = true;
  autoUpdater.quitAndInstall(false, true);
});
