import { useOnlineMessages } from "./useOnlineMessages";

export function useMessages(channelId: string) {
  return useOnlineMessages(channelId, true);
}

/**
 * A consulta e as mutações de um canal, do jeito que `MessageThread` as recebe.
 *
 * Existe como tipo nomeado porque a conversa passou a ser um componente só,
 * montado tanto na tela cheia quanto no painel de dentro da chamada — e quem
 * envolve o componente é que monta o hook, para não abrir duas assinaturas de
 * tempo real com o mesmo nome de canal.
 */
export type MessageThreadController = ReturnType<typeof useMessages>;
