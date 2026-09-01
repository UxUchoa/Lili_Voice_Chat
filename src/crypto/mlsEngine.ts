import Dexie, { type EntityTable } from "dexie";
import initOpenMls, {
  Group,
  Identity,
  KeyPackage,
  Provider,
  RatchetTree,
} from "./openmls-wasm/openmls_wasm";
import { ATTACHMENT_MAX_BYTES } from "../domain/attachments";
import type { MessagePayload, MessageView } from "../domain/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../services/online/client";
import { assertOnlineStorageUploadAllowed } from "../services/online/quota";
import { collectBatches, selectOlderPage } from "./messagePagination";
import {
  INDEXED_DB_MASTER_KEY,
  MissingLocalMlsKeyError,
  MlsLocalStateError,
  mlsMessageCacheId,
  persistWithSessionFallback,
  shouldReplaceMissingMlsDevice,
  type MlsPersistenceMode,
} from "./mlsPersistence";

import {
  MessagePipelineError,
  runStage,
  traceDecryptFailure,
} from "./pipelineTrace";

export type { MlsPersistenceMode } from "./mlsPersistence";
export { MessagePipelineError } from "./pipelineTrace";

interface DeviceStateRow {
  userId: string;
  deviceId: string;
  identityName?: string;
  publicKey: string;
  wrappedMasterKey: string;
  stateNonce: Uint8Array;
  encryptedProviderState: Uint8Array;
  updatedAt: string;
}

interface DeviceKeyRow {
  userId: string;
  key: CryptoKey;
  createdAt: string;
}

interface ChannelStateRow {
  id: string;
  userId: string;
  channelId: string;
  memberDeviceIds: string[];
  lastEventSequence: number;
  /**
   * Fundador do grupo no momento em que este estado foi gravado. Quando o
   * fundador é substituído (o anterior foi revogado e o grupo refundado), o
   * estado local vira lixo e precisa ser descartado.
   */
  founderDeviceId?: string;
}

interface MessageCacheRow {
  id: string;
  channelId: string;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
  editedAt?: string;
}

interface AccountMessageCacheRow extends MessageCacheRow {
  cacheId: string;
  userId: string;
  messageId: string;
}

interface RecipientDeviceRow {
  device_id: string;
  user_id: string;
  mls_credential: string;
}

interface ActiveMlsMemberRow {
  device_id: string;
  user_id: string;
  mls_credential: string;
  joined_epoch: number;
}

interface SendMessageInput {
  channelId: string;
  text: string;
  replyToId?: string;
  mentionRecipientIds?: string[];
  mentionRoleIds?: string[];
  mentionHereRecipientIds?: string[];
  mentionsEveryone?: boolean;
  mentionsHere?: boolean;
  resolvedMentionRecipientIds?: string[];
  files?: File[];
}

interface EditMessageInput {
  text: string;
  mentionRecipientIds?: string[];
  mentionRoleIds?: string[];
  mentionHereRecipientIds?: string[];
  mentionsEveryone?: boolean;
  mentionsHere?: boolean;
  resolvedMentionRecipientIds?: string[];
}

class MlsStateDatabase extends Dexie {
  devices!: EntityTable<DeviceStateRow, "userId">;
  deviceKeys!: EntityTable<DeviceKeyRow, "userId">;
  channels!: EntityTable<ChannelStateRow, "id">;
  messages!: EntityTable<MessageCacheRow, "id">;
  messagePayloads!: EntityTable<AccountMessageCacheRow, "cacheId">;

  constructor() {
    // O nome do banco local **não** acompanha o rename do produto. Renomeá-lo
    // não migra nada: o IndexedDB antigo simplesmente deixa de ser encontrado,
    // e com ele vão o estado do provider MLS, o cache cifrado de mensagens e a
    // identidade de cada dispositivo. No aplicativo desktop, que persiste entre
    // sessões, isso significaria perder o histórico inteiro por causa de uma
    // mudança de marca.
    super("janja-openmls-v1");
    this.version(1).stores({
      devices: "&userId, deviceId",
      channels: "&id, userId, channelId",
      messages: "&id, channelId",
    });
    this.version(2).stores({
      devices: "&userId, deviceId",
      deviceKeys: "&userId",
      channels: "&id, userId, channelId",
      // `messages` continua intacta como cache legado. As linhas antigas não
      // dizem a qual conta pertencem, então são migradas somente depois que a
      // chave correta consegue decifrá-las.
      messages: "&id, channelId",
      messagePayloads:
        "&cacheId, userId, messageId, channelId, [userId+channelId]",
    });
  }
}

const database = new MlsStateDatabase();
const encoder = new TextEncoder();
const decoder = new TextDecoder();
let wasmReady: Promise<unknown> | undefined;

const ensureWasm = () => (wasmReady ??= initOpenMls());
const toBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
};
const fromBase64 = (value: string) =>
  Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
const asArrayBuffer = (bytes: Uint8Array) => Uint8Array.from(bytes).buffer;

const digestBase64 = async (bytes: Uint8Array) =>
  toBase64(
    new Uint8Array(await crypto.subtle.digest("SHA-256", asArrayBuffer(bytes))),
  );

async function encryptOnlineAttachment(file: File, channelId: string) {
  if (file.size > ATTACHMENT_MAX_BYTES)
    throw new Error(
      `${file.name} excede o limite de ${ATTACHMENT_MAX_BYTES / (1024 * 1024)} MB por arquivo.`,
    );
  const id = crypto.randomUUID();
  const fileKey = crypto.getRandomValues(new Uint8Array(32));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const key = await importAesKey(fileKey);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: asArrayBuffer(nonce) },
      key,
      await file.arrayBuffer(),
    ),
  );
  const storageObject = `${channelId}/${id}/cipher.bin`;
  return {
    metadata: {
      id,
      name: file.name,
      size: file.size,
      mime: file.type || "application/octet-stream",
      storageObject,
      fileKey: toBase64(fileKey),
      nonce: toBase64(nonce),
      ciphertextHash: await digestBase64(ciphertext),
    },
    ciphertext,
  };
}

async function importAesKey(raw: Uint8Array) {
  return crypto.subtle.importKey("raw", asArrayBuffer(raw), "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

async function encryptAtRest(key: CryptoKey, plaintext: Uint8Array) {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: asArrayBuffer(nonce) },
      key,
      asArrayBuffer(plaintext),
    ),
  );
  return { nonce, ciphertext };
}

async function decryptAtRest(
  key: CryptoKey,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
) {
  return new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: asArrayBuffer(nonce) },
      key,
      asArrayBuffer(ciphertext),
    ),
  );
}

async function createMasterKey(userId: string) {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  if (window.janjaDesktop) {
    const wrapped = await window.janjaDesktop.wrapSecret(toBase64(raw));
    return {
      key: await importAesKey(raw),
      wrapped: `desktop:${wrapped}`,
      persistenceMode: "durable" as const,
    };
  }
  const key = await importAesKey(raw);
  let reference = "";
  const persistence = await persistWithSessionFallback(
    async () => {
      // CryptoKey usa structured clone no IndexedDB. `extractable=false`
      // impede que o material bruto seja exportado pela aplicação.
      await database.deviceKeys.put({
        userId,
        key,
        createdAt: new Date().toISOString(),
      });
    },
    () => {
      reference = crypto.randomUUID();
      sessionStorage.setItem(
        `janja.mls.master.${userId}.${reference}`,
        toBase64(raw),
      );
    },
  );
  if (persistence.mode === "durable") {
    return {
      key,
      wrapped: INDEXED_DB_MASTER_KEY,
      persistenceMode: "durable" as const,
    };
  }
  console.warn(
    "[mls] Navegador não persistiu a CryptoKey; usando sessão temporária",
    persistence.error,
  );
  // O nome desta chave também não acompanha o rename: mudá-la faz todo
  // dispositivo existente perder a master key e ser recriado, e um dispositivo
  // recriado precisa de um Welcome novo para voltar a ler o canal. Ganho zero,
  // custo alto.
  return {
    key,
    wrapped: `session:${reference}`,
    persistenceMode: "session" as const,
  };
}

async function openMasterKey(userId: string, wrapped: string) {
  if (wrapped.startsWith("desktop:")) {
    if (!window.janjaDesktop)
      throw new Error(
        "O cofre E2EE foi criado no app desktop e não pode ser aberto neste navegador.",
      );
    const raw = await window.janjaDesktop.unwrapSecret(wrapped.slice(8));
    return {
      key: await importAesKey(fromBase64(raw)),
      wrapped,
      persistenceMode: "durable" as const,
    };
  }
  if (wrapped === INDEXED_DB_MASTER_KEY) {
    const saved = await database.deviceKeys.get(userId);
    if (!saved?.key) throw new MissingLocalMlsKeyError();
    return {
      key: saved.key,
      wrapped,
      persistenceMode: "durable" as const,
    };
  }
  const reference = wrapped.slice("session:".length);
  const raw = sessionStorage.getItem(`janja.mls.master.${userId}.${reference}`);
  if (!raw) throw new MissingLocalMlsKeyError();
  const key = await importAesKey(fromBase64(raw));
  const persistence = await persistWithSessionFallback(
    async () => {
      // Migração atômica das sessões web ainda abertas. Se o navegador não
      // aceitar CryptoKey no IndexedDB, a linha antiga permanece válida.
      await database.transaction(
        "rw",
        database.deviceKeys,
        database.devices,
        async () => {
          await database.deviceKeys.put({
            userId,
            key,
            createdAt: new Date().toISOString(),
          });
          await database.devices.update(userId, {
            wrappedMasterKey: INDEXED_DB_MASTER_KEY,
          });
        },
      );
    },
    () => undefined,
  );
  if (persistence.mode === "durable") {
    return {
      key,
      wrapped: INDEXED_DB_MASTER_KEY,
      persistenceMode: "durable" as const,
    };
  }
  console.warn("[mls] Migração da master key foi adiada", persistence.error);
  return {
    key,
    wrapped,
    persistenceMode: "session" as const,
  };
}

const channelStateId = (userId: string, channelId: string) =>
  `${userId}:${channelId}`;

// Erro emitido enquanto o fundador do grupo ainda não entregou o Welcome deste
// dispositivo. É um estado transitório esperado, não uma falha permanente.
export class MlsWelcomePendingError extends Error {
  constructor() {
    super(
      "Aguardando a chave de criptografia deste canal. Ela é entregue quando outro participante do canal estiver com a aplicação aberta.",
    );
    this.name = "MlsWelcomePendingError";
  }
}

// Rastreamento do fluxo de mensagens para diagnóstico. Emite apenas
// identificadores e contadores — nunca chaves, tokens ou texto decifrado.
const traceE2ee = (step: string, detail: Record<string, unknown>) =>
  console.debug(`[e2ee] ${step}`, detail);

export class MlsEngine {
  private readonly groups = new Map<string, Group>();
  /** Desde quando este canal está esperando um Welcome que não chega. */
  private readonly waitingSince = new Map<string, number>();
  private readonly groupLoads = new Map<string, Promise<Group>>();
  private operationTail: Promise<void> = Promise.resolve();
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private heartbeatBeat: (() => void) | undefined;
  private disposed = false;

  private constructor(
    readonly userId: string,
    readonly deviceId: string,
    private readonly identityName: string,
    private provider: Provider,
    private identity: Identity,
    private masterKey: CryptoKey,
    private publicKey: Uint8Array,
    private wrappedMasterKey: string,
    readonly persistenceMode: MlsPersistenceMode,
    private readonly client: SupabaseClient,
  ) {}

  private async serializeOperation<T>(operation: () => Promise<T>) {
    const previous = this.operationTail;
    let release!: () => void;
    this.operationTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  static async open(userId: string, client: SupabaseClient = supabase) {
    await ensureWasm();
    const saved = await database.devices.get(userId);
    if (saved) {
      let opened: Awaited<ReturnType<typeof openMasterKey>> | undefined;
      try {
        opened = await openMasterKey(userId, saved.wrappedMasterKey);
      } catch (caught) {
        if (!shouldReplaceMissingMlsDevice(caught)) throw caught;
        // A chave realmente sumiu: o estado cifrado não tem caminho de volta.
        // A revogação precisa concluir antes de qualquer limpeza local; uma
        // queda do Supabase jamais pode destruir o que ainda está no disco.
        const { error } = await client
          .from("devices")
          .update({ revoked_at: new Date().toISOString() })
          .eq("id", saved.deviceId)
          .is("revoked_at", null);
        if (error) throw error;
        await database.transaction(
          "rw",
          database.devices,
          database.deviceKeys,
          database.channels,
          database.messagePayloads,
          async () => {
            await database.devices.delete(userId);
            await database.deviceKeys.delete(userId);
            await database.channels.where("userId").equals(userId).delete();
            await database.messagePayloads
              .where("userId")
              .equals(userId)
              .delete();
          },
        );
      }
      if (opened) {
        let provider: Provider;
        let identity: Identity;
        let publicKey: Uint8Array;
        const identityName = saved.identityName ?? userId;
        try {
          const serialized = await decryptAtRest(
            opened.key,
            saved.stateNonce,
            saved.encryptedProviderState,
          );
          provider = Provider.from_state(serialized);
          publicKey = fromBase64(saved.publicKey);
          identity = Identity.load(provider, identityName, publicKey);
        } catch (caught) {
          throw new MlsLocalStateError(caught);
        }
        const engine = new MlsEngine(
          userId,
          saved.deviceId,
          identityName,
          provider,
          identity,
          opened.key,
          publicKey,
          opened.wrapped,
          opened.persistenceMode,
          client,
        );
        // Rede e registro ficam deliberadamente fora do bloco que abre o
        // cofre. Se falharem, o estado local permanece intocado.
        await engine.registerDeviceAndReplenishPackages();
        return engine;
      }
    }
    const provider = new Provider();
    const deviceId = crypto.randomUUID();
    const identityName = `${userId}:${deviceId}`;
    const identity = new Identity(provider, identityName);
    const publicKey = identity.public_key();
    const { key, wrapped, persistenceMode } = await createMasterKey(userId);
    const engine = new MlsEngine(
      userId,
      deviceId,
      identityName,
      provider,
      identity,
      key,
      publicKey,
      wrapped,
      persistenceMode,
      client,
    );
    // A identidade nasce no disco antes de tocar a rede. Se o Supabase cair,
    // a próxima tentativa reutiliza o mesmo device em vez de abandonar uma
    // identidade que talvez já tenha sido registrada remotamente.
    await engine.persistProvider();
    await engine.registerDeviceAndReplenishPackages();
    return engine;
  }

  private async registerDeviceAndReplenishPackages() {
    const fingerprintBytes = new Uint8Array(
      await crypto.subtle.digest("SHA-256", asArrayBuffer(this.publicKey)),
    );
    const fingerprint = toBase64(fingerprintBytes);
    const { data: device, error: deviceError } = await this.client
      .from("devices")
      .upsert(
        {
          id: this.deviceId,
          user_id: this.userId,
          name: navigator.userAgent.includes("Electron")
            ? "Lili Desktop"
            : "Lili Web",
          platform: navigator.platform || "web",
          identity_public_key: toBase64(this.publicKey),
          mls_credential: this.identityName,
          fingerprint,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: "user_id,fingerprint" },
      )
      .select("id, revoked_at")
      .single();
    if (deviceError) throw deviceError;
    if (device.revoked_at)
      throw new Error("Este dispositivo E2EE foi revogado.");
    if (device.id !== this.deviceId)
      throw new Error(
        "A identidade local não corresponde ao dispositivo registrado.",
      );

    const { data: packages, error: packageQueryError } = await this.client
      .from("e2ee_key_packages")
      .select("id")
      .eq("device_id", this.deviceId)
      .is("consumed_at", null)
      .gt("expires_at", new Date().toISOString());
    if (packageQueryError) throw packageQueryError;
    const missing = Math.max(0, 5 - (packages?.length ?? 0));
    for (let index = 0; index < missing; index += 1) {
      const keyPackage = this.identity.key_package(this.provider);
      // O segredo correspondente ao KeyPackage precisa estar durável antes de
      // publicar a parte pública. Assim, uma falha no meio do lote não deixa
      // no servidor um convite que este dispositivo não consegue consumir.
      await this.persistProvider();
      const { error } = await this.client.from("e2ee_key_packages").insert({
        user_id: this.userId,
        device_id: this.deviceId,
        cipher_suite: 3,
        key_package: toBase64(keyPackage.to_bytes()),
        expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      });
      keyPackage.free();
      if (error) throw error;
    }
    this.startHeartbeat();
  }

  /**
   * Batimento do dispositivo. Só o fundador do grupo entrega Welcome, então o
   * banco precisa saber se ele ainda está de pé: sem este sinal um navegador
   * fechado continuaria "vivo" e travaria o canal para todo dispositivo novo.
   */
  private startHeartbeat() {
    if (this.heartbeatTimer !== undefined) return;
    const beat = () =>
      void this.client
        .rpc("touch_device", { p_device_id: this.deviceId })
        .then(({ error }) => {
          if (error)
            console.warn("[mls] batimento do dispositivo falhou", error);
        });
    this.heartbeatBeat = beat;
    beat();
    this.heartbeatTimer = setInterval(beat, 45_000);
    if (typeof window !== "undefined") window.addEventListener("focus", beat);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer !== undefined) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
    if (this.heartbeatBeat)
      window.removeEventListener("focus", this.heartbeatBeat);
    this.heartbeatBeat = undefined;
  }

  private async persistProvider() {
    const encrypted = await encryptAtRest(
      this.masterKey,
      this.provider.export_state(),
    );
    await database.devices.put({
      userId: this.userId,
      deviceId: this.deviceId,
      identityName: this.identityName,
      publicKey: toBase64(this.publicKey),
      wrappedMasterKey: this.wrappedMasterKey,
      stateNonce: encrypted.nonce,
      encryptedProviderState: encrypted.ciphertext,
      updatedAt: new Date().toISOString(),
    });
  }

  private async restoreProvider(snapshot: Uint8Array) {
    this.groups.clear();
    this.provider.free();
    this.identity.free();
    this.provider = Provider.from_state(snapshot);
    this.identity = Identity.load(
      this.provider,
      this.identityName,
      this.publicKey,
    );
  }

  private async getChannelState(channelId: string) {
    return (
      (await database.channels.get(channelStateId(this.userId, channelId))) ?? {
        id: channelStateId(this.userId, channelId),
        userId: this.userId,
        channelId,
        memberDeviceIds: [this.deviceId],
        lastEventSequence: 0,
      }
    );
  }

  private async saveChannelState(state: ChannelStateRow) {
    await database.channels.put(state);
  }

  /** O fundador registrado mudou desde a última vez que gravamos o estado? */
  private async groupWasRefounded(channelId: string) {
    const state = await database.channels.get(
      channelStateId(this.userId, channelId),
    );
    if (!state?.founderDeviceId) return false;
    const { data, error } = await this.client
      .from("mls_groups")
      .select("founder_device_id")
      .eq("channel_id", channelId)
      .maybeSingle();
    if (error || !data) return false;
    return data.founder_device_id !== state.founderDeviceId;
  }

  private async loadOrJoinGroup(channelId: string) {
    const existing = this.groups.get(channelId);
    if (existing) return existing;
    let pending = this.groupLoads.get(channelId);
    if (!pending) {
      pending = this.initializeGroup(channelId);
      this.groupLoads.set(channelId, pending);
    }
    try {
      return await pending;
    } finally {
      if (this.groupLoads.get(channelId) === pending)
        this.groupLoads.delete(channelId);
    }
  }

  private async initializeGroup(channelId: string) {
    const existing = this.groups.get(channelId);
    if (existing) return existing;
    let group: Group | undefined;
    try {
      group = Group.load(this.provider, channelId);
    } catch {
      // A group can legitimately be absent before its first Welcome.
    }
    if (group && (await this.groupWasRefounded(channelId))) {
      // O grupo foi refundado por outro dispositivo depois que o fundador
      // anterior sumiu. O estado local aponta para uma árvore que não existe
      // mais, então descartamos e entramos de novo pelo Welcome novo.
      traceE2ee("group-refounded", { channelId, deviceId: this.deviceId });
      group.free();
      group = undefined;
      await database.channels.delete(channelStateId(this.userId, channelId));
    }
    if (!group) {
      const { data: welcome, error } = await this.client
        .from("channel_key_envelopes")
        .select("epoch, envelope")
        .eq("channel_id", channelId)
        .eq("recipient_device_id", this.deviceId)
        .order("epoch", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (welcome) {
        traceE2ee("welcome-join", {
          channelId,
          deviceId: this.deviceId,
          epoch: welcome.epoch,
        });
        const envelope = JSON.parse(welcome.envelope) as {
          welcome: string;
          ratchetTree: string;
          joinedAfterSequence: number;
          memberDeviceIds: string[];
        };
        group = Group.join(
          this.provider,
          fromBase64(envelope.welcome),
          RatchetTree.from_bytes(fromBase64(envelope.ratchetTree)),
        );
        await this.saveChannelState({
          id: channelStateId(this.userId, channelId),
          userId: this.userId,
          channelId,
          memberDeviceIds: envelope.memberDeviceIds,
          lastEventSequence: await this.sequenceJoinedAt(
            channelId,
            welcome.epoch,
            envelope.joinedAfterSequence,
          ),
        });
      } else {
        // Primeiro tenta sem assumir o grupo, para dar chance a quem estiver
        // prestes a entregar o Welcome. Passados alguns segundos sem que ele
        // chegue, o canal de servidor assume — um canal público que não abre é
        // um canal quebrado, e ninguém tem como saber que precisa entrar nele
        // para destravar outra pessoa. Conversa privada nunca assume: o
        // servidor recusa o `takeover` para `dm` e `gdm`.
        const allowTakeover = this.waitedLongEnoughFor(channelId);
        const { data: founder, error: founderError } = await this.client.rpc(
          "initialize_mls_group",
          {
            p_channel_id: channelId,
            p_device_id: this.deviceId,
            p_allow_takeover: allowTakeover,
          },
        );
        if (founderError) throw founderError;
        if (founder) {
          group = Group.create_new(this.provider, this.identity, channelId);
        } else {
          // O registro do grupo pode ter sido criado por esta mesma aba pouco
          // antes de um remount/crash interromper a persistência local. Enquanto
          // nenhum commit ocorreu, recriar o estado fundador é determinístico e
          // evita deixar o próprio dispositivo esperando um Welcome impossível.
          const { data: groupRecord, error: groupError } = await this.client
            .from("mls_groups")
            .select("founder_device_id,current_epoch")
            .eq("channel_id", channelId)
            .single();
          if (groupError) throw groupError;
          if (
            groupRecord.founder_device_id === this.deviceId &&
            Number(groupRecord.current_epoch) === 0
          ) {
            group = Group.create_new(this.provider, this.identity, channelId);
          } else {
            throw new MlsWelcomePendingError();
          }
        }
      }
      this.waitingSince.delete(channelId);
      await this.persistProvider();
      await this.rememberFounder(channelId);
    }
    this.groups.set(channelId, group);
    await this.processGroupEvents(channelId, group);
    return group;
  }

  /** Grava o fundador atual para detectar refundações futuras. */
  private async rememberFounder(channelId: string) {
    const { data } = await this.client
      .from("mls_groups")
      .select("founder_device_id")
      .eq("channel_id", channelId)
      .maybeSingle();
    if (!data) return;
    const state = await this.getChannelState(channelId);
    await this.saveChannelState({
      ...state,
      founderDeviceId: data.founder_device_id,
    });
  }

  /**
   * A partir de qual evento este dispositivo deve processar commits.
   *
   * O Welcome já entrega o estado do grupo na época em que foi emitido, então
   * todo commit dessa época ou anterior **já está aplicado**. Reprocessá-lo
   * falha com "An error occurred during AEAD decryption", porque a chave
   * daquela época não existe mais — era o que quebrava todo servidor novo.
   *
   * O envelope antigo prometia um `joinedAfterSequence` que nenhum código
   * chegava a escrever: o valor chegava `undefined`, o filtro `gt` deixava
   * passar o histórico inteiro e o primeiro commit alheio derrubava a sincronia
   * para sempre — sem nunca avançar o marcador, o aplicativo tentava o mesmo
   * evento a cada ciclo. Ele continua sendo aceito quando presente, para não
   * depender de quando o remetente atualizou o cliente.
   */
  /**
   * Já esperamos tempo suficiente para assumir o grupo deste canal?
   *
   * Doze segundos: o bastante para um cliente que está ativo no canal publicar
   * o Welcome, e pouco o bastante para não parecer travado. A contagem é por
   * canal e vive só nesta aba — reabrir a página recomeça a espera, que é o
   * comportamento certo, já que um cliente novo pode ter entrado enquanto
   * isso.
   */
  private waitedLongEnoughFor(channelId: string) {
    const since = this.waitingSince.get(channelId);
    if (since === undefined) {
      this.waitingSince.set(channelId, Date.now());
      return false;
    }
    return Date.now() - since >= 12_000;
  }

  private async sequenceJoinedAt(
    channelId: string,
    welcomeEpoch: number,
    declared?: number,
  ): Promise<number> {
    if (typeof declared === "number" && Number.isFinite(declared))
      return declared;
    const { data, error } = await this.client
      .from("mls_group_events")
      .select("sequence")
      .eq("channel_id", channelId)
      .lte("epoch", welcomeEpoch)
      .order("sequence", { ascending: false })
      .limit(1)
      .maybeSingle();
    // Sem conseguir determinar o ponto de entrada, começar do zero traria de
    // volta exatamente o erro que este método existe para evitar. Melhor
    // ignorar o histórico: o que veio antes já está no estado do grupo.
    if (error) return Number.MAX_SAFE_INTEGER;
    return data ? Number(data.sequence) : 0;
  }

  private async processGroupEvents(channelId: string, group: Group) {
    const state = await this.getChannelState(channelId);
    const { data, error } = await this.client
      .from("mls_group_events")
      .select("sequence, sender_device_id, payload")
      .eq("channel_id", channelId)
      .gt("sequence", state.lastEventSequence)
      .order("sequence", { ascending: true });
    if (error) throw error;
    let changed = false;
    for (const event of data ?? []) {
      if (event.sender_device_id !== this.deviceId) {
        const payload = JSON.parse(event.payload) as {
          proposal: string;
          commit: string;
          memberDeviceIds: string[];
        };
        try {
          group.process_message(this.provider, fromBase64(payload.proposal));
          group.process_message(this.provider, fromBase64(payload.commit));
        } catch (caught) {
          // Em MLS um commit recusado deixa o estado parado naquela época: os
          // seguintes também falhariam, então parar aqui preserva o que já foi
          // aplicado. O que não pode acontecer é propagar o erro — antes ele
          // subia até a tela e derrubava a listagem inteira, inclusive as
          // mensagens que este dispositivo consegue ler perfeitamente.
          traceE2ee("group-event-rejected", {
            channelId,
            sequence: Number(event.sequence),
            reason: caught instanceof Error ? caught.message : String(caught),
          });
          break;
        }
        state.memberDeviceIds = payload.memberDeviceIds;
        changed = true;
      }
      state.lastEventSequence = Number(event.sequence);
    }
    if (data?.length) await this.saveChannelState(state);
    if (changed) await this.persistProvider();
  }

  private async reconcileRecipients(channelId: string, group: Group) {
    const { data: groupRecord, error: groupError } = await this.client
      .from("mls_groups")
      .select("founder_device_id")
      .eq("channel_id", channelId)
      .single();
    if (groupError) throw groupError;
    if (groupRecord.founder_device_id !== this.deviceId) return;
    const { data: recipients, error: recipientsError } = await this.client.rpc(
      "channel_recipient_devices",
      { p_channel_id: channelId },
    );
    if (recipientsError) throw recipientsError;
    const state = await this.getChannelState(channelId);
    const { data: activeMembers, error: membersError } = await this.client.rpc(
      "channel_mls_members",
      {
        p_channel_id: channelId,
        p_sender_device_id: this.deviceId,
      },
    );
    if (membersError) throw membersError;
    const recipientRows = (recipients ?? []) as RecipientDeviceRow[];
    const memberRows = (activeMembers ?? []) as ActiveMlsMemberRow[];
    const recipientDeviceIds = new Set(
      recipientRows.map((recipient) => recipient.device_id),
    );
    state.memberDeviceIds = memberRows.map((member) => member.device_id);

    for (const member of memberRows) {
      if (
        member.device_id === this.deviceId ||
        recipientDeviceIds.has(member.device_id)
      )
        continue;
      const snapshot = this.provider.export_state();
      try {
        const remove = group.propose_and_commit_remove(
          this.provider,
          this.identity,
          member.mls_credential,
        );
        const proposal = remove.proposal;
        const commit = remove.commit;
        remove.free();
        group.merge_pending_commit(this.provider);
        const nextMembers = state.memberDeviceIds.filter(
          (deviceId) => deviceId !== member.device_id,
        );
        const epoch = Number(group.epoch());
        const { data: sequence, error: publishError } = await this.client.rpc(
          "publish_mls_remove",
          {
            p_channel_id: channelId,
            p_sender_device_id: this.deviceId,
            p_removed_device_id: member.device_id,
            p_epoch: epoch,
            p_event_payload: JSON.stringify({
              proposal: toBase64(proposal),
              commit: toBase64(commit),
              removedDeviceId: member.device_id,
              memberDeviceIds: nextMembers,
            }),
          },
        );
        if (publishError) throw publishError;
        state.memberDeviceIds = nextMembers;
        state.lastEventSequence = Number(sequence);
        await this.saveChannelState(state);
        await this.persistProvider();
        traceE2ee("member-removed", {
          channelId,
          removedDeviceId: member.device_id,
          epoch,
        });
      } catch (caught) {
        await this.restoreProvider(snapshot);
        throw caught;
      }
    }

    for (const recipient of recipientRows) {
      if (state.memberDeviceIds.includes(recipient.device_id)) continue;
      const { data: claimed, error: claimError } = await this.client.rpc(
        "claim_mls_key_package",
        {
          p_channel_id: channelId,
          p_target_device_id: recipient.device_id,
          p_sender_device_id: this.deviceId,
        },
      );
      if (claimError) throw claimError;
      const packageRow = claimed?.[0];
      if (!packageRow) continue;
      const snapshot = this.provider.export_state();
      try {
        const keyPackage = KeyPackage.from_bytes(
          fromBase64(packageRow.key_package),
        );
        const add = group.propose_and_commit_add(
          this.provider,
          this.identity,
          keyPackage,
        );
        const proposal = add.proposal;
        const commit = add.commit;
        const welcome = add.welcome;
        keyPackage.free();
        add.free();
        group.merge_pending_commit(this.provider);
        const nextMembers = [...state.memberDeviceIds, recipient.device_id];
        const ratchetTree = group.export_ratchet_tree();
        const epoch = Number(group.epoch());
        const eventPayload = JSON.stringify({
          proposal: toBase64(proposal),
          commit: toBase64(commit),
          memberDeviceIds: nextMembers,
        });
        const welcomeEnvelope = JSON.stringify({
          welcome: toBase64(welcome),
          ratchetTree: toBase64(ratchetTree.to_bytes()),
          memberDeviceIds: nextMembers,
        });
        ratchetTree.free();
        const { data: sequence, error: publishError } = await this.client.rpc(
          "publish_mls_add",
          {
            p_channel_id: channelId,
            p_sender_device_id: this.deviceId,
            p_epoch: epoch,
            p_event_payload: eventPayload,
            p_recipient_user_id: recipient.user_id,
            p_recipient_device_id: recipient.device_id,
            p_welcome_envelope: welcomeEnvelope,
          },
        );
        if (publishError) throw publishError;
        state.memberDeviceIds = nextMembers;
        state.lastEventSequence = Number(sequence);
        await this.saveChannelState(state);
        await this.persistProvider();
        traceE2ee("welcome-delivered", {
          channelId,
          recipientDeviceId: recipient.device_id,
          epoch,
        });
      } catch (caught) {
        await this.restoreProvider(snapshot);
        throw caught;
      }
    }
  }

  private async cachePayload(
    messageId: string,
    channelId: string,
    payload: MessagePayload,
    editedAt?: string,
  ) {
    const encrypted = await encryptAtRest(
      this.masterKey,
      encoder.encode(JSON.stringify(payload)),
    );
    await database.messagePayloads.put({
      cacheId: mlsMessageCacheId(this.userId, messageId),
      userId: this.userId,
      messageId,
      id: messageId,
      channelId,
      nonce: encrypted.nonce,
      ciphertext: encrypted.ciphertext,
      editedAt,
    });
  }

  private async readCachedPayload(messageId: string, editedAt?: string) {
    const cacheId = mlsMessageCacheId(this.userId, messageId);
    const accountRow = await database.messagePayloads.get(cacheId);
    const legacyRow = accountRow
      ? undefined
      : await database.messages.get(messageId);
    const row = accountRow ?? legacyRow;
    if (!row) return undefined;
    const sameRevision =
      row.editedAt === editedAt ||
      (Boolean(row.editedAt) &&
        Boolean(editedAt) &&
        Date.parse(row.editedAt!) === Date.parse(editedAt!));
    if (!sameRevision) return undefined;
    try {
      const plaintext = await decryptAtRest(
        this.masterKey,
        row.nonce,
        row.ciphertext,
      );
      const payload = JSON.parse(decoder.decode(plaintext)) as MessagePayload;
      if (legacyRow) {
        // Só quem possui a chave correta consegue chegar aqui. A linha antiga
        // pode então ser movida com segurança para o cache isolado da conta.
        await database.transaction(
          "rw",
          database.messages,
          database.messagePayloads,
          async () => {
            await database.messagePayloads.put({
              ...legacyRow,
              cacheId,
              userId: this.userId,
              messageId,
            });
            await database.messages.delete(messageId);
          },
        );
      }
      return payload;
    } catch {
      // O cache local é cifrado com a master key do dispositivo. Depois de
      // recriar o dispositivo, as linhas antigas são indecifráveis — e a
      // exceção do WebCrypto vem sem mensagem, o que derrubava a lista
      // inteira com um erro em branco. Trata-se de cache inválido: descarta
      // e deixa o caminho normal decifrar de novo pelo grupo.
      // Uma linha já atribuída a esta conta pode ser descartada. Uma linha
      // legada que não abriu talvez pertença a outra conta no mesmo navegador
      // e deve permanecer para que ela faça sua própria migração.
      if (accountRow)
        await database.messagePayloads.delete(cacheId).catch(() => undefined);
      return undefined;
    }
  }

  async sendMessage(input: SendMessageInput) {
    return this.serializeOperation(() => this.sendMessageUnlocked(input));
  }

  private async sendMessageUnlocked(input: SendMessageInput) {
    if (input.text.length > 8_000)
      throw new Error("A mensagem excede o limite de 8.000 caracteres.");
    const where = { channelId: input.channelId, deviceId: this.deviceId };
    const group = await runStage("SEND", "GROUP_RESOLVED", where, () =>
      this.loadOrJoinGroup(input.channelId),
    );
    await runStage("SEND", "RECIPIENTS_RECONCILED", where, () =>
      this.reconcileRecipients(input.channelId, group),
    );
    if (input.files?.length)
      await assertOnlineStorageUploadAllowed(
        input.files
          .slice(0, 10)
          .reduce((total, file) => total + file.size + 16, 0),
      );
    const encryptedAttachments = await Promise.all(
      (input.files ?? [])
        .slice(0, 10)
        .map((file) => encryptOnlineAttachment(file, input.channelId)),
    );
    const uploadedObjects: string[] = [];
    try {
      for (const attachment of encryptedAttachments) {
        const { error } = await this.client.storage.from("attachments").upload(
          attachment.metadata.storageObject,
          new Blob([asArrayBuffer(attachment.ciphertext)], {
            type: "application/octet-stream",
          }),
          {
            contentType: "application/octet-stream",
            upsert: false,
            // O padrão do Storage é `max-age=3600`. Num anexo que vence em um
            // dia isso significa que o navegador continua servindo o arquivo
            // por até uma hora depois de ele ser apagado do servidor.
            cacheControl: "no-store",
          },
        );
        if (error) throw error;
        uploadedObjects.push(attachment.metadata.storageObject);
      }
      const payload: MessagePayload = {
        version: 1,
        text: input.text,
        mentions:
          input.resolvedMentionRecipientIds ?? input.mentionRecipientIds ?? [],
        reactions: {},
        attachments: encryptedAttachments.map((item) => item.metadata),
      };
      const ciphertext = await runStage("SEND", "ENCRYPTION", where, async () =>
        group.create_message(
          this.provider,
          this.identity,
          encoder.encode(JSON.stringify(payload)),
        ),
      );
      // Um ciphertext vazio chegaria ao banco como uma linha que ninguém
      // consegue abrir depois, e o defeito só apareceria na leitura — longe da
      // causa. A validação custa nada e mantém o erro no lugar onde nasceu.
      if (!ciphertext?.byteLength)
        throw new MessagePipelineError(
          "SEND",
          "ENCRYPTION",
          where,
          new Error("A cifragem devolveu um ciphertext vazio."),
        );
      // O segredo da época precisa estar no disco antes de a mensagem existir
      // para os outros: o inverso deixa uma mensagem que este dispositivo não
      // reabre depois de um recarregamento no meio do caminho.
      await runStage("SEND", "STATE_PERSISTED", where, () =>
        this.persistProvider(),
      );
      const { data: messageId, error } = await this.client.rpc(
        "send_encrypted_message",
        {
          p_channel_id: input.channelId,
          p_device_id: this.deviceId,
          p_ciphertext: toBase64(ciphertext),
          p_nonce: crypto.randomUUID(),
          p_payload_version: 3,
          p_mls_epoch: Number(group.epoch()),
          p_reply_to_id: input.replyToId ?? null,
          p_mention_recipient_ids: input.mentionRecipientIds ?? [],
          p_mention_role_ids: input.mentionRoleIds ?? [],
          p_mention_here_recipient_ids: input.mentionHereRecipientIds ?? [],
          p_mentions_everyone: input.mentionsEveryone ?? false,
          p_mentions_here: input.mentionsHere ?? false,
        },
      );
      if (error)
        throw new MessagePipelineError("SEND", "DATABASE_INSERT", where, error);
      traceE2ee("message-sent", {
        channelId: input.channelId,
        messageId,
        epoch: Number(group.epoch()),
        attachments: encryptedAttachments.length,
      });
      if (encryptedAttachments.length) {
        const { error: metadataError } = await this.client
          .from("message_attachments")
          .insert(
            encryptedAttachments.map((attachment) => ({
              id: attachment.metadata.id,
              message_id: messageId,
              channel_id: input.channelId,
              storage_object: attachment.metadata.storageObject,
              ciphertext_size: attachment.ciphertext.byteLength,
              ciphertext_hash: attachment.metadata.ciphertextHash,
            })),
          );
        if (metadataError) {
          await this.client
            .from("messages")
            .update({ deleted_at: new Date().toISOString() })
            .eq("id", messageId);
          throw metadataError;
        }
      }
      // O remetente nunca reprocessa o próprio ciphertext no MLS: este cache é
      // a única cópia legível da mensagem que ele mesmo enviou. Se falhar, a
      // mensagem existe para os outros e vira cadeado para o autor — vale um
      // registro nomeado em vez do silêncio.
      await runStage("SEND", "CACHE_WRITTEN", { ...where, messageId }, () =>
        this.cachePayload(messageId, input.channelId, payload),
      );
      return messageId as string;
    } catch (caught) {
      if (uploadedObjects.length)
        await this.client.storage.from("attachments").remove(uploadedObjects);
      throw caught;
    }
  }

  async downloadAttachment(attachment: MessagePayload["attachments"][number]) {
    if (
      !attachment.storageObject ||
      !attachment.fileKey ||
      !attachment.nonce ||
      !attachment.ciphertextHash
    )
      throw new Error("Metadados E2EE do anexo estão incompletos.");
    const { data, error } = await this.client.storage
      .from("attachments")
      .download(attachment.storageObject);
    if (error) throw error;
    const ciphertext = new Uint8Array(await data.arrayBuffer());
    if ((await digestBase64(ciphertext)) !== attachment.ciphertextHash)
      throw new Error(
        "A integridade do anexo cifrado não pôde ser confirmada.",
      );
    const key = await importAesKey(fromBase64(attachment.fileKey));
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: asArrayBuffer(fromBase64(attachment.nonce)) },
      key,
      asArrayBuffer(ciphertext),
    );
    return new Blob([plaintext], { type: attachment.mime });
  }

  async exportMediaKey(channelId: string) {
    return this.serializeOperation(() =>
      this.exportMediaKeyUnlocked(channelId),
    );
  }

  private async exportMediaKeyUnlocked(channelId: string) {
    const group = await this.loadOrJoinGroup(channelId);
    await this.reconcileRecipients(channelId, group);
    await this.processGroupEvents(channelId, group);
    const epoch = Number(group.epoch());
    const key = group.export_key(
      this.provider,
      // Rótulo do exporter MLS, e não um nome de produto: os dois lados da
      // chamada precisam derivar a chave de mídia a partir da mesma string.
      // Mudá-lo faria um cliente atualizado e um ainda aberto na aba antiga
      // gerarem chaves diferentes — a chamada conecta e ninguém se ouve.
      "janja-livekit-media-e2ee-v1",
      encoder.encode(`${channelId}:${epoch}`),
      32,
    );
    return {
      epoch,
      key: key.buffer.slice(
        key.byteOffset,
        key.byteOffset + key.byteLength,
      ) as ArrayBuffer,
    };
  }

  async editMessage(messageId: string, input: EditMessageInput) {
    return this.serializeOperation(() =>
      this.editMessageUnlocked(messageId, input),
    );
  }

  private async editMessageUnlocked(
    messageId: string,
    input: EditMessageInput,
  ) {
    if (input.text.length > 8_000)
      throw new Error("A mensagem excede o limite de 8.000 caracteres.");
    const { data: row, error: queryError } = await this.client
      .from("messages")
      .select("channel_id, author_id, edited_at")
      .eq("id", messageId)
      .single();
    if (queryError) throw queryError;
    if (row.author_id !== this.userId)
      throw new Error("Você só pode editar suas mensagens.");
    const group = await this.loadOrJoinGroup(row.channel_id);
    await this.processGroupEvents(row.channel_id, group);
    const previous = await this.readCachedPayload(
      messageId,
      row.edited_at ?? undefined,
    );
    const payload: MessagePayload = {
      version: 1,
      text: input.text,
      mentions:
        input.resolvedMentionRecipientIds ?? input.mentionRecipientIds ?? [],
      reactions: {},
      attachments: previous?.attachments ?? [],
    };
    const ciphertext = group.create_message(
      this.provider,
      this.identity,
      encoder.encode(JSON.stringify(payload)),
    );
    const editedAt = new Date().toISOString();
    const { error } = await this.client
      .from("messages")
      .update({
        ciphertext: toBase64(ciphertext),
        nonce: crypto.randomUUID(),
        mls_epoch: Number(group.epoch()),
        edited_at: editedAt,
        mention_user_ids: input.mentionRecipientIds ?? [],
        mention_role_ids: input.mentionRoleIds ?? [],
        mention_here_recipient_ids: input.mentionHereRecipientIds ?? [],
        mentions_everyone: input.mentionsEveryone ?? false,
        mentions_here: input.mentionsHere ?? false,
      })
      .eq("id", messageId);
    if (error) throw error;
    await this.cachePayload(messageId, row.channel_id, payload, editedAt);
    await this.persistProvider();
  }

  async listMessages(channelId: string): Promise<MessageView[]> {
    return this.serializeOperation(() => this.listMessagesUnlocked(channelId));
  }

  private async listMessagesUnlocked(
    channelId: string,
  ): Promise<MessageView[]> {
    let group: Group | undefined;
    try {
      group = await this.loadOrJoinGroup(channelId);
    } catch (caught) {
      // Sem o Welcome ainda dá para renderizar o histórico como bloqueado; a
      // assinatura realtime de channel_key_envelopes reprocessa quando chegar.
      if (!(caught instanceof MlsWelcomePendingError)) throw caught;
    }
    if (group) {
      // O fundador entrega Welcomes pendentes (e remove dispositivos revogados)
      // sempre que abre o canal — não apenas ao enviar uma mensagem. Sem isto,
      // um dispositivo novo do outro lado fica esperando indefinidamente.
      try {
        await this.reconcileRecipients(channelId, group);
      } catch (caught) {
        console.warn("[mls] Reconciliação adiada", caught);
      }
      await this.processGroupEvents(channelId, group);
    }
    const rows = await collectBatches(async (from, to) => {
      const { data, error } = await this.client
        .from("messages")
        .select(
          "*, message_reactions(user_id, emoji), message_pins(pinned_at), message_attachments(*)",
        )
        .eq("channel_id", channelId)
        .is("deleted_at", null)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to);
      if (error) throw error;
      return data ?? [];
    });
    const output: MessageView[] = [];
    for (const row of rows) {
      let payload = await this.readCachedPayload(
        row.id,
        row.edited_at ?? undefined,
      );
      if (!payload && group && row.author_id !== this.userId) {
        try {
          const plaintext = group.process_message(
            this.provider,
            fromBase64(row.ciphertext),
          );
          payload = JSON.parse(decoder.decode(plaintext)) as MessagePayload;
          await this.cachePayload(
            row.id,
            channelId,
            payload,
            row.edited_at ?? undefined,
          );
        } catch (caught) {
          // Mensagem anterior à entrada deste dispositivo no grupo é
          // indisponível por desenho do E2EE. O que não pode continuar é o
          // silêncio: sem registro, esse caso e um defeito real de chave
          // chegavam à tela com a mesma aparência.
          traceDecryptFailure({
            messageId: row.id,
            channelId,
            deviceId: this.deviceId,
            senderDeviceId: row.sender_device_id ?? undefined,
            epoch: Number(group.epoch()),
            reason: "PROCESS_MESSAGE_FAILED",
            error: caught,
          });
        }
      } else if (!payload && !group) {
        traceDecryptFailure({
          messageId: row.id,
          channelId,
          deviceId: this.deviceId,
          reason: "NO_GROUP",
        });
      } else if (!payload && row.author_id === this.userId) {
        // A própria mensagem só existe legível no cache local. Chegar aqui
        // significa que o cache se perdeu — é o sintoma de troca de cofre.
        traceDecryptFailure({
          messageId: row.id,
          channelId,
          deviceId: this.deviceId,
          reason: "CACHE_MISS_OWN_MESSAGE",
        });
      }
      payload ??= {
        version: 1,
        text: "🔒 A chave desta época não existe mais neste dispositivo.",
        mentions: [],
        reactions: {},
        attachments: [],
      };
      const reactions: Record<string, string[]> = {};
      for (const reaction of row.message_reactions ?? [])
        reactions[reaction.emoji] = [
          ...(reactions[reaction.emoji] ?? []),
          reaction.user_id,
        ];
      output.push({
        ...payload,
        mentions: row.mention_recipient_ids ?? payload.mentions,
        reactions,
        attachments: payload.attachments,
        id: row.id,
        channelId: row.channel_id,
        authorId: row.author_id,
        senderDeviceId: row.sender_device_id,
        replyToId: row.reply_to_id ?? undefined,
        pinned: Array.isArray(row.message_pins)
          ? row.message_pins.length > 0
          : Boolean(row.message_pins),
        createdAt: row.created_at,
        editedAt: row.edited_at ?? undefined,
      });
    }
    await this.persistProvider();
    traceE2ee("messages-listed", {
      channelId,
      total: output.length,
      locked: output.filter((message) => message.text.startsWith("🔒")).length,
      joined: Boolean(group),
    });
    return output;
  }

  private async decryptableLegacyMessageIds() {
    const ids: string[] = [];
    for (const row of await database.messages.toArray()) {
      try {
        await decryptAtRest(this.masterKey, row.nonce, row.ciphertext);
        ids.push(row.id);
      } catch {
        // Cache legado de outra conta: não tocar.
      }
    }
    return ids;
  }

  private releaseLocalResources() {
    if (this.disposed) return;
    this.disposed = true;
    this.stopHeartbeat();
    for (const group of this.groups.values()) group.free();
    this.groups.clear();
    this.identity.free();
    this.provider.free();
  }

  /** Fecha a sessão sem apagar a identidade nem o histórico deste dispositivo. */
  async close() {
    return this.serializeOperation(async () => {
      if (this.disposed) return;
      await this.persistProvider();
      this.releaseLocalResources();
    });
  }

  /** Revoga o dispositivo atual e remove apenas o cofre desta conta. */
  async forgetDevice() {
    return this.serializeOperation(async () => {
      if (this.disposed) return;
      const { error } = await this.client
        .from("devices")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", this.deviceId)
        .is("revoked_at", null);
      if (error) throw error;

      const legacyIds = await this.decryptableLegacyMessageIds();
      await database.transaction(
        "rw",
        database.devices,
        database.deviceKeys,
        database.channels,
        database.messages,
        database.messagePayloads,
        async () => {
          await database.devices.delete(this.userId);
          await database.deviceKeys.delete(this.userId);
          await database.channels.where("userId").equals(this.userId).delete();
          await database.messagePayloads
            .where("userId")
            .equals(this.userId)
            .delete();
          if (legacyIds.length) await database.messages.bulkDelete(legacyIds);
        },
      );
      if (this.wrappedMasterKey.startsWith("session:")) {
        const reference = this.wrappedMasterKey.slice("session:".length);
        sessionStorage.removeItem(
          `janja.mls.master.${this.userId}.${reference}`,
        );
      }
      this.releaseLocalResources();
    });
  }

  async listMessagesPage(
    channelId: string,
    before?: string,
    limit = 50,
  ): Promise<{ messages: MessageView[]; nextCursor?: string }> {
    return this.serializeOperation(async () =>
      selectOlderPage(
        await this.listMessagesUnlocked(channelId),
        before,
        limit,
      ),
    );
  }
}

const engines = new Map<string, Promise<MlsEngine>>();
export const getMlsEngine = (userId: string) => {
  if (!userId)
    return Promise.reject(
      new Error("Não há sessão autenticada para abrir o cofre E2EE."),
    );
  let engine = engines.get(userId);
  if (!engine) {
    // Uma falha ao abrir (rede caindo, migração em andamento, estado local a
    // meio caminho) não pode condenar a sessão inteira: sem tirar o promise
    // rejeitado do cache, toda leitura seguinte falhava com o mesmo erro para
    // sempre, e só recarregar a página resolvia.
    engine = MlsEngine.open(userId).catch((caught) => {
      engines.delete(userId);
      throw caught;
    });
    engines.set(userId, engine);
  }
  return engine;
};

export async function closeMlsEngine(userId: string) {
  const pending = engines.get(userId);
  if (!pending) return;
  const engine = await pending;
  await engine.close();
  engines.delete(userId);
}

export async function forgetMlsDevice(userId: string) {
  const engine = await getMlsEngine(userId);
  await engine.forgetDevice();
  engines.delete(userId);
}

export async function downloadOnlineAttachment(
  userId: string,
  attachment: MessagePayload["attachments"][number],
) {
  return (await getMlsEngine(userId)).downloadAttachment(attachment);
}
