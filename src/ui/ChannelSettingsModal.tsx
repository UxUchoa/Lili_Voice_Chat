import { useEffect, useMemo, useState } from "react";
import type { Channel, PermissionOverride, Role, ServerMember, Profile } from "../domain/types";
import { Permissions, hasPermission } from "../domain/permissions";
import { IconHash, IconTrash, IconVolume, IconX } from "./icons";
import { ModalPortal } from "./ModalPortal";
import { useConfirm } from "./ConfirmModal";

export type ChannelPermissionState = "inherit" | "allow" | "deny";

const STATE_LABEL: Record<ChannelPermissionState, string> = {
  deny: "Negar",
  inherit: "Herdar",
  allow: "Permitir",
};

/** Permissões que fazem sentido ajustar por canal, agrupadas como no Discord. */
const PERMISSION_GROUPS: Array<{
  title: string;
  kinds: Array<Channel["kind"]>;
  names: Array<keyof typeof Permissions>;
}> = [
  {
    title: "Geral do canal",
    kinds: ["text", "voice", "category"],
    names: ["VIEW_CHANNEL", "MANAGE_CHANNELS", "MANAGE_ROLES", "CREATE_INVITES"],
  },
  {
    title: "Permissões de texto",
    kinds: ["text", "category"],
    names: [
      "SEND_MESSAGES",
      "EMBED_LINKS",
      "ATTACH_FILES",
      "ADD_REACTIONS",
      "MENTION_EVERYONE",
      "MANAGE_MESSAGES",
      "READ_HISTORY",
      "PIN_MESSAGES",
      "BYPASS_SLOWMODE",
    ],
  },
  {
    title: "Permissões de voz",
    kinds: ["voice", "category"],
    names: [
      "CONNECT",
      "SPEAK",
      "STREAM",
      "USE_VAD",
      "MUTE_MEMBERS",
      "DEAFEN_MEMBERS",
      "MOVE_MEMBERS",
    ],
  },
];

const SLOWMODE_OPTIONS = [
  { value: 0, label: "Desligado" },
  { value: 5, label: "5 segundos" },
  { value: 10, label: "10 segundos" },
  { value: 30, label: "30 segundos" },
  { value: 60, label: "1 minuto" },
  { value: 300, label: "5 minutos" },
  { value: 900, label: "15 minutos" },
  { value: 3600, label: "1 hora" },
  { value: 21600, label: "6 horas" },
];

export interface ChannelSettingsActions {
  save: (changes: {
    name: string;
    topic: string;
    slowmodeSeconds: number;
    userLimit: number;
    private: boolean;
  }) => Promise<void>;
  setOverride: (
    targetType: "ROLE" | "MEMBER",
    targetId: string,
    allow: bigint,
    deny: bigint,
  ) => Promise<void>;
  syncWithCategory: () => Promise<void>;
  remove: () => Promise<void>;
}

/**
 * Configurações do canal, no formato do Discord: uma coluna de seções à
 * esquerda e o conteúdo à direita. Antes só existia uma linha de botões nas
 * configurações do servidor, com `window.prompt` para renomear.
 */
export function ChannelSettingsModal({
  channel,
  category,
  roles,
  members,
  profiles,
  overrides,
  actions,
  onClose,
}: {
  channel: Channel;
  category?: Channel;
  roles: Role[];
  members: ServerMember[];
  profiles: Profile[];
  overrides: PermissionOverride[];
  actions: ChannelSettingsActions;
  onClose: () => void;
}) {
  const [section, setSection] = useState<"overview" | "permissions">("overview");
  const [name, setName] = useState(channel.name);
  const [topic, setTopic] = useState(channel.topic);
  const [slowmode, setSlowmode] = useState(channel.slowmodeSeconds);
  const [userLimit, setUserLimit] = useState(channel.userLimit);
  const [isPrivate, setIsPrivate] = useState(channel.private);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const { ask, confirmDialog } = useConfirm();
  const [targetType, setTargetType] = useState<"ROLE" | "MEMBER">("ROLE");
  const [targetId, setTargetId] = useState(
    roles.find((role) => role.isDefault)?.id ?? roles[0]?.id ?? "",
  );

  // O rascunho segue o canal quando ele muda no servidor, mas depende dos
  // valores — não do objeto — para não apagar o que está sendo digitado a
  // cada reconciliação do workspace.
  useEffect(() => {
    setName(channel.name);
    setTopic(channel.topic);
    setSlowmode(channel.slowmodeSeconds);
    setUserLimit(channel.userLimit);
    setIsPrivate(channel.private);
  }, [
    channel.name,
    channel.topic,
    channel.slowmodeSeconds,
    channel.userLimit,
    channel.private,
  ]);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [busy, onClose]);

  const changed =
    name.trim() !== channel.name ||
    topic.trim() !== channel.topic ||
    slowmode !== channel.slowmodeSeconds ||
    userLimit !== channel.userLimit ||
    isPrivate !== channel.private;

  const run = async (action: () => Promise<void>, successMessage = "") => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      if (successMessage) setNotice(successMessage);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "A alteração não pôde ser salva.",
      );
    } finally {
      setBusy(false);
    }
  };

  const targetName =
    (targetType === "ROLE"
      ? roles.find((role) => role.id === targetId)?.name
      : (() => {
          const member = members.find((item) => item.userId === targetId);
          return (
            member?.nickname ??
            profiles.find((item) => item.id === targetId)?.displayName
          );
        })()) ?? "este alvo";

  const override = overrides.find(
    (item) =>
      item.channelId === channel.id &&
      item.targetType === targetType &&
      item.targetId === targetId,
  );
  const allowMask = BigInt(override?.allow ?? "0");
  const denyMask = BigInt(override?.deny ?? "0");
  const stateOf = (permission: bigint): ChannelPermissionState =>
    hasPermission(allowMask, permission)
      ? "allow"
      : hasPermission(denyMask, permission)
        ? "deny"
        : "inherit";
  const setPermission = (
    permission: bigint,
    next: ChannelPermissionState,
    label: string,
  ) => {
    let allow = allowMask & ~permission;
    let deny = denyMask & ~permission;
    if (next === "allow") allow |= permission;
    if (next === "deny") deny |= permission;
    // Estas mudanças gravam na hora, sem passar pelo botão de salvar. Sem
    // avisar, o único jeito de saber se pegou era fechar e reabrir o modal.
    void run(
      () => actions.setOverride(targetType, targetId, allow, deny),
      `${label}: ${STATE_LABEL[next]} salvo para ${targetName}.`,
    );
  };

  const groups = useMemo(
    () => PERMISSION_GROUPS.filter((group) => group.kinds.includes(channel.kind)),
    [channel.kind],
  );
  const targetsWithOverride = new Set(
    overrides
      .filter((item) => item.channelId === channel.id)
      .map((item) => `${item.targetType}:${item.targetId}`),
  );
  const Icon = channel.kind === "voice" ? IconVolume : IconHash;

  return (
    <ModalPortal>
      <div className="modal-backdrop" role="presentation">
      <section
        className="channel-settings-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Configurações de ${channel.name}`}
      >
        <nav className="channel-settings-nav" aria-label="Seções do canal">
          <span className="eyebrow">
            {channel.kind === "category" ? "CATEGORIA" : "CANAL"} ·{" "}
            {channel.name}
          </span>
          <button
            className={section === "overview" ? "active" : ""}
            onClick={() => setSection("overview")}
          >
            Visão geral
          </button>
          <button
            className={section === "permissions" ? "active" : ""}
            onClick={() => setSection("permissions")}
          >
            Permissões
          </button>
          <button
            className="channel-settings-delete"
            disabled={busy}
            onClick={() =>
              ask({
                title:
                  channel.kind === "category"
                    ? "Excluir categoria"
                    : "Excluir canal",
                message: `“${channel.name}” e todas as mensagens dele são apagadas. Não dá para desfazer.`,
                confirmLabel:
                  channel.kind === "category"
                    ? "Excluir categoria"
                    : "Excluir canal",
                danger: true,
                onConfirm: () => void run(actions.remove),
              })
            }
          >
            <span>
              {channel.kind === "category" ? "Excluir categoria" : "Excluir canal"}
            </span>
            <IconTrash size={17} />
          </button>
        </nav>

        <div className="channel-settings-body">
          <button
            className="icon-button channel-settings-close"
            aria-label="Fechar"
            disabled={busy}
            onClick={onClose}
          >
            <IconX size={20} />
          </button>

          {section === "overview" ? (
            <div className="channel-settings-section">
              <h3>Visão geral</h3>
              <label className="server-profile-field">
                <span>
                  Nome {channel.kind === "category" ? "da categoria" : "do canal"}{" "}
                  <em aria-hidden="true">*</em>
                </span>
                <div className="channel-name-input">
                  {channel.kind !== "category" && <Icon size={17} />}
                  <input
                    value={name}
                    maxLength={100}
                    disabled={busy}
                    onChange={(event) => setName(event.target.value)}
                  />
                </div>
              </label>

              {channel.kind !== "category" && (
                <label className="server-profile-field">
                  <span>Tópico</span>
                  <textarea
                    rows={3}
                    value={topic}
                    maxLength={1024}
                    disabled={busy}
                    placeholder="Do que se trata este canal?"
                    onChange={(event) => setTopic(event.target.value)}
                  />
                  <small>{topic.trim().length}/1024</small>
                </label>
              )}

              {channel.kind === "text" && (
                <label className="server-profile-field">
                  <span>Modo lento</span>
                  <select
                    value={slowmode}
                    disabled={busy}
                    onChange={(event) => setSlowmode(Number(event.target.value))}
                  >
                    {SLOWMODE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <small>
                    Membros só podem enviar uma mensagem a cada intervalo, a
                    menos que tenham a permissão de ignorar o modo lento.
                  </small>
                </label>
              )}

              {channel.kind === "voice" && (
                <label className="server-profile-field">
                  <span>
                    Limite de usuários{" "}
                    {userLimit === 0 ? "(sem limite)" : `(${userLimit})`}
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={99}
                    value={userLimit}
                    disabled={busy}
                    onChange={(event) => setUserLimit(Number(event.target.value))}
                  />
                  <small>
                    Zero mantém a sala aberta. Quem tem permissão de mover
                    membros pode ultrapassar o limite.
                  </small>
                </label>
              )}

              {error && (
                <div className="auth-error" role="alert">
                  {error}
                </div>
              )}
            </div>
          ) : (
            <div className="channel-settings-section">
              <h3>Permissões do canal</h3>
              <p className="channel-settings-help">
                Use as permissões para definir quem faz o quê neste canal. O
                que ficar em “Herdar” segue os cargos do servidor.
              </p>

              {category && (
                <div className="channel-sync-card">
                  <div>
                    <b>
                      {channel.permissionsSynced
                        ? `Permissões sincronizadas com a categoria: ${category.name}`
                        : `Permissões separadas da categoria: ${category.name}`}
                    </b>
                    <small>
                      {channel.permissionsSynced
                        ? "Alterar as permissões deste canal desfaz a sincronia."
                        : "Sincronizar novamente substitui as permissões deste canal pelas da categoria."}
                    </small>
                  </div>
                  {!channel.permissionsSynced && (
                    <button
                      className="outline-button"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          actions.syncWithCategory,
                          "Permissões sincronizadas com a categoria.",
                        )
                      }
                    >
                      Sincronizar
                    </button>
                  )}
                </div>
              )}

              <label className="channel-private-toggle">
                <span>
                  <b>
                    {channel.kind === "category"
                      ? "Categoria privada"
                      : "Canal privado"}
                  </b>
                  <small>
                    Nega a visualização para @everyone; cargos e membros
                    liberados abaixo continuam vendo.
                  </small>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={isPrivate}
                  disabled={busy}
                  onChange={(event) => setIsPrivate(event.target.checked)}
                />
                <i className="switch-track" aria-hidden="true" />
              </label>

              <div className="channel-target-picker">
                <div className="channel-target-tabs" role="tablist">
                  <button
                    role="tab"
                    aria-selected={targetType === "ROLE"}
                    className={targetType === "ROLE" ? "active" : ""}
                    onClick={() => {
                      setTargetType("ROLE");
                      setTargetId(
                        roles.find((role) => role.isDefault)?.id ??
                          roles[0]?.id ??
                          "",
                      );
                    }}
                  >
                    Cargos
                  </button>
                  <button
                    role="tab"
                    aria-selected={targetType === "MEMBER"}
                    className={targetType === "MEMBER" ? "active" : ""}
                    onClick={() => {
                      setTargetType("MEMBER");
                      setTargetId(members[0]?.userId ?? "");
                    }}
                  >
                    Membros
                  </button>
                </div>
                <div className="channel-target-list">
                  {targetType === "ROLE"
                    ? roles.map((role) => (
                        <button
                          key={role.id}
                          className={targetId === role.id ? "selected" : ""}
                          onClick={() => setTargetId(role.id)}
                        >
                          <i style={{ background: role.color }} />
                          <span>{role.name}</span>
                          {targetsWithOverride.has(`ROLE:${role.id}`) && (
                            <em title="Tem permissões próprias neste canal">
                              ●
                            </em>
                          )}
                        </button>
                      ))
                    : members.map((member) => {
                        const profile = profiles.find(
                          (item) => item.id === member.userId,
                        );
                        return (
                          <button
                            key={member.userId}
                            className={
                              targetId === member.userId ? "selected" : ""
                            }
                            onClick={() => setTargetId(member.userId)}
                          >
                            <i style={{ background: profile?.color }} />
                            <span>
                              {member.nickname ??
                                profile?.displayName ??
                                member.userId}
                            </span>
                            {targetsWithOverride.has(
                              `MEMBER:${member.userId}`,
                            ) && <em title="Tem permissões próprias">●</em>}
                          </button>
                        );
                      })}
                </div>
              </div>

              {targetId ? (
                <div className="channel-permission-groups">
                  {groups.map((group) => (
                    <section key={group.title}>
                      <span className="eyebrow">
                        {group.title.toUpperCase()}
                      </span>
                      {group.names.map((permissionName) => {
                        const permission = Permissions[permissionName];
                        const state = stateOf(permission);
                        return (
                          <div
                            className="channel-permission-row"
                            key={permissionName}
                          >
                            <span>{permissionName.replaceAll("_", " ")}</span>
                            <div
                              className="channel-permission-switch"
                              role="radiogroup"
                              aria-label={permissionName}
                            >
                              {(
                                [
                                  ["deny", "✕"],
                                  ["inherit", "/"],
                                  ["allow", "✓"],
                                ] as const
                              ).map(([value, glyph]) => (
                                <button
                                  key={value}
                                  role="radio"
                                  aria-checked={state === value}
                                  aria-label={
                                    value === "deny"
                                      ? "Negar"
                                      : value === "allow"
                                        ? "Permitir"
                                        : "Herdar"
                                  }
                                  className={`${value} ${state === value ? "active" : ""}`}
                                  disabled={busy}
                                  onClick={() =>
                                    setPermission(
                                      permission,
                                      value,
                                      permissionName.replaceAll("_", " "),
                                    )
                                  }
                                >
                                  {glyph}
                                </button>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </section>
                  ))}
                </div>
              ) : (
                <p className="empty-copy">
                  Escolha um cargo ou membro para ajustar as permissões.
                </p>
              )}

            </div>
          )}

          {error && (
            <div className="auth-error channel-settings-error" role="alert">
              {error}
            </div>
          )}
          {confirmDialog}
          <div className="settings-action-bar">
            <div className="settings-action-bar-inner">
              <span
                className={`action-bar-hint ${notice ? "success" : ""}`}
                role="status"
              >
                {notice || (changed ? "Alterações não salvas." : "")}
              </span>
              <button
                className="outline-button"
                disabled={busy || !changed}
                onClick={() => {
                  setName(channel.name);
                  setTopic(channel.topic);
                  setSlowmode(channel.slowmodeSeconds);
                  setUserLimit(channel.userLimit);
                  setIsPrivate(channel.private);
                  setNotice("");
                  setError("");
                }}
              >
                Descartar
              </button>
              <button
                className="primary-button"
                disabled={busy || !changed || !name.trim()}
                onClick={() =>
                  void run(
                    () =>
                      actions.save({
                        name: name.trim(),
                        topic: topic.trim(),
                        slowmodeSeconds: slowmode,
                        userLimit,
                        private: isPrivate,
                      }),
                    "Canal atualizado.",
                  )
                }
              >
                {busy ? "Salvando…" : "Salvar alterações"}
              </button>
            </div>
          </div>
        </div>
      </section>
      </div>
    </ModalPortal>
  );
}
