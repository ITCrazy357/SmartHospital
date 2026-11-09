import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import OpenAI from 'openai';
import { AiUsageEntity } from '../models/ai-usage.model';

/**
 * Bảng giá OpenAI (USD per 1M tokens) — cập nhật theo official price card.
 * Reference: https://openai.com/api/pricing/
 * Note: text-embedding-3-small chỉ tính prompt tokens (không có output).
 */
const PRICE_PER_1M_USD: Record<string, { input: number; output: number }> = {
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4o': { input: 2.5, output: 10 },
  'text-embedding-3-small': { input: 0.02, output: 0 },
  'text-embedding-3-large': { input: 0.13, output: 0 },
};

export interface ChatCompletionInput {
  feature: string;
  systemPrompt: string;
  userPrompt: string;
  /** JSON object response — set true để dùng response_format: json_object. */
  jsonMode?: boolean;
  temperature?: number;
  userId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface ChatCompletionResult {
  text: string;
  promptTokens: number;
  completionTokens: number;
}

export interface EmbeddingInput {
  feature: string;
  text: string;
  userId?: string | null;
  metadata?: Record<string, unknown> | null;
}

@Injectable()
export class OpenAIService {
  private readonly logger = new Logger(OpenAIService.name);
  private readonly client: OpenAI | null;
  private readonly chatModel: string;
  private readonly embeddingModel: string;

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(AiUsageEntity)
    private readonly usageRepo: Repository<AiUsageEntity>,
  ) {
    const apiKey = this.config.get<string>('OPENAI_API_KEY')?.trim();
    this.chatModel =
      this.config.get<string>('OPENAI_CHAT_MODEL')?.trim() || 'gpt-4o-mini';
    this.embeddingModel =
      this.config.get<string>('OPENAI_EMBEDDING_MODEL')?.trim() ||
      'text-embedding-3-small';

    if (!apiKey) {
      this.logger.warn(
        'OPENAI_API_KEY chưa cấu hình — các tính năng AI sẽ bị từ chối.',
      );
      this.client = null;
    } else {
      this.client = new OpenAI({ apiKey });
    }
  }

  isConfigured(): boolean {
    return this.client != null;
  }

  /** Gọi chat completion. Throw ServiceUnavailable nếu chưa cấu hình API key. */
  async chat(input: ChatCompletionInput): Promise<ChatCompletionResult> {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'OpenAI API key chưa cấu hình ở server. Liên hệ admin.',
      );
    }

    const res = await this.client.chat.completions.create({
      model: this.chatModel,
      temperature: input.temperature ?? 0.2,
      messages: [
        { role: 'system', content: input.systemPrompt },
        { role: 'user', content: input.userPrompt },
      ],
      response_format: input.jsonMode ? { type: 'json_object' } : undefined,
    });

    const text = res.choices[0]?.message?.content ?? '';
    const promptTokens = res.usage?.prompt_tokens ?? 0;
    const completionTokens = res.usage?.completion_tokens ?? 0;
    const totalTokens =
      res.usage?.total_tokens ?? promptTokens + completionTokens;

    await this.logUsage({
      feature: input.feature,
      model: this.chatModel,
      promptTokens,
      completionTokens,
      totalTokens,
      userId: input.userId ?? null,
      metadata: input.metadata ?? null,
    });

    return { text, promptTokens, completionTokens };
  }

  /** Gọi embedding API; trả về vector + token usage. */
  async embed(
    input: EmbeddingInput,
  ): Promise<{ embedding: number[]; promptTokens: number }> {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'OpenAI API key chưa cấu hình ở server. Liên hệ admin.',
      );
    }

    const res = await this.client.embeddings.create({
      model: this.embeddingModel,
      input: input.text,
    });

    const embedding = res.data[0]?.embedding ?? [];
    const promptTokens = res.usage?.prompt_tokens ?? 0;

    await this.logUsage({
      feature: input.feature,
      model: this.embeddingModel,
      promptTokens,
      completionTokens: 0,
      totalTokens: promptTokens,
      userId: input.userId ?? null,
      metadata: input.metadata ?? null,
    });

    return { embedding, promptTokens };
  }

  private async logUsage(args: {
    feature: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    userId: string | null;
    metadata: Record<string, unknown> | null;
  }): Promise<void> {
    try {
      const price = PRICE_PER_1M_USD[args.model] ?? { input: 0, output: 0 };
      const costUsd =
        (args.promptTokens * price.input +
          args.completionTokens * price.output) /
        1_000_000;

      const row = this.usageRepo.create({
        feature: args.feature,
        model: args.model,
        promptTokens: args.promptTokens,
        completionTokens: args.completionTokens,
        totalTokens: args.totalTokens,
        costUsd: costUsd.toFixed(6),
        userId: args.userId,
        metadata: args.metadata,
      });
      await this.usageRepo.save(row);
    } catch (e) {
      // Không throw — log usage fail không ảnh hưởng request chính.
      this.logger.warn(
        `Log ai_usage thất bại: ${e instanceof Error ? e.message : e}`,
      );
    }
  }
}
