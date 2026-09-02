import type { PresenceStatus, Role, ServerMember } from "./types";

/**
 * Agrupamento da lista de membros — item 11.
 *
 * Antes a lista só separava ONLINE de OFFLINE, e o cargo aparecia como texto
 * embaixo do nome. Num servidor com hierarquia isso apaga justamente a
 * informação que a barra existe para dar: quem é moderador, quem é convidado.
 *
 * Aqui vale o mesmo critério do Discord — cargo com `hoist` vira um grupo
 * próprio, na ordem da hierarquia; quem não tem cargo destacado cai em
 * "Online"; e quem está offline vai para o fim, num grupo só, independente de
 * cargo. Separar offline por cargo encheria a barra de títulos com uma pessoa
 * cada.
 *
 * É função pura para poder ser testada sem store e sem React.
 */

export interface MemberListPerson {
  id: string;
  status: PresenceStatus;
}

export interface MemberGroupResult<P extends MemberListPerson> {
  /** Chave estável para a lista do React. */
  key: string;
  title: string;
  people: P[];
  /** Cor do cargo que dá nome ao grupo, quando há. */
  color?: string;
  offline: boolean;
}

/** Offline e invisível somem do mesmo jeito para quem olha a barra. */
export function isOffline(status: PresenceStatus): boolean {
  return status === "offline" || status === "invisible";
}

/**
 * O cargo destacado de maior posição que a pessoa tem, se tiver algum.
 *
 * Devolve `undefined` quando ela só tem cargos comuns — aí ela pertence ao
 * grupo "Online", e não a um grupo de cargo invisível na hierarquia.
 */
export function hoistRoleOf(
  member: ServerMember | undefined,
  roles: Role[],
): Role | undefined {
  if (!member) return undefined;
  return roles
    .filter(
      (role) =>
        role.hoist && !role.isDefault && member.roleIds.includes(role.id),
    )
    .sort((a, b) => b.position - a.position)[0];
}

/**
 * A cor que o nome recebe: a do cargo colorido de maior posição.
 *
 * Não é necessariamente o cargo que dá nome ao grupo — um cargo pode colorir
 * sem destacar, e é assim que o Discord se comporta.
 */
export function nameColorOf(
  member: ServerMember | undefined,
  roles: Role[],
): string | undefined {
  if (!member) return undefined;
  return roles
    .filter(
      (role) =>
        !role.isDefault &&
        member.roleIds.includes(role.id) &&
        role.color &&
        role.color !== "transparent",
    )
    .sort((a, b) => b.position - a.position)[0]?.color;
}

export function groupMembers<P extends MemberListPerson>(
  people: P[],
  members: ServerMember[],
  roles: Role[],
): MemberGroupResult<P>[] {
  const memberOf = new Map(members.map((member) => [member.userId, member]));
  const hoisted = roles
    .filter((role) => role.hoist && !role.isDefault)
    .sort((a, b) => b.position - a.position);

  const byRole = new Map<string, P[]>();
  const plainOnline: P[] = [];
  const offline: P[] = [];

  for (const person of people) {
    if (isOffline(person.status)) {
      offline.push(person);
      continue;
    }
    const role = hoistRoleOf(memberOf.get(person.id), roles);
    if (!role) {
      plainOnline.push(person);
      continue;
    }
    const bucket = byRole.get(role.id);
    if (bucket) bucket.push(person);
    else byRole.set(role.id, [person]);
  }

  const groups: MemberGroupResult<P>[] = [];
  for (const role of hoisted) {
    const bucket = byRole.get(role.id);
    // Cargo sem ninguém online não vira um título vazio na barra.
    if (bucket?.length)
      groups.push({
        key: `role-${role.id}`,
        title: role.name,
        people: bucket,
        color: role.color || undefined,
        offline: false,
      });
  }
  if (plainOnline.length)
    groups.push({
      key: "online",
      title: "Online",
      people: plainOnline,
      offline: false,
    });
  if (offline.length)
    groups.push({
      key: "offline",
      title: "Offline",
      people: offline,
      offline: true,
    });
  return groups;
}
