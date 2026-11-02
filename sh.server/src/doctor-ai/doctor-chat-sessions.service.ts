import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DoctorChatSessionEntity } from '../models/doctor-chat-session.model';
import {
  DoctorChatMessageEntity,
  DoctorChatRole,
  SourceJson,
} from '../models/doctor-chat-message.model';

/** Title tự động sinh từ câu hỏi đầu tiên. */
const AUTO_TITLE_MAX_LEN = 80;

export interface SessionListItemDto {
  id: string;
  title: string;
  updatedAt: string;
  lastUserMessage: string | null;
  messageCount: number;
}

export interface SessionDetailDto {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: SessionMessageDto[];
}

export interface SessionMessageDto {
  id: string;
  role: DoctorChatRole;
  content: string;
  sources: SourceJson[] | null;
  createdAt: string;
}

@Injectable()
export class DoctorChatSessionsService {
  constructor(
    @InjectRepository(DoctorChatSessionEntity)
    private readonly sessionRepo: Repository<DoctorChatSessionEntity>,
    @InjectRepository(DoctorChatMessageEntity)
    private readonly messageRepo: Repository<DoctorChatMessageEntity>,
  ) {}

  /** Liệt kê session của 1 bác sĩ — sort theo updatedAt DESC. */
  async list(doctorId: string, limit = 50): Promise<SessionListItemDto[]> {
    const sessions = await this.sessionRepo.find({
      where: { doctorId },
      order: { updatedAt: 'DESC' },
      take: limit,
    });
    if (sessions.length === 0) return [];

    const sessionIds = sessions.map((s) => s.id);
    const counts = await this.messageRepo
      .createQueryBuilder('m')
      .select('m.session_id', 'sid')
      .addSelect('COUNT(*)', 'cnt')
      .where('m.session_id IN (:...ids)', { ids: sessionIds })
      .groupBy('m.session_id')
      .getRawMany<{ sid: string; cnt: string }>();
    const countMap = new Map(counts.map((r) => [r.sid, Number(r.cnt)]));

    // Lấy 1 user message cuối mỗi session để preview ở sidebar.
    const lastUserMessages = await this.messageRepo
      .createQueryBuilder('m')
      .distinctOn(['m.sessionId'])
      .select(['m.sessionId', 'm.content'])
      .where('m.session_id IN (:...ids)', { ids: sessionIds })
      .andWhere(`m.role = 'user'`)
      .orderBy('m.sessionId', 'ASC')
      .addOrderBy('m.createdAt', 'DESC')
      .addOrderBy('m.id', 'DESC')
      .getMany();
    const lastUserMap = new Map<string, string>();
    for (const m of lastUserMessages) {
      if (!lastUserMap.has(m.sessionId)) lastUserMap.set(m.sessionId, m.content);
    }

    return sessions.map((s) => ({
      id: s.id,
      title: s.title,
      updatedAt: s.updatedAt.toISOString(),
      lastUserMessage: lastUserMap.get(s.id) ?? null,
      messageCount: countMap.get(s.id) ?? 0,
    }));
  }

  async getDetail(doctorId: string, sessionId: string): Promise<SessionDetailDto> {
    const session = await this.assertOwn(doctorId, sessionId);
    const messages = await this.messageRepo.find({
      where: { sessionId },
      order: { createdAt: 'ASC' },
    });
    return {
      id: session.id,
      title: session.title,
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        sources: m.sources,
        createdAt: m.createdAt.toISOString(),
      })),
    };
  }

  /** Tạo 1 session rỗng — title sẽ auto-update khi user gửi message đầu. */
  async create(doctorId: string): Promise<DoctorChatSessionEntity> {
    const s = this.sessionRepo.create({ doctorId, title: 'Hội thoại mới' });
    return this.sessionRepo.save(s);
  }

  async rename(
    doctorId: string,
    sessionId: string,
    title: string,
  ): Promise<DoctorChatSessionEntity> {
    const session = await this.assertOwn(doctorId, sessionId);
    const trimmed = (title ?? '').trim().slice(0, AUTO_TITLE_MAX_LEN);
    session.title = trimmed || 'Hội thoại mới';
    return this.sessionRepo.save(session);
  }

  async delete(doctorId: string, sessionId: string): Promise<void> {
    await this.assertOwn(doctorId, sessionId);
    await this.sessionRepo.delete({ id: sessionId });
  }

  /**
   * Append 1 cặp (user message, assistant message) vào session — gọi từ DoctorChatService.
   * Cập nhật title nếu đây là cặp đầu tiên.
   */
  async appendTurn(args: {
    doctorId: string;
    sessionId: string | null;
    userContent: string;
    assistantContent: string;
    assistantSources: SourceJson[];
  }): Promise<{ sessionId: string; userMessageId: string; assistantMessageId: string }> {
    let session: DoctorChatSessionEntity;
    let isNew = false;
    if (args.sessionId) {
      session = await this.assertOwn(args.doctorId, args.sessionId);
    } else {
      session = await this.create(args.doctorId);
      isNew = true;
    }

    const [userMsg, asstMsg] = await this.messageRepo.save([
      this.messageRepo.create({
        sessionId: session.id,
        role: 'user',
        content: args.userContent,
        sources: null,
      }),
      this.messageRepo.create({
        sessionId: session.id,
        role: 'assistant',
        content: args.assistantContent,
        sources: args.assistantSources.length > 0 ? args.assistantSources : null,
      }),
    ]);

    if (isNew) {
      session.title = autoTitle(args.userContent);
    }
    session.updatedAt = new Date();
    await this.sessionRepo.save(session);

    return {
      sessionId: session.id,
      userMessageId: userMsg.id,
      assistantMessageId: asstMsg.id,
    };
  }

  private async assertOwn(
    doctorId: string,
    sessionId: string,
  ): Promise<DoctorChatSessionEntity> {
    const session = await this.sessionRepo.findOne({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Không tìm thấy phiên hội thoại');
    if (session.doctorId !== doctorId) {
      throw new ForbiddenException('Phiên hội thoại không thuộc bạn');
    }
    return session;
  }
}

function autoTitle(question: string): string {
  const cleaned = question.replace(/\s+/g, ' ').trim();
  if (!cleaned) return 'Hội thoại mới';
  return cleaned.length > AUTO_TITLE_MAX_LEN
    ? cleaned.slice(0, AUTO_TITLE_MAX_LEN - 1) + '…'
    : cleaned;
}
