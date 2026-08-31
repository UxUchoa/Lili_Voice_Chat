import { describe, expect, it } from "vitest";
import { locationHash, parseLocationHash } from "./navigationStore";

describe("endereço da navegação", () => {
  it("lê a Home, as solicitações e uma conversa direta", () => {
    expect(parseLocationHash("#/channels/@me")).toEqual({
      view: "home",
      serverId: "",
      channelId: "",
      section: "friends",
    });
    expect(parseLocationHash("#/channels/@me/requests")).toEqual({
      view: "home",
      serverId: "",
      channelId: "",
      section: "requests",
    });
    expect(parseLocationHash("#/channels/@me/canal-1")).toEqual({
      view: "home",
      serverId: "",
      channelId: "canal-1",
      section: "dm",
    });
  });

  it("lê um servidor com e sem canal", () => {
    expect(parseLocationHash("#/channels/servidor-1/canal-2")).toEqual({
      view: "server",
      serverId: "servidor-1",
      channelId: "canal-2",
      section: "friends",
    });
    expect(parseLocationHash("#/channels/servidor-1")).toMatchObject({
      view: "server",
      serverId: "servidor-1",
      channelId: "",
    });
  });

  it("ignora endereços que não são rotas", () => {
    expect(parseLocationHash("")).toBeNull();
    expect(parseLocationHash("#")).toBeNull();
    expect(parseLocationHash("#/qualquer/coisa")).toBeNull();
    expect(parseLocationHash("#/channels")).toBeNull();
  });

  it("escreve o endereço de cada contexto", () => {
    expect(
      locationHash({
        view: "home",
        serverId: "",
        serverChannelId: "",
        section: "friends",
        dmChannelId: "",
      }),
    ).toBe("#/channels/@me");
    expect(
      locationHash({
        view: "home",
        serverId: "",
        serverChannelId: "",
        section: "requests",
        dmChannelId: "",
      }),
    ).toBe("#/channels/@me/requests");
    expect(
      locationHash({
        view: "home",
        serverId: "",
        serverChannelId: "",
        section: "dm",
        dmChannelId: "canal-1",
      }),
    ).toBe("#/channels/@me/canal-1");
    expect(
      locationHash({
        view: "server",
        serverId: "servidor-1",
        serverChannelId: "canal-2",
        section: "friends",
        dmChannelId: "",
      }),
    ).toBe("#/channels/servidor-1/canal-2");
  });

  it("volta ao mesmo estado depois de ida e volta", () => {
    for (const hash of [
      "#/channels/@me",
      "#/channels/@me/requests",
      "#/channels/@me/canal-1",
      "#/channels/servidor-1/canal-2",
    ]) {
      const parsed = parseLocationHash(hash)!;
      expect(
        locationHash({
          view: parsed.view,
          serverId: parsed.serverId,
          serverChannelId: parsed.channelId,
          section: parsed.section,
          dmChannelId: parsed.channelId,
        }),
      ).toBe(hash);
    }
  });

  it("na Home o endereço nunca carrega um servidor", () => {
    // A regressão que este teste protege: entrar na Home mantendo o último
    // servidor no endereço fazia o refresh voltar para dentro do servidor.
    expect(
      locationHash({
        view: "home",
        serverId: "servidor-antigo",
        serverChannelId: "canal-antigo",
        section: "friends",
        dmChannelId: "",
      }),
    ).toBe("#/channels/@me");
  });
});
