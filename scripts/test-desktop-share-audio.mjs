#!/usr/bin/env node
/**
 * O compartilhamento de tela do desktop leva som — e leva o som certo?
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
 *    É a asserção que teria pego o bug da 0.2.0.
 * 3. Sem escolha registrada, a captura é negada — um pedido que a pessoa não
 *    fez não pode virar transmissão.
 * 4. A escolha vale uma vez só: a segunda captura seguida é negada.
 * 5. Uma janela pede o loopback do processo dela; um monitor pede a saída do
 *    sistema; uma janela sem processo conhecido cai para a saída do sistema.
 * 6. **Com `restrictOwnAudio`, o som do próprio aplicativo não entra na
 *    captura** — e sem ela entra. É a asserção do eco, e ela é medida: um tom
 *    é tocado aqui dentro e procurado no que voltou.
 * 7. O loopback por processo captura o som do processo alvo. É o outro lado da
 *    mesma moeda: excluir o Lili não pode significar não capturar nada.
 *
 * As duas últimas são medidas em decibéis, não em "tem faixa de áudio": uma
 * faixa muda e uma faixa com o eco dentro são indistinguíveis pela contagem, e
 * era exatamente essa a diferença que interessava.
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

/** O tom que faz o papel do áudio da chamada, tocando na saída padrão. */
const TONE_HZ = 1000;
const startTone = (win) =>
  win.webContents.executeJavaScript(
    `(() => {
      const context = new AudioContext();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = ${TONE_HZ};
      gain.gain.value = 0.25;
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      return context.state;
    })()`,
    true,
  );

/**
 * Captura e mede a energia em 1 kHz no que voltou, em decibéis.
 *
 * Devolve `null` quando o tom não aparece acima do piso de ruído — que é o
 * resultado desejado quando se está testando a exclusão.
 */
const measureTone = (win, extraConstraints) =>
  win.webContents.executeJavaScript(
    `(async () => {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false${extraConstraints} },
        });
        const track = stream.getAudioTracks()[0];
        if (!track) { stream.getTracks().forEach((t) => t.stop()); return { error: "sem faixa de áudio" }; }
        const context = new AudioContext({ sampleRate: 48000 });
        const analyser = context.createAnalyser();
        analyser.fftSize = 4096;
        context.createMediaStreamSource(new MediaStream([track])).connect(analyser);
        const bins = new Float32Array(analyser.frequencyBinCount);
        const bin = Math.round(${TONE_HZ} / (context.sampleRate / analyser.fftSize));
        let peak = -Infinity;
        const started = Date.now();
        while (Date.now() - started < 2500) {
          await new Promise((resolve) => setTimeout(resolve, 80));
          analyser.getFloatFrequencyData(bins);
          peak = Math.max(peak, bins[bin - 1], bins[bin], bins[bin + 1]);
        }
        stream.getTracks().forEach((t) => t.stop());
        await context.close();
        return { db: peak === -Infinity ? null : Math.round(peak * 10) / 10 };
      } catch (error) { return { error: error.name + ": " + error.message }; }
    })()`,
    true,
  );

/**
 * O limiar entre "está lá" e "sumiu".
 *
 * Medido nesta versão: sem exclusão o tom aparece por volta de −26 dB; com
 * exclusão, por volta de −77. Cinquenta decibéis de diferença não deixam
 * dúvida, e −60 fica confortavelmente no meio.
 */
const AUDIVEL_DB = -60;

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
    const sources = await desktopCapturer.getSources({
      types: ["screen", "window"],
    });
    const screenSource = sources.find((item) => item.id.startsWith("screen:"));
    if (!screenSource) {
      failures.push("Nenhuma tela disponível para capturar neste ambiente.");
    } else {
      const source = screenSource;
      const windowSource = sources.find(
        (item) => !item.id.startsWith("screen:"),
      );
      const windows = process.platform === "win32";

      log("Captura com a fonte escolhida:");
      await bridge.select(source.id, true);
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
      await bridge.select(source.id, false);
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
      await bridge.select(source.id, true);
      await capture(win, true);
      const segunda = await capture(win, true);
      check(
        !segunda.ok,
        "a segunda captura seguida foi negada",
        segunda.ok ? "a escolha ficou pendurada" : "",
      );

      /**
       * Qual dispositivo de áudio cada tipo de fonte pede.
       *
       * Sem `resolveWindowPid` o Windows não separa som por janela, e era essa
       * a limitação que a interface anunciava. Com ele, uma janela pede o
       * loopback do processo dono — e o teste confere as duas pontas, porque
       * cair para a saída do sistema em silêncio seria entregar o som de tudo
       * a quem escolheu um aplicativo.
       */
      if (windows && windowSource) {
        log("O dispositivo de áudio segue o tipo de fonte:");
        const comPid = createDisplayMediaBridge({
          desktopCapturer,
          session,
          resolveWindowPid: async () => 4242,
        });
        const janela = await comPid.select(windowSource.id, true);
        check(
          comPid.peek()?.audio === "applicationLoopback:4242",
          "uma janela pede o loopback do processo dela",
          `pediu ${comPid.peek()?.audio}`,
        );
        check(
          janela.audioMode === "application",
          "e diz que o som é só daquele aplicativo",
          `disse ${janela.audioMode}`,
        );
        const tela = await comPid.select(source.id, true);
        check(
          comPid.peek()?.audio === "loopback",
          "um monitor pede a saída do sistema",
          `pediu ${comPid.peek()?.audio}`,
        );
        check(
          tela.audioMode === "system",
          "e diz que o som é o do computador",
          `disse ${tela.audioMode}`,
        );
        const semProcesso = createDisplayMediaBridge({
          desktopCapturer,
          session,
          resolveWindowPid: async () => null,
        });
        const caiu = await semProcesso.select(windowSource.id, true);
        check(
          semProcesso.peek()?.audio === "loopback" &&
            caiu.audioMode === "system",
          "sem o processo da janela, cai para a saída do sistema e avisa",
          `pediu ${semProcesso.peek()?.audio} / ${caiu.audioMode}`,
        );

        /**
         * Duas escolhas em voo ao mesmo tempo.
         *
         * Achar o processo de uma janela leva algumas centenas de
         * milissegundos, e dois cliques no seletor põem duas escolhas
         * esperando. Vale a última pedida, não a última a voltar — e a que
         * perdeu não pode deixar um prazo armado que apague a boa depois.
         */
        const lenta = createDisplayMediaBridge({
          desktopCapturer,
          session,
          resolveWindowPid: async (id) => {
            await new Promise((resolve) =>
              setTimeout(resolve, id === windowSource.id ? 200 : 10),
            );
            return id === windowSource.id ? 111 : 222;
          },
        });
        const [primeira, segunda] = await Promise.all([
          lenta.select(windowSource.id, true),
          lenta.select(source.id, true),
        ]);
        check(
          lenta.peek()?.audio === "loopback",
          "com duas escolhas em voo, vale a última pedida",
          `ficou ${lenta.peek()?.audio}`,
        );
        check(
          primeira.audioMode === "application" &&
            segunda.audioMode === "system",
          "e cada chamada recebe a resposta do que ela mesma pediu",
          `${primeira.audioMode} / ${segunda.audioMode}`,
        );
      }

      /**
       * O eco, medido.
       *
       * O loopback do Windows captura a saída inteira, este aplicativo
       * incluído: a voz de quem estava na chamada saía pelos alto-falantes,
       * voltava pela captura e subia de novo no compartilhamento. Contar
       * faixas de áudio nunca pegaria isso — a faixa existia, e o problema era
       * o que havia dentro dela.
       */
      if (windows) {
        log("O som do próprio aplicativo não pode voltar pela captura:");
        await startTone(win);
        await new Promise((resolve) => setTimeout(resolve, 800));

        await bridge.select(source.id, true);
        const semRestricao = await measureTone(win, "");
        if (semRestricao.error) {
          log(`  nota  não deu para medir a linha de base: ${semRestricao.error}`);
        } else {
          check(
            semRestricao.db !== null && semRestricao.db > AUDIVEL_DB,
            "linha de base: sem a restrição, o próprio som entra mesmo",
            `${semRestricao.db} dB — se isto falhar, o teste não está medindo nada`,
          );
        }

        await bridge.select(source.id, true);
        const comRestricao = await measureTone(win, ", restrictOwnAudio: true");
        if (comRestricao.error) {
          log(`  nota  ${comRestricao.error}`);
          failures.push(
            `A captura com restrictOwnAudio falhou: ${comRestricao.error}`,
          );
        } else {
          check(
            comRestricao.db === null || comRestricao.db < AUDIVEL_DB,
            "com restrictOwnAudio, o som do Lili some da captura",
            `${comRestricao.db} dB (limiar ${AUDIVEL_DB})`,
          );
        }

        /**
         * E o outro lado: excluir o Lili não pode virar capturar nada.
         *
         * O alvo aqui é o próprio processo de teste, que é o único cuja árvore
         * se sabe estar tocando som neste instante. Se o loopback por processo
         * pega o tom daqui, ele pega o do jogo ou do navegador escolhido.
         */
        log("O loopback por processo captura o som do processo alvo:");
        const doProcesso = createDisplayMediaBridge({
          desktopCapturer,
          session,
          resolveWindowPid: async () => process.pid,
        });
        doProcesso.register(
          (request) => request?.frame?.top === win.webContents.mainFrame,
        );
        await doProcesso.select(windowSource?.id ?? source.id, true);
        const alvo = await measureTone(win, "");
        // Volta a ponte original: as duas registram na mesma sessão, e a
        // última a registrar é quem responde.
        bridge.register(
          (request) => request?.frame?.top === win.webContents.mainFrame,
        );
        if (alvo.error) {
          log(`  nota  ${alvo.error}`);
          failures.push(`O loopback por processo falhou: ${alvo.error}`);
        } else {
          check(
            alvo.db !== null && alvo.db > AUDIVEL_DB,
            "o som do processo alvo chega na captura",
            `${alvo.db} dB (limiar ${AUDIVEL_DB})`,
          );
        }
      }
    }
  } catch (error) {
    failures.push(`Erro inesperado: ${error?.message ?? error}`);
  }

  if (failures.length) {
    log(`\n${failures.length} falha(s):`);
    for (const failure of failures) log(`  - ${failure}`);
  } else {
    log("\nCompartilhamento do desktop leva vídeo e o som certo.");
  }
  app.exit(failures.length ? 1 : 0);
});
