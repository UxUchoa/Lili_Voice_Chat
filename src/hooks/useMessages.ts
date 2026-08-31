import { useOnlineMessages } from "./useOnlineMessages";

export function useMessages(channelId: string) {
  return useOnlineMessages(channelId, true);
}
