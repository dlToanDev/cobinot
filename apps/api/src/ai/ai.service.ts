import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  AiChatInput,
  AiChatOutput,
  AiMessage,
  AiProvider,
  AiToolCallResult,
  AiToolSchema,
} from './ai.types';
import { FallbackAiProvider } from './providers/fallback.provider';
import { OpenAICompatibleProvider } from './providers/openai-compatible.provider';
import {
  friendlyAiErrorMessage,
  normalizeAiError,
} from './utils/ai-error-normalizer';

/**
 * Facade AI duy nhất cho toàn hệ thống. Chọn provider theo .env (AI_PROVIDER) và
 * KHÔNG bao giờ ném lỗi kỹ thuật ra ngoài: mọi lỗi provider được chuẩn hóa thành
 * kết quả "mềm" để nghiệp vụ fallback sang rule/database.
 */
@Injectable()
export class AiService implements OnModuleInit {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly openAiCompatible: OpenAICompatibleProvider,
    private readonly fallback: FallbackAiProvider,
  ) {}

  onModuleInit() {
    const provider = this.selectProvider();
    this.logger.log(
      `AI provider: ${provider.name} (configured=${provider.isConfigured()}), fallback=${this.fallbackEnabled()}`,
    );
    if (!provider.isConfigured()) {
      this.logger.warn(
        'AI provider chưa được cấu hình (.env AI_BASE_URL/AI_API_KEY/AI_MODEL). ' +
          'Copilot sẽ chạy bằng rule/database (deterministic).',
      );
    }
  }

  private fallbackEnabled(): boolean {
    return process.env.AI_ENABLE_FALLBACK !== 'false';
  }

  /** Chọn provider theo cấu hình; tự lùi về fallback nếu chưa cấu hình. */
  private selectProvider(): AiProvider {
    const configured = (process.env.AI_PROVIDER || 'openai-compatible')
      .trim()
      .toLowerCase();

    if (configured === 'fallback') return this.fallback;

    // 'openai-compatible', 'openai', 'proxy', 'ollama'... đều dùng chung protocol.
    if (this.openAiCompatible.isConfigured()) return this.openAiCompatible;
    return this.fallback;
  }

  /** Chat thuần (không tool). Không bao giờ throw ra UI. */
  async chat(input: AiChatInput): Promise<AiChatOutput> {
    const provider = this.selectProvider();
    try {
      return await provider.chat(input);
    } catch (error) {
      const reason = normalizeAiError(error);
      this.logger.error(`AI chat lỗi (${reason}).`);
      return { content: friendlyAiErrorMessage() };
    }
  }

  /**
   * Tool-calling cho Agent. Giữ chữ ký tương thích lớp cũ để không phá vỡ
   * AgentRunnerService. Trả {type:'error'} khi provider lỗi -> Agent fallback.
   */
  async callWithTools(
    systemPrompt: string,
    messages: AiMessage[],
    tools: AiToolSchema[],
  ): Promise<AiToolCallResult> {
    const provider = this.selectProvider();

    if (!provider.isConfigured()) {
      return {
        type: 'error',
        content: friendlyAiErrorMessage(),
        errorReason: 'NOT_CONFIGURED',
      };
    }

    try {
      return await provider.chatWithTools({ systemPrompt, messages, tools });
    } catch (error) {
      const reason = normalizeAiError(error);
      // Log chi tiết cho dev, KHÔNG đẩy chuỗi lỗi thô ra chat.
      this.logger.error(`AI callWithTools lỗi (${reason}).`);
      return {
        type: 'error',
        content: friendlyAiErrorMessage(),
        errorReason: reason,
      };
    }
  }
}
