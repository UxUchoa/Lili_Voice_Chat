/**
 * Regras da mensagem de voz.
 *
 * Separado da interface para poder ser testado sem microfone e sem navegador:
 * o que decide o formato, o corte de um minuto e o nome do arquivo é tudo
 * função pura.
 */

/** Um minuto. Ao atingir, a gravação para sozinha e fica pronta para enviar. */
export const VOICE_MAX_MS = 60_000;

/**
 * Formatos aceitos, na ordem de preferência.
 *
 * O pedido é OGG com Opus. Nem todo navegador grava nesse contêiner: o
 * Chromium historicamente só oferece WebM para `MediaRecorder`, ainda que o
 * codec de dentro seja o mesmo Opus. Por isso a escolha é feita em tempo de
 * execução, e não fixada: forçar `audio/ogg` onde ele não existe faria o
 * `MediaRecorder` cair para o formato padrão do navegador sem avisar, e aí o
 * arquivo sairia com extensão errada.
 */
export const VOICE_MIME_PREFERENCE = [
  "audio/ogg;codecs=opus",
  "audio/ogg",
  "audio/webm;codecs=opus",
  "audio/webm",
] as const;

export interface VoiceFormat {
  mime: string;
  extension: string;
}

/** Extensão que combina com o contêiner realmente usado. */
export function extensionFor(mime: string): string {
  if (mime.startsWith("audio/ogg")) return "ogg";
  if (mime.startsWith("audio/webm")) return "webm";
  if (mime.startsWith("audio/mp4")) return "m4a";
  return "bin";
}

/**
 * Escolhe o melhor formato que este navegador realmente grava.
 *
 * `isSupported` é injetado para o teste não depender de `MediaRecorder`.
 * Devolve `undefined` quando nenhum candidato serve — aí a interface avisa em
 * vez de gravar um arquivo que ninguém consegue tocar.
 */
export function pickVoiceFormat(
  isSupported: (mime: string) => boolean,
): VoiceFormat | undefined {
  for (const mime of VOICE_MIME_PREFERENCE)
    if (isSupported(mime)) return { mime, extension: extensionFor(mime) };
  return undefined;
}

/** `0:07`, `1:00`. O relógio da gravação e do player usam o mesmo formato. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Nome do arquivo enviado. A extensão acompanha o contêiner de verdade. */
export function voiceFileName(format: VoiceFormat, at = new Date()): string {
  const stamp = [
    at.getFullYear(),
    String(at.getMonth() + 1).padStart(2, "0"),
    String(at.getDate()).padStart(2, "0"),
    String(at.getHours()).padStart(2, "0"),
    String(at.getMinutes()).padStart(2, "0"),
    String(at.getSeconds()).padStart(2, "0"),
  ].join("");
  return `mensagem-de-voz-${stamp}.${format.extension}`;
}

/** O anexo é uma mensagem de voz, e não um áudio qualquer que alguém subiu? */
export function isVoiceMessage(attachment: {
  name: string;
  mime: string;
}): boolean {
  return (
    attachment.mime.startsWith("audio/") &&
    attachment.name.startsWith("mensagem-de-voz-")
  );
}
