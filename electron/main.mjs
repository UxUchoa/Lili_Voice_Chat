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
import { appendFileSync, existsSync, readFileSync } from "node:fs";
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
  process.env.LILI_UPDATE_TEST_MODE === "1" ||
  process.argv.includes("--janja-update-test");
const configuredTestResult =
  process.env.LILI_UPDATE_TEST_RESULT ??
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

/**
 * Endereço da release no GitHub, montado a partir do `app-update.yml` que o
 * electron-builder embarca.
 *
 * É o mesmo lugar de onde o updater baixa, e serve para quando ele não puder
 * fazer o trabalho: canal ausente, erro de rede, instalação sem permissão de
 * escrita. Aí o botão leva a pessoa direto ao instalador em vez de deixá-la
 * com um aviso e nenhuma saída.
 */
const releaseUrlFor = (version) => {
  if (!hasPackagedUpdateConfiguration()) return undefined;
  try {
    const config = readFileSync(
      path.join(process.resourcesPath, "app-update.yml"),
      "utf8",
    );
    const owner = /^\s*owner:\s*(\S+)\s*$/m.exec(config)?.[1];
    const repo = /^\s*repo:\s*(\S+)\s*$/m.exec(config)?.[1];
    if (!owner || !repo) return undefined;
    return version
      ? `https://github.com/${owner}/${repo}/releases/tag/v${version}`
      : `https://github.com/${owner}/${repo}/releases/latest`;
  } catch {
    return undefined;
  }
};

/**
 * As notas da versão, como o provedor as entrega.
 *
 * O GitHub manda o corpo da release — o mesmo texto que sai de
 * `docs/CHANGELOG.md`. Com `fullChangelog` vem uma lista de versões, e por
 * isso os dois formatos são achatados aqui: o resto do aplicativo lida com uma
 * string, e não com a forma que o provedor escolheu.
 */
const releaseNotesFrom = (info) => {
  const notes = info?.releaseNotes;
  if (typeof notes === "string") return notes.trim() || undefined;
  if (Array.isArray(notes))
    return (
      notes
        .map((entry) =>
          typeof entry === "string"
            ? entry
            : [entry?.version && `## ${entry.version}`, entry?.note]
                .filter(Boolean)
                .join("\n"),
        )
        .join("\n\n")
        .trim() || undefined
    );
  return undefined;
};

/**
 * Endereço que a janela carrega.
 *
 * O aplicativo instalado é uma casca nativa sobre o **mesmo** site: ele não
 * embarca mais uma cópia do bundle. Antes carregava `dist/index.html` por
 * `file://`, e a consequência era que um deploy da web não chegava a quem
 * tinha o app instalado — só um instalador novo levava. Agora o front vem do
 * site a cada abertura, e o `electron-updater` fica reservado ao que de fato
 * precisa de instalador: Electron, `preload.cjs` e este processo.
 *
 * O valor é gravado no `package.json` empacotado pelo electron-builder
 * (`--config.extraMetadata.liliSiteUrl`). `LILI_SITE_URL` tem precedência para
 * que o teste de fumaça aponte a janela para um servidor local.
 */
const siteUrl = (() => {
  const clean = (value) => String(value ?? "").trim().replace(/\/+$/, "");
  const fromEnvironment = clean(process.env.LILI_SITE_URL);
  if (/^https?:\/\//i.test(fromEnvironment)) return fromEnvironment;
  if (isDevelopment) return "http://127.0.0.1:5173";
  try {
    const manifest = JSON.parse(
      readFileSync(path.join(app.getAppPath(), "package.json"), "utf8"),
    );
    const configured = clean(manifest.liliSiteUrl);
    return /^https:\/\//i.test(configured) ? configured : "";
  } catch {
    return "";
  }
})();

/** Origem única autorizada a rodar dentro da janela. */
const siteOrigin = (() => {
  try {
    return new URL(siteUrl).origin;
  } catch {
    return "";
  }
})();

/**
 * Tela de indisponibilidade.
 *
 * Sem cópia local do aplicativo, um site fora do ar deixaria a janela em
 * branco — o mesmo sintoma silencioso que já custou caro aqui. Esta página é
 * estática, não faz parte do aplicativo e existe só para dizer o que houve e
 * oferecer uma nova tentativa.
 */
const offlinePage = path.join(directory, "offline.html");

/** Abre o site na janela; sem endereço configurado, abre a tela de aviso. */
const loadSite = async () => {
  if (!siteUrl) {
    console.error("[shell] nenhum endereço de site configurado nesta build.");
    return mainWindow?.loadFile(offlinePage);
  }
  return mainWindow?.loadURL(siteUrl);
};

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
      process.env.LILI_UPDATE_FEED_URL ??
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
  /*
   * O download deixa de comecar sozinho.
   *
   * Sao ~118 MB, e ate aqui eles saiam pela rede da pessoa sem aviso: o
   * primeiro sinal de que havia atualizacao era o "pronto para reiniciar".
   * Agora a versao nova se anuncia com as notas do que mudou e um botao, e
   * quem decide baixar e quem esta usando o aplicativo.
   *
   * No modo de teste o automatico continua: o teste de atualizacao instalada
   * roda sem ninguem para clicar.
   */
  autoUpdater.autoDownload = updateTestMode;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = console;
  autoUpdater.on("checking-for-update", () =>
    publishUpdateState({ status: "checking", error: undefined }),
  );
  autoUpdater.on("update-available", (info) => {
    publishUpdateState({
      // Com `autoDownload` desligado, "disponivel" e um estado de verdade, e
      // nao um instante entre a checagem e o download.
      status: updateTestMode ? "downloading" : "available",
      version: info.version,
      progress: 0,
      notes: releaseNotesFrom(info),
      releaseUrl: releaseUrlFor(info.version),
      error: undefined,
    });
  });
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
      notes: releaseNotesFrom(info),
      releaseUrl: releaseUrlFor(info.version),
    });
    if (updateTestMode) {
      recordUpdateTest("update-downloaded", { targetVersion: info.version });
      isQuitting = true;
      autoUpdater.quitAndInstall(true, true);
      return;
    }
    const notification = new Notification({
      title: "Atualização da Lili pronta",
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
  const configuredDelay = Number(process.env.LILI_UPDATE_CHECK_DELAY_MS);
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
  // A janela empacotada não tem barra de endereço nem menu: sem um atalho
  // fixo, um erro em produção não deixa rastro nenhum que dê para inspecionar
  // depois. F12/Ctrl+Shift+I é a convenção que Discord, Slack e VS Code já
  // usam nos respectivos apps empacotados.
  mainWindow.webContents.on("before-input-event", (_event, input) => {
    const isToggle =
      input.type === "keyDown" &&
      (input.key === "F12" ||
        (input.control && input.shift && input.key.toUpperCase() === "I"));
    if (isToggle) mainWindow?.webContents.toggleDevTools();
  });
  // A janela só roda a origem do site e a página de indisponibilidade. O
  // `preload` expõe `safeStorage` e canais de IPC: qualquer outra origem que
  // conseguisse navegar aqui herdaria esse acesso nativo.
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith("file:")) return;
    let origin = "";
    try {
      origin = new URL(url).origin;
    } catch {
      origin = "";
    }
    if (!siteOrigin || origin !== siteOrigin) event.preventDefault();
  });

  // `did-fail-load` também dispara para sub-recursos; só a navegação principal
  // significa que o aplicativo não abriu.
  mainWindow.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) return; // -3 = cancelado por nova navegação
      console.warn(`[shell] falha ao carregar ${validatedUrl}: ${errorDescription}`);
      void mainWindow?.loadFile(offlinePage);
    },
  );

  void loadSite();
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
    app.setAppUserModelId("chat.lili.desktop");
    recordUpdateTest("startup");
    createWindow();
    setupAutoUpdater();
    tray = new Tray(
      nativeImage.createFromPath(assetPath("logo-vetorizada.ico")),
    );
    tray.setToolTip("Lili — Voice Chat");
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: "Abrir Lili",
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

// Só a página de indisponibilidade usa isto: o aplicativo em si nunca precisa
// pedir para ser recarregado.
ipcMain.on("shell:retry", (event) => {
  if (event.sender === mainWindow?.webContents) void loadSite();
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
ipcMain.on("update:download", (event) => {
  // So a partir de "disponivel": um segundo clique no meio do download faria o
  // electron-updater comecar outro por cima do primeiro.
  if (event.sender !== mainWindow?.webContents) return;
  if (updateState.status !== "available") return;
  publishUpdateState({ status: "downloading", progress: 0, error: undefined });
  void autoUpdater.downloadUpdate().catch((error) =>
    publishUpdateState({
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    }),
  );
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
