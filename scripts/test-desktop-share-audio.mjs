#!/usr/bin/env node
/**
 * O compartilhamento de tela do desktop leva som?
 *
 * Esta era a única parte do compartilhamento sem cobertura nenhuma, e foi por
 * ali que o defeito passou: durante toda a 0.2.0 o desktop transmitiu mudo.
 * O vídeo subia, o áudio não, e ninguém reclamou porque quem compartilha é a
 * única pessoa que não ouve o próprio resultado.
 *
 * O Playwright não alcança isto — ele dirige o Edge, e o que estava quebrado
 * era a ponte entre o processo principal do Electron e o Chromium embutido.
 * Então o teste é um Electron de verdade: sobe uma janela, registra a mesma
 * ponte que a aplicação registra, marca uma fonte como o seletor marcaria e
 * pede a captura pelo renderer.
 *
 * O que ele afirma:
 *
 * 1. Com uma fonte escolhida, a captura devolve vídeo.
 * 2. No Windows, com áudio pedido, ela devolve **também uma faixa de áudio**.
 *    É a asserção que teria pego o bug.
 * 3. Sem escolha registrada, a captura é negada — um pedido que a pessoa não
 *    fez não pode virar transmissão.
 * 4. A escolha vale uma vez só: a segunda captura seguida é negada.
 *
 * Roda com `npm run desktop:share-audio`; sai diferente de zero se qualquer
 * uma falhar.
 */
import { app, BrowserWindow, desktopCapturer, session } from "electron";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createDisplayMediaBridge } from "../electron/displayMedia.mjs";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const offlinePage = path.join(projectRoot, "electron", "offline.html");

const failures = [];
const log = (message) => process.stdout.write(`${message}\n`);
const check = (condition, description, detail = "") => {
  if (condition) {
    log(`  ok   ${description}`);
    return true;
  }
  failures.push(`${description}${detail ? ` — ${detail}` : ""}`);
  log(`  FALHA ${description}${detail ? ` — ${detail}` : ""}`);
  return false;
};

/**
 * Pede a captura pelo renderer e conta as faixas.
 *
 * `userGesture: true` é obrigatório: `getDisplayMedia` exige ativação do
 * usuário, e sem isso o teste mediria uma recusa que não é a que interessa.
 */
async function capture(win, withAudio) {
  return win.webContents.executeJavaScript(
    `navigator.mediaDevices
      .getDisplayMedia({ video: true, audio: ${withAudio ? "true" : "false"} })
      .then((stream) => {
        const result = {
          ok: true,
          video: stream.getVideoTracks().length,
          audio: stream.getAudioTracks().length,
        };
        stream.getTracks().forEach((track) => track.stop());
        return result;
      })
      .catch((error) => ({ ok: false, name: error.name, message: error.message }))`,
    true,
  );
}

app.whenReady().then(async () => {
  const bridge = createDisplayMediaBridge({ desktopCapturer, session });
  const win = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  bridge.register(
    (request) => request?.frame?.top === win.webContents.mainFrame,
  );
  await win.loadFile(offlinePage);

  try {
    const sources = await desktopCapturer.getSources({ types: ["screen"] });
    if (!sources.length) {
      failures.push("Nenhuma tela disponível para capturar neste ambiente.");
    } else {
      const source = sources[0];
      const windows = process.platform === "win32";

      log("Captura com a fonte escolhida:");
      bridge.select(source.id, true);
      const comAudio = await capture(win, true);
      check(comAudio.ok, "a captura foi concedida", comAudio.name ?? "");
      // `NotReadableError` aqui não é falha do código: é o Windows recusando
      // abrir o loopback na saída padrão. Acontece quando ela está em mais de
      // dois canais ou em 24 bits — `IAudioClient::Initialize` devolve
      // `AUDCLNT_E_UNSUPPORTED_FORMAT`. Sem esta linha, o teste reprova sem
      // dizer onde mexer, e o lugar não é o projeto.
      if (comAudio.name === "NotReadableError")
        log(
          "  nota  a saída padrão do Windows recusou o loopback; deixe-a em 2 canais, 16 bits, 48000 Hz",
        );
      check(comAudio.video === 1, "veio uma faixa de vídeo", `veio ${comAudio.video}`);
      if (windows)
        // A asserção que faltava. Durante a 0.2.0 isto era zero, e nada no
        // projeto dizia nada a respeito.
        check(
          comAudio.audio === 1,
          "veio uma faixa de áudio (loopback do Windows)",
          `veio ${comAudio.audio}`,
        );
      else
        log(
          `  nota  áudio de tela não existe em ${process.platform}; só o Windows tem loopback`,
        );

      log("Captura sem pedir áudio:");
      bridge.select(source.id, false);
      const semAudio = await capture(win, false);
      check(semAudio.ok, "a captura foi concedida", semAudio.name ?? "");
      check(semAudio.audio === 0, "não veio áudio", `veio ${semAudio.audio}`);

      log("Sem escolha registrada:");
      const semEscolha = await capture(win, true);
      check(
        !semEscolha.ok,
        "a captura foi negada",
        semEscolha.ok ? "veio um stream sem ninguém ter escolhido" : "",
      );

      log("A escolha vale uma vez só:");
      bridge.select(source.id, true);
      await capture(win, true);
      const segunda = await capture(win, true);
      check(
        !segunda.ok,
        "a segunda captura seguida foi negada",
        segunda.ok ? "a escolha ficou pendurada" : "",
      );
    }
  } catch (error) {
    failures.push(`Erro inesperado: ${error?.message ?? error}`);
  }

  if (failures.length) {
    log(`\n${failures.length} falha(s):`);
    for (const failure of failures) log(`  - ${failure}`);
  } else {
    log("\nCompartilhamento do desktop leva vídeo e som.");
  }
  app.exit(failures.length ? 1 : 0);
});
