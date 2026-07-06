import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ChatMessage } from './decision.types';
import { AgentToolDefinition } from './tool-definitions';

export type { ChatMessage } from './decision.types';

export interface ModelCallResult {
  type: 'tool_call' | 'text' | 'error';
  toolCall?: {
    name: string;
    args: Record<string, unknown>;
    callId: string;
  };
  content?: string;
}

@Injectable()
export class AiModelService implements OnModuleInit {
  private readonly logger = new Logger(AiModelService.name);
  private readonly openAiKey = process.env.OPENAI_API_KEY;
  private readonly geminiKey = process.env.GEMINI_API_KEY;

  onModuleInit() {
    const providers = [
      this.openAiKey && this.openAiKey.trim().length > 10 ? 'OpenAI' : null,
      this.geminiKey && this.geminiKey.trim().length > 10 ? 'Gemini' : null,
    ].filter(Boolean);

    if (providers.length === 0) {
      this.logger.warn('Không có AI provider nào được cấu hình cho Copilot.');
      return;
    }

    this.logger.log(`Copilot AI providers: ${providers.join(', ')}`);
  }

  async callWithTools(
    systemPrompt: string,
    messages: ChatMessage[],
    tools: AgentToolDefinition[],
  ): Promise<ModelCallResult> {
    const providers: Array<{
      name: string;
      call: () => Promise<ModelCallResult>;
    }> = [];

    if (this.hasConfiguredKey(this.openAiKey)) {
      providers.push({
        name: 'OpenAI',
        call: () => this.callOpenAiWithTools(systemPrompt, messages, tools),
      });
    }

    if (this.hasConfiguredKey(this.geminiKey)) {
      providers.push({
        name: 'Gemini',
        call: () => this.callGeminiWithTools(systemPrompt, messages, tools),
      });
    }

    if (providers.length === 0) {
      return {
        type: 'error',
        content: 'Chưa có AI provider nào được cấu hình cho Copilot.',
      };
    }

    const failures: string[] = [];
    for (const provider of providers) {
      try {
        return await provider.call();
      } catch (error) {
        const message =
          error instanceof Error ? error.message : JSON.stringify(error);
        failures.push(`${provider.name}: ${message}`);
        this.logger.warn(
          `Copilot provider ${provider.name} lỗi, thử provider tiếp theo nếu có. ${message}`,
        );
      }
    }

    this.logger.error(`Tất cả AI providers đều lỗi: ${failures.join(' | ')}`);
    return {
      type: 'error',
      content:
        'Copilot chưa gọi được AI provider lúc này. Bạn kiểm tra quota/API key hoặc thử lại sau nhé.',
    };
  }

  private hasConfiguredKey(key?: string): boolean {
    return Boolean(key && key.trim().length > 10);
  }

  private async callOpenAiWithTools(
    systemPrompt: string,
    messages: ChatMessage[],
    tools: AgentToolDefinition[],
  ): Promise<ModelCallResult> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.openAiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model:
          process.env.OPENAI_AGENT_MODEL ||
          process.env.OPENAI_MODEL ||
          'gpt-4o-mini',
        temperature: 0.1,
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages.map((message) => this.toOpenAiMessage(message)),
        ],
        tools,
        tool_choice: 'auto',
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`OpenAI tool call failed: ${response.status} ${detail}`);
    }

    const payload = await response.json();
    const message = payload?.choices?.[0]?.message;
    const toolCall = message?.tool_calls?.[0];
    if (toolCall?.function?.name) {
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

  private async callGeminiWithTools(
    systemPrompt: string,
    messages: ChatMessage[],
    tools: AgentToolDefinition[],
  ): Promise<ModelCallResult> {
    const model =
      process.env.GEMINI_AGENT_MODEL ||
      process.env.GEMINI_MODEL ||
      'gemini-flash-latest';
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: systemPrompt }],
          },
          contents: messages.map((message) => {
            if (message.role === 'tool') {
              return {
                role: 'user',
                parts: [
                  {
                    functionResponse: {
                      name: message.toolName || 'tool',
                      response: { result: message.content },
                    },
                  },
                ],
              };
            }
            return {
              role: message.role === 'assistant' ? 'model' : 'user',
              parts: [{ text: message.content }],
            };
          }),
          tools: [
            {
              functionDeclarations: tools.map((tool) =>
                this.stripAdditionalProperties(tool.function),
              ),
            },
          ],
          generationConfig: { temperature: 0.1 },
        }),
      },
    );

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Gemini tool call failed: ${response.status} ${detail}`);
    }

    const payload = await response.json();
    const part = payload?.candidates?.[0]?.content?.parts?.[0];
    if (part?.functionCall?.name) {
      return {
        type: 'tool_call',
        toolCall: {
          name: part.functionCall.name,
          args: part.functionCall.args || {},
          callId: part.functionCall.name,
        },
      };
    }

    return {
      type: 'text',
      content: typeof part?.text === 'string' ? part.text : '',
    };
  }

  private toOpenAiMessage(message: ChatMessage) {
    if (message.role === 'tool') {
      return {
        role: 'tool',
        content: message.content,
        tool_call_id: message.toolCallId || message.toolName || 'tool_call',
      };
    }

    return {
      role: message.role,
      content: message.content,
    };
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

  private stripAdditionalProperties(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.stripAdditionalProperties(item));
    }
    if (!value || typeof value !== 'object') return value;

    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (key === 'additionalProperties') continue;
      output[key] = this.stripAdditionalProperties(child);
    }
    return output;
  }
}
