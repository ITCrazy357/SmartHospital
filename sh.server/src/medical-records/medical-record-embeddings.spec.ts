import { MedicalRecordEmbeddingsService } from './medical-record-embeddings.service';

function fixture() {
  const query = jest.fn().mockResolvedValue([]);
  const record = { id: 'record', doctorId: 'doctor-a', patientId: 'patient', version: 1, symptoms: 'Fixture only' };
  const recordRepo = { findOne: jest.fn().mockResolvedValue(record) };
  const userRepo = { findOne: jest.fn(async ({ where }: any) => ({ id: where.id, role: where.id === 'doctor-a' ? 'doctor' : 'user', isLocked: false, fullName: 'Fixture name' })) };
  const policy = { allows: jest.fn().mockResolvedValue(true), hasConsent: jest.fn().mockResolvedValue(true), authorize: jest.fn().mockResolvedValue(undefined), claimEmbedding: jest.fn().mockResolvedValue(true), ragMaxDistance: () => 0.35 };
  const openai = { isConfigured: () => true, embed: jest.fn().mockResolvedValue({ embedding: [0.1, 0.2] }) };
  const ds = { query, transaction: async (fn: any) => fn({ query }) };
  const service = new MedicalRecordEmbeddingsService(ds as any, recordRepo as any, userRepo as any, openai as any, { scrub: (s: string) => s } as any, policy as any);
  return { service, query, openai, policy, record };
}

describe('medical embedding boundaries', () => {
  it('always scopes manual backfill to its doctor and limits batch size', async () => {
    const f = fixture();
    await f.service.backfill({ doctorId: 'doctor-a', forceAll: true, limit: 3 });
    expect(f.query.mock.calls[0][0]).toContain('doctor_id=$2');
    expect(f.query.mock.calls[0][1]).toEqual([3, 'doctor-a']);
    await expect(f.service.backfill({ doctorId: 'doctor-a', limit: 101 })).rejects.toThrow();
    await expect(f.service.backfill({ doctorId: 'doctor-a', limit: -1 })).rejects.toThrow();
  });
  it('never calls the provider without patient consent', async () => {
    const f = fixture(); f.policy.hasConsent.mockResolvedValue(false);
    expect(await f.service.embedRecord('record')).toBe(false);
    expect(f.openai.embed).not.toHaveBeenCalled();
  });
  it('does not overwrite a newer medical version when a provider response arrives late', async () => {
    const f = fixture(); f.query.mockResolvedValue([{ version: 2 }]);
    expect(await f.service.embedRecord('record')).toBe(false);
    expect(f.openai.embed).toHaveBeenCalledTimes(1);
    expect(f.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO medical_record_embeddings'))).toBe(false);
  });
  it('skips another worker holding the same record/version reservation', async () => {
    const f = fixture(); f.policy.claimEmbedding.mockResolvedValue(false);
    expect(await f.service.embedRecord('record')).toBe(false);
    expect(f.openai.embed).not.toHaveBeenCalled();
  });
  it('keeps provider failures retryable without marking any index ready', async () => {
    const f = fixture(); f.openai.embed.mockRejectedValue(new Error('fixture provider timeout'));
    await expect(f.service.embedRecord('record')).rejects.toThrow('fixture provider timeout');
    expect(f.query).toHaveBeenCalledWith("UPDATE medical_records SET embedding_status='failed' WHERE id=$1 AND version=$2", ['record', 1]);
    expect(f.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO medical_record_embeddings'))).toBe(false);
  });
  it('fails closed if consent or quota storage is unavailable before sending text', async () => {
    const f = fixture(); f.policy.authorize.mockRejectedValue(new Error('fixture quota database unavailable'));
    await expect(f.service.embedRecord('record')).rejects.toThrow('fixture quota database unavailable');
    expect(f.openai.embed).not.toHaveBeenCalled();
  });
  it('filters stale indexes and revoked patient consent during RAG retrieval', async () => {
    const f = fixture();
    await f.service.searchByDoctor({ doctorId: 'doctor-a', queryEmbedding: [0.1, 0.2], patientId: 'patient' });
    const [sql, values] = f.query.mock.calls[0];
    expect(sql).toContain('e.doctor_id = $2');
    expect(sql).toContain("mr.embedding_status = 'ready'");
    expect(sql).toContain('e.updated_at >= mr.updated_at');
    expect(sql).toContain('c.revoked_at IS NULL');
    expect(sql).toContain('(e.embedding <=> $1::vector) <= $5');
    expect(values).toEqual(['[0.1,0.2]', 'doctor-a', 10, 'patient', 0.35]);
  });
});
