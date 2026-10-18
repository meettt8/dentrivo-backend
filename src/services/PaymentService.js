import crypto from 'node:crypto';
import config from '../config/index.js';
import { Invoice, PaymentOrder } from '../models/index.js';
import workflowService from './WorkflowService.js';

const BASE_URL = 'https://api.razorpay.com/v1';

/** PAY-01 to PAY-05: Razorpay Payment Gateway Service. */
class PaymentService {
  get authHeader() {
    const { keyId, keySecret } = config.services.razorpay;
    return `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`;
  }

  /** PAY-01: Create a Razorpay order for an invoice. */
  async createOrder(invoice) {
    const amountInPaise = Math.round(invoice.total * 100);

    const response = await fetch(`${BASE_URL}/orders`, {
      method: 'POST',
      headers: { Authorization: this.authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: amountInPaise,
        currency: invoice.currency ?? 'INR',
        receipt: invoice.invoice_number,
        notes: {
          invoice_id: String(invoice.id),
        },
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      console.error('Razorpay order creation failed', { invoice_id: invoice.id, response: body });
      throw new Error('Payment gateway error: Unable to create order.');
    }

    const orderData = await response.json();

    const paymentOrder = await PaymentOrder.create({
      invoice_id: invoice.id,
      patient_id: invoice.patient_id,
      gateway: 'razorpay',
      gateway_order_id: orderData.id,
      amount: invoice.total,
      currency: invoice.currency ?? 'INR',
      status: 'created',
    });

    await Invoice.update(invoice.id, {
      payment_gateway: 'razorpay',
      gateway_order_id: orderData.id,
    });

    return paymentOrder;
  }

  /** PAY-02: Process a Razorpay webhook event. */
  async handleWebhook(payload) {
    const event = payload.event ?? '';
    const paymentEntity = payload.payload?.payment?.entity ?? {};

    const orderId = paymentEntity.order_id ?? null;
    if (!orderId) return;

    const paymentOrder = await PaymentOrder.findOne({ gateway_order_id: orderId });
    if (!paymentOrder) {
      console.warn('Webhook: PaymentOrder not found', { order_id: orderId });
      return;
    }

    await PaymentOrder.update(paymentOrder.id, { webhook_payload: payload });

    switch (event) {
      case 'payment.captured':
        await this.handleCapture(paymentOrder, paymentEntity);
        break;
      case 'payment.failed':
        await this.handleFailure(paymentOrder, paymentEntity);
        break;
      case 'refund.created':
        await this.handleRefund(paymentOrder, payload);
        break;
      default:
        console.log(`Unhandled Razorpay event: ${event}`);
    }
  }

  /** PAY-03: Handle successful payment — auto-update the invoice. */
  async handleCapture(order, paymentEntity) {
    const updated = await PaymentOrder.update(order.id, {
      gateway_payment_id: paymentEntity.id ?? null,
      status: 'captured',
      paid_at: new Date(),
    });

    await Invoice.update(order.invoice_id, {
      status: 'paid',
      paid_at: new Date(),
      payment_method: 'razorpay',
    });

    await workflowService.fireEvent('payment_received', updated, 'PaymentOrder');

    console.log('Payment captured', { order_id: order.id });
  }

  /** PAY-05: Handle payment failure. */
  async handleFailure(order, paymentEntity) {
    const reason = paymentEntity.error_description
      ?? paymentEntity.error_reason
      ?? 'Unknown failure';

    const updated = await PaymentOrder.update(order.id, {
      status: 'failed',
      failure_reason: reason,
      retry_count: order.retry_count + 1,
    });

    await workflowService.fireEvent('payment_failed', updated, 'PaymentOrder');

    console.warn('Payment failed', { order_id: order.id, reason });
  }

  /** PAY-04: Handle a refund. */
  async handleRefund(order, payload) {
    const refundEntity = payload.payload?.refund?.entity ?? {};
    const refundAmount = (refundEntity.amount ?? 0) / 100;

    await PaymentOrder.update(order.id, {
      status: refundAmount >= order.amount ? 'refunded' : 'partially_refunded',
      refund_amount: refundAmount,
      refund_id: refundEntity.id ?? null,
      refunded_at: new Date(),
    });

    console.log('Refund processed', { order_id: order.id, refund_amount: refundAmount });
  }

  /** PAY-04: Initiate a refund via the Razorpay API. */
  async initiateRefund(order, amount = null) {
    const paymentId = order.gateway_payment_id;
    if (!paymentId) throw new Error('No payment ID found for refund.');

    const refundAmount = amount ?? order.amount;
    const refundInPaise = Math.round(refundAmount * 100);

    const response = await fetch(`${BASE_URL}/payments/${paymentId}/refund`, {
      method: 'POST',
      headers: { Authorization: this.authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: refundInPaise }),
    });

    if (!response.ok) {
      const body = await response.text();
      console.error('Razorpay refund failed', { order_id: order.id, response: body });
      throw new Error(`Refund failed: ${body}`);
    }

    const refundData = await response.json();

    await PaymentOrder.update(order.id, {
      status: refundAmount >= order.amount ? 'refunded' : 'partially_refunded',
      refund_amount: refundAmount,
      refund_id: refundData.id,
      refunded_at: new Date(),
    });

    return refundData;
  }

  /** Verify the Razorpay webhook signature. */
  verifyWebhookSignature(payload, signature) {
    const expected = crypto
      .createHmac('sha256', config.services.razorpay.webhookSecret)
      .update(payload)
      .digest('hex');

    const expectedBuffer = Buffer.from(expected);
    const givenBuffer = Buffer.from(signature ?? '');
    if (expectedBuffer.length !== givenBuffer.length) return false;
    return crypto.timingSafeEqual(expectedBuffer, givenBuffer);
  }
}

export default new PaymentService();
