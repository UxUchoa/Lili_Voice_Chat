import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../services/online/client";

interface TypingPayload {
  userId: string;
  typing: boolean;
  at: number;
}

export function useOnlineTyping(
  channelId: string,
  currentUserId: string,
  enabled = true,
) {
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const realtimeRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const expiryRef = useRef(new Map<string, number>());
  const stopTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const realtime = supabase.channel(`typing:channel:${channelId}`, {
      config: { private: true, broadcast: { self: false, ack: true } },
    });
    realtimeRef.current = realtime;
    realtime
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        const message = payload as TypingPayload;
        if (!message?.userId || message.userId === currentUserId) return;
        if (message.typing)
          expiryRef.current.set(message.userId, Date.now() + 3_500);
        else expiryRef.current.delete(message.userId);
        setTypingUsers([...expiryRef.current.keys()]);
      })
      .subscribe();
    const interval = window.setInterval(() => {
      const now = Date.now();
      for (const [userId, expiry] of expiryRef.current)
        if (expiry < now) expiryRef.current.delete(userId);
      setTypingUsers([...expiryRef.current.keys()]);
    }, 1_000);
    return () => {
      window.clearInterval(interval);
      if (stopTimerRef.current) window.clearTimeout(stopTimerRef.current);
      expiryRef.current.clear();
      realtimeRef.current = null;
      void supabase.removeChannel(realtime);
    };
  }, [channelId, currentUserId, enabled]);

  const announceTyping = useCallback(() => {
    const realtime = realtimeRef.current;
    if (!enabled || !realtime) return;
    const send = (typing: boolean) =>
      realtime.send({
        type: "broadcast",
        event: "typing",
        payload: {
          userId: currentUserId,
          typing,
          at: Date.now(),
        } satisfies TypingPayload,
      });
    void send(true);
    if (stopTimerRef.current) window.clearTimeout(stopTimerRef.current);
    stopTimerRef.current = window.setTimeout(() => void send(false), 2_500);
  }, [currentUserId, enabled]);

  return { typingUsers, announceTyping };
}
