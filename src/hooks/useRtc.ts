import { useLiveKitRtc } from "./useLiveKitRtc";

export function useRtc(roomId: string) {
  return useLiveKitRtc(roomId, true);
}
