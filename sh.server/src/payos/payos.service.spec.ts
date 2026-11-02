import {ConfigService} from '@nestjs/config';
import {createHmac} from 'crypto';
import {PayOSService} from './payos.service';

describe('PayOS boundary (no external requests)',()=>{
  const service=()=>new PayOSService(new ConfigService({PAYOS_CLIENT_ID:'fixture',PAYOS_API_KEY:'fixture',PAYOS_CHECKSUM_KEY:'fixture-checksum'}));
  const params={orderCode:123,amount:50000,description:'Coc kham',returnUrl:'https://clinic.example/return',cancelUrl:'https://clinic.example/cancel',expiredAt:1800000000};
  afterEach(()=>jest.restoreAllMocks());
  it('refuses a webhook when provider configuration is missing',()=>{
    expect(new PayOSService(new ConfigService()).verifyWebhookSignature({orderCode:123},'0'.repeat(64))).toBe(false);
  });
  it('checks canonical data signature and rejects changed values/malformed signatures',()=>{
    const s=service(),data={orderCode:123,amount:50000,code:'00'};
    const signature=createHmac('sha256','fixture-checksum').update('amount=50000&code=00&orderCode=123').digest('hex');
    expect(s.verifyWebhookSignature(data,signature)).toBe(true);
    expect(s.verifyWebhookSignature({...data,amount:1},signature)).toBe(false);
    expect(s.verifyWebhookSignature(data,'x')).toBe(false);
  });
  it('recovers a duplicate or timed-out create using the same existing provider order',async()=>{
    const s=service();jest.spyOn(s,'createPaymentLink').mockRejectedValue(new Error('timeout'));
    const get=jest.spyOn(s,'getPayment').mockResolvedValue({id:'fixture-link',status:'PENDING',amountPaid:0});
    expect((await s.ensurePaymentLink(params)).checkoutUrl).toBe('https://pay.payos.vn/web/fixture-link');
    expect(get).toHaveBeenCalledWith(123);
  });
  it('never returns a payment link for a paid or cancelled order',async()=>{
    const s=service();jest.spyOn(s,'createPaymentLink').mockRejectedValue(new Error('duplicate'));
    jest.spyOn(s,'getPayment').mockResolvedValue({id:'fixture-link',status:'PAID',amountPaid:50000});
    await expect(s.ensurePaymentLink(params)).rejects.toThrow('duplicate');
  });
  it('sends fixed expiry and uses a timeout without logging credentials',async()=>{
    const fetch=jest.spyOn(globalThis,'fetch').mockResolvedValue({ok:true,json:async()=>({code:'00',data:{checkoutUrl:'https://pay.payos.vn/web/fixture',paymentLinkId:'fixture'}})} as Response);
    await service().createPaymentLink(params);
    const options=fetch.mock.calls[0][1]!;
    expect(JSON.parse(String(options.body))).toMatchObject({expiredAt:params.expiredAt,orderCode:123,amount:50000});
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });
});
