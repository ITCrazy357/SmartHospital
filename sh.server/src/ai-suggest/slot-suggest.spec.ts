import { BadRequestException } from '@nestjs/common';
import { SlotSuggestService } from './slot-suggest.service';

describe('slot suggestion request boundary', () => {
  it.each(['malformed', '', 42, null, undefined])('rejects doctor identifier %p before SQL or paid classification', async doctorId => {
    const query = jest.fn(), embed = jest.fn(), chat = jest.fn(), authorize = jest.fn();
    const service = new SlotSuggestService({ query } as any, {} as any,
      { isConfigured: () => true, embed, chat } as any, {} as any, { authorize } as any);
    await expect(service.suggest({ userId: 'fixture-patient', doctorId: doctorId as any, symptoms: 'Fixture symptoms only' })).rejects.toBeInstanceOf(BadRequestException);
    expect(query).not.toHaveBeenCalled(); expect(embed).not.toHaveBeenCalled(); expect(chat).not.toHaveBeenCalled(); expect(authorize).not.toHaveBeenCalled();
  });
});
