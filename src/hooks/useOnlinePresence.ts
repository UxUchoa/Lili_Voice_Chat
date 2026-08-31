import { useEffect, useRef } from "react";
import { supabase } from "../services/online/client";
import { useAppStore } from "../store/appStore";

// A presença é por conta, não por canal: um amigo continua online mesmo quando
// está em outro servidor ou na tela de amigos. Rastrear por canal fazia toda a
// lista de amigos aparecer offline.
const WORKSPACE_PRESENCE_TOPIC = "presence:workspace";

export function useOnlinePresence(userId: string) {
  const visibleUsersRef = useRef(new Set<string>());
  const updateProfile = useAppStore((state) => state.updateProfile);
  const preferredStatus = useAppStore(
    (state) =>
      state.profiles.find((profile) => profile.id === userId)
        ?.preferredStatus ?? "online",
  );
  useEffect(() => {
    if (!userId) return;
    const realtime = supabase.channel(WORKSPACE_PRESENCE_TOPIC, {
      config: { presence: { key: userId } },
    });
    const sync = () => {
      const state = realtime.presenceState() as Record<
        string,
        Array<{
          userId?: string;
          status?: "online" | "idle" | "dnd" | "offline";
        }>
      >;
      const visibleUsers = new Set<string>();
      for (const [key, entries] of Object.entries(state)) {
        const presence = entries.at(-1);
        const visibleUserId = presence?.userId ?? key;
        visibleUsers.add(visibleUserId);
        updateProfile(visibleUserId, { status: presence?.status ?? "online" });
      }
      for (const previousUserId of visibleUsersRef.current)
        if (!visibleUsers.has(previousUserId) && previousUserId !== userId)
          updateProfile(previousUserId, { status: "offline" });
      visibleUsersRef.current = visibleUsers;
    };
    const effectiveStatus = () =>
      preferredStatus === "invisible"
        ? "offline"
        : preferredStatus === "dnd"
          ? "dnd"
          : preferredStatus === "idle" || document.hidden
            ? "idle"
            : "online";
    realtime.on("presence", { event: "sync" }, sync).subscribe(async (status) => {
      if (status === "SUBSCRIBED")
        await realtime.track({
          userId,
          status: effectiveStatus(),
          at: Date.now(),
        });
    });
    const onVisibility = () =>
      void realtime.track({
        userId,
        status: effectiveStatus(),
        at: Date.now(),
      });
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      void realtime.untrack();
      void supabase.removeChannel(realtime);
      visibleUsersRef.current = new Set();
    };
  }, [preferredStatus, updateProfile, userId]);
}
