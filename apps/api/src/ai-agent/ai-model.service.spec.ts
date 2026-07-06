import { AiModelService } from './ai-model.service';

describe('AiModelService', () => {
  const originalEnv = process.env;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      OPENAI_API_KEY: 'openai-test-key-long-enough',
      GEMINI_API_KEY: 'gemini-test-key-long-enough',
      OPENAI_MODEL: 'gpt-test',
      GEMINI_MODEL: 'gemini-test',
    };
    fetchSpy = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    process.env = originalEnv;
  });

  it('fallback sang Gemini khi OpenAI hết quota', async () => {
    fetchSpy
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: jest.fn().mockResolvedValue(
          JSON.stringify({
            error: { code: 'insufficient_quota' },
          }),
        ),
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          candidates: [
            {
              content: {
                parts: [
                  {
                    functionCall: {
                      name: 'search_student',
                      args: { keyword: 'An' },
                    },
                  },
                ],
              },
            },
          ],
        }),
      } as any);

    const service = new AiModelService();
    const result = await service.callWithTools(
      'system',
      [{ role: 'user', content: 'tìm An' }],
      [
        {
          type: 'function',
          function: {
            name: 'search_student',
            description: 'Search students',
            parameters: {
              type: 'object',
              properties: { keyword: { type: 'string' } },
            },
          },
        },
      ],
    );

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('api.openai.com');
    expect(String(fetchSpy.mock.calls[1][0])).toContain(
      'generativelanguage.googleapis.com',
    );
    expect(result).toEqual({
      type: 'tool_call',
      toolCall: {
        name: 'search_student',
        args: { keyword: 'An' },
        callId: 'search_student',
      },
    });
  });

  it('trả error mềm khi tất cả provider đều lỗi', async () => {
    fetchSpy
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: jest.fn().mockResolvedValue('quota exceeded'),
      } as any)
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: jest.fn().mockResolvedValue('provider unavailable'),
      } as any);

    const service = new AiModelService();
    const result = await service.callWithTools(
      'system',
      [{ role: 'user', content: 'hello' }],
      [],
    );

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      type: 'error',
      content:
        'Copilot chưa gọi được AI provider lúc này. Bạn kiểm tra quota/API key hoặc thử lại sau nhé.',
    });
  });

  it('dùng Gemini Flash latest khi không cấu hình model Gemini', async () => {
    process.env = {
      ...originalEnv,
      GEMINI_API_KEY: 'gemini-test-key-long-enough',
    };
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({
        candidates: [{ content: { parts: [{ text: 'Xin chào' }] } }],
      }),
    } as any);

    const service = new AiModelService();
    const result = await service.callWithTools(
      'system',
      [{ role: 'user', content: 'hello' }],
      [],
    );

    expect(String(fetchSpy.mock.calls[0][0])).toContain(
      '/models/gemini-flash-latest:generateContent',
    );
    expect(result).toEqual({ type: 'text', content: 'Xin chào' });
  });
});
