import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect } from "react";
import { getMlsEngine } from "../crypto/mlsEngine";
import { supabase } from "../services/online/client";
import { reportRuntimeError } from "../services/runtimeErrors";
import { useAppStore } from "../store/appStore";

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const containsMention = (text: string, label: string) =>
  new RegExp(`(?:^|\\s)@${escapeRegExp(label)}(?=$|\\s|[.,!?;:])`, "i").test(
    text,
  );

export function useOnlineMessages(channelId: string, enabled = true) {
  const queryClient = useQueryClient();
  const currentUserId = useAppStore((state) => state.currentUserId);
  const queryKey = ["online-messages", channelId];

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const reconcile = () => void queryClient.invalidateQueries({ queryKey });
    const online = () => reconcile();
    const realtime = supabase
      .channel(`messages:${channelId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "messages",
          filter: `channel_id=eq.${channelId}`,
        },
        () => void queryClient.invalidateQueries({ queryKey }),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "message_reactions" },
        () => void queryClient.invalidateQueries({ queryKey }),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "message_pins",
          filter: `channel_id=eq.${channelId}`,
        },
        () => void queryClient.invalidateQueries({ queryKey }),
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "mls_group_events",
          filter: `channel_id=eq.${channelId}`,
        },
        () => void queryClient.invalidateQueries({ queryKey }),
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "channel_key_envelopes",
          filter: `channel_id=eq.${channelId}`,
        },
        // O Welcome deste dispositivo pode chegar depois de a listagem ter
        // renderizado o histórico como bloqueado; reprocessar destrava o canal
        // sem refresh manual.
        () => void queryClient.invalidateQueries({ queryKey }),
      )
      .subscribe((status) => {
        if (!active) return;
        if (status === "SUBSCRIBED") reconcile();
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT")
          reportRuntimeError(
            "A sincronização em tempo real das mensagens foi interrompida",
            status,
          );
      });
    window.addEventListener("online", online);
    return () => {
      active = false;
      window.removeEventListener("online", online);
      void supabase.removeChannel(realtime);
    };
  }, [channelId, enabled, queryClient]);

  const query = useInfiniteQuery({
    queryKey,
    enabled: enabled && Boolean(currentUserId),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      (await getMlsEngine(currentUserId)).listMessagesPage(
        channelId,
        pageParam,
      ),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    // A chave do grupo pode chegar segundos depois de abrir o canal (Welcome,
    // refundação, epoch novo). Sem novas tentativas a conversa ficava presa
    // num erro vermelho até o usuário trocar de canal e voltar.
    retry: 5,
    retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 8_000),
  });

  // Uma falha ao decifrar o histórico é o tipo de erro que o usuário só vê
  // como um aviso genérico; o detalhe técnico precisa chegar ao console.
  useEffect(() => {
    if (query.error)
      console.error("[e2ee] falha ao listar mensagens", {
        channelId,
        error: query.error,
      });
  }, [channelId, query.error]);

  const resolveMentions = (text: string) => {
    const workspace = useAppStore.getState();
    const channel = workspace.channels.find((item) => item.id === channelId);
    const serverId =
      channel?.serverId === "direct" ? undefined : channel?.serverId;
    const mentionRecipientIds = workspace.profiles
      .filter(
        (profile) =>
          profile.id !== currentUserId &&
          containsMention(text, profile.username),
      )
      .map((profile) => profile.id);
    const mentionRoleIds = serverId
      ? workspace.roles
          .filter(
            (role) =>
              role.serverId === serverId &&
              !role.isDefault &&
              containsMention(text, role.name),
          )
          .map((role) => role.id)
      : [];
    const mentionsEveryone = Boolean(
      serverId && containsMention(text, "everyone"),
    );
    const mentionsHere = Boolean(serverId && containsMention(text, "here"));
    const serverMembers = serverId
      ? workspace.members.filter((member) => member.serverId === serverId)
      : [];
    const mentionHereRecipientIds = mentionsHere
      ? serverMembers
          .filter((member) => {
            const status = workspace.profiles.find(
              (profile) => profile.id === member.userId,
            )?.status;
            return status === "online" || status === "idle" || status === "dnd";
          })
          .map((member) => member.userId)
          .filter((userId) => userId !== currentUserId)
      : [];
    const roleRecipientIds = serverMembers
      .filter((member) =>
        member.roleIds.some((roleId) => mentionRoleIds.includes(roleId)),
      )
      .map((member) => member.userId);
    const everyoneRecipientIds = mentionsEveryone
      ? serverMembers.map((member) => member.userId)
      : [];
    const resolvedMentionRecipientIds = [
      ...new Set([
        ...mentionRecipientIds,
        ...mentionHereRecipientIds,
        ...roleRecipientIds,
        ...everyoneRecipientIds,
      ]),
    ].filter((userId) => userId !== currentUserId);
    return {
      mentionRecipientIds,
      mentionRoleIds,
      mentionHereRecipientIds,
      mentionsEveryone,
      mentionsHere,
      resolvedMentionRecipientIds,
    };
  };
  const send = useMutation({
    mutationFn: async (input: {
      authorId: string;
      text: string;
      replyToId?: string;
      files?: File[];
    }) => {
      return (await getMlsEngine(currentUserId)).sendMessage({
        channelId,
        text: input.text,
        replyToId: input.replyToId,
        ...resolveMentions(input.text),
        files: input.files,
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });
  const edit = useMutation({
    mutationFn: async (input: { messageId: string; text: string }) =>
      (await getMlsEngine(currentUserId)).editMessage(input.messageId, {
        text: input.text,
        ...resolveMentions(input.text),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });
  const remove = useMutation({
    mutationFn: async (messageId: string) => {
      const { data: attachments, error: attachmentError } = await supabase
        .from("message_attachments")
        .select("storage_object")
        .eq("message_id", messageId);
      if (attachmentError) throw attachmentError;
      const objects = (attachments ?? []).map((item) => item.storage_object);
      if (objects.length) {
        const { error: storageError } = await supabase.storage
          .from("attachments")
          .remove(objects);
        if (storageError) throw storageError;
        const { error: metadataError } = await supabase
          .from("message_attachments")
          .delete()
          .eq("message_id", messageId);
        if (metadataError) throw metadataError;
      }
      const { error } = await supabase
        .from("messages")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", messageId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });
  const pin = useMutation({
    mutationFn: async (messageId: string) => {
      const { data: existing, error: queryError } = await supabase
        .from("message_pins")
        .select("message_id")
        .eq("message_id", messageId)
        .maybeSingle();
      if (queryError) throw queryError;
      if (existing) {
        const { error } = await supabase
          .from("message_pins")
          .delete()
          .eq("message_id", messageId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("message_pins").insert({
          message_id: messageId,
          channel_id: channelId,
          pinned_by: currentUserId,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });
  const react = useMutation({
    mutationFn: async (input: {
      messageId: string;
      emoji: string;
      userId: string;
    }) => {
      const { data: existing, error: queryError } = await supabase
        .from("message_reactions")
        .select("message_id")
        .eq("message_id", input.messageId)
        .eq("user_id", input.userId)
        .eq("emoji", input.emoji)
        .maybeSingle();
      if (queryError) throw queryError;
      const operation = existing
        ? supabase
            .from("message_reactions")
            .delete()
            .eq("message_id", input.messageId)
            .eq("user_id", input.userId)
            .eq("emoji", input.emoji)
        : supabase.from("message_reactions").insert({
            message_id: input.messageId,
            user_id: input.userId,
            emoji: input.emoji,
          });
      const { error } = await operation;
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  return {
    ...query,
    data: query.data?.pages
      .flatMap((page) => page.messages)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    send,
    edit,
    remove,
    pin,
    react,
  };
}
