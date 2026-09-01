import { useEffect, useRef, useState } from "react";
import { EmojiPicker } from "./EmojiPicker";
import { GifPicker } from "./GifPicker";
import { downloadGifAsFile, type GifResult } from "../services/gifs";

type Tab = "gifs" | "emoji";

/**
 * A gaveta que abre acima do compositor, com GIFs e emoji.
 *
 * O GIF escolhido não vira link: ele é baixado aqui e entregue como arquivo
 * para o mesmo caminho de anexo que qualquer outro envio usa.
 */
export function ComposerPicker({
  onEmoji,
  onFile,
  onClose,
}: {
  onEmoji: (char: string) => void;
  onFile: (file: File) => Promise<void> | void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("gifs");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  const sendGif = async (gif: GifResult) => {
    setBusy(true);
    setError("");
    try {
      await onFile(await downloadGifAsFile(gif));
      onClose();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Não foi possível enviar.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="composer-picker" ref={rootRef}>
      <nav className="picker-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === "gifs"}
          className={tab === "gifs" ? "active" : ""}
          onClick={() => setTab("gifs")}
        >
          GIFs
        </button>
        <button
          role="tab"
          aria-selected={tab === "emoji"}
          className={tab === "emoji" ? "active" : ""}
          onClick={() => setTab("emoji")}
        >
          Emoji
        </button>
      </nav>
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
      {tab === "gifs" ? (
        <GifPicker busy={busy} onPick={(gif) => void sendGif(gif)} />
      ) : (
        <EmojiPicker onPick={onEmoji} />
      )}
    </div>
  );
}
