/**
 * Identidade sonora do Lili, sintetizada com Web Audio.
 *
 * Os sons são gerados em tempo real em vez de virem de arquivos: não há nada
 * para baixar, nada some do bundle e o timbre é nosso, sem reaproveitar
 * material de outros aplicativos. Cada evento tem um desenho próprio —
 * registro, timbre, ritmo e envelope diferentes — e não a mesma amostra com
 * pitch trocado.
 *
 *  - `join`  "tum → tim": grave, duas notas ascendentes, macio. Chegada.
 *  - `leave` "tim → tchim": agudo, seco, com um batimento levemente
 *            destoante no fim. Saída.
 *  - `ringtone` "tutu tutu tum tum": motivo em laço enquanto o telefone toca.
 */

export type LiliSound =
  | "join"
  | "leave"
  | "self-join"
  | "self-leave"
  | "mute"
  | "unmute"
  | "deafen"
  | "undeafen"
  | "screen-share"
  | "message"
  | "call-declined";

const SOUND_PREFERENCE_KEY = "janja.sounds.enabled";
const VOLUME_KEY = "janja.sounds.volume";

let context: AudioContext | undefined;

function audioContext() {
  if (typeof window === "undefined") return undefined;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return undefined;
  context ??= new Ctor();
  // Navegadores suspendem o contexto até a primeira interação do usuário.
  if (context.state === "suspended") void context.resume().catch(() => {});
  return context;
}

/**
 * Destrava o áudio no primeiro gesto da sessão. Sem isto, o toque de uma
 * chamada recebida logo após carregar a página sairia mudo — a política de
 * autoplay mantém o contexto suspenso até alguém tocar na interface.
 */
export function primeAudioOnUserGesture() {
  if (typeof window === "undefined") return () => undefined;
  const unlock = () => {
    audioContext();
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock, { once: true });
  window.addEventListener("keydown", unlock, { once: true });
  return () => {
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
}

export function soundsEnabled() {
  return localStorage.getItem(SOUND_PREFERENCE_KEY) !== "off";
}

export function setSoundsEnabled(enabled: boolean) {
  localStorage.setItem(SOUND_PREFERENCE_KEY, enabled ? "on" : "off");
  if (!enabled) stopRingtone();
}

const DEFAULT_VOLUME = 0.5;

export function soundVolume() {
  // `Number(null)` é 0 — sem esta checagem, uma conta que nunca mexeu no
  // volume "escolhia" silêncio absoluto e nenhum som da aplicação tocava.
  const raw = localStorage.getItem(VOLUME_KEY);
  if (raw === null || raw.trim() === "") return DEFAULT_VOLUME;
  const stored = Number(raw);
  return Number.isFinite(stored) && stored >= 0 && stored <= 1
    ? stored
    : DEFAULT_VOLUME;
}

export function setSoundVolume(volume: number) {
  localStorage.setItem(VOLUME_KEY, String(Math.min(1, Math.max(0, volume))));
}

interface Tone {
  frequency: number;
  /** Início relativo ao disparo, em segundos. */
  at: number;
  duration: number;
  gain?: number;
  type?: OscillatorType;
  /** Segunda voz simultânea, para timbres com batimento ou brilho. */
  partial?: { frequency: number; gain: number; type?: OscillatorType };
  /** Ataque em segundos. Curto = percussivo; longo = macio. */
  attack?: number;
}

const SOUNDS: Record<LiliSound, Tone[]> = {
  // Chegada — "tum → tim". Registro grave, dois passos ascendentes e ataque
  // arredondado: presente o bastante para se notar, discreto o bastante para
  // não cortar quem está falando.
  join: [
    {
      frequency: 196,
      at: 0,
      duration: 0.14,
      type: "triangle",
      gain: 0.85,
      attack: 0.02,
    },
    {
      frequency: 293.66,
      at: 0.1,
      duration: 0.2,
      type: "sine",
      gain: 0.7,
      attack: 0.018,
      partial: { frequency: 587.33, gain: 0.18, type: "sine" },
    },
  ],
  // Saída — "tim → tchim". Uma oitava e meia acima da chegada, ataque seco e
  // um batimento de segunda maior no fim, que dá o "tch" e fecha a ideia.
  leave: [
    {
      frequency: 659.25,
      at: 0,
      duration: 0.07,
      type: "sine",
      gain: 0.55,
      attack: 0.004,
    },
    {
      frequency: 932.33,
      at: 0.075,
      duration: 0.1,
      type: "triangle",
      gain: 0.6,
      attack: 0.003,
      partial: { frequency: 1046.5, gain: 0.3, type: "sine" },
    },
  ],
  // A própria entrada é mais afirmativa: tríade ascendente.
  "self-join": [
    { frequency: 523.25, at: 0, duration: 0.08 },
    { frequency: 659.25, at: 0.07, duration: 0.08 },
    { frequency: 987.77, at: 0.14, duration: 0.16 },
  ],
  "self-leave": [
    { frequency: 659.25, at: 0, duration: 0.08 },
    { frequency: 523.25, at: 0.07, duration: 0.08 },
    { frequency: 392, at: 0.14, duration: 0.18 },
  ],
  mute: [{ frequency: 440, at: 0, duration: 0.07, gain: 0.5 }],
  unmute: [{ frequency: 660, at: 0, duration: 0.07, gain: 0.5 }],
  deafen: [
    { frequency: 392, at: 0, duration: 0.07, gain: 0.5 },
    { frequency: 294, at: 0.06, duration: 0.1, gain: 0.5 },
  ],
  undeafen: [
    { frequency: 294, at: 0, duration: 0.07, gain: 0.5 },
    { frequency: 392, at: 0.06, duration: 0.1, gain: 0.5 },
  ],
  "screen-share": [
    { frequency: 698.46, at: 0, duration: 0.07 },
    { frequency: 1046.5, at: 0.07, duration: 0.12 },
  ],
  message: [{ frequency: 784, at: 0, duration: 0.08, gain: 0.35 }],
  // Recusa: dois passos descendentes com a segunda nota alongada.
  "call-declined": [
    { frequency: 415.3, at: 0, duration: 0.11, type: "triangle", gain: 0.6 },
    { frequency: 311.13, at: 0.11, duration: 0.26, type: "triangle", gain: 0.6 },
  ],
};

/** Motivo do toque: "tu-tu tu-tu tum tum", repetido a cada ciclo. */
const RINGTONE_PATTERN: Tone[] = [
  { frequency: 587.33, at: 0, duration: 0.1, type: "triangle", gain: 0.55 },
  { frequency: 587.33, at: 0.16, duration: 0.1, type: "triangle", gain: 0.55 },
  { frequency: 659.25, at: 0.42, duration: 0.1, type: "triangle", gain: 0.55 },
  { frequency: 659.25, at: 0.58, duration: 0.1, type: "triangle", gain: 0.55 },
  {
    frequency: 440,
    at: 0.88,
    duration: 0.24,
    type: "sine",
    gain: 0.7,
    attack: 0.02,
    partial: { frequency: 220, gain: 0.35, type: "sine" },
  },
  {
    frequency: 349.23,
    at: 1.2,
    duration: 0.36,
    type: "sine",
    gain: 0.7,
    attack: 0.02,
    partial: { frequency: 174.61, gain: 0.35, type: "sine" },
  },
];
const RINGTONE_CYCLE_SECONDS = 2.4;

function scheduleTone(
  ctx: AudioContext,
  tone: Tone,
  startAt: number,
  master: number,
) {
  const voices: Array<{
    frequency: number;
    gain: number;
    type: OscillatorType;
  }> = [
    {
      frequency: tone.frequency,
      gain: tone.gain ?? 0.7,
      type: tone.type ?? "sine",
    },
  ];
  if (tone.partial)
    voices.push({
      frequency: tone.partial.frequency,
      gain: tone.partial.gain,
      type: tone.partial.type ?? "sine",
    });
  const nodes: OscillatorNode[] = [];
  for (const voice of voices) {
    const oscillator = ctx.createOscillator();
    const envelope = ctx.createGain();
    oscillator.type = voice.type;
    oscillator.frequency.setValueAtTime(voice.frequency, startAt);
    // Ataque e queda suaves evitam o "clique" de ligar/desligar o oscilador.
    const attack = tone.attack ?? 0.012;
    const peak = master * voice.gain * 0.22;
    envelope.gain.setValueAtTime(0.0001, startAt);
    envelope.gain.exponentialRampToValueAtTime(peak, startAt + attack);
    envelope.gain.exponentialRampToValueAtTime(
      0.0001,
      startAt + tone.duration,
    );
    oscillator.connect(envelope);
    envelope.connect(ctx.destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + tone.duration + 0.02);
    nodes.push(oscillator);
  }
  return nodes;
}

export function playSound(name: LiliSound) {
  if (!soundsEnabled()) return;
  const ctx = audioContext();
  if (!ctx) return;
  const master = soundVolume();
  if (master <= 0) return;
  const now = ctx.currentTime;
  for (const tone of SOUNDS[name])
    scheduleTone(ctx, tone, now + tone.at, master);
}

let ringtoneTimer: number | undefined;
let ringtoneVoices: OscillatorNode[] = [];

/**
 * Toca o motivo em laço. Chamar de novo enquanto já está tocando não empilha
 * um segundo toque — é o mesmo laço, o que mantém um único telefone tocando
 * mesmo que dois eventos de Realtime cheguem para a mesma chamada.
 */
export function startRingtone() {
  if (ringtoneTimer !== undefined) return;
  if (!soundsEnabled()) return;
  const ctx = audioContext();
  if (!ctx) return;
  const cycle = () => {
    const master = soundVolume();
    if (master <= 0 || !soundsEnabled()) return;
    const start = ctx.currentTime + 0.02;
    ringtoneVoices = RINGTONE_PATTERN.flatMap((tone) =>
      scheduleTone(ctx, tone, start + tone.at, master),
    );
  };
  cycle();
  ringtoneTimer = window.setInterval(cycle, RINGTONE_CYCLE_SECONDS * 1000);
}

export function stopRingtone() {
  if (ringtoneTimer !== undefined) {
    window.clearInterval(ringtoneTimer);
    ringtoneTimer = undefined;
  }
  for (const voice of ringtoneVoices) {
    try {
      voice.stop();
    } catch {
      // O oscilador já terminou seu envelope; nada a fazer.
    }
  }
  ringtoneVoices = [];
}

export const ringtonePlaying = () => ringtoneTimer !== undefined;
