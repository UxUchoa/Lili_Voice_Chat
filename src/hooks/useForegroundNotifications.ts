import { useEffect, useRef } from "react";
import { getMlsEngine } from "../crypto/mlsEngine";
import { supabase } from "../services/online/client";
import { reportRuntimeError } from "../services/runtimeErrors";
import { useAppStore } from "../store/appStore";

interface InsertedMessage {
  id: string;
  channel_id: string;
  author_id: string;
}

const notificationBody = (text: string, attachmentCount: number) => {
  const trimmed = text.trim();
  if (trimmed) return trimmed.slice(0, 240);
  if (attachmentCount > 0)
    return `${attachmentCount} ${attachmentCount === 1 ? "anexo" : "anexos"}`;
  return "Nova mensagem cifrada";
};

export function useForegroundNotifications(
  userId: string,
  activeChannelId: string,
) {
  const activeChannelRef = useRef(activeChannelId);
  useEffect(() => {
    activeChannelRef.current = activeChannelId;
  }, [activeChannelId]);

  useEffect(() => {
    if (!userId) return;
    let mounted = true;
    let deliveryQueue = Promise.resolve();

    const deliver = async (row: InsertedMessage) => {
      if (
        row.author_id === userId ||
        (document.visibilityState === "visible" &&
          activeChannelRef.current === row.channel_id)
      )
        return;

      const { data: eventType, error } = await supabase.rpc(
        "notification_event_for_message",
        { p_message_id: row.id },
      );
      if (error) throw error;
      if (!mounted || !eventType) return;

      const messages = await (
        await getMlsEngine(userId)
      ).listMessages(row.channel_id);
      if (!mounted) return;
      const message = messages.find((item) => item.id === row.id);
      if (!message) return;

      const workspace = useAppStore.getState();
      const author = workspace.profiles.find(
        (profile) => profile.id === row.author_id,
      );
      const channel = workspace.channels.find(
        (item) => item.id === row.channel_id,
      );
      const location =
        channel?.serverId === "direct"
          ? channel.name
          : `#${channel?.name ?? "canal"}`;
      const title = `${author?.displayName ?? "Nova mensagem"} · ${location}`;
      const body = notificationBody(message.text, message.attachments.length);

      if (window.liliDesktop) {
        window.liliDesktop.notify(title, body);
      } else if (
        "Notification" in window &&
        Notification.permission === "granted"
      ) {
        new Notification(title, { body, tag: `lili-message-${row.id}` });
      }
    };

    const realtime = supabase
      .channel(`foreground-notifications:${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const row = payload.new as InsertedMessage;
          if (!row.id || !row.channel_id || !row.author_id) return;
          deliveryQueue = deliveryQueue
            .catch(() => undefined)
            .then(() => deliver(row))
            .catch((caught) =>
              reportRuntimeError("Falha ao entregar notificação local", caught),
            );
        },
      )
      .subscribe();

    return () => {
      mounted = false;
      void supabase.removeChannel(realtime);
    };
  }, [userId]);
}
