import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';

const PAYOS_API_BASE = 'https://api-merchant.payos.vn';

export interface CreatePaymentLinkParams {
  orderCode: number;
  amount: number; // VND (integer)
  description: string;
  returnUrl: string;
  cancelUrl: string;
  buyerName?: string;
  buyerEmail?: string;
  buyerPhone?: string;
  expiredAt?: number;
}

export interface CreatePaymentLinkResult {
  checkoutUrl: string;
  orderCode: number;
  paymentLinkId: string;
}

export interface PayOSWebhookPayload {
  code: string;
  desc: string;
  success: boolean;
  data: {
    orderCode: number;
    amount: number;
    description?: string;
    [key: string]: unknown;
  };
  signature: string;
}

@Injectable()
export class PayOSService {
  private readonly clientId: string;
  private readonly apiKey: string;
  private readonly checksumKey: string;

  constructor(private readonly config: ConfigService) {
    this.clientId = this.config.get<string>('PAYOS_CLIENT_ID') ?? '';
    this.apiKey = this.config.get<string>('PAYOS_API_KEY') ?? '';
    this.checksumKey = this.config.get<string>('PAYOS_CHECKSUM_KEY') ?? '';
  }

  isConfigured(): boolean { return !!(this.clientId && this.apiKey && this.checksumKey); }

  async getPayment(orderCode: number): Promise<{ status: string; amountPaid: number; id: string } | null> {
    if (!this.isConfigured()) throw new Error('PayOS chưa cấu hình');
    const res = await fetch(`${PAYOS_API_BASE}/v2/payment-requests/${orderCode}`, {
      headers: { 'x-client-id': this.clientId, 'x-api-key': this.apiKey }, signal: AbortSignal.timeout(10000),
    });
    const json = await res.json() as { code?: string; data?: { status: string; amountPaid: number; id: string } };
    if (res.status === 404) return null;
    if (!res.ok || json.code !== '00' || !json.data) throw new Error('Chưa đọc được giao dịch PayOS');
    return json.data;
  }

  async ensurePaymentLink(params: CreatePaymentLinkParams): Promise<CreatePaymentLinkResult> {
    // POST with the same orderCode is safe to retry; on duplicate/timeout recover
    // the existing link. This avoids guessing undocumented not-found error codes.
    try { return await this.createPaymentLink(params); }
    catch (error) {
      const recovered = await this.getPayment(params.orderCode);
      if (recovered?.status === 'PENDING') return { orderCode: params.orderCode, paymentLinkId: recovered.id,
        checkoutUrl: `https://pay.payos.vn/web/${encodeURIComponent(recovered.id)}` };
      throw error;
    }
  }

  /**
   * Tạo link thanh toán PayOS.
   * Doc: https://payos.vn/docs/api#tag/payment-request/operation/payment-request
   */
  async createPaymentLink(params: CreatePaymentLinkParams): Promise<CreatePaymentLinkResult> {
    const { orderCode, amount, returnUrl, cancelUrl, buyerName, buyerEmail, buyerPhone } = params;
    // PayOS: mô tả tối đa 25 ký tự; signature phải tính từ đúng giá trị gửi lên.
    if (!this.isConfigured()) throw new Error('PayOS chưa cấu hình');
    const description = 'Coc kham';

    const dataStr = [
      `amount=${amount}`,
      `cancelUrl=${cancelUrl}`,
      `description=${description}`,
      `orderCode=${orderCode}`,
      `returnUrl=${returnUrl}`,
    ].join('&');
    const signature = createHmac('sha256', this.checksumKey).update(dataStr).digest('hex');

    const body: Record<string, unknown> = {
      orderCode,
      amount,
      description,
      cancelUrl,
      returnUrl,
      signature,
      expiredAt: params.expiredAt,
    };
    if (buyerName) body.buyerName = buyerName;
    if (buyerEmail) body.buyerEmail = buyerEmail;
    if (buyerPhone) body.buyerPhone = buyerPhone;

    const res = await fetch(`${PAYOS_API_BASE}/v2/payment-requests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': this.clientId,
        'x-api-key': this.apiKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });

    const json = (await res.json()) as { code?: string; desc?: string; data?: { checkoutUrl?: string; orderCode?: number; paymentLinkId?: string } };
    if (json.code !== '00' || !json.data?.checkoutUrl) {
      throw new Error(json.desc ?? 'PayOS tạo link thất bại');
    }
    return {
      checkoutUrl: json.data.checkoutUrl,
      orderCode: json.data.orderCode ?? orderCode,
      paymentLinkId: json.data.paymentLinkId ?? '',
    };
  }

  /**
   * Xác thực chữ ký webhook PayOS (payment-requests).
   * Doc: https://payos.vn/docs/tich-hop-webhook/kiem-tra-du-lieu-voi-signature/
   */
  verifyWebhookSignature(data: Record<string, unknown>, signature: string): boolean {
    if (!this.isConfigured() || typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature)) return false;
    const sorted = Object.keys(data)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = data[key];
        return acc;
      }, {});

    const parts: string[] = [];
    for (const key of Object.keys(sorted)) {
      let value = sorted[key];
      if (value === undefined || value === null || value === 'undefined' || value === 'null') value = '';
      if (Array.isArray(value)) value = JSON.stringify(value.map((v) => (typeof v === 'object' && v !== null ? Object.keys(v).sort().reduce((o, k) => ({ ...o, [k]: (v as Record<string, unknown>)[k] }), {}) : v)));
      parts.push(`${key}=${value}`);
    }
    const dataStr = parts.join('&');
    const expected = createHmac('sha256', this.checksumKey).update(dataStr).digest('hex');
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
  }
}
