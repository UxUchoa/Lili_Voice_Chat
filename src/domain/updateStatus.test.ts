import { describe, expect, it } from "vitest";
import { summarizeUpdate } from "./updateStatus";

describe("o painel de atualizações", () => {
  it("fala da versão que está rodando, não da anunciada", () => {
    // O caso que produziu a tela contraditória: rodando a 0.2.0, e a checagem
    // não achou nada — então `version` passou a valer a última publicada.
    // Mostrar `version` como se fosse a instalada era o erro.
    const resumo = summarizeUpdate({
      status: "current",
      appVersion: "0.2.1",
      version: "0.2.0",
    });
    expect(resumo.installed).toBe("0.2.1");
    expect(resumo.state).toBe("em dia");
  });

  it("conta quando a publicada ficou para trás da instalada", () => {
    // Build feita aqui e ainda não publicada. "Em dia" sozinho manda procurar
    // o defeito na tela, quando o que falta é a release.
    expect(
      summarizeUpdate({
        status: "current",
        appVersion: "0.2.1",
        version: "0.2.0",
      }).announcement,
    ).toBe("A mais recente publicada é a 0.2.0.");
  });

  it("não acrescenta nada quando as duas versões batem", () => {
    expect(
      summarizeUpdate({
        status: "current",
        appVersion: "0.2.1",
        version: "0.2.1",
      }).announcement,
    ).toBeNull();
  });

  it("anuncia a versão nova sem trocar a instalada de lugar", () => {
    const resumo = summarizeUpdate({
      status: "available",
      appVersion: "0.2.0",
      version: "0.2.1",
    });
    expect(resumo.installed).toBe("0.2.0");
    expect(resumo.announcement).toBe("Versão 0.2.1 disponível.");
  });

  it("mostra o progresso do download", () => {
    const resumo = summarizeUpdate({
      status: "downloading",
      appVersion: "0.2.0",
      version: "0.2.1",
      progress: 42.6,
    });
    expect(resumo.state).toBe("baixando 43%");
    expect(resumo.announcement).toBe("Baixando a versão 0.2.1.");
  });

  it("traduz todos os estados que o processo principal envia", () => {
    // Sem isto o painel imprimia `current`, `idle`, `unconfigured` — palavras
    // que não são da interface e não querem dizer nada para quem lê.
    const estados = [
      "idle",
      "development",
      "unconfigured",
      "checking",
      "available",
      "downloading",
      "current",
      "ready",
      "error",
      "denied",
    ];
    for (const status of estados) {
      const texto = summarizeUpdate({ status, appVersion: "0.2.1" }).state;
      expect(texto).not.toBe(status);
      expect(texto.length).toBeGreaterThan(0);
    }
  });

  it("aguenta não ter estado nenhum ainda", () => {
    expect(summarizeUpdate(null)).toEqual({
      installed: "…",
      state: "carregando",
      announcement: null,
    });
  });

  it("cai na anunciada quando a instalada não veio", () => {
    // `appVersion` é opcional no tipo; uma casca antiga pode não mandá-la, e
    // "…" no lugar de um número seria pior do que a única versão conhecida.
    expect(
      summarizeUpdate({ status: "current", version: "0.2.0" }).installed,
    ).toBe("0.2.0");
  });
});
