import { useOnlineTyping } from "./useOnlineTyping";

export function useTyping(channelId: string, currentUserId: string) {
  return useOnlineTyping(channelId, currentUserId, true);
}
