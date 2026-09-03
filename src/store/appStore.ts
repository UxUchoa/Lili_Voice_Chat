import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  AuditEntry,
  Ban,
  Block,
  Channel,
  ChannelMember,
  Friendship,
  Invite,
  NotificationSetting,
  PermissionOverride,
  PrivacySetting,
  Profile,
  ReadState,
  Role,
  Server,
  ServerMember,
} from "../domain/types";
import {
  DEFAULT_NOISE_SUPPRESSION,
  type NoiseSuppressionMode,
} from "../services/noiseSuppression";
import {
  deleteOnlineNotificationSetting,
  saveOnlineNotificationSetting,
} from "../services/online/settings";
import type {
  DmState,
  ServerPrivacy,
  UserContact,
} from "../services/online/contacts";
import { reportRuntimeError } from "../services/runtimeErrors";

interface WorkspaceProjection {
  currentUserId: string;
  contacts: UserContact[];
  dmStates: DmState[];
  serverPrivacy: ServerPrivacy[];
  profiles: Profile[];
  servers: Server[];
  channels: Channel[];
  roles: Role[];
  members: ServerMember[];
  friendships: Friendship[];
  blocks: Block[];
  channelMembers: ChannelMember[];
  readStates: ReadState[];
  bans: Ban[];
  invites: Invite[];
  permissionOverrides: PermissionOverride[];
  notificationSettings: NotificationSetting[];
  privacySettings: PrivacySetting[];
  auditLogs: AuditEntry[];
}

interface AppState extends WorkspaceProjection {
  accessibility: {
    textScale: number;
    zoom: number;
    reducedMotion: boolean;
  };
  /**
   * Preferências de captura da chamada. Ficam no cliente porque descrevem
   * este computador — o microfone, a CPU e a placa de som são dele, não da
   * conta — e precisam valer já no primeiro `getUserMedia`, antes de qualquer
   * ida ao servidor.
   */
  voice: {
    noiseSuppression: NoiseSuppressionMode;
    /** Levar o áudio do sistema junto ao compartilhar a tela. */
    shareSystemAudio: boolean;
  };
  hydrateOnline: (state: Partial<WorkspaceProjection>) => void;
  updateProfile: (profileId: string, changes: Partial<Profile>) => void;
  markChannelRead: (channelId: string, messageId?: string) => void;
  setNotificationSetting: (
    setting: Omit<NotificationSetting, "id" | "userId">,
  ) => void;
  clearNotificationSetting: (
    scopeType: NotificationSetting["scopeType"],
    scopeId: string,
  ) => void;
  setAccessibility: (changes: Partial<AppState["accessibility"]>) => void;
  setVoice: (changes: Partial<AppState["voice"]>) => void;
}

const emptyWorkspace: WorkspaceProjection = {
  currentUserId: "",
  contacts: [],
  dmStates: [],
  serverPrivacy: [],
  profiles: [],
  servers: [],
  channels: [],
  roles: [],
  members: [],
  friendships: [],
  blocks: [],
  channelMembers: [],
  readStates: [],
  bans: [],
  invites: [],
  permissionOverrides: [],
  notificationSettings: [],
  privacySettings: [],
  auditLogs: [],
};

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      ...emptyWorkspace,
      accessibility: { textScale: 1, zoom: 1, reducedMotion: false },
      voice: {
        noiseSuppression: DEFAULT_NOISE_SUPPRESSION,
        // Desligado por padrão, e não por economia: no desktop o que o
        // Chromium entrega é o loopback da saída inteira, não o som da janela
        // escolhida. Ligado sem pedir, compartilhar um jogo levava junto
        // Spotify, Discord e notificação. Quem quiser isso liga, sabendo.
        shareSystemAudio: false,
      },
      hydrateOnline: (onlineState) => set(onlineState),
      updateProfile: (profileId, changes) =>
        set((state) => ({
          profiles: state.profiles.map((profile) =>
            profile.id === profileId ? { ...profile, ...changes } : profile,
          ),
        })),
      markChannelRead: (channelId, lastMessageId) => {
        const userId = get().currentUserId;
        const lastReadAt = new Date().toISOString();
        set((state) => ({
          readStates: state.readStates.some(
            (item) => item.channelId === channelId && item.userId === userId,
          )
            ? state.readStates.map((item) =>
                item.channelId === channelId && item.userId === userId
                  ? { ...item, lastMessageId, lastReadAt, mentionCount: 0 }
                  : item,
              )
            : [
                ...state.readStates,
                {
                  channelId,
                  userId,
                  lastMessageId,
                  lastReadAt,
                  mentionCount: 0,
                },
              ],
        }));
      },
      setNotificationSetting: (setting) => {
        const userId = get().currentUserId;
        const previousSettings = get().notificationSettings;
        const existing = get().notificationSettings.find(
          (item) =>
            item.userId === userId &&
            item.scopeType === setting.scopeType &&
            item.scopeId === setting.scopeId,
        );
        const next: NotificationSetting = {
          id: existing?.id ?? crypto.randomUUID(),
          userId,
          ...setting,
        };
        set((state) => ({
          notificationSettings: existing
            ? state.notificationSettings.map((item) =>
                item.id === existing.id ? next : item,
              )
            : [...state.notificationSettings, next],
        }));
        void saveOnlineNotificationSetting(next).catch((error) => {
          set({ notificationSettings: previousSettings });
          reportRuntimeError("Falha ao salvar notificações", error);
        });
      },
      clearNotificationSetting: (scopeType, scopeId) => {
        const userId = get().currentUserId;
        const previousSettings = get().notificationSettings;
        set((state) => ({
          notificationSettings: state.notificationSettings.filter(
            (item) =>
              !(
                item.userId === userId &&
                item.scopeType === scopeType &&
                item.scopeId === scopeId
              ),
          ),
        }));
        void deleteOnlineNotificationSetting(scopeType, scopeId).catch(
          (error) => {
            set({ notificationSettings: previousSettings });
            reportRuntimeError("Falha ao herdar notificações", error);
          },
        );
      },
      setAccessibility: (changes) =>
        set((state) => ({
          accessibility: { ...state.accessibility, ...changes },
        })),
      setVoice: (changes) =>
        set((state) => ({ voice: { ...state.voice, ...changes } })),
    }),
    {
      name: "janja-ui-preferences-v2",
      /**
       * 1 — o áudio do compartilhamento deixa de vir ligado.
       *
       * A preferência é salva, e a fusão abaixo faz o valor guardado vencer o
       * padrão do código. Sem esta migração, mudar o padrão não alcançaria
       * ninguém que já tivesse aberto o aplicativo alguma vez — ou seja,
       * praticamente todo mundo continuaria transmitindo o som do computador
       * inteiro sem ter pedido isso.
       *
       * Só este campo é tocado: o resto das preferências de voz é escolha da
       * pessoa e não tem por que ser desfeita.
       */
      version: 1,
      migrate: (persisted, from) => {
        const state = (persisted ?? {}) as {
          accessibility?: AppState["accessibility"];
          voice?: AppState["voice"];
        };
        if (from >= 1) return state as never;
        return {
          ...state,
          voice: { ...state.voice, shareSystemAudio: false },
        } as never;
      },
      partialize: (state) => ({
        accessibility: state.accessibility,
        voice: state.voice,
      }),
      // Quem já tinha preferências salvas não tem a chave `voice`: sem esta
      // fusão o estado voltava `undefined` e a primeira leitura quebrava.
      merge: (persisted, current) => ({
        ...current,
        ...(persisted as Partial<AppState>),
        accessibility: {
          ...current.accessibility,
          ...(persisted as Partial<AppState>)?.accessibility,
        },
        voice: {
          ...current.voice,
          ...(persisted as Partial<AppState>)?.voice,
        },
      }),
    },
  ),
);
