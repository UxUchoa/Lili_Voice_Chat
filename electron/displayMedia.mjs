/**
 * Quem decide o que o `getDisplayMedia` do renderer vai capturar — imagem e som.
 *
 * Até a 0.2.1 o desktop capturava por `getUserMedia` com as restrições legadas
 * `chromeMediaSource: "desktop"`, pedindo vídeo e áudio na mesma chamada. O
 * vídeo continuou vindo; o áudio parou. Essa via deixou de conceder loopback
 * nas versões recentes do Chromium, e a falha era do pior tipo possível: a
 * tentativa com áudio lançava, o renderer repetia sem áudio, e a transmissão
 * subia muda. Sem erro, sem aviso — e invisível exatamente para quem
 * compartilha, que é a única pessoa que não ouve o resultado.
 *
 * O caminho atual é o handler daqui.
 *
 * ---
 *
 * As três formas de som que o Chromium do Electron sabe capturar no Windows.
 *
 * O tipo declarado do Electron só admite "loopback" e "loopbackWithMute", mas o
 * valor é repassado cru ao serviço de áudio do Chromium, e lá existe uma tabela
 * maior. Medido nesta versão (Electron 43 / Chromium 14x), com um tom de 1 kHz
 * tocando no próprio app e outro de 1,5 kHz num processo separado:
 *
 *     loopback                     próprio −26 dB · externo −22 dB
 *     loopbackWithoutChrome        próprio −77 dB · externo −22 dB
 *     applicationLoopback:<pid>    próprio −76 dB · externo −22 dB
 *
 * O primeiro é a saída inteira do Windows, o próprio Lili incluído — é dali que
 * vinha o eco. O segundo é a mesma saída sem a árvore de processos deste
 * aplicativo. O terceiro é o loopback por processo do WASAPI, com a árvore do
 * alvo *incluída*: é o áudio daquele aplicativo e de mais nada.
 *
 * A palavra "árvore" importa: um navegador desenha a janela no processo
 * principal e toca o som num processo filho de áudio. Medido — apontar para o
 * PID do pai captura o tom emitido pelo filho, então Chrome, Discord e afins
 * funcionam.
 *
 * Aqui escolhemos o terceiro quando a fonte é uma janela e o PID é conhecido, e
 * o primeiro quando é um monitor inteiro. Quem tira o Lili do primeiro é o
 * renderer, pela restrição `restrictOwnAudio: true` — ver `main.tsx`.
 *
 * "loopback" e não "loopbackWithMute": o segundo silencia os alto-falantes de
 * quem compartilha, e quem está mostrando um vídeo quer ouvi-lo também.
 *
 * Vive fora de `main.mjs` para poder ser exercitado por um Electron de teste.
 * Era a única parte do compartilhamento sem cobertura nenhuma, e foi por ali
 * que o defeito passou.
 */

/** Quanto tempo uma escolha fica de pé esperando o `getDisplayMedia`. */
export const PENDING_SHARE_TIMEOUT_MS = 30_000;

/** A saída de áudio inteira do Windows. */
const SYSTEM_LOOPBACK = "loopback";

/** O loopback de uma árvore de processos, pelo PID da raiz. */
export const applicationLoopback = (pid) => `applicationLoopback:${pid}`;

/** Como chamar, para quem compartilha, o som que vai junto. */
export function shareAudioMode(device) {
  if (!device) return "none";
  return device.startsWith("applicationLoopback:") ? "application" : "system";
}

export function createDisplayMediaBridge({
  desktopCapturer,
  session,
  platform = process.platform,
  /**
   * O PID dono de uma janela, ou `null` quando não dá para saber.
   *
   * É injetado porque a tradução é específica do Windows e cara demais para o
   * teste — e porque, sem poder devolver `null` de propósito, não haveria como
   * exercitar a queda para o som do sistema.
   */
  resolveWindowPid = async () => null,
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
  /**
   * Qual escolha é a atual.
   *
   * `select` passou a esperar pela tradução do PID, e duas chamadas seguidas
   * podem ficar em voo ao mesmo tempo — dois cliques no seletor bastam. Sem
   * este contador, a primeira a voltar depois da segunda sobrescreveria a
   * escolha boa, e o prazo que ela deixou armado apagaria a da vez, trinta
   * segundos depois, numa captura que a pessoa acabou de pedir.
   */
  let generation = 0;

  const clear = () => {
    pending = null;
    if (timer) unschedule(timer);
    timer = null;
  };

  /** O loopback de áudio do Chromium só existe no Windows. */
  const audioSupported = () => platform === "win32";

  /**
   * Qual dispositivo de áudio serve a esta fonte.
   *
   * Um monitor não tem processo dono: o que estiver na tela pode vir de
   * qualquer aplicativo, e a saída inteira é a única resposta honesta. Uma
   * janela tem, e aí vale perguntar — o pedido é o som *daquele* aplicativo,
   * não o de tudo o que estiver tocando.
   *
   * Quando o PID não sai, cai para a saída inteira em vez de ir mudo: mudo
   * seria regressão em relação ao que já funcionava, e quem compartilha é
   * justamente quem não percebe o silêncio. Quem chamou fica sabendo qual dos
   * dois aconteceu, pelo `audioMode`, e o aviso na tela diz.
   */
  const audioDeviceFor = async (sourceId) => {
    if (sourceId.startsWith("screen:")) return SYSTEM_LOOPBACK;
    const pid = await resolveWindowPid(sourceId).catch(() => null);
    return typeof pid === "number" && pid > 0
      ? applicationLoopback(pid)
      : SYSTEM_LOOPBACK;
  };

  return {
    /**
     * Registra a escolha do seletor. Some depois de um uso e depois do prazo:
     * uma escolha pendurada seria capturada por um pedido posterior que a
     * pessoa não fez.
     *
     * O PID é resolvido aqui, e não no `resolve`: o renderer já espera por
     * esta chamada antes de pedir a captura, então os poucos centenas de
     * milissegundos da tradução saem de graça — enquanto no `resolve` eles
     * atrasariam o `getDisplayMedia` em si.
     */
    async select(sourceId, audio) {
      if (typeof sourceId !== "string" || !sourceId)
        throw new Error("Fonte de compartilhamento inválida.");
      clear();
      const mine = ++generation;
      const device =
        audio === true && audioSupported()
          ? await audioDeviceFor(sourceId)
          : null;
      const answer = {
        audioAvailable: Boolean(device),
        audioMode: shareAudioMode(device),
      };
      // Chegou tarde: outra escolha foi feita enquanto esta esperava. Quem
      // perguntou ainda merece a resposta do que pediu, mas ela não pode virar
      // a captura da vez.
      if (mine !== generation) return answer;
      clear();
      pending = { sourceId, audio: device };
      timer = schedule(clear, PENDING_SHARE_TIMEOUT_MS);
      return answer;
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
        ...(choice.audio ? { audio: choice.audio } : {}),
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
