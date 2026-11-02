import { DoctorChatService, verifiedRagAnswer } from './doctor-chat.service';
import { ForbiddenException } from '@nestjs/common';

describe('RAG evidence checks', () => {
  it('rejects unknown citations and missing citations instead of presenting an unverified answer', () => {
    expect(verifiedRagAnswer('Fixture [#9]', 2)).toContain('Không thể xác minh');
    expect(verifiedRagAnswer('No supporting reference', 2)).toContain('Không thể xác minh');
    expect(verifiedRagAnswer('Fixture [#1]', 2)).toBe('Fixture [#1]');
  });
  it('does not call the answer model when retrieval has no related context', async () => {
    const openai = { isConfigured: () => true, embed: jest.fn().mockResolvedValue({ embedding: [1] }), chat: jest.fn() };
    const sessions = { appendTurn: jest.fn().mockResolvedValue({ sessionId: 'session' }) };
    const service = new DoctorChatService(openai as any, { scrub: (s: string) => s } as any, { searchByDoctor: async () => [] } as any, sessions as any, { authorize: async () => undefined } as any);
    const result = await service.chat({ doctorId: 'doctor', question: 'Fixture only?' });
    expect(result.sources).toEqual([]);
    expect(result.answer).toContain('không tìm thấy');
    expect(openai.chat).not.toHaveBeenCalled();
  });
  it('does not embed a question when policy authorization fails', async () => {
    const openai = { isConfigured: () => true, embed: jest.fn() };
    const service = new DoctorChatService(openai as any, { scrub: (s: string) => s } as any, {} as any, {} as any, { authorize: async () => { throw new Error('policy denied'); } } as any);
    await expect(service.chat({ doctorId: 'doctor', question: 'Fixture only?' })).rejects.toThrow('policy denied');
    expect(openai.embed).not.toHaveBeenCalled();
  });
  it.each([
    { patientId: 'malformed-id' }, { sessionId: 'malformed-id' }, { sessionId: 42 },
  ])('rejects invalid identifiers before external work: %p', async invalid => {
    const openai = { isConfigured: () => true, embed: jest.fn() };
    const authorize = jest.fn();
    const service = new DoctorChatService(openai as any, {} as any, {} as any, {} as any, { authorize } as any);
    await expect(service.chat({ doctorId: 'fixture-doctor', question: 'Fixture question?', ...invalid } as any)).rejects.toThrow('UUID');
    expect(openai.embed).not.toHaveBeenCalled(); expect(authorize).not.toHaveBeenCalled();
  });
  it('rejects another doctor session before consuming quota or embedding the question', async () => {
    const openai = { isConfigured: () => true, embed: jest.fn(), chat: jest.fn() };
    const authorize = jest.fn();
    const assertOwnedSession = jest.fn().mockRejectedValue(new ForbiddenException('Phiên hội thoại không thuộc bạn'));
    const service = new DoctorChatService(openai as any, {} as any, {} as any, { assertOwnedSession } as any, { authorize } as any);
    const sessionId = '12222222-2222-4222-8222-222222222222';
    await expect(service.chat({ doctorId: 'fixture-doctor', question: 'Fixture question?', sessionId })).rejects.toBeInstanceOf(ForbiddenException);
    expect(assertOwnedSession).toHaveBeenCalledWith('fixture-doctor', sessionId);
    expect(openai.embed).not.toHaveBeenCalled(); expect(openai.chat).not.toHaveBeenCalled(); expect(authorize).not.toHaveBeenCalled();
  });
});
