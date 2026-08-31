import { describe, expect, it, vi } from "vitest";
import {
  dispatchPendingNotifications,
  type NotificationEnvelope,
  type PushDispatchDependencies,
  type PushSubscriptionRecord,
} from "./core";

const envelope: NotificationEnvelope = {
  id: "envelope-1",
  recipient_user_id: "recipient-1",
  message_id: "message-1",
  channel_id: "channel-1",
  event_type: "MENTION",
  attempt_count: 0,
};

const subscription: PushSubscriptionRecord = {
  id: "subscription-1",
  endpoint: "https://push.invalid/test",
  p256dh: "public-key",
  auth: "auth-secret",
};

const setup = (overrides: Partial<PushDispatchDependencies> = {}) => {
  const dependencies: PushDispatchDependencies = {
    claimEnvelopes: vi.fn(async () => [envelope]),
    listSubscriptions: vi.fn(async () => [subscription]),
    sendNotification: vi.fn(async () => undefined),
    removeSubscription: vi.fn(async () => undefined),
    updateEnvelope: vi.fn(async () => undefined),
    now: () => Date.UTC(2026, 7, 24, 12),
    ...overrides,
  };
  return dependencies;
};

describe("push dispatcher core", () => {
  it("delivers only a generic E2EE-safe payload and completes the envelope", async () => {
    const dependencies = setup();
    const result = await dispatchPendingNotifications(dependencies);

    expect(result).toEqual({
      processed: 1,
      delivered: 1,
      removed: 0,
      retried: 0,
    });
    const [, payload, ttl] = vi.mocked(dependencies.sendNotification).mock
      .calls[0];
    expect(JSON.parse(payload)).toEqual({
      title: "Janja — Voice Chat",
      body: "Você recebeu uma nova atividade cifrada.",
      data: {
        channelId: "channel-1",
        eventType: "MENTION",
        messageId: "message-1",
      },
    });
    expect(payload).not.toMatch(/plaintext|ciphertext|fileKey|auth-secret/);
    expect(ttl).toBe(300);
    expect(dependencies.updateEnvelope).toHaveBeenCalledWith(
      "envelope-1",
      expect.objectContaining({
        dispatched_at: "2026-08-24T12:00:00.000Z",
        claimed_at: null,
        last_error: null,
      }),
    );
  });

  it("removes permanently expired subscriptions without retrying", async () => {
    const dependencies = setup({
      sendNotification: vi.fn(async () => {
        throw { statusCode: 410 };
      }),
    });

    await expect(dispatchPendingNotifications(dependencies)).resolves.toEqual({
      processed: 1,
      delivered: 0,
      removed: 1,
      retried: 0,
    });
    expect(dependencies.removeSubscription).toHaveBeenCalledWith(
      "subscription-1",
    );
  });

  it("releases the claim and applies exponential backoff on transient failure", async () => {
    const dependencies = setup({
      claimEnvelopes: vi.fn(async () => [{ ...envelope, attempt_count: 2 }]),
      sendNotification: vi.fn(async () => {
        throw { statusCode: 503 };
      }),
    });

    const result = await dispatchPendingNotifications(dependencies);
    expect(result.retried).toBe(1);
    expect(dependencies.updateEnvelope).toHaveBeenCalledWith("envelope-1", {
      attempt_count: 3,
      next_attempt_at: "2026-08-24T12:02:00.000Z",
      claimed_at: null,
      last_error: "push_503",
    });
  });

  it("retries when the subscription query itself fails", async () => {
    const dependencies = setup({
      listSubscriptions: vi.fn(async () => {
        throw new Error("database unavailable");
      }),
    });

    const result = await dispatchPendingNotifications(dependencies);
    expect(result).toEqual({
      processed: 1,
      delivered: 0,
      removed: 0,
      retried: 1,
    });
    expect(dependencies.sendNotification).not.toHaveBeenCalled();
    expect(dependencies.updateEnvelope).toHaveBeenCalledWith(
      "envelope-1",
      expect.objectContaining({ last_error: "subscription_query_failed" }),
    );
  });
});
