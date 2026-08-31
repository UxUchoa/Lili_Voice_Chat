import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Os sons são sintetizados, então o teste observa o que foi agendado no
 * Web Audio em vez de ouvir. Um oscilador criado = uma voz tocando.
 */

class FakeParam {
  setValueAtTime = vi.fn();
  exponentialRampToValueAtTime = vi.fn();
}
class FakeOscillator {
  type = "sine";
  frequency = new FakeParam();
  connect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}
class FakeGain {
  gain = new FakeParam();
  connect = vi.fn();
}
class FakeAudioContext {
  static created: FakeAudioContext[] = [];
  state = "running";
  currentTime = 0;
  destination = {};
  oscillators: FakeOscillator[] = [];
  constructor() {
    FakeAudioContext.created.push(this);
  }
  createOscillator() {
    const oscillator = new FakeOscillator();
    this.oscillators.push(oscillator);
    return oscillator;
  }
  createGain() {
    return new FakeGain();
  }
  resume() {
    return Promise.resolve();
  }
}

const store = new Map<string, string>();
const localStorageStub = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
  clear: () => store.clear(),
};

async function loadSounds() {
  vi.resetModules();
  return import("./sounds");
}

beforeEach(() => {
  store.clear();
  FakeAudioContext.created = [];
  vi.stubGlobal("localStorage", localStorageStub);
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.useFakeTimers();
  vi.stubGlobal("window", {
    AudioContext: FakeAudioContext,
    // Delegação preguiçosa: os temporizadores falsos substituem o global
    // depois deste stub, então capturar a referência aqui pegaria o real.
    setInterval: (...args: Parameters<typeof globalThis.setInterval>) =>
      globalThis.setInterval(...args),
    clearInterval: (handle: Parameters<typeof globalThis.clearInterval>[0]) =>
      globalThis.clearInterval(handle),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const context = () => FakeAudioContext.created[0];

describe("volume dos sons", () => {
  it("usa o padrão audível quando nunca foi configurado", async () => {
    // Regressão: `Number(null)` é 0, então a ausência de preferência era lida
    // como "volume zero" e a aplicação inteira ficava muda.
    const { soundVolume } = await loadSounds();
    expect(soundVolume()).toBe(0.5);
  });

  it("respeita um volume salvo e descarta valores inválidos", async () => {
    const { soundVolume, setSoundVolume } = await loadSounds();
    setSoundVolume(0.2);
    expect(soundVolume()).toBeCloseTo(0.2);
    store.set("lili.sounds.volume", "não é número");
    expect(soundVolume()).toBe(0.5);
  });

  it("silêncio explícito continua valendo", async () => {
    const { soundVolume, playSound } = await loadSounds();
    store.set("lili.sounds.volume", "0");
    expect(soundVolume()).toBe(0);
    playSound("join");
    expect(context()?.oscillators.length ?? 0).toBe(0);
  });
});

describe("identidade sonora", () => {
  it("entrada e saída não são o mesmo som", async () => {
    const { playSound } = await loadSounds();
    playSound("join");
    const join = context().oscillators.map((item) =>
      item.frequency.setValueAtTime.mock.calls[0][0],
    );
    context().oscillators.length = 0;
    playSound("leave");
    const leave = context().oscillators.map((item) =>
      item.frequency.setValueAtTime.mock.calls[0][0],
    );
    expect(join).not.toEqual(leave);
    expect(join).not.toEqual([...leave].reverse());
    // A chegada vive num registro mais grave que a saída, e sobe.
    expect(Math.max(...join)).toBeLessThan(Math.max(...leave));
    expect(join[0]).toBeLessThan(join[join.length - 1]);
  });

  it("cada som usa o próprio desenho", async () => {
    const { playSound } = await loadSounds();
    const shapeOf = (name: Parameters<typeof playSound>[0]) => {
      context().oscillators.length = 0;
      playSound(name);
      return context()
        .oscillators.map((item) => item.frequency.setValueAtTime.mock.calls[0][0])
        .join("|");
    };
    playSound("join");
    const shapes = new Set(
      (["join", "leave", "self-join", "self-leave", "call-declined"] as const).map(
        shapeOf,
      ),
    );
    expect(shapes.size).toBe(5);
  });
});

describe("toque da chamada", () => {
  it("toca em laço e não empilha quando chamado de novo", async () => {
    const { startRingtone, stopRingtone, ringtonePlaying } = await loadSounds();
    startRingtone();
    const firstCycle = context().oscillators.length;
    expect(firstCycle).toBeGreaterThan(0);
    expect(ringtonePlaying()).toBe(true);

    // Um segundo evento para a mesma chamada não pode dobrar o toque.
    startRingtone();
    expect(context().oscillators.length).toBe(firstCycle);

    vi.advanceTimersByTime(2_400);
    expect(context().oscillators.length).toBe(firstCycle * 2);

    stopRingtone();
    expect(ringtonePlaying()).toBe(false);
    vi.advanceTimersByTime(10_000);
    expect(context().oscillators.length).toBe(firstCycle * 2);
  });

  it("desligar os sons interrompe o toque", async () => {
    const { startRingtone, setSoundsEnabled, ringtonePlaying } =
      await loadSounds();
    startRingtone();
    expect(ringtonePlaying()).toBe(true);
    setSoundsEnabled(false);
    expect(ringtonePlaying()).toBe(false);
  });

  it("o motivo do toque é diferente dos avisos de entrada e saída", async () => {
    const { startRingtone, playSound } = await loadSounds();
    startRingtone();
    const ringtone = context().oscillators.length;
    context().oscillators.length = 0;
    playSound("join");
    expect(context().oscillators.length).not.toBe(ringtone);
  });
});
