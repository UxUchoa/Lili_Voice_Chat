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
import { migratePreferences } from "./preferences";
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
        /**
         * Ligado por padrão: quem compartilha um jogo, um vídeo ou uma aba
         * está compartilhando o que ele **faz**, e metade disso é som. Chegar
         * do outro lado mudo é o resultado errado na maioria das vezes, e a
         * pessoa que compartilha nem descobre — ninguém vê o próprio silêncio.
         *
         * Ficou desligado por uma boa razão, que continua verdadeira: no
         * Windows o Chromium só entrega o loopback da saída inteira, então vai
         * junto música, notificação e as outras conversas. A razão é boa para
         * **avisar**, não para decidir sozinho — o seletor diz exatamente isso
         * antes de compartilhar, e desligar é um clique.
         */
        shareSystemAudio: true,
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
      // O histórico das versões e o porquê de cada uma estão em
      // `preferences.ts`, junto da função que as aplica.
      version: 2,
      migrate: (persisted, from) => migratePreferences(persisted, from) as never,
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
