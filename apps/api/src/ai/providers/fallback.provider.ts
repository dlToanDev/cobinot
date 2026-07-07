import { Injectable } from '@nestjs/common';
import {
  AiChatInput,
  AiChatOutput,
  AiProvider,
  AiToolCallInput,
  AiToolCallResult,
} from '../ai.types';
import { friendlyAiErrorMessage } from '../utils/ai-error-normalizer';

/**
 * Provider dự phòng thuần rule (không gọi mạng). Dùng khi AI_PROVIDER=fallback
 * hoặc khi không có provider nào được cấu hình. Luôn "thành công" nhưng KHÔNG
 * chọn tool -> caller (Agent/Copilot) tự xử lý bằng rule/database search.
 */
@Injectable()
export class FallbackAiProvider implements AiProvider {
  readonly name = 'fallback';

  isConfigured(): boolean {
    return true;
  }

  async chat(_input: AiChatInput): Promise<AiChatOutput> {
    return { content: friendlyAiErrorMessage() };
  }

  async chatWithTools(_input: AiToolCallInput): Promise<AiToolCallResult> {
    // Báo lỗi "mềm" để Agent kích hoạt fallback deterministic/database.
    return {
      type: 'error',
      content: friendlyAiErrorMessage(),
      errorReason: 'NOT_CONFIGURED',
    };
  }
}
