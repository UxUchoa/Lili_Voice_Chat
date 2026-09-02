import { useMemo } from "react";
import type { Channel } from "../domain/types";
import type { MentionTarget } from "../domain/mentions";
import { useAppStore } from "../store/appStore";

/**
 * Quem pode ser mencionado neste canal — item 5.
 *
 * A lista sai do mesmo lugar de onde `useOnlineMessages` resolve a notificação:
 * perfis do workspace e cargos do servidor. Montar em outro lugar deixaria a
 * sugestão oferecendo alguém que a resolução do envio não encontraria depois.
 *
 * O `token` é o `username` da pessoa e o nome do cargo, porque é isso que o
 * casamento procura no corpo da mensagem. O `label` é o nome de exibição, que
 * é o que a pessoa reconhece na lista e no destaque.
 */
export function useMentionTargets(channel: Channel): MentionTarget[] {
  const profiles = useAppStore((state) => state.profiles);
  const roles = useAppStore((state) => state.roles);
  const members = useAppStore((state) => state.members);
  const currentUserId = useAppStore((state) => state.currentUserId);
  const channelMembers = useAppStore((state) => state.channelMembers);

  return useMemo(() => {
    const direct = channel.serverId === "direct";
    // Numa conversa direta só existem os participantes dela; num servidor, quem
    // é membro. Oferecer o workspace inteiro sugeriria gente que nem enxerga o
    // canal e que, mencionada, não seria notificada de nada.
    const allowedIds = direct
      ? new Set(
          channelMembers
            .filter((member) => member.channelId === channel.id)
            .map((member) => member.userId),
        )
      : new Set(
          members
            .filter((member) => member.serverId === channel.serverId)
            .map((member) => member.userId),
        );

    // A própria pessoa entra na lista, e sempre: sem ela aqui, o `@fulano` que
    // alguém escreveu para ela ficava sem destaque na tela — notificava e
    // aparecia como texto cru. `suggestMentions` é quem a tira das sugestões.
    const people: MentionTarget[] = profiles
      .filter(
        (profile) =>
          profile.id === currentUserId || allowedIds.has(profile.id),
      )
      .map((profile) => ({
        id: profile.id,
        token: profile.username,
        label: profile.displayName,
        hint: `@${profile.username}`,
        kind: "user" as const,
        self: profile.id === currentUserId,
      }));

    // Cargo só existe em servidor, e o @everyone padrão tem caminho próprio.
    const serverRoles: MentionTarget[] = direct
      ? []
      : roles
          .filter((role) => role.serverId === channel.serverId && !role.isDefault)
          .map((role) => ({
            id: role.id,
            token: role.name,
            label: role.name,
            hint: role.mentionable ? "Cargo" : "Cargo · menção desligada",
            kind: "role" as const,
            mentionable: role.mentionable,
          }));

    return [...people, ...serverRoles].sort((a, b) =>
      a.label.localeCompare(b.label, "pt-BR"),
    );
  }, [
    channel.id,
    channel.serverId,
    profiles,
    roles,
    members,
    channelMembers,
    currentUserId,
  ]);
}
