import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { UserEntity, type PreferredTimePattern } from '../models/user.model';
import { OpenAIService } from '../ai/openai.service';
import { AnonymizeService } from '../ai/anonymize.service';
import { AiPolicyService } from '../ai/ai-policy.service';
import { sqlSlotNotInLunchBreak } from '../common/doctor-slot-hours';
import { isUuid } from '../common/is-uuid';

/** Cửa sổ ngày tối đa cho gợi ý slot (để query không nặng). */
const MAX_DAYS_AHEAD = 30;
const DEFAULT_DAYS_AHEAD = 14;
const SUGGESTION_LIMIT = 5;
/** Ngưỡng tối thiểu để pattern được coi là "đáng tin". */
const PATTERN_MIN_SAMPLES = 3;

interface CandidateSlot {
  slotId: string;
  slotTime: Date;
  doctorName: string;
}

export interface SlotSuggestionItem {
  slotId: string;
  slotTime: string;
  doctorName: string;
  score: number;
  /** Các lý do (ngắn gọn) để hiện trên UI cho user hiểu vì sao slot này được gợi ý. */
  reasons: string[];
}

export interface SlotSuggestionResult {
  /** AI đánh giá triệu chứng có khẩn không. UI nên banner đỏ khi true. */
  urgent: boolean;
  /** Lý do AI nghĩ là khẩn (rỗng khi không khẩn hoặc chưa có triệu chứng). */
  urgencyReason: string | null;
  /** Có dùng pattern cá nhân trong scoring không (false nếu user mới, ít data). */
  personalized: boolean;
  /** Top slot được gợi ý, đã sort theo score giảm dần. */
  suggestions: SlotSuggestionItem[];
  /** Số slot trống tổng cộng đã xét (debug). */
  consideredCount: number;
}

@Injectable()
export class SlotSuggestService {
  private readonly logger = new Logger(SlotSuggestService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    private readonly openai: OpenAIService,
    private readonly anonymize: AnonymizeService,
    private readonly policy: AiPolicyService,
  ) {}

  async suggest(args: {
    userId: string;
    doctorId: string;
    symptoms?: string | null;
    daysAhead?: number;
  }): Promise<SlotSuggestionResult> {
    if (args.symptoms != null && (typeof args.symptoms !== 'string' || args.symptoms.length > 2000)) throw new BadRequestException('Triệu chứng tối đa 2000 ký tự.');
    if (typeof args.doctorId !== 'string' || !isUuid(args.doctorId)) throw new BadRequestException('doctorId phải là UUID hợp lệ.');
    const doctorId = args.doctorId.trim();

    const daysAhead = clamp(args.daysAhead ?? DEFAULT_DAYS_AHEAD, 1, MAX_DAYS_AHEAD);

    // 1. Pattern cá nhân (cache trong users.preferred_time_pattern). Refresh nếu null/cũ.
    let pattern = await this.getOrBuildPattern(args.userId);
    const personalized =
      !!pattern && pattern.totalSamples >= PATTERN_MIN_SAMPLES;

    // 2. Đánh giá khẩn (chỉ gọi LLM khi có triệu chứng + key đã cấu hình).
    const symptoms = (args.symptoms ?? '').trim();
    let urgent = false;
    let urgencyReason: string | null = null;
    if (symptoms) {
      const urgency = await this.classifyUrgency(symptoms, args.userId);
      urgent = urgency.urgent;
      urgencyReason = urgency.reason;
    }

    // 3. Lấy slot khả dụng.
    const candidates = await this.fetchAvailableSlots(doctorId, daysAhead);

    if (candidates.length === 0) {
      return {
        urgent,
        urgencyReason,
        personalized,
        suggestions: [],
        consideredCount: 0,
      };
    }

    // 4. Score & rank.
    const shiftPreference = this.detectShiftPreference(symptoms);
    const scored = candidates.map((c) =>
      this.scoreSlot(c, { pattern: personalized ? pattern : null, urgent, shiftPreference, now: new Date() }),
    );
    scored.sort((a, b) => b.score - a.score);

    return {
      urgent,
      urgencyReason,
      personalized,
      consideredCount: candidates.length,
      suggestions: scored.slice(0, SUGGESTION_LIMIT),
    };
  }

  /** Lấy pattern hiện tại; rebuild nếu null hoặc cũ hơn 30 ngày. */
  private async getOrBuildPattern(userId: string): Promise<PreferredTimePattern | null> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) return null;
    const cached = user.preferredTimePattern;
    if (cached && Date.now() - new Date(cached.builtAt).getTime() < 30 * 24 * 3600 * 1000) {
      return cached;
    }
    const fresh = await this.buildPatternFromHistory(userId);
    if (fresh && fresh.totalSamples >= PATTERN_MIN_SAMPLES) {
      user.preferredTimePattern = fresh;
      try {
        await this.userRepo.save(user);
      } catch (e) {
        this.logger.warn(`Không lưu được pattern cho user ${userId}: ${e instanceof Error ? e.message : e}`);
      }
    }
    return fresh;
  }

  /** Tổng hợp pattern từ lịch sử appointment 6 tháng gần nhất (status confirmed/completed). */
  private async buildPatternFromHistory(userId: string): Promise<PreferredTimePattern> {
    const rows = (await this.dataSource.query(
      `
      SELECT s.slot_time
      FROM appointments a
      JOIN appointment_slots s ON s.id = a.slot_id
      WHERE a.user_id = $1
        AND a.status IN ('confirmed', 'completed')
        AND s.slot_time >= now() - interval '6 months'
      ORDER BY s.slot_time DESC
      LIMIT 100
      `,
      [userId],
    )) as { slot_time: Date }[];

    const hourCount = new Map<number, number>();
    const wdCount = new Map<number, number>();
    for (const r of rows) {
      const t = new Date(r.slot_time);
      // Giờ VN (server đang UTC+7 dù thực tế DB lưu timestamp wall-time → coi local).
      const h = t.getHours();
      const wd = t.getDay();
      hourCount.set(h, (hourCount.get(h) ?? 0) + 1);
      wdCount.set(wd, (wdCount.get(wd) ?? 0) + 1);
    }
    const top = (m: Map<number, number>, k: number): number[] =>
      Array.from(m.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, k)
        .map((x) => x[0]);

    return {
      hourSlots: top(hourCount, 3),
      weekdays: top(wdCount, 3),
      totalSamples: rows.length,
      builtAt: new Date().toISOString(),
    };
  }

  private async fetchAvailableSlots(
    doctorId: string,
    daysAhead: number,
  ): Promise<CandidateSlot[]> {
    const rows = (await this.dataSource.query(
      `
      SELECT s.id AS slot_id, s.slot_time, u.full_name AS doctor_name
      FROM appointment_slots s
      JOIN users u ON u.id = s.doctor_id
      WHERE s.doctor_id = $1
        AND s.status = 'available'
        AND ${sqlSlotNotInLunchBreak('s')}
        AND s.slot_time > now()
        AND s.slot_time <= now() + ($2 || ' days')::interval
      ORDER BY s.slot_time ASC
      LIMIT 200
      `,
      [doctorId, String(daysAhead)],
    )) as { slot_id: string; slot_time: Date; doctor_name: string }[];

    return rows.map((r) => ({
      slotId: r.slot_id,
      slotTime: new Date(r.slot_time),
      doctorName: r.doctor_name,
    }));
  }

  private scoreSlot(
    s: CandidateSlot,
    ctx: { pattern: PreferredTimePattern | null; urgent: boolean; shiftPreference: 'morning' | 'afternoon' | null; now: Date },
  ): SlotSuggestionItem {
    const reasons: string[] = [];
    let score = 0;

    const hoursAhead = (s.slotTime.getTime() - ctx.now.getTime()) / 3600_000;
    const h = s.slotTime.getHours();
    const isMorning = h >= 8 && h < 12;
    const isAfternoon = h >= 13 && h < 17;

    // (a) Slot sớm gần ngày hôm nay luôn cộng nhẹ — tránh đẩy ai cũng vào "tuần sau".
    const earlinessScore = Math.max(0, 30 - hoursAhead) / 30; // 0..1
    score += earlinessScore * 10;

    // (b) Khẩn → ưu tiên cực kỳ mạnh mẽ cho các slot sớm nhất có thể
    if (ctx.urgent) {
      if (hoursAhead <= 24) {
        // Cộng 50 điểm cơ bản, nhưng trừ đi 1.5 điểm cho mỗi giờ chờ đợi (ưu tiên tuyệt đối slot sớm hơn)
        const urgencyScore = Math.max(0, 50 - hoursAhead * 1.5);
        score += urgencyScore;
        reasons.push('Triệu chứng có dấu hiệu cần khám gấp — ưu tiên slot sớm nhất');
      } else if (hoursAhead <= 72) {
        // Giảm dần điểm khi thời gian chờ tăng từ 24h đến 72h
        const urgencyScore = Math.max(0, 25 - (hoursAhead - 24) * 0.5);
        score += urgencyScore;
        reasons.push('Triệu chứng đáng lưu ý — nên khám trong vài ngày tới');
      }
    }

    // Chỉ xét các sở thích cá nhân khi KHÔNG khẩn cấp. Khẩn cấp sức khỏe là trên hết!
    if (!ctx.urgent) {
      // (c) Shift preference — cộng mạnh nếu đúng ca user muốn, trừ điểm nếu sai ca.
      if (ctx.shiftPreference === 'afternoon') {
        if (isAfternoon) {
          score += 30;
          reasons.push('Phù hợp ca chiều bạn yêu cầu');
        } else if (isMorning) {
          score -= 25; // phạt ca sáng khi user nói bận sáng
        }
      } else if (ctx.shiftPreference === 'morning') {
        if (isMorning) {
          score += 30;
          reasons.push('Phù hợp ca sáng bạn yêu cầu');
        } else if (isAfternoon) {
          score -= 25;
        }
      }

      // (d) Pattern cá nhân.
      if (ctx.pattern && ctx.pattern.totalSamples >= PATTERN_MIN_SAMPLES) {
        const wd = s.slotTime.getDay();
        if (ctx.pattern.hourSlots.includes(h)) {
          score += 15;
          reasons.push(`Bạn thường khám lúc ${h}h`);
        }
        if (ctx.pattern.weekdays.includes(wd)) {
          score += 10;
          reasons.push(`Bạn thường khám vào ${weekdayLabel(wd)}`);
        }
      }

      // (e) Ưu tiên khung giờ "vàng" (8–10h, 14–16h) khi không có pattern cá nhân và không có shift preference.
      if (!ctx.shiftPreference && (!ctx.pattern || ctx.pattern.totalSamples < PATTERN_MIN_SAMPLES)) {
        if ((h >= 8 && h <= 10) || (h >= 14 && h <= 16)) {
          score += 5;
          reasons.push('Khung giờ phổ biến, ít chen chúc');
        }
      }
    }

    if (reasons.length === 0) {
      reasons.push('Slot trống gần nhất');
    }

    return {
      slotId: s.slotId,
      slotTime: s.slotTime.toISOString(),
      doctorName: s.doctorName,
      score: Math.round(score * 10) / 10,
      reasons,
    };
  }

  /**
   * Phân loại khẩn hay không bằng LLM (gpt-4o-mini, JSON mode).
   * Có cache đơn giản theo lượt — không persist, vì symptom đa dạng và rẻ ($0.0001/lượt).
   */
  private async classifyUrgency(
    symptoms: string, userId: string,
  ): Promise<{ urgent: boolean; reason: string | null }> {
    if (!this.openai.isConfigured() || !await this.policy.allows(userId)) {
      return { urgent: false, reason: null };
    }
    const safe = this.anonymize.scrub(symptoms, []);
    const sys = `Bạn là phân loại triệu chứng cho hệ thống đặt lịch khám. Xác định triệu chứng có cần khám SỚM hay không.
Trả về JSON đúng schema: {"urgent": boolean, "reason": string}.
- urgent=true khi: đau ngực, khó thở, sốt cao kéo dài, chảy máu nhiều, đột quỵ, co giật, mất ý thức, đau bụng dữ dội, chấn thương nặng, hoặc các dấu hiệu cấp cứu khác.
- urgent=false khi: đau đầu nhẹ, mệt mỏi, ho/sổ mũi nhẹ, kiểm tra định kỳ, tái khám.
- reason: 1 câu ngắn tiếng Việt giải thích lý do (≤80 ký tự).`;
    try {
      await this.policy.authorize(userId);
      const { text } = await this.openai.chat({
        feature: 'slot-suggest-urgency',
        systemPrompt: sys,
        userPrompt: `Triệu chứng: "${safe}"\n\nTrả JSON.`,
        jsonMode: true,
        temperature: 0,
      });
      const parsed = JSON.parse(text || '{}') as {
        urgent?: unknown;
        reason?: unknown;
      };
      return {
        urgent: parsed.urgent === true,
        reason: typeof parsed.reason === 'string' ? parsed.reason : null,
      };
    } catch (e) {
      this.logger.warn(`Phân loại khẩn lỗi: ${e instanceof Error ? e.message : e}`);
      return { urgent: false, reason: null };
    }
  }

  /**
   * Phát hiện preference ca sáng/chiều từ text triệu chứng/ghi chú của user.
   * Dùng rule-based (không tốn token LLM) — đủ cho các cụm từ phổ biến.
   * Trả về: 'morning' | 'afternoon' | null
   */
  detectShiftPreference(text: string): 'morning' | 'afternoon' | null {
    const t = text.toLowerCase();

    // 1. Kiểm tra các cụm từ thể hiện sự bận rộn / không rảnh ở một buổi nào đó
    // Bận chiều -> muốn khám sáng
    const busyAfternoonPatterns = [
      'bận chiều', 'bận buổi chiều', 'bận ca chiều',
      'chiều bận', 'chiều không rảnh', 'chiều ko rảnh',
      'không rảnh chiều', 'không rảnh buổi chiều',
      'ko rảnh chiều', 'ko rảnh buổi chiều',
      'bận pm', 'pm bận',
    ];
    // Bận sáng -> muốn khám chiều
    const busyMorningPatterns = [
      'bận sáng', 'bận buổi sáng', 'bận ca sáng',
      'sáng bận', 'sáng không rảnh', 'sáng ko rảnh',
      'không rảnh sáng', 'không rảnh buổi sáng',
      'ko rảnh sáng', 'ko rảnh buổi sáng',
      'bận am', 'am bận',
    ];

    if (busyAfternoonPatterns.some((p) => t.includes(p))) {
      return 'morning';
    }
    if (busyMorningPatterns.some((p) => t.includes(p))) {
      return 'afternoon';
    }

    // 2. Kiểm tra các cụm từ thể hiện sự ưu tiên hoặc rảnh ở một buổi cụ thể
    const afternoonPatterns = [
      'rảnh chiều', 'rảnh buổi chiều', 'ca chiều', 'khám chiều',
      'sau 12h', 'sau 12', 'sau trưa', 'từ 13', 'từ 14', 'chiều', 'afternoon', 'pm',
    ];
    const morningPatterns = [
      'rảnh sáng', 'rảnh buổi sáng', 'ca sáng', 'khám sáng',
      'trước 12h', 'trước 12', 'trước trưa', 'từ 8', 'từ 9', 'từ 10', 'sáng', 'morning', 'am',
    ];

    if (afternoonPatterns.some((p) => t.includes(p))) {
      return 'afternoon';
    }
    if (morningPatterns.some((p) => t.includes(p))) {
      return 'morning';
    }

    return null;
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function weekdayLabel(wd: number): string {
  return ['Chủ Nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'][wd] ?? '';
}
