import { CopilotService } from './copilot.service';

describe('CopilotService', () => {
  const mockPrisma = {
    aiAgentSession: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    aiAgentSessionMessage: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
    aiCopilotTurnEvent: {
      create: jest.fn(),
    },
  };
  const mockToolRegistry = {
    execute: jest.fn(),
    findActions: jest.fn(),
    findAuditLogs: jest.fn(),
  };
  const mockAgentRunner = {
    run: jest.fn(),
  };
  const mockUsersService = {
    findDuplicateStudentByEmailOrPhone: jest.fn(),
  };
  const mockDeterministic = {
    resolve: jest.fn(),
    fallbackSearch: jest.fn(),
    buildCreateClassPending: jest.fn((params: any) => ({
      tool_name: 'create_class',
      input: {
        courseId: params.courseId,
        title: params.title,
        type: params.type,
        sessions: params.sessions ?? [],
      },
      display_input: {
        courseId: params.courseId,
        title: params.title,
        type: params.type,
        sessions: params.sessions ?? [],
        courseName: params.courseLabel,
      },
      summary: `Tạo lớp học mới: ${params.title}`,
      intent: 'create_class',
      status: 'waiting_confirm',
      severity: 'default',
    })),
  };

  let service: CopilotService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUsersService.findDuplicateStudentByEmailOrPhone.mockResolvedValue(null);
    // Mặc định lớp deterministic trả null -> mọi test cũ vẫn đi qua LLM như trước.
    mockDeterministic.resolve.mockResolvedValue(null);
    mockDeterministic.fallbackSearch.mockResolvedValue(null);
    service = new CopilotService(
      mockPrisma as any,
      mockToolRegistry as any,
      mockAgentRunner as any,
      mockUsersService as any,
      mockDeterministic as any,
    );
  });

  it('tạo session mới với default state', async () => {
    mockPrisma.aiAgentSession.create.mockResolvedValue({ id: 1 });

    await service.createSession(10, 20, { title: 'Test session' });

    expect(mockPrisma.aiAgentSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 10,
        userId: 20,
        title: 'Test session',
        status: 'ACTIVE',
        state: expect.objectContaining({
          last_intent: null,
          pending_action: null,
        }),
      }),
    });
  });

  it('createTurn gọi AgentRunner và lưu assistant response', async () => {
    mockPrisma.aiAgentSession.findFirst.mockResolvedValue({
      id: 1,
      tenantId: 10,
      userId: 20,
      status: 'ACTIVE',
      state: {},
    });
    mockPrisma.aiAgentSessionMessage.create
      .mockResolvedValueOnce({ id: 100, role: 'user', content: 'tìm học viên' })
      .mockResolvedValueOnce({ id: 101, role: 'assistant', content: '{}' });
    mockPrisma.aiAgentSessionMessage.findMany.mockResolvedValue([]);
    mockAgentRunner.run.mockResolvedValue({
      type: 'text',
      message: 'Đây là kết quả.',
      contextPatch: { selected_student_id: 7 },
    });
    mockPrisma.aiAgentSession.update.mockResolvedValue({
      id: 1,
      state: { selected_student_id: 7 },
    });
    mockPrisma.aiCopilotTurnEvent.create.mockResolvedValue({ id: 1 });

    const result = await service.createTurn(
      { tenantId: 10, userId: 20, role: 'ADMIN' },
      1,
      'tìm học viên',
    );

    expect(mockAgentRunner.run).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 10,
        userId: 20,
        sessionId: 1,
        userMessage: 'tìm học viên',
        sessionHistory: [],
      }),
    );
    expect(mockPrisma.aiAgentSessionMessage.create).toHaveBeenCalledTimes(2);
    expect(result.response).toEqual({
      type: 'text_message',
      message: 'Đây là kết quả.',
    });
  });

  it('deterministic xử lý tìm kiếm thì KHÔNG gọi LLM (không lỗi quota)', async () => {
    mockPrisma.aiAgentSession.findFirst.mockResolvedValue({
      id: 1,
      tenantId: 10,
      userId: 20,
      status: 'ACTIVE',
      state: {},
    });
    mockPrisma.aiAgentSessionMessage.create
      .mockResolvedValueOnce({ id: 100, role: 'user', content: 'tìm học viên toàn' })
      .mockResolvedValueOnce({ id: 101, role: 'assistant', content: '{}' });
    mockDeterministic.resolve.mockResolvedValue({
      type: 'message',
      message: 'Tôi tìm thấy 1 học viên: Toàn',
      contextPatch: { last_intent: 'search_student' },
    });
    mockPrisma.aiAgentSession.update.mockResolvedValue({ id: 1, state: {} });
    mockPrisma.aiCopilotTurnEvent.create.mockResolvedValue({ id: 1 });

    const result = await service.createTurn(
      { tenantId: 10, userId: 20, role: 'ADMIN' },
      1,
      'tìm học viên toàn',
    );

    expect(mockAgentRunner.run).not.toHaveBeenCalled();
    expect(result.response).toEqual({
      type: 'text_message',
      message: 'Tôi tìm thấy 1 học viên: Toàn',
    });
  });

  it('LLM hết quota thì fallback tìm DB và trả câu thân thiện', async () => {
    mockPrisma.aiAgentSession.findFirst.mockResolvedValue({
      id: 1,
      tenantId: 10,
      userId: 20,
      status: 'ACTIVE',
      state: {},
    });
    mockPrisma.aiAgentSessionMessage.create
      .mockResolvedValueOnce({ id: 100, role: 'user', content: 'ai đó tên nam' })
      .mockResolvedValueOnce({ id: 101, role: 'assistant', content: '{}' });
    mockPrisma.aiAgentSessionMessage.findMany.mockResolvedValue([]);
    mockDeterministic.resolve.mockResolvedValue(null);
    mockAgentRunner.run.mockResolvedValue({
      type: 'text',
      message: 'Hệ thống AI đang quá tải.',
      contextPatch: {},
      llmUnavailable: true,
    });
    mockDeterministic.fallbackSearch.mockResolvedValue({
      message: 'Tôi tìm thấy 1 học viên: Nam',
      contextPatch: {},
    });
    mockPrisma.aiAgentSession.update.mockResolvedValue({ id: 1, state: {} });
    mockPrisma.aiCopilotTurnEvent.create.mockResolvedValue({ id: 1 });

    const result = await service.createTurn(
      { tenantId: 10, userId: 20, role: 'ADMIN' },
      1,
      'ai đó tên nam',
    );

    expect(mockDeterministic.fallbackSearch).toHaveBeenCalledWith(
      10,
      'ai đó tên nam',
    );
    expect((result.response as any).type).toBe('text_message');
    expect((result.response as any).message).toContain(
      'AI đang tạm hết quota',
    );
    expect((result.response as any).message).toContain('Nam');
  });

  it('confirm thực thi pending action qua ToolRegistry rồi clear pending', async () => {
    mockPrisma.aiAgentSession.findFirst.mockResolvedValue({
      id: 1,
      tenantId: 10,
      userId: 20,
      status: 'ACTIVE',
      state: {
        pending_action: {
          tool_name: 'create_student',
          input: { fullName: 'Nguyễn Văn A' },
          summary: 'Tạo học viên',
          intent: 'create_student',
        },
      },
    });
    mockToolRegistry.execute.mockResolvedValue({
      id: 9,
      fullName: 'Nguyễn Văn A',
    });
    mockPrisma.aiAgentSessionMessage.create.mockResolvedValue({
      id: 101,
      role: 'assistant',
      content: '{}',
    });
    mockPrisma.aiAgentSession.update.mockResolvedValue({
      id: 1,
      state: { pending_action: null },
    });
    mockPrisma.aiCopilotTurnEvent.create.mockResolvedValue({ id: 1 });

    await service.confirm({ tenantId: 10, userId: 20, role: 'ADMIN' }, 1);

    expect(mockToolRegistry.execute).toHaveBeenCalledWith(
      1,
      { tenantId: 10, userId: 20, role: 'ADMIN' },
      'create_student',
      { fullName: 'Nguyễn Văn A' },
    );
    expect(mockPrisma.aiAgentSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: expect.objectContaining({
            pending_action: null,
            selected_student_id: 9,
          }),
        }),
      }),
    );
  });

  it('createTurn gặp pending_action và user gửi ok thì confirm gọi ToolRegistry.execute', async () => {
    mockPrisma.aiAgentSession.findFirst.mockResolvedValue({
      id: 1,
      tenantId: 10,
      userId: 20,
      status: 'ACTIVE',
      state: {
        pending_action: {
          tool_name: 'create_student',
          input: { fullName: 'Nguyễn Văn A' },
          summary: 'Tạo học viên',
          intent: 'create_student',
        },
      },
    });
    mockPrisma.aiAgentSessionMessage.create
      .mockResolvedValueOnce({ id: 100, role: 'user', content: 'ok' })
      .mockResolvedValueOnce({ id: 101, role: 'assistant', content: '{}' });
    mockToolRegistry.execute.mockResolvedValue({
      id: 9,
      fullName: 'Nguyễn Văn A',
    });
    mockPrisma.aiAgentSession.update.mockResolvedValue({
      id: 1,
      state: { pending_action: null },
    });
    mockPrisma.aiCopilotTurnEvent.create.mockResolvedValue({ id: 1 });

    await service.createTurn(
      { tenantId: 10, userId: 20, role: 'ADMIN' },
      1,
      'ok',
    );

    expect(mockToolRegistry.execute).toHaveBeenCalledWith(
      1,
      { tenantId: 10, userId: 20, role: 'ADMIN' },
      'create_student',
      { fullName: 'Nguyễn Văn A' },
    );
    expect(mockAgentRunner.run).not.toHaveBeenCalled();
  });

  it('confirm update_course: gọi execute và giữ selected_course_id trong state', async () => {
    mockPrisma.aiAgentSession.findFirst.mockResolvedValue({
      id: 1,
      tenantId: 10,
      userId: 20,
      status: 'ACTIVE',
      state: {
        selected_course_id: 79,
        last_created_course: { id: 79, label: 'Test 1' },
        pending_action: {
          tool_name: 'update_course',
          input: { courseId: 79, level: 'Cấp độ 1' },
          summary: 'Cập nhật khóa học Test 1',
          intent: 'update_course',
        },
      },
    });
    mockPrisma.aiAgentSessionMessage.create
      .mockResolvedValueOnce({ id: 100, role: 'user', content: 'ok' })
      .mockResolvedValueOnce({ id: 101, role: 'assistant', content: '{}' });
    mockToolRegistry.execute.mockResolvedValue({
      id: 79,
      title: 'Test 1',
      courseCode: 'TEST_1',
      level: 'Cấp độ 1',
    });
    mockPrisma.aiAgentSession.update.mockResolvedValue({ id: 1, state: {} });
    mockPrisma.aiCopilotTurnEvent.create.mockResolvedValue({ id: 1 });

    const result = await service.createTurn(
      { tenantId: 10, userId: 20, role: 'ADMIN' },
      1,
      'ok',
    );

    expect(mockToolRegistry.execute).toHaveBeenCalledWith(
      1,
      { tenantId: 10, userId: 20, role: 'ADMIN' },
      'update_course',
      { courseId: 79, level: 'Cấp độ 1' },
    );
    expect(result.response.type).toBe('tool_result');
    expect(String(result.response.message)).toContain(
      'Đã cập nhật khóa học thành công',
    );
    const updateArg = mockPrisma.aiAgentSession.update.mock.calls[0][0];
    expect(updateArg.data.state.selected_course_id).toBe(79);
    expect(updateArg.data.state.pending_action).toBeNull();
  });

  it('createTurn gặp pending_action và user gửi hủy thì clear pending, không execute', async () => {
    mockPrisma.aiAgentSession.findFirst.mockResolvedValue({
      id: 1,
      tenantId: 10,
      userId: 20,
      status: 'ACTIVE',
      state: {
        pending_action: {
          tool_name: 'create_student',
          input: { fullName: 'Nguyễn Văn A' },
          summary: 'Tạo học viên',
          intent: 'create_student',
        },
      },
    });
    mockPrisma.aiAgentSessionMessage.create
      .mockResolvedValueOnce({ id: 100, role: 'user', content: 'hủy' })
      .mockResolvedValueOnce({ id: 101, role: 'assistant', content: '{}' });
    mockPrisma.aiAgentSession.update.mockResolvedValue({
      id: 1,
      state: { pending_action: null },
    });
    mockPrisma.aiCopilotTurnEvent.create.mockResolvedValue({ id: 1 });

    await service.createTurn(
      { tenantId: 10, userId: 20, role: 'ADMIN' },
      1,
      'hủy',
    );

    expect(mockToolRegistry.execute).not.toHaveBeenCalled();
    expect(mockPrisma.aiAgentSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: expect.objectContaining({ pending_action: null }),
        }),
      }),
    );
    expect(mockAgentRunner.run).not.toHaveBeenCalled();
  });

  it('trả lời tên lớp khi đang chờ (pending_class_creation) -> preview create_class, không hỏi thêm', async () => {
    mockPrisma.aiAgentSession.findFirst.mockResolvedValue({
      id: 1,
      tenantId: 10,
      userId: 20,
      status: 'ACTIVE',
      state: {
        pending_class_creation: {
          courseId: 62,
          courseTitle: 'Tiếng Bi',
          type: 'WEEKLY',
        },
      },
    });
    mockPrisma.aiAgentSessionMessage.create
      .mockResolvedValueOnce({ id: 100, role: 'user', content: 'Lớp Tiếng Bi 2' })
      .mockResolvedValueOnce({ id: 101, role: 'assistant', content: '{}' });
    mockPrisma.aiAgentSessionMessage.findMany.mockResolvedValue([]);
    mockPrisma.aiAgentSession.update.mockResolvedValue({ id: 1, state: {} });
    mockPrisma.aiCopilotTurnEvent.create.mockResolvedValue({ id: 1 });

    const result = await service.createTurn(
      { tenantId: 10, userId: 20, role: 'ADMIN' },
      1,
      'Lớp Tiếng Bi 2',
    );

    // Đã xử lý bằng context -> KHÔNG cần LLM/deterministic, cũng không execute.
    expect(mockDeterministic.resolve).not.toHaveBeenCalled();
    expect(mockAgentRunner.run).not.toHaveBeenCalled();
    expect(mockToolRegistry.execute).not.toHaveBeenCalled();
    expect(mockDeterministic.buildCreateClassPending).toHaveBeenCalledWith(
      expect.objectContaining({
        courseId: 62,
        title: 'Lớp Tiếng Bi 2',
        type: 'WEEKLY',
      }),
    );
    expect(result.response.type).toBe('preview_card');

    const updateArg = mockPrisma.aiAgentSession.update.mock.calls[0][0];
    expect(updateArg.data.state.pending_action.tool_name).toBe('create_class');
    expect(updateArg.data.state.pending_class_creation).toBeNull();
  });

  it('createTurn gặp pending_write từ runner thì trả preview_card, KHÔNG execute và lưu pending_action', async () => {
    mockPrisma.aiAgentSession.findFirst.mockResolvedValue({
      id: 1,
      tenantId: 10,
      userId: 20,
      status: 'ACTIVE',
      state: {},
    });
    mockPrisma.aiAgentSessionMessage.create
      .mockResolvedValueOnce({
        id: 100,
        role: 'user',
        content: 'Tạo học viên A',
      })
      .mockResolvedValueOnce({ id: 101, role: 'assistant', content: '{}' });
    mockPrisma.aiAgentSessionMessage.findMany.mockResolvedValue([]);
    mockAgentRunner.run.mockResolvedValue({
      type: 'pending_write',
      pendingAction: {
        tool_name: 'create_student',
        input: { fullName: 'Nguyễn Văn A', email: 'a@test.com' },
        summary: 'Tạo học viên mới',
        severity: 'normal',
        status: 'waiting_confirm',
      },
      contextPatch: {},
      message: 'Chuẩn bị tạo',
    });
    mockPrisma.aiAgentSession.update.mockResolvedValue({
      id: 1,
      state: { pending_action: { tool_name: 'create_student' } },
    });
    mockPrisma.aiCopilotTurnEvent.create.mockResolvedValue({ id: 1 });

    const result = await service.createTurn(
      { tenantId: 10, userId: 20, role: 'ADMIN' },
      1,
      'Tạo học viên A',
    );

    expect(mockToolRegistry.execute).not.toHaveBeenCalled();
    expect(result.response.type).toBe('preview_card');

    const updateArg = mockPrisma.aiAgentSession.update.mock.calls[0][0];
    expect(updateArg.data.state.pending_action).toBeTruthy();
    expect(updateArg.data.state.pending_action.tool_name).toBe(
      'create_student',
    );
  });

  it('confirm mới execute DB rồi clear pending và trả tool_result', async () => {
    mockPrisma.aiAgentSession.findFirst.mockResolvedValue({
      id: 1,
      tenantId: 10,
      userId: 20,
      status: 'ACTIVE',
      state: {
        pending_action: {
          tool_name: 'create_student',
          input: { fullName: 'Nguyễn Văn A', email: 'a@test.com' },
          summary: 'Tạo học viên mới',
          intent: 'create_student',
        },
      },
    });
    mockToolRegistry.execute.mockResolvedValue({
      id: 9,
      fullName: 'Nguyễn Văn A',
    });
    mockPrisma.aiAgentSessionMessage.create.mockResolvedValue({
      id: 101,
      role: 'assistant',
      content: '{}',
    });
    mockPrisma.aiAgentSession.update.mockResolvedValue({
      id: 1,
      state: { pending_action: null },
    });
    mockPrisma.aiCopilotTurnEvent.create.mockResolvedValue({ id: 1 });

    const result = await service.confirm(
      { tenantId: 10, userId: 20, role: 'ADMIN' },
      1,
    );

    expect(mockToolRegistry.execute).toHaveBeenCalledTimes(1);
    expect(result.response.type).toBe('tool_result');

    const updateArg = mockPrisma.aiAgentSession.update.mock.calls[0][0];
    expect(updateArg.data.state.pending_action).toBeNull();
  });

  it('cancel không execute và clear pending_action', async () => {
    mockPrisma.aiAgentSession.findFirst.mockResolvedValue({
      id: 1,
      tenantId: 10,
      userId: 20,
      status: 'ACTIVE',
      state: {
        pending_action: {
          tool_name: 'create_student',
          input: { fullName: 'Nguyễn Văn A' },
          summary: 'Tạo học viên',
          intent: 'create_student',
        },
      },
    });
    mockPrisma.aiAgentSessionMessage.create.mockResolvedValue({
      id: 101,
      role: 'assistant',
      content: '{}',
    });
    mockPrisma.aiAgentSession.update.mockResolvedValue({
      id: 1,
      state: { pending_action: null },
    });
    mockPrisma.aiCopilotTurnEvent.create.mockResolvedValue({ id: 1 });

    await service.cancel({ tenantId: 10, userId: 20, role: 'ADMIN' }, 1);

    expect(mockToolRegistry.execute).not.toHaveBeenCalled();
    const updateArg = mockPrisma.aiAgentSession.update.mock.calls[0][0];
    expect(updateArg.data.state.pending_action).toBeNull();
  });

  it('suggestion WRITE cũng trả preview_card, KHÔNG execute và lưu pending_action', async () => {
    mockPrisma.aiAgentSession.findFirst.mockResolvedValue({
      id: 1,
      tenantId: 10,
      userId: 20,
      status: 'ACTIVE',
      state: {},
    });
    mockPrisma.aiAgentSessionMessage.create
      .mockResolvedValueOnce({
        id: 100,
        role: 'user',
        content: 'Tạo học viên A',
      })
      .mockResolvedValueOnce({ id: 101, role: 'assistant', content: '{}' });
    mockPrisma.aiAgentSession.update.mockResolvedValue({
      id: 1,
      state: { pending_action: { tool_name: 'create_student' } },
    });
    mockPrisma.aiCopilotTurnEvent.create.mockResolvedValue({ id: 1 });

    const result = await service.createTurn(
      { tenantId: 10, userId: 20, role: 'ADMIN' },
      1,
      'Tạo học viên A',
      {
        type: 'suggestion_action',
        action: 'create_student',
        input: { fullName: 'Nguyễn Văn A', email: 'a@test.com' },
      },
    );

    expect(mockToolRegistry.execute).not.toHaveBeenCalled();
    expect(mockAgentRunner.run).not.toHaveBeenCalled();
    expect(result.response.type).toBe('preview_card');

    const updateArg = mockPrisma.aiAgentSession.update.mock.calls[0][0];
    expect(updateArg.data.state.pending_action).toBeTruthy();
    expect(updateArg.data.state.pending_action.tool_name).toBe(
      'create_student',
    );
  });

  it('create_student trùng email trả clarification, KHÔNG tạo pending và không execute', async () => {
    mockPrisma.aiAgentSession.findFirst.mockResolvedValue({
      id: 1,
      tenantId: 10,
      userId: 20,
      status: 'ACTIVE',
      state: {},
    });
    mockPrisma.aiAgentSessionMessage.create
      .mockResolvedValueOnce({
        id: 100,
        role: 'user',
        content: 'Tạo học viên A old@test.com',
      })
      .mockResolvedValueOnce({ id: 101, role: 'assistant', content: '{}' });
    mockPrisma.aiAgentSessionMessage.findMany.mockResolvedValue([]);
    mockAgentRunner.run.mockResolvedValue({
      type: 'pending_write',
      pendingAction: {
        tool_name: 'create_student',
        input: { fullName: 'Nguyễn Văn A', email: 'old@test.com' },
        summary: 'Tạo học viên mới',
        severity: 'normal',
        status: 'waiting_confirm',
      },
      contextPatch: {},
      message: 'Chuẩn bị tạo',
    });
    mockUsersService.findDuplicateStudentByEmailOrPhone.mockResolvedValue({
      id: 5,
      fullName: 'Nguyễn Văn A',
      email: 'old@test.com',
      phone: '0987654321',
    });
    mockPrisma.aiAgentSession.update.mockResolvedValue({
      id: 1,
      state: { duplicate_student_context: {} },
    });
    mockPrisma.aiCopilotTurnEvent.create.mockResolvedValue({ id: 1 });

    const result = await service.createTurn(
      { tenantId: 10, userId: 20, role: 'ADMIN' },
      1,
      'Tạo học viên A old@test.com',
    );

    expect(result.response.type).toBe('clarification');
    expect(mockToolRegistry.execute).not.toHaveBeenCalled();

    const updateArg = mockPrisma.aiAgentSession.update.mock.calls[0][0];
    expect(updateArg.data.state.pending_action).toBeNull();
    expect(updateArg.data.state.duplicate_student_context).toBeTruthy();
    expect(updateArg.data.state.duplicate_student_context.intended_action).toBe(
      'create',
    );
    expect(updateArg.data.state.last_intent).toBe('create_student');
  });

  it('create_student không trùng vẫn preview_card bình thường', async () => {
    mockPrisma.aiAgentSession.findFirst.mockResolvedValue({
      id: 1,
      tenantId: 10,
      userId: 20,
      status: 'ACTIVE',
      state: {},
    });
    mockPrisma.aiAgentSessionMessage.create
      .mockResolvedValueOnce({
        id: 100,
        role: 'user',
        content: 'Tạo học viên A new@test.com',
      })
      .mockResolvedValueOnce({ id: 101, role: 'assistant', content: '{}' });
    mockPrisma.aiAgentSessionMessage.findMany.mockResolvedValue([]);
    mockAgentRunner.run.mockResolvedValue({
      type: 'pending_write',
      pendingAction: {
        tool_name: 'create_student',
        input: { fullName: 'Nguyễn Văn A', email: 'new@test.com' },
        summary: 'Tạo học viên mới',
        severity: 'normal',
        status: 'waiting_confirm',
      },
      contextPatch: {},
      message: 'Chuẩn bị tạo',
    });
    mockUsersService.findDuplicateStudentByEmailOrPhone.mockResolvedValue(null);
    mockPrisma.aiAgentSession.update.mockResolvedValue({
      id: 1,
      state: { pending_action: { tool_name: 'create_student' } },
    });
    mockPrisma.aiCopilotTurnEvent.create.mockResolvedValue({ id: 1 });

    const result = await service.createTurn(
      { tenantId: 10, userId: 20, role: 'ADMIN' },
      1,
      'Tạo học viên A new@test.com',
    );

    expect(result.response.type).toBe('preview_card');
    const updateArg = mockPrisma.aiAgentSession.update.mock.calls[0][0];
    expect(updateArg.data.state.pending_action.tool_name).toBe(
      'create_student',
    );
    expect(updateArg.data.state.last_intent).toBe('create_student');
  });

  it('confirm update_student bị chặn khi duplicate context là create', async () => {
    mockPrisma.aiAgentSession.findFirst.mockResolvedValue({
      id: 1,
      tenantId: 10,
      userId: 20,
      status: 'ACTIVE',
      state: {
        pending_action: {
          tool_name: 'update_student',
          input: { userId: 1, fullName: 'Tên mới' },
          summary: 'Cập nhật học viên',
          intent: 'update_student',
        },
        duplicate_student_context: {
          intended_action: 'create',
          existing_student: { id: 1, label: 'Nguyễn Văn A' },
        },
        last_intent: 'create_student',
      },
    });
    mockPrisma.aiAgentSessionMessage.create.mockResolvedValue({
      id: 101,
      role: 'assistant',
      content: '{}',
    });
    mockPrisma.aiAgentSession.update.mockResolvedValue({
      id: 1,
      state: { pending_action: null },
    });
    mockPrisma.aiCopilotTurnEvent.create.mockResolvedValue({ id: 1 });

    const result = await service.confirm(
      { tenantId: 10, userId: 20, role: 'ADMIN' },
      1,
    );

    expect(mockToolRegistry.execute).not.toHaveBeenCalled();
    expect(['clarification', 'error']).toContain(result.response.type);
  });

  it('user chọn "dùng học viên có sẵn" thì set selected student, clear duplicate, không execute', async () => {
    mockPrisma.aiAgentSession.findFirst.mockResolvedValue({
      id: 1,
      tenantId: 10,
      userId: 20,
      status: 'ACTIVE',
      state: {
        duplicate_student_context: {
          intended_action: 'create',
          existing_student: { id: 7, label: 'Nguyễn Văn A' },
        },
      },
    });
    mockPrisma.aiAgentSessionMessage.create
      .mockResolvedValueOnce({
        id: 100,
        role: 'user',
        content: 'Dùng học viên có sẵn',
      })
      .mockResolvedValueOnce({ id: 101, role: 'assistant', content: '{}' });
    mockPrisma.aiAgentSession.update.mockResolvedValue({
      id: 1,
      state: { duplicate_student_context: null },
    });
    mockPrisma.aiCopilotTurnEvent.create.mockResolvedValue({ id: 1 });

    const result = await service.createTurn(
      { tenantId: 10, userId: 20, role: 'ADMIN' },
      1,
      'Dùng học viên có sẵn',
    );

    expect(mockToolRegistry.execute).not.toHaveBeenCalled();
    expect(mockAgentRunner.run).not.toHaveBeenCalled();
    expect(result.response.type).toBe('text_message');

    const updateArg = mockPrisma.aiAgentSession.update.mock.calls[0][0];
    expect(updateArg.data.state.selected_student_id).toBe(7);
    expect(updateArg.data.state.duplicate_student_context).toBeNull();
  });

  it('createTurn trả preview_card cho assign_student_to_course, không execute', async () => {
    mockPrisma.aiAgentSession.findFirst.mockResolvedValue({
      id: 1,
      tenantId: 10,
      userId: 20,
      status: 'ACTIVE',
      state: {},
    });
    mockPrisma.aiAgentSessionMessage.create
      .mockResolvedValueOnce({
        id: 100,
        role: 'user',
        content: 'Thêm học viên 1 vào khóa 10',
      })
      .mockResolvedValueOnce({ id: 101, role: 'assistant', content: '{}' });
    mockPrisma.aiAgentSessionMessage.findMany.mockResolvedValue([]);
    mockAgentRunner.run.mockResolvedValue({
      type: 'pending_write',
      pendingAction: {
        tool_name: 'assign_student_to_course',
        input: { userId: 1, courseId: 10 },
        summary: 'Ghi danh học viên #1 vào khóa học #10',
        status: 'waiting_confirm',
      },
      contextPatch: {},
      message: 'Chuẩn bị ghi danh',
    });
    mockPrisma.aiAgentSession.update.mockResolvedValue({
      id: 1,
      state: { pending_action: { tool_name: 'assign_student_to_course' } },
    });
    mockPrisma.aiCopilotTurnEvent.create.mockResolvedValue({ id: 1 });

    const result = await service.createTurn(
      { tenantId: 10, userId: 20, role: 'ADMIN' },
      1,
      'Thêm học viên 1 vào khóa 10',
    );

    expect(mockToolRegistry.execute).not.toHaveBeenCalled();
    expect(result.response.type).toBe('preview_card');

    const updateArg = mockPrisma.aiAgentSession.update.mock.calls[0][0];
    expect(updateArg.data.state.pending_action.tool_name).toBe(
      'assign_student_to_course',
    );
  });

  it('confirm execute assign_student_to_course với đúng input', async () => {
    mockPrisma.aiAgentSession.findFirst.mockResolvedValue({
      id: 1,
      tenantId: 10,
      userId: 20,
      status: 'ACTIVE',
      state: {
        pending_action: {
          tool_name: 'assign_student_to_course',
          input: { userId: 1, courseId: 10 },
          summary: 'Ghi danh học viên #1 vào khóa học #10',
          intent: 'assign_student_to_course',
        },
      },
    });
    mockToolRegistry.execute.mockResolvedValue({
      id: 55,
      enrollmentId: 55,
      studentId: 1,
      courseId: 10,
      classId: 5,
    });
    mockPrisma.aiAgentSessionMessage.create.mockResolvedValue({
      id: 101,
      role: 'assistant',
      content: '{}',
    });
    mockPrisma.aiAgentSession.update.mockResolvedValue({
      id: 1,
      state: { pending_action: null },
    });
    mockPrisma.aiCopilotTurnEvent.create.mockResolvedValue({ id: 1 });

    const result = await service.confirm(
      { tenantId: 10, userId: 20, role: 'ADMIN' },
      1,
    );

    expect(mockToolRegistry.execute).toHaveBeenCalledWith(
      1,
      { tenantId: 10, userId: 20, role: 'ADMIN' },
      'assign_student_to_course',
      expect.objectContaining({ userId: 1, courseId: 10 }),
    );
    expect(result.response.type).toBe('tool_result');

    const updateArg = mockPrisma.aiAgentSession.update.mock.calls[0][0];
    expect(updateArg.data.state.pending_action).toBeNull();
    expect(updateArg.data.state.selected_course_id).toBe(10);
  });

  it('confirm assign_student_to_course lỗi nhiều lớp thì chuyển sang clarification chọn lớp', async () => {
    mockPrisma.aiAgentSession.findFirst.mockResolvedValue({
      id: 1,
      tenantId: 10,
      userId: 20,
      status: 'ACTIVE',
      state: {
        pending_action: {
          tool_name: 'assign_student_to_course',
          input: { userId: 1, courseId: 10 },
          summary: 'Ghi danh',
          intent: 'assign_student_to_course',
        },
      },
    });
    const multiClassError: any = new Error('multiple');
    multiClassError.response = {
      code: 'COURSE_HAS_MULTIPLE_CLASSES',
      message: 'Khóa học này có nhiều lớp.',
      classes: [
        { id: 5, label: 'IELTS tối', classCode: 'IELTS_T', status: 'ACTIVE' },
        {
          id: 6,
          label: 'IELTS cuối tuần',
          classCode: 'IELTS_CT',
          status: 'ACTIVE',
        },
      ],
    };
    mockToolRegistry.execute.mockRejectedValue(multiClassError);
    mockPrisma.aiAgentSessionMessage.create.mockResolvedValue({
      id: 101,
      role: 'assistant',
      content: '{}',
    });
    mockPrisma.aiAgentSession.update.mockResolvedValue({
      id: 1,
      state: {},
    });
    mockPrisma.aiCopilotTurnEvent.create.mockResolvedValue({ id: 1 });

    const result = await service.confirm(
      { tenantId: 10, userId: 20, role: 'ADMIN' },
      1,
    );

    expect(result.response.type).toBe('clarification');
    const updateArg = mockPrisma.aiAgentSession.update.mock.calls[0][0];
    expect(updateArg.data.state.pending_action).toBeNull();
    expect(
      updateArg.data.state.pending_enrollment_context.candidateClasses,
    ).toHaveLength(2);
    expect(updateArg.data.state.pending_enrollment_context.courseId).toBe(10);
  });

  it('user chọn lớp sau khi nhiều lớp thì tạo preview assign_student_to_course kèm classId', async () => {
    mockPrisma.aiAgentSession.findFirst.mockResolvedValue({
      id: 1,
      tenantId: 10,
      userId: 20,
      status: 'ACTIVE',
      state: {
        pending_enrollment_context: {
          userId: 1,
          courseId: 10,
          candidateClasses: [
            { id: 5, label: 'IELTS tối' },
            { id: 6, label: 'IELTS cuối tuần' },
          ],
        },
      },
    });
    mockPrisma.aiAgentSessionMessage.create
      .mockResolvedValueOnce({ id: 100, role: 'user', content: 'chọn lớp 2' })
      .mockResolvedValueOnce({ id: 101, role: 'assistant', content: '{}' });
    mockPrisma.aiAgentSession.update.mockResolvedValue({
      id: 1,
      state: { pending_action: { tool_name: 'assign_student_to_course' } },
    });
    mockPrisma.aiCopilotTurnEvent.create.mockResolvedValue({ id: 1 });

    const result = await service.createTurn(
      { tenantId: 10, userId: 20, role: 'ADMIN' },
      1,
      'chọn lớp 2',
    );

    expect(mockToolRegistry.execute).not.toHaveBeenCalled();
    expect(mockAgentRunner.run).not.toHaveBeenCalled();
    expect(result.response.type).toBe('preview_card');

    const updateArg = mockPrisma.aiAgentSession.update.mock.calls[0][0];
    expect(updateArg.data.state.pending_action.input.classId).toBe(6);
    expect(updateArg.data.state.pending_enrollment_context).toBeNull();
  });

  it('createTurn trả preview_card cho create_course kèm ngày, không execute', async () => {
    mockPrisma.aiAgentSession.findFirst.mockResolvedValue({
      id: 1,
      tenantId: 10,
      userId: 20,
      status: 'ACTIVE',
      state: {},
    });
    mockPrisma.aiAgentSessionMessage.create
      .mockResolvedValueOnce({
        id: 100,
        role: 'user',
        content: 'Tạo khóa IELTS 6.5',
      })
      .mockResolvedValueOnce({ id: 101, role: 'assistant', content: '{}' });
    mockPrisma.aiAgentSessionMessage.findMany.mockResolvedValue([]);
    mockAgentRunner.run.mockResolvedValue({
      type: 'pending_write',
      pendingAction: {
        tool_name: 'create_course',
        input: {
          title: 'IELTS 6.5',
          startDate: '2026-07-10',
          expireDate: '2026-09-10',
        },
        summary: 'Tạo khóa học mới: IELTS 6.5',
        status: 'waiting_confirm',
      },
      contextPatch: {},
      message: 'Chuẩn bị tạo khóa',
    });
    mockPrisma.aiAgentSession.update.mockResolvedValue({
      id: 1,
      state: { pending_action: { tool_name: 'create_course' } },
    });
    mockPrisma.aiCopilotTurnEvent.create.mockResolvedValue({ id: 1 });

    const result = await service.createTurn(
      { tenantId: 10, userId: 20, role: 'ADMIN' },
      1,
      'Tạo khóa IELTS 6.5',
    );

    expect(mockToolRegistry.execute).not.toHaveBeenCalled();
    expect(result.response.type).toBe('preview_card');

    const updateArg = mockPrisma.aiAgentSession.update.mock.calls[0][0];
    expect(updateArg.data.state.pending_action.tool_name).toBe('create_course');
    expect(updateArg.data.state.pending_action.input.startDate).toBe(
      '2026-07-10',
    );
    expect(updateArg.data.state.pending_action.input.expireDate).toBe(
      '2026-09-10',
    );
  });

  it('confirm execute create_course kèm startDate/expireDate rồi set last_created_course', async () => {
    mockPrisma.aiAgentSession.findFirst.mockResolvedValue({
      id: 1,
      tenantId: 10,
      userId: 20,
      status: 'ACTIVE',
      state: {
        pending_action: {
          tool_name: 'create_course',
          input: {
            title: 'IELTS 6.5',
            startDate: '2026-07-10',
            expireDate: '2026-09-10',
          },
          summary: 'Tạo khóa học mới: IELTS 6.5',
          intent: 'create_course',
        },
      },
    });
    mockToolRegistry.execute.mockResolvedValue({
      id: 42,
      title: 'IELTS 6.5',
      courseCode: 'IELTS_6_5',
      startDate: '2026-07-10T00:00:00.000Z',
      expireDate: '2026-09-10T00:00:00.000Z',
    });
    mockPrisma.aiAgentSessionMessage.create.mockResolvedValue({
      id: 101,
      role: 'assistant',
      content: '{}',
    });
    mockPrisma.aiAgentSession.update.mockResolvedValue({
      id: 1,
      state: { pending_action: null },
    });
    mockPrisma.aiCopilotTurnEvent.create.mockResolvedValue({ id: 1 });

    const result = await service.confirm(
      { tenantId: 10, userId: 20, role: 'ADMIN' },
      1,
    );

    expect(mockToolRegistry.execute).toHaveBeenCalledWith(
      1,
      { tenantId: 10, userId: 20, role: 'ADMIN' },
      'create_course',
      expect.objectContaining({
        title: 'IELTS 6.5',
        startDate: '2026-07-10',
        expireDate: '2026-09-10',
      }),
    );
    expect(result.response.type).toBe('tool_result');

    const updateArg = mockPrisma.aiAgentSession.update.mock.calls[0][0];
    expect(updateArg.data.state.pending_action).toBeNull();
    expect(updateArg.data.state.selected_course_id).toBe(42);
    expect(updateArg.data.state.last_created_course).toBeTruthy();
  });

  describe('confirm/cancel text matching (Cụm 6)', () => {
    it('confirm text match toàn chuỗi, tránh false positive', () => {
      const s = service as any;
      expect(s.isConfirmText('ok')).toBe(true);
      expect(s.isConfirmText('oke')).toBe(true);
      expect(s.isConfirmText('đồng ý')).toBe(true);
      expect(s.isConfirmText('Xác nhận')).toBe(true);
      expect(s.isConfirmText('confirm')).toBe(true);

      expect(s.isConfirmText('book')).toBe(false);
      expect(s.isConfirmText('không đồng ý')).toBe(false);
      expect(s.isConfirmText('khong dong y')).toBe(false);
    });

    it('cancel text match toàn chuỗi', () => {
      const s = service as any;
      expect(s.isCancelText('hủy')).toBe(true);
      expect(s.isCancelText('cancel')).toBe(true);
      expect(s.isCancelText('không đồng ý')).toBe(true);
      expect(s.isCancelText('khong dong y')).toBe(true);

      expect(s.isCancelText('ok')).toBe(false);
      expect(s.isCancelText('khong sao')).toBe(false);
    });
  });

  describe('session cleanup (Cụm 5)', () => {
    const originalEnv = process.env.AGENT_MINI_MODE;

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.AGENT_MINI_MODE;
      } else {
        process.env.AGENT_MINI_MODE = originalEnv;
      }
    });

    it('createSession tạo state sạch', async () => {
      mockPrisma.aiAgentSession.create.mockResolvedValue({ id: 1 });

      await service.createSession(10, 20, { title: 'X' });

      const arg = mockPrisma.aiAgentSession.create.mock.calls[0][0];
      expect(arg.data.status).toBe('ACTIVE');
      expect(arg.data.state.pending_action).toBeNull();
      expect(arg.data.state.selected_student_id).toBeNull();
      expect(arg.data.state.selected_course_id).toBeNull();
      expect(arg.data.state.duplicate_student_context).toBeNull();
      expect(arg.data.state.last_candidates.students).toEqual([]);
    });

    it('closeSession set CLOSED và clear pending_action/context', async () => {
      mockPrisma.aiAgentSession.findFirst.mockResolvedValue({
        id: 1,
        tenantId: 10,
        userId: 20,
        status: 'ACTIVE',
        state: {
          pending_action: {
            tool_name: 'create_student',
            input: { fullName: 'A' },
          },
          selected_student_id: 1,
          selected_course_id: 2,
        },
      });
      mockPrisma.aiAgentSession.update.mockResolvedValue({ id: 1 });

      await service.closeSession(10, 20, 1);

      const arg = mockPrisma.aiAgentSession.update.mock.calls[0][0];
      expect(arg.data.status).toBe('CLOSED');
      expect(arg.data.state.pending_action).toBeNull();
      expect(arg.data.state.selected_student_id).toBeNull();
      expect(arg.data.state.selected_course_id).toBeNull();
      expect(arg.data.state.duplicate_student_context).toBeNull();
    });

    it('confirm trên session CLOSED bị chặn SESSION_NOT_ACTIVE', async () => {
      mockPrisma.aiAgentSession.findFirst.mockResolvedValue({
        id: 1,
        tenantId: 10,
        userId: 20,
        status: 'CLOSED',
        state: {},
      });

      await expect(
        service.confirm({ tenantId: 10, userId: 20, role: 'ADMIN' }, 1),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'SESSION_NOT_ACTIVE' }),
      });
      expect(mockToolRegistry.execute).not.toHaveBeenCalled();
    });

    it('confirm pending delete_students bị chặn trong mini mode, clear pending', async () => {
      process.env.AGENT_MINI_MODE = 'true';
      mockPrisma.aiAgentSession.findFirst.mockResolvedValue({
        id: 1,
        tenantId: 10,
        userId: 20,
        status: 'ACTIVE',
        state: {
          pending_action: { tool_name: 'delete_students', input: { ids: [1] } },
        },
      });
      mockPrisma.aiAgentSessionMessage.create.mockResolvedValue({
        id: 101,
        role: 'assistant',
        content: '{}',
      });
      mockPrisma.aiAgentSession.update.mockResolvedValue({ id: 1, state: {} });
      mockPrisma.aiCopilotTurnEvent.create.mockResolvedValue({ id: 1 });

      const result = await service.confirm(
        { tenantId: 10, userId: 20, role: 'ADMIN' },
        1,
      );

      expect(mockToolRegistry.execute).not.toHaveBeenCalled();
      expect(result.response.type).toBe('error');
      const arg = mockPrisma.aiAgentSession.update.mock.calls[0][0];
      expect(arg.data.state.pending_action).toBeNull();
    });

    it('getOrCreateCurrentSession bỏ qua session CLOSED, tạo session ACTIVE mới', async () => {
      // Không có session ACTIVE nào -> phải tạo mới.
      mockPrisma.aiAgentSession.findFirst.mockResolvedValue(null);
      mockPrisma.aiAgentSession.create.mockResolvedValue({
        id: 9,
        status: 'ACTIVE',
      });

      const result = await service.getOrCreateCurrentSession(10, 20);

      expect(mockPrisma.aiAgentSession.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: 10, userId: 20, status: 'ACTIVE' },
        }),
      );
      expect(mockPrisma.aiAgentSession.create).toHaveBeenCalled();
      expect(result).toEqual({ id: 9, status: 'ACTIVE' });
    });

    it('getOrCreateCurrentSession trả session ACTIVE còn hạn', async () => {
      const recent = {
        id: 5,
        status: 'ACTIVE',
        updatedAt: new Date(),
      };
      mockPrisma.aiAgentSession.findFirst.mockResolvedValue(recent);

      const result = await service.getOrCreateCurrentSession(10, 20);

      expect(result).toBe(recent);
      expect(mockPrisma.aiAgentSession.create).not.toHaveBeenCalled();
    });
  });
});
