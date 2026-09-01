import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect } from "react";
import {
  editMessage,
  listMessagesPage,
  sendMessage,
} from "../services/online/messages";
import { supabase } from "../services/online/client";
import { reportRuntimeError } from "../services/runtimeErrors";
import { useAppStore } from "../store/appStore";

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const containsMention = (text: string, label: string) =>
  new RegExp(`(?:^|\\s)@${escapeRegExp(label)}(?=$|\\s|[.,!?;:])`, "i").test(
    text,
  );

/**
 * Quantas quedas seguidas antes de incomodar o usuário. Três erra pouco: uma
 * queda isolada é rotina, três seguidas já indicam rede ou servidor com
 * problema de verdade.
 */
const PERSISTENT_FAILURES = 3;

export function useOnlineMessages(channelId: string, enabled = true) {
  const queryClient = useQueryClient();
  const currentUserId = useAppStore((state) => state.currentUserId);
  const queryKey = ["online-messages", channelId];

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let failures = 0;
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
          event: "*",
          schema: "public",
          table: "message_attachments",
          filter: `channel_id=eq.${channelId}`,
        },
        () => void queryClient.invalidateQueries({ queryKey }),
      )
      .subscribe((status) => {
        if (!active) return;
        if (status === "SUBSCRIBED") {
          failures = 0;
          reconcile();
          return;
        }
        if (status !== "CHANNEL_ERROR" && status !== "TIMED_OUT") return;
        // O canal cai por qualquer soluço de rede e o supabase-js reassina
        // sozinho. Avisar na primeira queda enchia a tela de vermelho por algo
        // que se resolvia em segundos — e o aviso, aparecendo o tempo todo,
        // deixava de significar alguma coisa. A busca continua funcionando por
        // reconciliação enquanto isso.
        reconcile();
        if (++failures === PERSISTENT_FAILURES)
          reportRuntimeError(
            "A sincronização em tempo real das mensagens está instável. " +
              "As mensagens continuam chegando, com algum atraso.",
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
      listMessagesPage(channelId, pageParam),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    // Uma falha aqui é de rede ou de permissão, não mais de chave. As
    // tentativas continuam porque a primeira leitura costuma coincidir com a
    // reconexão do realtime.
    retry: 3,
    retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 8_000),
  });

  // Uma falha ao decifrar o histórico é o tipo de erro que o usuário só vê
  // como um aviso genérico; o detalhe técnico precisa chegar ao console.
  useEffect(() => {
    if (query.error)
      console.error("[messages] falha ao listar mensagens", {
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
      return sendMessage(currentUserId, {
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
      editMessage(input.messageId, {
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
