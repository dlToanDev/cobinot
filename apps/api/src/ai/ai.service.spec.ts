import { AiService } from './ai.service';
import { FallbackAiProvider } from './providers/fallback.provider';
import { OpenAICompatibleProvider } from './providers/openai-compatible.provider';
import { normalizeAiError } from './utils/ai-error-normalizer';

describe('AI provider adapter', () => {
  const ENV = { ...process.env };
  let fetchMock: jest.Mock;

  beforeEach(() => {
    process.env = { ...ENV };
    fetchMock = jest.fn();
    (global as any).fetch = fetchMock;
    process.env.AI_PROVIDER = 'openai-compatible';
    process.env.AI_BASE_URL = 'https://third-party.example/v1';
    process.env.AI_API_KEY = 'test-key';
    process.env.AI_MODEL = 'model-x';
    process.env.AI_MAX_RETRIES = '0';
  });

  afterAll(() => {
    process.env = ENV;
  });

  const buildService = () =>
    new AiService(new OpenAICompatibleProvider(), new FallbackAiProvider());

  // Case 1: gọi đúng endpoint third-party, không đụng Gemini/Groq.
  it('gọi đúng {AI_BASE_URL}/chat/completions với model & key từ .env', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Xin chào' } }],
      }),
    });

    const out = await buildService().chat({
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(out.content).toBe('Xin chào');
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://third-party.example/v1/chat/completions');
    expect(options.headers.Authorization).toBe('Bearer test-key');
    const body = JSON.parse(options.body);
    expect(body.model).toBe('model-x');
    // stream:false BẮT BUỘC để endpoint trả JSON thay vì SSE (vd RamCloud).
    expect(body.stream).toBe(false);
    // Không có domain Gemini/Groq nào bị gọi.
    expect(url).not.toContain('googleapis');
    expect(url).not.toContain('groq');
  });

  it('AI_MAX_TOKENS override max_tokens gửi lên provider', async () => {
    process.env.AI_MAX_TOKENS = '4096';
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    });

    await buildService().chat({ messages: [{ role: 'user', content: 'hi' }] });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.max_tokens).toBe(4096);
  });

  it('tool-calling parse tool_calls từ response OpenAI-compatible', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  id: 'call_1',
                  function: {
                    name: 'search_student',
                    arguments: '{"keyword":"An"}',
                  },
                },
              ],
            },
          },
        ],
      }),
    });

    const result = await buildService().callWithTools(
      'system',
      [{ role: 'user', content: 'tìm An' }],
      [
        {
          type: 'function',
          function: {
            name: 'search_student',
            description: 'x',
            parameters: { type: 'object', properties: {} },
          },
        },
      ],
    );

    expect(result).toEqual({
      type: 'tool_call',
      toolCall: { name: 'search_student', args: { keyword: 'An' }, callId: 'call_1' },
    });
  });

  // Case 2: API key sai -> không crash, trả error mềm.
  it('401 -> trả type=error errorReason=INVALID_API_KEY, không throw', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'invalid api key',
    });

    const result = await buildService().callWithTools('s', [], []);
    expect(result.type).toBe('error');
    expect(result.errorReason).toBe('INVALID_API_KEY');
    expect(result.content).toContain('AI đang tạm lỗi');
  });

  // Case 3: 429 quota -> error mềm (Copilot sẽ fallback DB).
  it('429 -> errorReason=RATE_LIMIT_OR_QUOTA', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'rate limit',
    });

    const result = await buildService().callWithTools('s', [], []);
    expect(result.type).toBe('error');
    expect(result.errorReason).toBe('RATE_LIMIT_OR_QUOTA');
  });

  it('chưa cấu hình AI_BASE_URL -> lùi về fallback provider (không gọi mạng)', async () => {
    delete process.env.AI_BASE_URL;
    delete process.env.AI_API_KEY;
    delete process.env.AI_MODEL;

    const result = await buildService().callWithTools('s', [], []);
    expect(result.type).toBe('error');
    expect(result.errorReason).toBe('NOT_CONFIGURED');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('AI_PROVIDER=fallback -> không gọi mạng', async () => {
    process.env.AI_PROVIDER = 'fallback';
    const out = await buildService().chat({
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(out.content).toContain('AI đang tạm lỗi');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe('normalizeAiError', () => {
    it('map status code sang mã lỗi chuẩn', () => {
      expect(normalizeAiError(new Error('error 401: nope'))).toBe(
        'INVALID_API_KEY',
      );
      expect(normalizeAiError(new Error('error 403 forbidden'))).toBe(
        'NO_CREDIT_OR_FORBIDDEN',
      );
      expect(normalizeAiError(new Error('error 429 quota'))).toBe(
        'RATE_LIMIT_OR_QUOTA',
      );
      expect(normalizeAiError(new Error('error 404 model not found'))).toBe(
        'MODEL_NOT_FOUND',
      );
      expect(normalizeAiError(new Error('error 503'))).toBe('PROVIDER_DOWN');
      expect(normalizeAiError(new Error('timeout'))).toBe('TIMEOUT');
      expect(normalizeAiError(new Error('weird'))).toBe('UNKNOWN_AI_ERROR');
    });
  });
});
