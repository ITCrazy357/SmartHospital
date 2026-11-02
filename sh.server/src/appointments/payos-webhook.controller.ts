import { Controller, Post, Body, BadRequestException } from '@nestjs/common';
import { PayOSService } from '../payos/payos.service';
import { AppointmentsService } from './appointments.service';
import { PayOSWebhookBodyDto } from './dto/payos-webhook.dto';

/**
 * Webhook nhận kết quả thanh toán từ PayOS.
 * Cấu hình URL trên https://my.payos.vn (dùng ngrok: https://xxx.ngrok.io/payments/payos-webhook).
 * Khi thanh toán thành công, cập nhật payment status sang 'paid' (đã cọc).
 */
@Controller('payments')
export class PayOSWebhookController {
  constructor(
    private readonly payos: PayOSService,
    private readonly appointmentsService: AppointmentsService,
  ) {}

  @Post('payos-webhook')
  async handleWebhook(@Body() body: PayOSWebhookBodyDto): Promise<{ success: boolean }> {
    const { data, signature, success, code } = body;
    if (code !== '00' || !success || !data || !signature) {
      return { success: false };
    }

    const isValid = this.payos.verifyWebhookSignature(data as unknown as Record<string, unknown>, signature);
    if (!isValid) {
      throw new BadRequestException('Chữ ký webhook không hợp lệ');
    }

    const orderCode = data.orderCode;
    if (orderCode != null) {
      if (data.code !== '00' || !Number.isSafeInteger(Number(orderCode)) || !Number.isSafeInteger(data.amount))
        throw new BadRequestException('Dữ liệu giao dịch không hợp lệ');
      await this.appointmentsService.markPaymentPaidByPayOSOrderCode(Number(orderCode), data.amount);
    }
    return { success: true };
  }
}
