import { runBackgroundJob, type BackgroundJobLease } from './background-job';
import { AppointmentsService } from '../appointments/appointments.service';
import { AppointmentRemindersService } from '../appointments/appointment-reminders.service';
import { SchedulesService } from '../schedules/schedules.service';
import { MedicalRecordEmbeddingsService } from '../medical-records/medical-record-embeddings.service';

const lease = (): BackgroundJobLease => ({
  signal: new AbortController().signal,
  assertOwned: jest.fn(async () => {}),
});
const owningRedis = () => ({
  withLease: jest.fn(
    async (
      _name: string,
      _ttl: number,
      work: (lease: BackgroundJobLease) => Promise<unknown>,
    ) => ({ acquired: true, value: await work(lease()) }),
  ),
});

describe('background job Redis coordination', () => {
  it('does not run protected work when another replica owns the lease', async () => {
    const redis = { withLease: jest.fn(async () => ({ acquired: false })) };
    const work = jest.fn(),
      logger = { warn: jest.fn() };
    await runBackgroundJob(redis as any, 'fixture', 30000, work, logger);
    expect(work).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('skips rather than falling back when configured Redis cannot coordinate', async () => {
    const redis = {
      withLease: jest.fn(async () => {
        throw new Error('redis://secret@example.invalid fixture-private-query');
      }),
    };
    const work = jest.fn(),
      logger = { warn: jest.fn() };
    await runBackgroundJob(redis as any, 'fixture', 30000, work, logger);
    expect(work).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][0]).not.toMatch(
      /secret|example|private-query/,
    );
  });

  it('retains existing database protections for direct construction without Redis', async () => {
    const work = jest.fn(async () => undefined);
    await runBackgroundJob(undefined, 'fixture', 30000, work, {
      warn: jest.fn(),
    });
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('coordinates reminder cron and preserves the lease context through sending', async () => {
    const redis = owningRedis();
    const service = new AppointmentRemindersService(
      {} as any,
      {} as any,
      redis as any,
    );
    const work = jest
      .spyOn(service, 'runRemindersOnce')
      .mockResolvedValue({
        h24Sent: 0,
        h1Sent: 0,
        h24Failed: 0,
        h1Failed: 0,
        skipped: 0,
      });
    await service.cronRunReminders();
    expect(redis.withLease).toHaveBeenCalledWith(
      'appointments:reminders',
      120000,
      expect.any(Function),
    );
    expect(work).toHaveBeenCalledWith(
      expect.objectContaining({ assertOwned: expect.any(Function) }),
    );
  });

  it('coordinates all recurring booking jobs without changing transaction methods', async () => {
    const redis = owningRedis();
    const service = new AppointmentsService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { isConfigured: () => true } as any,
      {} as any,
      redis as any,
    );
    jest
      .spyOn(service, 'releaseStalePendingBookings')
      .mockResolvedValue({ cancelled: 0, slotsReleased: 0 });
    const reconcile = jest
      .spyOn(service, 'reconcilePending')
      .mockResolvedValue({ checked: 0 });
    jest.spyOn(service, 'purgeOrphanPastAvailableSlots').mockResolvedValue(0);
    await service.cronReleaseStaleBookings();
    await service.cronReconcile();
    await service.cronPurgeOrphanPastAvailableSlots();
    expect(redis.withLease.mock.calls.map(([name]) => name)).toEqual([
      'appointments:expire-pending',
      'appointments:reconcile-payments',
      'appointments:purge-unused-slots',
    ]);
    expect(reconcile).toHaveBeenCalledWith(
      expect.objectContaining({ assertOwned: expect.any(Function) }),
    );
  });

  it('uses the same schedule lease for startup and periodic generation', async () => {
    const redis = owningRedis();
    const service = new SchedulesService({} as any, redis as any);
    jest
      .spyOn(service, 'generateAll')
      .mockResolvedValue({ processed: 0, failed: 0 });
    await service.onModuleInit();
    await service.refreshHorizon();
    expect(redis.withLease.mock.calls.map(([name]) => name)).toEqual([
      'schedules:refresh-horizon',
      'schedules:refresh-horizon',
    ]);
  });

  it('does not scan embedding records when a replica already owns the retry task', async () => {
    const redis = { withLease: jest.fn(async () => ({ acquired: false })) };
    const query = jest.fn();
    const service = new MedicalRecordEmbeddingsService(
      { query } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      redis as any,
    );
    await service.retryPending();
    expect(query).not.toHaveBeenCalled();
    expect(redis.withLease).toHaveBeenCalledWith(
      'medical-records:retry-embeddings',
      120000,
      expect.any(Function),
    );
  });

  it('stops payment-provider work before another record after lease ownership is lost', async () => {
    const qb: any = {};
    for (const method of ['where', 'andWhere', 'orderBy', 'take'])
      qb[method] = () => qb;
    qb.getMany = async () => [{ id: 'fixture', payosOrderCode: 123 }];
    const provider = { getPayment: jest.fn() },
      query = jest.fn();
    const service = new AppointmentsService(
      {} as any,
      { createQueryBuilder: () => qb } as any,
      {} as any,
      { query } as any,
      provider as any,
      {} as any,
    );
    const lost = lease();
    (lost.assertOwned as jest.Mock).mockRejectedValue(new Error('lease lost'));
    await expect(service.reconcilePending(lost)).rejects.toThrow('lease lost');
    expect(provider.getPayment).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });
});
