import { describe, expect, it } from "vitest";
import { planPublications, publicationSlot } from "./publishPlan";

/** MediaStream não existe no Node; o plano só lê `id` e `kind`. */
function fakeTrack(id: string, kind: "audio" | "video") {
  return { id, kind } as unknown as MediaStreamTrack;
}
function fakeStream(...tracks: MediaStreamTrack[]) {
  return { getTracks: () => tracks } as unknown as MediaStream;
}

describe("publicationSlot", () => {
  it("separa microfone, câmera, tela e áudio da tela", () => {
    expect(publicationSlot("audio", "camera")).toBe("microphone");
    expect(publicationSlot("video", "camera")).toBe("camera");
    expect(publicationSlot("video", "screen")).toBe("screen");
    expect(publicationSlot("audio", "screen")).toBe("screen-audio");
  });
});

describe("planPublications", () => {
  it("publica microfone, câmera, tela e áudio da tela juntos", () => {
    // O compartilhamento não substitui o microfone: quem mostra o jogo
    // continua falando por cima dele.
    const plan = planPublications([
      {
        stream: fakeStream(fakeTrack("m", "audio"), fakeTrack("c", "video")),
        origin: "camera",
      },
      {
        stream: fakeStream(fakeTrack("s", "video"), fakeTrack("sa", "audio")),
        origin: "screen",
      },
    ]);
    expect([...plan.keys()].sort()).toEqual(["c", "m", "s", "sa"]);
    expect(plan.get("sa")?.slot).toBe("screen-audio");
    expect(plan.get("m")?.slot).toBe("microphone");
  });

  it("recusa uma segunda track do mesmo microfone", () => {
    // Era a voz fantasma: duas capturas do mesmo microfone publicadas ao mesmo
    // tempo chegam do outro lado como duas pessoas falando com poucos
    // milissegundos de diferença.
    const plan = planPublications([
      {
        stream: fakeStream(
          fakeTrack("mic-1", "audio"),
          fakeTrack("mic-2", "audio"),
        ),
        origin: "camera",
      },
    ]);
    expect([...plan.keys()]).toEqual(["mic-1"]);
  });

  it("recusa uma segunda câmera e uma segunda tela", () => {
    const plan = planPublications([
      {
        stream: fakeStream(
          fakeTrack("cam-1", "video"),
          fakeTrack("cam-2", "video"),
        ),
        origin: "camera",
      },
      {
        stream: fakeStream(
          fakeTrack("tela-1", "video"),
          fakeTrack("tela-2", "video"),
        ),
        origin: "screen",
      },
    ]);
    expect([...plan.keys()].sort()).toEqual(["cam-1", "tela-1"]);
  });

  it("mantém a track que já estava no ar, e não a recém-chegada", () => {
    // Trocar uma transmissão que funciona pela duplicata seria pagar o preço
    // do bug duas vezes.
    const plan = planPublications([
      {
        stream: fakeStream(
          fakeTrack("antiga", "audio"),
          fakeTrack("nova", "audio"),
        ),
        origin: "camera",
      },
    ]);
    expect(plan.get("antiga")).toBeDefined();
    expect(plan.get("nova")).toBeUndefined();
  });

  it("não publica nada quando não há stream nenhum", () => {
    expect(planPublications([]).size).toBe(0);
  });
});
