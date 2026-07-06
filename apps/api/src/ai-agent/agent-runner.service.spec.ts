import { AgentRunnerService } from './agent-runner.service';

describe('AgentRunnerService', () => {
  const aiModel = {
    callWithTools: jest.fn(),
  };
  const contextBuilder = {
    buildSystemPrompt: jest.fn(() => 'system prompt'),
  };
  const toolExecutor = {
    executeRead: jest.fn(),
  };
  let service: AgentRunnerService;

  const baseRunInput = (overrides: Record<string, unknown> = {}) => ({
    tenantId: 1,
    userId: 2,
    sessionId: 3,
    userMessage: 'hello',
    sessionHistory: [],
    context: {},
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AgentRunnerService(
      aiModel as any,
      contextBuilder as any,
      toolExecutor as any,
    );
  });

  it('LLM chọn READ tool thì executeRead được gọi, Data append vào messages và LLM được gọi lần 2', async () => {
    aiModel.callWithTools
      .mockResolvedValueOnce({
        type: 'tool_call',
        toolCall: {
          name: 'search_student',
          args: { keyword: 'An' },
          callId: 'call_read',
        },
      })
      .mockResolvedValueOnce({ type: 'text', content: 'Có 1 học viên.' });
    toolExecutor.executeRead.mockResolvedValue([{ id: 3, fullName: 'An' }]);

    const result = await service.run(baseRunInput({ userMessage: 'tìm An' }));

    expect(toolExecutor.executeRead).toHaveBeenCalledWith(1, 'search_student', {
      keyword: 'An',
    });
    expect(aiModel.callWithTools).toHaveBeenCalledTimes(2);
    expect(aiModel.callWithTools.mock.calls[1][1]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'tool',
          content: expect.stringContaining('Data:'),
        }),
      ]),
    );
    expect(result.type).toBe('text');
  });

  it('LLM chọn WRITE tool thì trả pending_write và không execute read', async () => {
    aiModel.callWithTools.mockResolvedValue({
      type: 'tool_call',
      toolCall: {
        name: 'create_student',
        args: { fullName: 'Nguyễn Văn A' },
        callId: 'call_write',
      },
    });

    const result = await service.run(
      baseRunInput({ userMessage: 'tạo học viên A' }),
    );

    expect(toolExecutor.executeRead).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        type: 'pending_write',
        pendingAction: expect.objectContaining({
          tool_name: 'create_student',
          input: { fullName: 'Nguyễn Văn A' },
          status: 'waiting_confirm',
        }),
      }),
    );
  });

  it('LLM gọi ask_clarification thì trả clarification và không execute gì', async () => {
    aiModel.callWithTools.mockResolvedValue({
      type: 'tool_call',
      toolCall: {
        name: 'ask_clarification',
        args: {
          message: 'Bạn muốn chọn học viên nào?',
          missingFields: ['userId'],
          intent: 'update_student',
        },
        callId: 'call_clarify',
      },
    });

    const result = await service.run(
      baseRunInput({ userMessage: 'sửa học viên' }),
    );

    expect(toolExecutor.executeRead).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        type: 'clarification',
        clarification: expect.objectContaining({
          missing_fields: ['userId'],
          intent: 'update_student',
        }),
      }),
    );
  });

  it('LLM trả text thẳng thì trả type=text', async () => {
    aiModel.callWithTools.mockResolvedValue({
      type: 'text',
      content: 'Xin chào',
    });

    const result = await service.run(baseRunInput());

    expect(result).toEqual({
      type: 'text',
      message: 'Xin chào',
      contextPatch: {},
    });
  });

  it('agentic loop 2 bước: search_student READ rồi assign_student_to_class WRITE', async () => {
    aiModel.callWithTools
      .mockResolvedValueOnce({
        type: 'tool_call',
        toolCall: {
          name: 'search_student',
          args: { keyword: 'An' },
          callId: 'call_read',
        },
      })
      .mockResolvedValueOnce({
        type: 'tool_call',
        toolCall: {
          name: 'assign_student_to_class',
          args: { userId: 3, classId: 8 },
          callId: 'call_write',
        },
      });
    toolExecutor.executeRead.mockResolvedValue([{ id: 3, fullName: 'An' }]);

    const result = await service.run(
      baseRunInput({ userMessage: 'thêm An vào lớp 8' }),
    );

    expect(toolExecutor.executeRead).toHaveBeenCalledTimes(1);
    expect(result).toEqual(
      expect.objectContaining({
        type: 'pending_write',
        pendingAction: expect.objectContaining({
          tool_name: 'assign_student_to_class',
          input: { userId: 3, classId: 8 },
        }),
      }),
    );
  });

  it('loop vượt 5 vòng thì dừng và trả type=text', async () => {
    aiModel.callWithTools.mockResolvedValue({
      type: 'tool_call',
      toolCall: {
        name: 'search_course',
        args: { keyword: 'IELTS' },
        callId: 'call_read',
      },
    });
    toolExecutor.executeRead.mockResolvedValue([{ id: 2, title: 'IELTS' }]);

    const result = await service.run(
      baseRunInput({ userMessage: 'tìm IELTS' }),
    );

    expect(aiModel.callWithTools).toHaveBeenCalledTimes(5);
    expect(toolExecutor.executeRead).toHaveBeenCalledTimes(5);
    expect(result.type).toBe('text');
  });

  it('WRITE tool không được execute thẳng dù LLM yêu cầu', async () => {
    aiModel.callWithTools.mockResolvedValue({
      type: 'tool_call',
      toolCall: {
        name: 'delete_students',
        args: { ids: [1] },
        callId: 'call_write',
      },
    });

    const result = await service.run(
      baseRunInput({ userMessage: 'xóa học viên 1' }),
    );

    expect(toolExecutor.executeRead).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        type: 'pending_write',
        pendingAction: expect.objectContaining({
          tool_name: 'delete_students',
          severity: 'danger',
        }),
      }),
    );
  });

  it('cập nhật last_candidates sau READ search_student', async () => {
    aiModel.callWithTools
      .mockResolvedValueOnce({
        type: 'tool_call',
        toolCall: {
          name: 'search_student',
          args: { keyword: 'An' },
          callId: 'call_read',
        },
      })
      .mockResolvedValueOnce({ type: 'text', content: 'Đã tìm.' });
    toolExecutor.executeRead.mockResolvedValue([{ id: 3, fullName: 'An' }]);

    const result = await service.run(baseRunInput({ userMessage: 'tìm An' }));

    expect(result.contextPatch).toEqual({
      last_candidates: {
        students: [
          expect.objectContaining({
            id: 3,
            label: 'An',
          }),
        ],
      },
    });
  });

  it('đưa sessionHistory và context vào model prompt', async () => {
    aiModel.callWithTools.mockResolvedValue({
      type: 'text',
      content: 'ok',
    });

    await service.run(
      baseRunInput({
        userMessage: 'tiếp tục',
        context: { selected_student_id: 9 },
        sessionHistory: [{ role: 'assistant', content: 'trước đó' }],
      }),
    );

    expect(contextBuilder.buildSystemPrompt).toHaveBeenCalledWith({
      selected_student_id: 9,
    });
    expect(aiModel.callWithTools).toHaveBeenCalledWith(
      'system prompt',
      [
        { role: 'assistant', content: 'trước đó' },
        { role: 'user', content: 'tiếp tục' },
      ],
      expect.any(Array),
    );
  });

  it('tool không hỗ trợ thì trả clarification', async () => {
    aiModel.callWithTools.mockResolvedValue({
      type: 'tool_call',
      toolCall: { name: 'unknown_tool', args: {}, callId: 'call_unknown' },
    });

    const result = await service.run(
      baseRunInput({ userMessage: 'làm gì đó' }),
    );

    expect(result.type).toBe('clarification');
  });
});
