/**
 * Quem decide o que o `getDisplayMedia` do renderer vai capturar.
 *
 * Até a 0.2.1 o desktop capturava por `getUserMedia` com as restrições legadas
 * `chromeMediaSource: "desktop"`, pedindo vídeo e áudio na mesma chamada. O
 * vídeo continuou vindo; o áudio parou. Essa via deixou de conceder loopback
 * nas versões recentes do Chromium, e a falha era do pior tipo possível: a
 * tentativa com áudio lançava, o renderer repetia sem áudio, e a transmissão
 * subia muda. Sem erro, sem aviso — e invisível exatamente para quem
 * compartilha, que é a única pessoa que não ouve o resultado.
 *
 * O caminho atual é o handler daqui. `audio: "loopback"` é o que o Electron
 * oferece hoje para o som do sistema, e continua sendo a saída inteira, não a
 * janela escolhida: o Windows não separa áudio por janela.
 *
 * `"loopback"` e não `"loopbackWithMute"`: o segundo silencia os alto-falantes
 * de quem compartilha, e quem está mostrando um vídeo quer ouvi-lo também.
 *
 * Vive fora de `main.mjs` para poder ser exercitado por um Electron de teste.
 * Era a única parte do compartilhamento sem cobertura nenhuma, e foi por ali
 * que o defeito passou.
 */

/** Quanto tempo uma escolha fica de pé esperando o `getDisplayMedia`. */
export const PENDING_SHARE_TIMEOUT_MS = 30_000;

export function createDisplayMediaBridge({
  desktopCapturer,
  session,
  platform = process.platform,
  setTimeout: schedule = setTimeout,
  clearTimeout: unschedule = clearTimeout,
}) {
  /**
   * A fonte que o seletor da aplicação escolheu, esperando ser consumida.
   *
   * O renderer não entrega a fonte direto — quem decide é o processo
   * principal. Então o fluxo é em duas etapas: o renderer marca a escolha
   * aqui, e a chamada seguinte de `getDisplayMedia` a consome.
   */
  let pending = null;
  let timer = null;

  const clear = () => {
    pending = null;
    if (timer) unschedule(timer);
    timer = null;
  };

  /** O loopback de áudio do Chromium só existe no Windows. */
  const audioSupported = () => platform === "win32";

  return {
    /**
     * Registra a escolha do seletor. Some depois de um uso e depois do prazo:
     * uma escolha pendurada seria capturada por um pedido posterior que a
     * pessoa não fez.
     */
    select(sourceId, audio) {
      if (typeof sourceId !== "string" || !sourceId)
        throw new Error("Fonte de compartilhamento inválida.");
      clear();
      pending = { sourceId, audio: audio === true };
      timer = schedule(clear, PENDING_SHARE_TIMEOUT_MS);
      return { audioAvailable: pending.audio && audioSupported() };
    },

    /** Só para teste: o que está pendente agora. */
    peek() {
      return pending;
    },

    /**
     * Resolve um pedido de captura.
     *
     * `isTrusted` decide se o quadro que pediu é o da janela da aplicação;
     * qualquer outro é negado. Negar é `callback({})`, que o Chromium
     * transforma em `NotAllowedError` no renderer.
     */
    async resolve(request, isTrusted) {
      if (!isTrusted(request)) return {};
      const choice = pending;
      clear();
      // Sem escolha registrada não há o que capturar. Adivinhar uma tela e
      // transmiti-la seria pior do que recusar.
      if (!choice) return {};
      const sources = await desktopCapturer.getSources({
        types: ["window", "screen"],
      });
      const source = sources.find((item) => item.id === choice.sourceId);
      if (!source) return {};
      return {
        video: source,
        ...(choice.audio && audioSupported() ? { audio: "loopback" } : {}),
      };
    },

    /**
     * Liga o handler na sessão padrão.
     *
     * `session.defaultSession` é resolvido aqui, e não na construção: ele só
     * existe depois de `app.whenReady()`, e a ponte é montada antes disso.
     */
    register(isTrusted) {
      session.defaultSession.setDisplayMediaRequestHandler(
        (request, callback) => {
          void this.resolve(request, isTrusted)
            .catch((caught) => {
              console.warn("[shell] falha ao resolver a captura", caught);
              return {};
            })
            .then((response) => {
              try {
                callback(response);
              } catch {
                /**
                 * Recusar é `callback({})`, e o Electron sinaliza a recusa
                 * **lançando** ("Video was requested, but no video stream was
                 * provided"). O renderer recebe `NotAllowedError`, que é
                 * exatamente o que se quer — então aqui não há o que fazer.
                 *
                 * Antes este `throw` caía no `catch` de cima, que chamava o
                 * callback outra vez: "One-time callback was called more than
                 * once", e uma rejeição não tratada por recusa.
                 */
              }
            });
        },
        // O seletor é o da própria aplicação, com miniaturas e o ajuste de
        // qualidade; o do sistema abriria uma segunda escolha por cima dela.
        { useSystemPicker: false },
      );
    },
  };
}
