import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';
import { OpenAIService } from '../ai/openai.service';
import { AnonymizeService } from '../ai/anonymize.service';
import { AiPolicyService } from '../ai/ai-policy.service';
import { DepartmentEntity } from '../models/department.model';
import {
  AiSpecialtySuggestionEntity,
  type SpecialtySuggestionResponse,
  type SpecialtySuggestionItem,
} from '../models/ai-specialty-suggestion.model';

const MIN_SYMPTOMS_LEN = 10;
const MAX_SYMPTOMS_LEN = 2000;

@Injectable()
export class SpecialtySuggestService {
  private readonly logger = new Logger(SpecialtySuggestService.name);

  constructor(
    private readonly openai: OpenAIService,
    private readonly anonymize: AnonymizeService,
    @InjectRepository(DepartmentEntity)
    private readonly deptRepo: Repository<DepartmentEntity>,
    @InjectRepository(AiSpecialtySuggestionEntity)
    private readonly cacheRepo: Repository<AiSpecialtySuggestionEntity>,
    private readonly policy: AiPolicyService,
  ) {}

  /**
   * Đầu vào: triệu chứng tự do của bệnh nhân.
   * Đầu ra: 1-3 chuyên khoa phù hợp + cảnh báo cấp cứu nếu cần.
   *
   * Cache theo SHA-256 của text đã normalize (lower + collapse whitespace).
   * Cùng triệu chứng → 0 cost OpenAI cho lần thứ 2 trở đi.
   */
  async suggest(
    rawSymptoms: string,
    userId: string | null,
  ): Promise<SpecialtySuggestionResponse> {
    if (typeof rawSymptoms !== 'string') throw new BadRequestException('Triệu chứng phải là văn bản.');
    if (!userId) throw new BadRequestException('Vui lòng đăng nhập trước khi dùng AI.');
    if (!await this.policy.allows(userId)) throw new ServiceUnavailableException('AI đang tắt hoặc bạn chưa đồng ý chính sách xử lý dữ liệu.');
    if (!this.openai.isConfigured()) {
      throw new ServiceUnavailableException(
        'Hệ thống AI chưa cấu hình. Vui lòng liên hệ quản trị.',
      );
    }
    const symptoms = (rawSymptoms ?? '').trim();
    if (symptoms.length < MIN_SYMPTOMS_LEN) {
      throw new BadRequestException(
        `Vui lòng mô tả triệu chứng chi tiết hơn (tối thiểu ${MIN_SYMPTOMS_LEN} ký tự).`,
      );
    }
    if (symptoms.length > MAX_SYMPTOMS_LEN) {
      throw new BadRequestException(
        `Mô tả quá dài (tối đa ${MAX_SYMPTOMS_LEN} ký tự).`,
      );
    }

    // 1) Anonymize trước khi xử lý — kể cả với LLM vẫn nên bóc PII.
    const cleanSymptoms = this.anonymize.scrub(symptoms);
    const cacheKey = this.hashSymptoms(cleanSymptoms);

    // 2) Cache hit?
    const hit = await this.cacheRepo.findOne({ where: { symptomsHash: cacheKey } });
    if (hit) {
      // increment hits — fire-and-forget, không block response.
      this.cacheRepo
        .increment({ id: hit.id }, 'hits', 1)
        .catch((e) =>
          this.logger.warn(`Tăng hits cache thất bại: ${e instanceof Error ? e.message : e}`),
        );
      return hit.responseJson;
    }

    // 3) Cache miss → gọi LLM.
    const departments = await this.deptRepo.find({ order: { name: 'ASC' } });
    if (departments.length === 0) {
      // Khoa rỗng → trả về general note.
      return {
        suggestions: [],
        urgent: false,
        generalNote: 'Hệ thống chưa có thông tin chuyên khoa.',
      };
    }

    const llmOutput = await this.callLLM(cleanSymptoms, departments, userId);
    const validated = this.validateAndMatch(llmOutput, departments);

    // 4) Lưu cache (tránh duplicate khi 2 request cùng lúc).
    try {
      await this.cacheRepo
        .createQueryBuilder()
        .insert()
        .values({
          symptomsHash: cacheKey,
          symptomsSample: '', // cache response/hash; do not retain free-text symptoms unnecessarily
          responseJson: validated,
          hits: 1,
        })
        .orIgnore()
        .execute();
    } catch (e) {
      this.logger.warn(
        `Cache insert thất bại (bỏ qua): ${e instanceof Error ? e.message : e}`,
      );
    }

    return validated;
  }

  private hashSymptoms(text: string): string {
    const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
    return createHash('sha256').update(normalized, 'utf8').digest('hex');
  }

  private async callLLM(
    symptoms: string,
    departments: DepartmentEntity[],
    userId: string | null,
  ): Promise<SpecialtySuggestionResponse> {
    const deptList = departments
      .map(
        (d, i) =>
          `${i + 1}. ${d.name}${d.description ? ` — ${d.description}` : ''}`,
      )
      .join('\n');

    const systemPrompt = [
      'Bạn là trợ lý y tế của SmartHospital. Vai trò của bạn là gợi ý chuyên khoa phù hợp dựa trên triệu chứng người dùng mô tả.',
      'NGHIÊM CẤM tự đưa ra chẩn đoán cụ thể. Chỉ gợi ý 1-3 chuyên khoa kèm lý do ngắn để bệnh nhân tự quyết định.',
      'Nếu triệu chứng có dấu hiệu cấp cứu (đau ngực dữ dội, khó thở nặng, mất ý thức, chảy máu nhiều, đột quỵ...), set "urgent": true và khuyên đi cấp cứu ngay.',
      'Trả về JSON object đúng schema, không thêm văn bản ngoài JSON.',
    ].join('\n');

    const userPrompt = [
      `Triệu chứng người dùng: """${symptoms}"""`,
      '',
      'Danh sách chuyên khoa hệ thống đang có:',
      deptList,
      '',
      'Trả về JSON theo schema:',
      '{',
      '  "suggestions": [',
      '    { "departmentName": "<đúng tên trong list>", "reason": "<1-2 câu lý do>", "confidence": "low" | "medium" | "high" }',
      '  ],',
      '  "urgent": true | false,',
      '  "generalNote": "<lời khuyên chung 1 câu, hoặc null>"',
      '}',
      '',
      'Quy tắc: chỉ chọn departmentName trùng KHỚP CHÍNH XÁC với 1 mục trong list (kể cả dấu, hoa thường).',
      'Tối đa 3 suggestions. Confidence "high" chỉ khi triệu chứng đặc trưng rõ ràng cho khoa đó.',
    ].join('\n');

    await this.policy.authorize(userId!);
    const res = await this.openai.chat({
      feature: 'suggest-departments',
      systemPrompt,
      userPrompt,
      jsonMode: true,
      temperature: 0.2,
      userId,
      metadata: { symptomsLen: symptoms.length, deptCount: departments.length },
    });

    let parsed: unknown;
    try {
      parsed = JSON.parse(res.text);
    } catch {
      this.logger.warn('LLM response không phải JSON hợp lệ.');
      throw new ServiceUnavailableException(
        'AI trả về dữ liệu không đọc được. Vui lòng thử lại.',
      );
    }

    return parsed as SpecialtySuggestionResponse;
  }

  /**
   * Validate output từ LLM và map departmentName → departmentId của hệ thống.
   * LLM có thể bịa tên không khớp → loại bỏ; chỉ giữ tên match đúng.
   */
  private validateAndMatch(
    raw: SpecialtySuggestionResponse,
    departments: DepartmentEntity[],
  ): SpecialtySuggestionResponse {
    const byName = new Map(departments.map((d) => [d.name.trim().toLowerCase(), d.id]));

    const suggestions: SpecialtySuggestionItem[] = [];
    if (Array.isArray(raw?.suggestions)) {
      for (const s of raw.suggestions.slice(0, 3)) {
        const name = (s?.departmentName ?? '').trim();
        if (!name) continue;
        const id = byName.get(name.toLowerCase()) ?? null;
        // Bỏ qua nếu LLM bịa tên không có trong DB.
        if (!id) {
          this.logger.warn(`LLM trả tên khoa không khớp: "${name}"`);
          continue;
        }
        const conf = s?.confidence;
        suggestions.push({
          departmentId: id,
          departmentName: name,
          reason: typeof s?.reason === 'string' ? s.reason : '',
          confidence:
            conf === 'high' || conf === 'medium' || conf === 'low' ? conf : 'medium',
        });
      }
    }

    return {
      suggestions,
      urgent: Boolean(raw?.urgent),
      generalNote:
        typeof raw?.generalNote === 'string' && raw.generalNote.trim()
          ? raw.generalNote.trim()
          : null,
    };
  }
}
