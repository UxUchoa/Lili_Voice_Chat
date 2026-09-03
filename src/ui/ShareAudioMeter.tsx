import { useEffect, useRef, useState } from "react";
import {
  describeShareAudio,
  levelFromSamples,
  shareAudioStatus,
  type ShareAudioStatus,
} from "../hooks/shareAudioLevel";
import { IconVolume } from "./icons";

/**
 * O medidor de som do próprio compartilhamento.
 *
 * Fica no tile da própria tela porque é ali que a pessoa já olha para conferir
 * o que está transmitindo — e era ali que faltava a metade sonora da prova. O
 * porquê inteiro está em `hooks/shareAudioLevel`.
 *
 * Nada aqui é conectado à saída de áudio, de propósito: reproduzir o loopback
 * realimentaria a própria captura, e reproduzir o som do aplicativo entregaria
 * a ele somado a uma cópia atrasada de si mesmo — o mesmo filtro pente que deu
 * timbre de lata na voz duplicada da 0.2.1. A prova é visual justamente porque
 * a sonora não é possível.
 */
export function ShareAudioMeter({
  stream,
  active,
}: {
  stream: MediaStream | null;
  /** A pessoa pediu o som do sistema. Sem isso, não há o que medir nem avisar. */
  active: boolean;
}) {
  const [status, setStatus] = useState<ShareAudioStatus>("aguardando");
  const barRef = useRef<HTMLElement | null>(null);
  const trackId = (active && stream?.getAudioTracks()[0]?.id) || "";

  useEffect(() => {
    if (!active) return;
    const audio = stream?.getAudioTracks()[0] ?? null;
    if (!audio) {
      setStatus("sem-faixa");
      return;
    }
    setStatus("aguardando");
    // A faixa pode morrer no meio — troca de dispositivo de saída, driver que
    // some. Sem isto, o medidor continuaria mostrando o último nível lido de
    // uma transmissão que já emudeceu.
    const ended = () => setStatus("sem-faixa");
    audio.addEventListener("ended", ended);
    const detach = () => audio.removeEventListener("ended", ended);
    if (typeof AudioContext === "undefined") return detach;

    const context = new AudioContext();
    const source = context.createMediaStreamSource(new MediaStream([audio]));
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    // O contexto nasce suspenso quando não há gesto recente; compartilhar é um
    // clique, então isto quase sempre resolve na hora.
    void context.resume().catch(() => {});

    const samples = new Float32Array(analyser.fftSize);
    const startedAt = Date.now();
    let peak = 0;
    // A barra é escrita direto no elemento, e não por estado: sessenta
    // renderizações por segundo no meio da grade de tiles custariam mais que a
    // própria transmissão. Estado só para o status, que muda de raro em raro.
    let frame = requestAnimationFrame(function tick() {
      analyser.getFloatTimeDomainData(samples);
      const level = levelFromSamples(samples);
      peak = Math.max(peak, level);
      if (barRef.current)
        barRef.current.style.transform = `scaleX(${level.toFixed(3)})`;
      setStatus(
        shareAudioStatus({
          hasTrack: true,
          peak,
          elapsedMs: Date.now() - startedAt,
        }),
      );
      frame = requestAnimationFrame(tick);
    });

    return () => {
      cancelAnimationFrame(frame);
      detach();
      source.disconnect();
      analyser.disconnect();
      void context.close().catch(() => {});
    };
  }, [active, stream, trackId]);

  if (!active) return null;
  const warning = describeShareAudio(status);
  const label = warning?.detail ?? "O som do compartilhamento está saindo.";
  return (
    <span
      className={`share-audio-meter${warning ? " warn" : ""}`}
      role="status"
      aria-label={label}
      title={label}
    >
      <IconVolume size={12} />
      {warning ? (
        <span className="share-audio-badge">{warning.badge}</span>
      ) : (
        <span className="share-audio-track" aria-hidden="true">
          <i ref={barRef} />
        </span>
      )}
    </span>
  );
}
