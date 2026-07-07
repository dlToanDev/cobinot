/**
 * Kiểu dữ liệu chung cho lớp AI Provider (không phụ thuộc nhà cung cấp cụ thể).
 * Mọi provider (OpenAI-compatible, proxy/gateway, Ollama, fallback) đều tuân
 * theo interface này để có thể đổi qua .env mà không sửa code nghiệp vụ.
 */

export type AiRole = 'system' | 'user' | 'assistant' | 'tool';

export interface AiMessage {
  role: AiRole;
  content: string;
  /** Cho message role 'tool': tên tool đã chạy. */
  toolName?: string;
  toolCallId?: string;
}

export interface AiChatInput {
  systemPrompt?: string;
  messages: Array<{ role: AiRole; content: string }>;
  temperature?: number;
  maxTokens?: number;
}

export interface AiChatOutput {
  content: string;
  raw?: unknown;
}

/** Định nghĩa tool theo chuẩn OpenAI function-calling. */
export interface AiToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: string;
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

export interface AiToolCallInput {
  systemPrompt: string;
  messages: AiMessage[];
  tools: AiToolSchema[];
  temperature?: number;
  maxTokens?: number;
}

/** Kết quả gọi có tool: model chọn tool, trả text, hoặc lỗi. */
export interface AiToolCallResult {
  type: 'tool_call' | 'text' | 'error';
  toolCall?: {
    name: string;
    args: Record<string, unknown>;
    callId: string;
  };
  content?: string;
  /** Mã lỗi đã chuẩn hóa (chỉ có khi type === 'error'). */
  errorReason?: AiErrorReason;
}

export type AiErrorReason =
  | 'INVALID_API_KEY'
  | 'NO_CREDIT_OR_FORBIDDEN'
  | 'RATE_LIMIT_OR_QUOTA'
  | 'MODEL_NOT_FOUND'
  | 'PROVIDER_DOWN'
  | 'TIMEOUT'
  | 'NOT_CONFIGURED'
  | 'UNKNOWN_AI_ERROR';

/**
 * Interface chung mọi provider phải implement. `chatWithTools` là mở rộng cần
 * thiết cho Agent (tool-calling); provider không hỗ trợ tool vẫn trả text/error.
 */
export interface AiProvider {
  readonly name: string;
  isConfigured(): boolean;
  chat(input: AiChatInput): Promise<AiChatOutput>;
  chatWithTools(input: AiToolCallInput): Promise<AiToolCallResult>;
}

export const AI_PROVIDER = Symbol('AI_PROVIDER');
