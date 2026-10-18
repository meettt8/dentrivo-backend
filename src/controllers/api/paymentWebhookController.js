import paymentService from '../../services/PaymentService.js';

/** PAY-02: Razorpay webhook. */
export async function handle(req, res) {
  // `req.rawBody` is captured by the JSON parser so the signature can be
  // verified against the exact bytes Razorpay signed.
  const payload = req.rawBody ?? JSON.stringify(req.body);
  const signature = req.headers['x-razorpay-signature'] ?? '';

  if (!paymentService.verifyWebhookSignature(payload, signature)) {
    console.warn('Invalid Razorpay webhook signature');
    return res.status(403).json({ error: 'Invalid signature' });
  }

  try {
    await paymentService.handleWebhook(JSON.parse(payload));
    return res.status(200).json({ status: 'ok' });
  } catch (error) {
    console.error('Webhook processing error', { error: error.message });
    return res.status(500).json({ error: 'Processing failed' });
  }
}
