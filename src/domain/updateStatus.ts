/**
 * O que o painel de atualizações diz, em português e sem ambiguidade.
 *
 * O painel mostrava `updateState.version` — a versão **anunciada** — e o
 * `status` cru, em inglês. As duas coisas juntas produzem frases que parecem
 * mentira mesmo quando cada metade está certa: "Versão 0.2.0 · estado current",
 * numa máquina onde a pessoa acabava de construir a 0.2.1, lê-se como "o
 * aplicativo está desatualizado e diz que está em dia". Estava tudo correto —
 * rodava a 0.2.0 mesmo, e a mais recente publicada era a 0.2.0 —, e ainda assim
 * a tela não permitia chegar a essa conclusão.
 *
 * A regra: quem manda na frase é a versão **que está rodando**, não a
 * anunciada. A anunciada só aparece quando é outra, e aí dizendo o que é.
 *
 * `version` vira a anunciada assim que uma checagem acontece — inclusive na
 * checagem que não encontra nada, quando ela passa a valer a última publicada.
 * É exatamente aí que ela pode ficar **abaixo** da instalada, numa build local
 * ainda não publicada. Chamar isso de "atualizado" e sumir com os dois números
 * é o que não dá para fazer.
 */

/** Um estado de atualização, do jeito que o processo principal o envia. */
export interface UpdateStateInput {
  status: string;
  /** A que está rodando agora. */
  appVersion?: string;
  /** A anunciada — igual à instalada até a primeira checagem. */
  version?: string;
  progress?: number;
}

export interface UpdateSummary {
  /** A versão que está rodando, que é o fato principal da tela. */
  installed: string;
  /** O estado em uma expressão curta. */
  state: string;
  /**
   * A linha extra sobre a versão anunciada, quando ela é outra. `null` quando
   * não há nada a acrescentar — o caso comum de quem está em dia.
   */
  announcement: string | null;
}

const STATES: Record<string, string> = {
  idle: "ainda não procurei",
  development: "modo de desenvolvimento",
  unconfigured: "sem canal de atualização",
  checking: "procurando",
  available: "há uma versão nova",
  downloading: "baixando",
  current: "em dia",
  ready: "pronta para instalar",
  error: "a checagem falhou",
  denied: "acesso negado",
};

export function summarizeUpdate(
  state: UpdateStateInput | null | undefined,
): UpdateSummary {
  if (!state) return { installed: "…", state: "carregando", announcement: null };
  const installed = state.appVersion ?? state.version ?? "…";
  const announced = state.version;
  const label = STATES[state.status] ?? state.status;
  const stateText =
    state.status === "downloading"
      ? `baixando ${Math.round(state.progress ?? 0)}%`
      : label;

  const differs = Boolean(announced) && announced !== installed;
  const announcement =
    state.status === "available" || state.status === "ready"
      ? `Versão ${announced} disponível.`
      : state.status === "downloading"
        ? `Baixando a versão ${announced}.`
        : // Instalada acima da publicada: uma build feita aqui e ainda não
          // publicada. "Em dia" sozinho faria a pessoa procurar o defeito na
          // tela em vez de na release que falta.
          differs && state.status === "current"
          ? `A mais recente publicada é a ${announced}.`
          : null;

  return { installed, state: stateText, announcement };
}
