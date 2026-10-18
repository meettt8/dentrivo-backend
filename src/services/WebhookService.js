import crypto from 'node:crypto';
import { WebhookDelivery, WebhookEndpoint } from '../models/index.js';

/** API-04: Webhook Delivery Service with retry. */
class WebhookService {
  /** Dispatch an event to every subscribed endpoint. */
  async dispatch(event, payload) {
    const endpoints = await WebhookEndpoint.find(
      { is_active: 1 },
      { keepHidden: ['secret'] },
    );

    for (const endpoint of endpoints) {
      if (!(endpoint.events ?? []).includes(event)) continue;

      // eslint-disable-next-line no-await-in-loop
      const delivery = await WebhookDelivery.create({
        webhook_endpoint_id: endpoint.id,
        event,
        payload,
        status: 'pending',
        attempt: 1,
        max_attempts: 5,
      });

      // eslint-disable-next-line no-await-in-loop
      await this.deliver(delivery, endpoint);
    }
  }

  /** Attempt to deliver a webhook. */
  async deliver(delivery, endpoint) {
    try {
      const headers = { 'Content-Type': 'application/json' };
      const body = JSON.stringify(delivery.payload);

      if (endpoint.secret) {
        headers['X-Webhook-Signature'] = crypto
          .createHmac('sha256', endpoint.secret)
          .update(body)
          .digest('hex');
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      let response;
      try {
        response = await fetch(endpoint.url, {
          method: 'POST',
          headers,
          body,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      const responseBody = (await response.text()).slice(0, 2000);

      const updated = await WebhookDelivery.update(delivery.id, {
        http_status: response.status,
        response_body: responseBody,
        status: response.ok ? 'success' : 'failed',
      });

      if (!response.ok && this.canRetry(updated)) {
        await this.scheduleRetry(updated);
      }
    } catch (error) {
      const updated = await WebhookDelivery.update(delivery.id, {
        status: 'failed',
        response_body: error.message,
      });

      if (this.canRetry(updated)) await this.scheduleRetry(updated);

      console.error('Webhook delivery failed', {
        delivery_id: delivery.id,
        url: endpoint.url,
        error: error.message,
      });
    }
  }

  canRetry(delivery) {
    return delivery.status === 'failed' && delivery.attempt < delivery.max_attempts;
  }

  /** Exponential backoff: 2, 4, 8, 16, 32 minutes. */
  async scheduleRetry(delivery) {
    const backoffMinutes = 2 ** delivery.attempt;
    await WebhookDelivery.update(delivery.id, {
      next_retry_at: new Date(Date.now() + backoffMinutes * 60_000),
    });
  }

  /** Process pending retries (called by the scheduler). */
  async processRetries() {
    const pending = await WebhookDelivery.find({
      status: 'failed',
      next_retry_at: { lte: new Date(), ne: null },
    });

    const eligible = pending.filter((row) => Number(row.attempt || 1) < Number(row.max_attempts || 5));

    let processed = 0;
    for (const row of eligible) {
      // eslint-disable-next-line no-await-in-loop
      const endpoint = await WebhookEndpoint.findById(
        row.webhook_endpoint_id,
        { keepHidden: ['secret'] },
      );
      if (!endpoint) continue;

      // eslint-disable-next-line no-await-in-loop
      const delivery = await WebhookDelivery.update(row.id, {
        attempt: row.attempt + 1,
        next_retry_at: null,
      });
      // eslint-disable-next-line no-await-in-loop
      await this.deliver(delivery, endpoint);
      processed += 1;
    }

    return processed;
  }
}

export default new WebhookService();
