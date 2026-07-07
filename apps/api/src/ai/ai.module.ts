import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { FallbackAiProvider } from './providers/fallback.provider';
import { OpenAICompatibleProvider } from './providers/openai-compatible.provider';

/**
 * Module AI dùng chung. Đổi provider chỉ bằng .env (AI_PROVIDER/AI_BASE_URL/
 * AI_API_KEY/AI_MODEL). Không phụ thuộc trực tiếp Gemini/Groq.
 */
@Module({
  providers: [AiService, OpenAICompatibleProvider, FallbackAiProvider],
  exports: [AiService],
})
export class AiModule {}
