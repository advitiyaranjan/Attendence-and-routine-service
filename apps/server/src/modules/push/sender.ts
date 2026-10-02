import webpush from 'web-push';
import { env } from '../../env';

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export type SendResult = 'ok' | 'gone' | 'error';

/** Abstracted so the scheduler can be tested without a real push service. */
export interface PushSender {
  readonly enabled: boolean;
  readonly publicKey: string | null;
  send(target: PushTarget, payload: unknown, ttlSeconds: number): Promise<SendResult>;
}

export class WebPushSender implements PushSender {
  readonly enabled: boolean;
  readonly publicKey: string | null;

  constructor() {
    this.enabled = !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
    this.publicKey = env.VAPID_PUBLIC_KEY ?? null;
    if (this.enabled) webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!);
  }

  async send(target: PushTarget, payload: unknown, ttlSeconds: number): Promise<SendResult> {
    if (!this.enabled) return 'error';
    try {
      await webpush.sendNotification({ endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } }, JSON.stringify(payload), {
        TTL: ttlSeconds,
        urgency: 'high',
      });
      return 'ok';
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      // 404/410: the browser unsubscribed or the subscription expired.
      return status === 404 || status === 410 ? 'gone' : 'error';
    }
  }
}
