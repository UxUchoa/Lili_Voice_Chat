import { create } from "zustand";
import { persist } from "zustand/middleware";
import { onlineConfig } from "../services/online/config";

/**
 * Navegação da aplicação.
 *
 * Existem dois contextos e eles nunca se sobrepõem: a Home (amigos, conversas
 * diretas e solicitações) e um servidor. Manter isso num estado único e
 * explícito — em vez de um booleano `home` ao lado de um `selectedServerId`
 * que continuava valendo — é o que garante que entrar na Home desmonte todo o
 * conteúdo do servidor, e não apenas o esconda.
 *
 * O endereço é espelhado no hash, no formato do Discord:
 *   #/channels/@me              → Home, tela de amigos
 *   #/channels/@me/requests     → Home, solicitações
 *   #/channels/@me/<channelId>  → Home, conversa direta
 *   #/channels/<serverId>/<channelId> → servidor
 *
 * Assim atualizar a página, colar um link ou usar voltar/avançar do navegador
 * caem sempre no mesmo contexto, e o último canal de cada servidor é
 * lembrado ao alternar entre eles.
 */

export type AppView = "home" | "server";
export type HomeSection = "friends" | "requests" | "dm";

interface NavigationState {
  view: AppView;
  /** Servidor aberto. Vazio na Home — não existe "servidor ativo" lá. */
  serverId: string;
  /** Canal aberto dentro do servidor. */
  serverChannelId: string;
  section: HomeSection;
  /** Conversa direta aberta na Home. */
  dmChannelId: string;
  /** Último canal visitado por servidor, para voltar onde parou. */
  lastChannelByServer: Record<string, string>;
  /** Conta dona deste estado; nav de outra sessão não é reaproveitada. */
  ownerId: string;
  openHome: (section?: Exclude<HomeSection, "dm">) => void;
  openDirectChannel: (channelId: string) => void;
  openServer: (serverId: string, channelId?: string) => void;
  openServerChannel: (serverId: string, channelId: string) => void;
  claim: (userId: string) => void;
  reset: () => void;
}

const initial = {
  view: "home" as AppView,
  serverId: "",
  serverChannelId: "",
  section: "friends" as HomeSection,
  dmChannelId: "",
  lastChannelByServer: {} as Record<string, string>,
  ownerId: "",
};

export const useNavigationStore = create<NavigationState>()(
  persist(
    (set, get) => ({
      ...initial,
      openHome: (section = "friends") =>
        set({
          view: "home",
          section,
          dmChannelId: "",
          // O servidor deixa de existir como contexto: nada de "último
          // servidor" continuar aceso enquanto o usuário está na Home.
          serverId: "",
          serverChannelId: "",
        }),
      openDirectChannel: (channelId) =>
        set({
          view: "home",
          section: "dm",
          dmChannelId: channelId,
          serverId: "",
          serverChannelId: "",
        }),
      openServer: (serverId, channelId) =>
        set((state) => ({
          view: "server",
          serverId,
          serverChannelId:
            channelId ?? state.lastChannelByServer[serverId] ?? "",
          dmChannelId: "",
          section: "friends",
        })),
      openServerChannel: (serverId, channelId) =>
        set((state) => ({
          view: "server",
          serverId,
          serverChannelId: channelId,
          dmChannelId: "",
          lastChannelByServer: {
            ...state.lastChannelByServer,
            [serverId]: channelId,
          },
        })),
      claim: (userId) => {
        if (get().ownerId === userId) return;
        set({ ...initial, ownerId: userId });
      },
      reset: () => set({ ...initial }),
    }),
    {
      name: "janja-navigation-v1",
      partialize: (state) => ({
        view: state.view,
        serverId: state.serverId,
        serverChannelId: state.serverChannelId,
        section: state.section,
        dmChannelId: state.dmChannelId,
        lastChannelByServer: state.lastChannelByServer,
        ownerId: state.ownerId,
      }),
    },
  ),
);

export interface NavigationLocation {
  view: AppView;
  serverId: string;
  channelId: string;
  section: HomeSection;
}

/** Endereço atual → estado. Devolve `null` quando o hash não é uma rota. */
export function parseLocationHash(hash: string): NavigationLocation | null {
  const parts = hash.replace(/^#/, "").split("/").filter(Boolean);
  if (parts[0] !== "channels" || parts.length < 2) return null;
  const [, scope, target = ""] = parts;
  if (scope === "@me") {
    if (target === "requests")
      return { view: "home", serverId: "", channelId: "", section: "requests" };
    if (target)
      return {
        view: "home",
        serverId: "",
        channelId: target,
        section: "dm",
      };
    return { view: "home", serverId: "", channelId: "", section: "friends" };
  }
  return {
    view: "server",
    serverId: scope,
    channelId: target,
    section: "friends",
  };
}

/** Um código de convite tem 12 caracteres de base64url; nada além disso entra. */
const INVITE_CODE = /^[A-Za-z0-9_-]{4,64}$/;

const codeFromParts = (parts: string[]) =>
  parts[0] === "invite" && parts[1] && INVITE_CODE.test(parts[1])
    ? parts[1]
    : "";

/**
 * `#/invite/<codigo>` → `<codigo>`.
 *
 * O convite é uma rota à parte do par Home/servidor porque ainda não se sabe
 * para onde ele leva: o servidor só é conhecido depois que o código é trocado.
 */
export function inviteCodeFromHash(hash: string): string {
  return codeFromParts(hash.replace(/^#/, "").split("/").filter(Boolean));
}

/**
 * O código do convite, venha ele no caminho ou no fragmento.
 *
 * As duas formas existem por um motivo, e não por indecisão. O fragmento nunca
 * chega ao servidor — é isso que ele é —, então um endereço `#/invite/CODE`
 * chega ao Discord, ao WhatsApp e a qualquer coisa que desdobre links como se
 * fosse a página inicial do site. Era por isso que todo convite virava o mesmo
 * cartão "Lili — Voice Chat", sem dizer para qual servidor chamava.
 *
 * O caminho `/invite/CODE` chega. Os links novos são assim, e é o que permite
 * responder com o nome e o ícone do servidor antes de qualquer login.
 *
 * O fragmento continua sendo lido porque os convites já copiados por aí não
 * deixam de existir quando o formato muda.
 */
export function inviteCodeFromLocation(hash: string, pathname: string): string {
  return (
    inviteCodeFromHash(hash) ||
    codeFromParts(pathname.split("/").filter(Boolean))
  );
}

/**
 * O endereço que se manda para alguém entrar no servidor.
 *
 * Sai do site, nunca da origem atual: no desktop empacotado a origem é
 * `file://`, e o convite copiado de lá viraria `file:///#/invite/CODE` — um
 * endereço que só abriria no computador de quem copiou, se abrisse.
 */
export function inviteUrl(code: string): string {
  const base = onlineConfig.siteUrl || window.location.origin;
  return `${base}/invite/${code}`;
}

/** Estado → endereço. */
export function locationHash(state: {
  view: AppView;
  serverId: string;
  serverChannelId: string;
  section: HomeSection;
  dmChannelId: string;
}) {
  if (state.view === "server")
    return `#/channels/${state.serverId}${
      state.serverChannelId ? `/${state.serverChannelId}` : ""
    }`;
  if (state.section === "dm" && state.dmChannelId)
    return `#/channels/@me/${state.dmChannelId}`;
  if (state.section === "requests") return "#/channels/@me/requests";
  return "#/channels/@me";
}
