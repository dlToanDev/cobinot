import { Injectable, Logger } from '@nestjs/common';
import {
  AiChatInput,
  AiChatOutput,
  AiMessage,
  AiProvider,
  AiToolCallInput,
  AiToolCallResult,
  AiToolSchema,
} from '../ai.types';
import {
  isRetryableAiError,
  normalizeAiError,
} from '../utils/ai-error-normalizer';

/**
 * Provider gọi bất kỳ endpoint tương thích OpenAI:
 *   POST {AI_BASE_URL}/chat/completions
 * Dùng được cho OpenAI, OpenRouter, gateway/proxy, Ollama (/v1)... chỉ cần đổi
 * AI_BASE_URL / AI_API_KEY / AI_MODEL trong .env. KHÔNG hard-code key/model/url.
 */
@Injectable()
export class OpenAICompatibleProvider implements AiProvider {
  readonly name = 'openai-compatible';
  private readonly logger = new Logger(OpenAICompatibleProvider.name);

  private get baseUrl(): string {
    return (process.env.AI_BASE_URL || '').trim().replace(/\/+$/, '');
  }
  private get apiKey(): string {
    return (process.env.AI_API_KEY || '').trim();
  }
  private get model(): string {
    return (process.env.AI_MODEL || '').trim();
  }
  private get timeoutMs(): number {
    const value = Number(process.env.AI_TIMEOUT_MS);
    return Number.isFinite(value) && value > 0 ? value : 30000;
  }
  private get maxRetries(): number {
    const value = Number(process.env.AI_MAX_RETRIES);
    return Number.isFinite(value) && value >= 0 ? value : 2;
  }
  private get maxTokensDefault(): number {
    // Model suy luận (reasoning) tiêu tốn token cho phần "nghĩ" trước khi ra kết
    // quả -> cần headroom lớn, nếu quá thấp content sẽ rỗng (finish_reason=length).
    const value = Number(process.env.AI_MAX_TOKENS);
    return Number.isFinite(value) && value > 0 ? value : 2000;
  }

  isConfigured(): boolean {
    return Boolean(this.baseUrl && this.apiKey && this.model);
  }

  async chat(input: AiChatInput): Promise<AiChatOutput> {
    const messages = [
      ...(input.systemPrompt
        ? [{ role: 'system' as const, content: input.systemPrompt }]
        : []),
      ...input.messages.map((message) => ({
        role: message.role === 'tool' ? ('user' as const) : message.role,
        content: message.content,
      })),
    ];

    const data = await this.postChatCompletions({
      model: this.model,
      messages,
      temperature: input.temperature ?? 0.2,
      max_tokens: input.maxTokens ?? this.maxTokensDefault,
    });

    const content = this.extractContent(data);
    return { content, raw: data };
  }

  async chatWithTools(input: AiToolCallInput): Promise<AiToolCallResult> {
    const messages = [
      { role: 'system', content: input.systemPrompt },
      ...input.messages.map((message) => this.toOpenAiMessage(message)),
    ];

    const data = await this.postChatCompletions({
      model: this.model,
      messages,
      temperature: input.temperature ?? 0.1,
      max_tokens: input.maxTokens ?? this.maxTokensDefault,
      tools: this.normalizeTools(input.tools),
      tool_choice: 'auto',
    });

    const message = (data as any)?.choices?.[0]?.message;
    const toolCall = message?.tool_calls?.[0];
    if (toolCall?.function?.name) {
      if (!this.hasRegisteredTool(toolCall.function.name, input.tools)) {
        return {
          type: 'error',
          content: `Tool ${toolCall.function.name} chưa được đăng ký.`,
          errorReason: 'UNKNOWN_AI_ERROR',
        };
      }
      return {
        type: 'tool_call',
        toolCall: {
          name: toolCall.function.name,
          args: this.parseToolArgs(toolCall.function.arguments),
          callId: toolCall.id || toolCall.function.name,
        },
      };
    }

    return {
      type: 'text',
      content: typeof message?.content === 'string' ? message.content : '',
    };
  }

  /** Gọi endpoint với timeout + retry cho lỗi tạm thời (429/5xx/timeout). */
  private async postChatCompletions(body: Record<string, unknown>): Promise<unknown> {
    if (!this.isConfigured()) {
      throw new Error('NOT_CONFIGURED: thiếu AI_BASE_URL/AI_API_KEY/AI_MODEL');
    }

    const url = `${this.baseUrl}/chat/completions`;
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          // stream:false BẮT BUỘC: nhiều gateway (vd RamCloud) mặc định trả SSE
          // stream, khiến response.json() vỡ. Ép JSON thường để parse ổn định.
          body: JSON.stringify({ ...body, stream: false }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const detail = await response.text().catch(() => '');
          throw new Error(
            `AI provider error ${response.status}: ${detail.slice(0, 300)}`,
          );
        }
        return await response.json();
      } catch (error) {
        lastError = error;
        const reason = normalizeAiError(
          controller.signal.aborted ? new Error('timeout') : error,
        );
        // Không retry lỗi cố định (key sai, không đủ credit, model sai).
        if (!isRetryableAiError(reason) || attempt === this.maxRetries) {
          throw error;
        }
        this.logger.warn(
          `AI provider lỗi tạm thời (${reason}), thử lại lần ${attempt + 1}/${this.maxRetries}.`,
        );
      } finally {
        clearTimeout(timer);
      }
    }

    throw lastError ?? new Error('AI provider unknown error');
  }

  private extractContent(data: unknown): string {
    const content = (data as any)?.choices?.[0]?.message?.content;
    return typeof content === 'string' ? content : '';
  }

  private toOpenAiMessage(message: AiMessage) {
    // Kết quả tool đưa vào dạng user message để tương thích mọi endpoint OpenAI
    // (không phụ thuộc liên kết tool_call_id nghiêm ngặt).
    if (message.role === 'tool') {
      return {
        role: 'user',
        content: `[Kết quả tool ${message.toolName || ''}] ${message.content}`,
      };
    }
    return { role: message.role, content: message.content };
  }

  private normalizeTools(tools: AiToolSchema[]): AiToolSchema[] {
    return tools.map((tool) => ({
      ...tool,
      function: {
        ...tool.function,
        parameters: {
          ...tool.function.parameters,
          additionalProperties: false,
        },
      },
    }));
  }

  private hasRegisteredTool(name: string, tools: AiToolSchema[]): boolean {
    return tools.some((tool) => tool.function.name === name);
  }

  private parseToolArgs(raw: unknown): Record<string, unknown> {
    if (!raw) return {};
    if (typeof raw === 'object') return raw as Record<string, unknown>;
    if (typeof raw !== 'string') return {};
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
}
