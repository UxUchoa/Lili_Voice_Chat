import { useEffect, useRef, useState } from "react";
import {
  VOICE_MAX_MS,
  formatDuration,
  pickVoiceFormat,
  voiceFileName,
  type VoiceFormat,
} from "../domain/voiceMessage";

type Stage = "idle" | "requesting" | "recording" | "ready" | "denied";

/**
 * Gravação de mensagem de voz no compositor — item 22.
 *
 * A gravação para sozinha em um minuto e já fica pronta para enviar, em vez de
 * simplesmente ser cortada: quem falou até o limite não perde o que gravou.
 *
 * O microfone só é pedido quando a pessoa clica em gravar. Pedir na montagem
 * faria o navegador mostrar o aviso de permissão a quem só queria escrever.
 */
export function VoiceRecorder({
  onReady,
  onCancel,
}: {
  /** Entrega o arquivo pronto; o compositor cuida do envio. */
  onReady: (file: File) => void;
  onCancel: () => void;
}) {
  const [stage, setStage] = useState<Stage>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<{ url: string; file: File } | null>(
    null,
  );

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const formatRef = useRef<VoiceFormat | null>(null);
  const startedAtRef = useRef(0);
  const previewUrlRef = useRef("");

  /** Solta microfone e URL de prévia; deixar qualquer um dos dois aberto
      mantém o indicador de gravação do sistema aceso depois de sair. */
  const release = () => {
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = "";
    }
  };

  useEffect(() => release, []);

  useEffect(() => {
    if (stage !== "recording") return;
    const timer = window.setInterval(() => {
      const now = Date.now() - startedAtRef.current;
      setElapsed(now);
      if (now >= VOICE_MAX_MS) recorderRef.current?.stop();
    }, 100);
    return () => window.clearInterval(timer);
  }, [stage]);

  const start = async () => {
    setError("");
    if (typeof MediaRecorder === "undefined") {
      setStage("denied");
      setError("Este navegador não grava áudio.");
      return;
    }
    const format = pickVoiceFormat((mime) => MediaRecorder.isTypeSupported(mime));
    if (!format) {
      setStage("denied");
      setError("Este navegador não grava em nenhum formato compatível.");
      return;
    }
    formatRef.current = format;
    setStage("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream, { mimeType: format.mime });
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: format.mime });
        const file = new File([blob], voiceFileName(format), {
          type: format.mime,
        });
        const url = URL.createObjectURL(blob);
        previewUrlRef.current = url;
        setPreview({ url, file });
        setStage("ready");
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      };
      startedAtRef.current = Date.now();
      setElapsed(0);
      recorder.start();
      setStage("recording");
    } catch (caught) {
      release();
      setStage("denied");
      setError(
        caught instanceof DOMException && caught.name === "NotAllowedError"
          ? "O microfone está bloqueado. Libere o acesso nas permissões do site e tente de novo."
          : "Não foi possível acessar o microfone.",
      );
    }
  };

  const discard = () => {
    recorderRef.current?.stop();
    release();
    setPreview(null);
    setStage("idle");
    onCancel();
  };

  if (stage === "idle")
    return (
      <button
        className="voice-record-start"
        aria-label="Gravar mensagem de voz"
        title="Gravar mensagem de voz"
        onClick={() => void start()}
      >
        🎙
      </button>
    );

  return (
    <div className="voice-recorder" role="group" aria-label="Mensagem de voz">
      {stage === "requesting" && <span>Pedindo o microfone…</span>}

      {stage === "denied" && (
        <>
          <span className="voice-recorder-error" role="alert">
            {error}
          </span>
          <button className="outline-button" onClick={discard}>
            Fechar
          </button>
        </>
      )}

      {stage === "recording" && (
        <>
          <span className="voice-recorder-dot" aria-hidden="true" />
          <span className="voice-recorder-clock">
            {formatDuration(elapsed)} / {formatDuration(VOICE_MAX_MS)}
          </span>
          <span className="voice-recorder-bar" aria-hidden="true">
            <i style={{ width: `${(elapsed / VOICE_MAX_MS) * 100}%` }} />
          </span>
          <button
            className="outline-button"
            aria-label="Cancelar gravação"
            onClick={discard}
          >
            Cancelar
          </button>
          <button
            className="primary-button"
            aria-label="Finalizar gravação"
            onClick={() => recorderRef.current?.stop()}
          >
            Finalizar
          </button>
        </>
      )}

      {stage === "ready" && preview && (
        <>
          {/* Prévia antes de enviar: o player nativo basta aqui, porque isto
              some assim que a mensagem sai. O player do design system é o da
              mensagem já enviada. */}
          <audio src={preview.url} controls preload="metadata" />
          <button
            className="outline-button"
            aria-label="Descartar gravação"
            onClick={discard}
          >
            Descartar
          </button>
          <button
            className="primary-button"
            aria-label="Enviar mensagem de voz"
            onClick={() => {
              onReady(preview.file);
              release();
              setPreview(null);
              setStage("idle");
            }}
          >
            Enviar
          </button>
        </>
      )}
    </div>
  );
}
