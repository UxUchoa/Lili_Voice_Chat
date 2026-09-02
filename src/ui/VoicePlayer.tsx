import { useEffect, useRef, useState } from "react";
import { formatDuration } from "../domain/voiceMessage";
import { IconLoader, IconPause, IconPlay } from "./icons";

const SPEEDS = [1, 1.5, 2] as const;

/**
 * Player da mensagem de voz — item 22.
 *
 * O `<audio controls>` nativo é desenhado pelo navegador e não aceita CSS: no
 * Chromium ele aparece como uma barra clara, com fonte própria, dentro de uma
 * interface escura. Por isso os controles são remontados aqui.
 *
 * O áudio só é buscado quando alguém toca. Carregar sozinho gastaria a banda
 * de quem está apenas lendo o histórico, e uma conversa com muitas mensagens
 * de voz baixaria tudo de uma vez.
 */
export function VoicePlayer({
  name,
  durationHint,
  onResolveUrl,
}: {
  name: string;
  /** Segundos, quando conhecidos antes de carregar. */
  durationHint?: number;
  /** Busca o arquivo e devolve uma URL tocável. */
  onResolveUrl: () => Promise<string>;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef("");
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(durationHint ?? 0);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);

  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  const ensureUrl = async () => {
    if (url) return url;
    setLoading(true);
    setError("");
    try {
      const next = await onResolveUrl();
      urlRef.current = next;
      setUrl(next);
      return next;
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Falha ao carregar o áudio.",
      );
      return "";
    } finally {
      setLoading(false);
    }
  };

  const toggle = async () => {
    const source = await ensureUrl();
    if (!source) return;
    const node = audioRef.current;
    if (!node) return;
    if (node.paused) await node.play().catch(() => setError("Não foi possível tocar."));
    else node.pause();
  };

  const seek = (value: number) => {
    const node = audioRef.current;
    if (!node || !Number.isFinite(node.duration)) return;
    node.currentTime = value;
    setPosition(value);
  };

  const progress = duration ? (position / duration) * 100 : 0;

  return (
    <div className="voice-player">
      <button
        className="voice-player-toggle"
        aria-label={playing ? `Pausar ${name}` : `Tocar ${name}`}
        disabled={loading}
        onClick={() => void toggle()}
      >
        {loading ? (
          <IconLoader className="icon-spin" size={16} />
        ) : playing ? (
          <IconPause size={16} />
        ) : (
          <IconPlay size={16} />
        )}
      </button>

      <div className="voice-player-track">
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={position}
          aria-label={`Posição de ${name}`}
          disabled={!duration}
          onChange={(event) => seek(Number(event.target.value))}
        />
        <span className="voice-player-fill" aria-hidden="true">
          <i style={{ width: `${Math.min(100, progress)}%` }} />
        </span>
      </div>

      <span className="voice-player-time">
        {formatDuration(position * 1000)}
        {duration ? ` / ${formatDuration(duration * 1000)}` : ""}
      </span>

      <button
        className="voice-player-speed"
        aria-label={`Velocidade ${speed}x`}
        onClick={() => {
          const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
          setSpeed(next);
          if (audioRef.current) audioRef.current.playbackRate = next;
        }}
      >
        {speed}x
      </button>

      {error && (
        <small className="voice-player-error" role="alert">
          {error}
        </small>
      )}

      {url && (
        <audio
          ref={audioRef}
          src={url}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setPosition(0);
          }}
          onTimeUpdate={(event) =>
            setPosition(event.currentTarget.currentTime)
          }
          onLoadedMetadata={(event) => {
            // Um OGG/WebM gravado por `MediaRecorder` costuma vir sem duração
            // no cabeçalho, e o navegador informa `Infinity`. Nesse caso a
            // barra fica sem total até o fim da primeira reprodução.
            const value = event.currentTarget.duration;
            if (Number.isFinite(value)) setDuration(value);
          }}
          onDurationChange={(event) => {
            const value = event.currentTarget.duration;
            if (Number.isFinite(value)) setDuration(value);
          }}
        />
      )}
    </div>
  );
}
