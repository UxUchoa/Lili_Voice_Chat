import { describe, expect, it } from "vitest";
import {
  VOICE_MAX_MS,
  extensionFor,
  formatDuration,
  isVoiceMessage,
  pickVoiceFormat,
  voiceFileName,
} from "./voiceMessage";

describe("pickVoiceFormat", () => {
  it("prefere OGG com Opus quando o navegador grava nesse contêiner", () => {
    const format = pickVoiceFormat((mime) => mime === "audio/ogg;codecs=opus");
    expect(format).toEqual({ mime: "audio/ogg;codecs=opus", extension: "ogg" });
  });

  it("cai para WebM quando OGG não existe, mantendo o Opus", () => {
    // O Chromium historicamente so oferece WebM para MediaRecorder, ainda que
    // o codec de dentro seja o mesmo Opus.
    const format = pickVoiceFormat((mime) => mime.startsWith("audio/webm"));
    expect(format).toEqual({
      mime: "audio/webm;codecs=opus",
      extension: "webm",
    });
  });

  it("devolve indefinido quando nada serve, em vez de escolher às cegas", () => {
    // Forcar um mime que o navegador nao grava faria o MediaRecorder cair no
    // padrao dele sem avisar, e o arquivo sairia com extensao errada.
    expect(pickVoiceFormat(() => false)).toBeUndefined();
  });
});

describe("extensionFor", () => {
  it("acompanha o contêiner de verdade", () => {
    expect(extensionFor("audio/ogg;codecs=opus")).toBe("ogg");
    expect(extensionFor("audio/webm;codecs=opus")).toBe("webm");
    expect(extensionFor("audio/mp4")).toBe("m4a");
    expect(extensionFor("audio/desconhecido")).toBe("bin");
  });
});

describe("formatDuration", () => {
  it("mostra minutos e segundos com dois dígitos", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(7_000)).toBe("0:07");
    expect(formatDuration(67_000)).toBe("1:07");
  });

  it("não devolve tempo negativo", () => {
    expect(formatDuration(-500)).toBe("0:00");
  });

  it("mostra exatamente 1:00 no teto de um minuto", () => {
    expect(formatDuration(VOICE_MAX_MS)).toBe("1:00");
  });
});

describe("voiceFileName", () => {
  it("usa a extensão do formato escolhido", () => {
    const at = new Date(2026, 8, 1, 14, 5, 9);
    expect(
      voiceFileName({ mime: "audio/ogg;codecs=opus", extension: "ogg" }, at),
    ).toBe("mensagem-de-voz-20260901140509.ogg");
    expect(voiceFileName({ mime: "audio/webm", extension: "webm" }, at)).toBe(
      "mensagem-de-voz-20260901140509.webm",
    );
  });
});

describe("isVoiceMessage", () => {
  it("distingue a mensagem de voz de um áudio qualquer que alguém subiu", () => {
    expect(
      isVoiceMessage({
        name: "mensagem-de-voz-20260901140509.ogg",
        mime: "audio/ogg",
      }),
    ).toBe(true);
    expect(isVoiceMessage({ name: "musica.mp3", mime: "audio/mpeg" })).toBe(
      false,
    );
    expect(
      isVoiceMessage({ name: "mensagem-de-voz-x.txt", mime: "text/plain" }),
    ).toBe(false);
  });
});
