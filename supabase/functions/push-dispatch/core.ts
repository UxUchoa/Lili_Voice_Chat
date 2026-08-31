export interface NotificationEnvelope {
  id: string;
  recipient_user_id: string;
  message_id: string;
  channel_id: string;
  event_type: string;
  attempt_count: number;
}

export interface PushSubscriptionRecord {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushDispatchDependencies {
  claimEnvelopes: (limit: number) => Promise<NotificationEnvelope[]>;
  listSubscriptions: (userId: string) => Promise<PushSubscriptionRecord[]>;
  sendNotification: (
    subscription: PushSubscriptionRecord,
    payload: string,
    ttl: number,
  ) => Promise<void>;
  removeSubscription: (subscriptionId: string) => Promise<void>;
  updateEnvelope: (
    envelopeId: string,
    patch: Record<string, unknown>,
  ) => Promise<void>;
  now?: () => number;
}

export interface PushDispatchResult {
  processed: number;
  delivered: number;
  removed: number;
  retried: number;
}

const errorStatus = (error: unknown) =>
  typeof error === "object" && error !== null && "statusCode" in error
    ? (error as { statusCode?: number }).statusCode
    : undefined;

export async function dispatchPendingNotifications(
  dependencies: PushDispatchDependencies,
): Promise<PushDispatchResult> {
  const envelopes = await dependencies.claimEnvelopes(100);
  const now = dependencies.now ?? Date.now;
  let delivered = 0;
  let removed = 0;
  let retried = 0;

  for (const envelope of envelopes) {
    let subscriptions: PushSubscriptionRecord[] = [];
    const transientErrors: string[] = [];
    try {
      subscriptions = await dependencies.listSubscriptions(
        envelope.recipient_user_id,
      );
    } catch {
      transientErrors.push("subscription_query_failed");
    }

    const payload = JSON.stringify({
      title: "Janja — Voice Chat",
      body: "Você recebeu uma nova atividade cifrada.",
      data: {
        channelId: envelope.channel_id,
        eventType: envelope.event_type,
        messageId: envelope.message_id,
      },
    });

    for (const subscription of subscriptions) {
      try {
        await dependencies.sendNotification(subscription, payload, 300);
        delivered += 1;
      } catch (error) {
        const statusCode = errorStatus(error);
        if (statusCode === 404 || statusCode === 410) {
          await dependencies.removeSubscription(subscription.id);
          removed += 1;
        } else {
          transientErrors.push(`push_${statusCode ?? "network"}`);
        }
      }
    }

    if (transientErrors.length > 0) {
      const attemptCount = Math.min(envelope.attempt_count + 1, 20);
      const delaySeconds = Math.min(3600, 15 * 2 ** Math.min(attemptCount, 8));
      await dependencies.updateEnvelope(envelope.id, {
        attempt_count: attemptCount,
        next_attempt_at: new Date(now() + delaySeconds * 1000).toISOString(),
        claimed_at: null,
        last_error: [...new Set(transientErrors)].join(",").slice(0, 256),
      });
      retried += 1;
    } else {
      await dependencies.updateEnvelope(envelope.id, {
        dispatched_at: new Date(now()).toISOString(),
        claimed_at: null,
        last_error: null,
      });
    }
  }

  return { processed: envelopes.length, delivered, removed, retried };
}
