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
    parseStudentInfo: jest.fn(),
    resolveClassCourseReply: jest.fn(),
    resolveEnrollStudentReply: jest.fn(),
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
  const originalMiniMode = process.env.AGENT_MINI_MODE;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUsersService.findDuplicateStudentByEmailOrPhone.mockResolvedValue(null);
    // Mặc định lớp deterministic trả null -> mọi test cũ vẫn đi qua LLM như trước.
    mockDeterministic.resolve.mockResolvedValue(null);
    mockDeterministic.fallbackSearch.mockResolvedValue(null);
    mockDeterministic.parseStudentInfo.mockReturnValue({ fullName: '' });
    mockDeterministic.resolveClassCourseReply.mockResolvedValue(null);
    mockDeterministic.resolveEnrollStudentReply.mockResolvedValue(null);
    service = new CopilotService(
      mockPrisma as any,
      mockToolRegistry as any,
      mockAgentRunner as any,
      mockUsersService as any,
      mockDeterministic as any,
    );
  });

  afterEach(() => {
    if (originalMiniMode === undefined) {
      delete process.env.AGENT_MINI_MODE;
    } else {
      process.env.AGENT_MINI_MODE = originalMiniMode;
    }
  });

  it('tạo session mới với default state', async () => {
    // Không có session ACTIVE trống nào để tái sử dụng -> phải tạo mới.
    mockPrisma.aiAgentSession.findFirst.mockResolvedValue(null);
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
      .mockResolvedValueOnce({
        id: 100,
        role: 'user',
        content: 'tìm học viên toàn',
      })
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
      .mockResolvedValueOnce({
        id: 100,
        role: 'user',
        content: 'ai đó tên nam',
      })
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
    expect((result.response as any).message).toContain('AI đang tạm hết quota');
    expect((result.response as any).message).toContain('Nam');
  });

  it('renameSession đổi tên (trim) và chặn tên rỗng', async () => {
    mockPrisma.aiAgentSession.findFirst.mockResolvedValue({
      id: 1,
      tenantId: 10,
      userId: 20,
      status: 'ACTIVE',
      state: {},
    });
    mockPrisma.aiAgentSession.update.mockResolvedValue({
      id: 1,
      title: 'Tên mới',
    });

    await service.renameSession(10, 20, 1, '  Tên mới  ');
    expect(mockPrisma.aiAgentSession.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { title: 'Tên mới' },
    });

    await expect(service.renameSession(10, 20, 1, '   ')).rejects.toThrow(
      'Tên phiên chat không được để trống',
    );
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

  it('confirm lưu last_executed_idempotency_key từ pending sau khi execute', async () => {
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
          idempotency_key: 'key-abc',
        },
      },
    });
    mockToolRegistry.execute.mockResolvedValue({ id: 9 });
    mockPrisma.aiAgentSessionMessage.create.mockResolvedValue({
      id: 101,
      role: 'assistant',
      content: '{}',
    });
    mockPrisma.aiAgentSession.update.mockResolvedValue({ id: 1, state: {} });
    mockPrisma.aiCopilotTurnEvent.create.mockResolvedValue({ id: 1 });

    await service.confirm(
      { tenantId: 10, userId: 20, role: 'ADMIN' },
      1,
      undefined,
      'key-abc',
    );

    expect(mockToolRegistry.execute).toHaveBeenCalledTimes(1);
    const updateArg = mockPrisma.aiAgentSession.update.mock.calls[0][0];
    expect(updateArg.data.state.last_executed_idempotency_key).toBe('key-abc');
  });

  it('confirm lặp lại với key vừa execute -> trả idempotent, KHÔNG execute lần 2', async () => {
    mockPrisma.aiAgentSession.findFirst.mockResolvedValue({
      id: 1,
      tenantId: 10,
      userId: 20,
      status: 'ACTIVE',
      state: {
        pending_action: null,
        last_executed_idempotency_key: 'key-abc',
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
      undefined,
      'key-abc',
    );

    expect(mockToolRegistry.execute).not.toHaveBeenCalled();
    expect(result.response.type).toBe('text_message');
    expect((result.response as any).message).toContain('vừa được thực hiện');
  });

  it('confirm với key của bản nháp cũ (mismatch) -> chặn, KHÔNG execute', async () => {
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
          idempotency_key: 'key-moi',
        },
      },
    });

    await expect(
      service.confirm(
        { tenantId: 10, userId: 20, role: 'ADMIN' },
        1,
        undefined,
        'key-cu',
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'IDEMPOTENCY_KEY_MISMATCH' }),
    });
    expect(mockToolRegistry.execute).not.toHaveBeenCalled();
  });

  it('pending_write được lưu kèm idempotency_key tự sinh', async () => {
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
        input: { fullName: 'Nguyễn Văn A' },
        summary: 'Tạo học viên mới',
        intent: 'create_student',
        status: 'waiting_confirm',
      },
      contextPatch: {},
      message: 'Chuẩn bị tạo',
    });
    mockPrisma.aiAgentSession.update.mockResolvedValue({ id: 1, state: {} });
    mockPrisma.aiCopilotTurnEvent.create.mockResolvedValue({ id: 1 });

    const result = await service.createTurn(
      { tenantId: 10, userId: 20, role: 'ADMIN' },
      1,
      'Tạo học viên A',
    );

    const updateArg = mockPrisma.aiAgentSession.update.mock.calls[0][0];
    const key = updateArg.data.state.pending_action.idempotency_key;
    expect(typeof key).toBe('string');
    expect(key.length).toBeGreaterThan(10);
    // Turn có pending_action -> phase PREVIEW để FE khóa composer.
    expect((result as any).phase).toBe('PREVIEW');
  });

  it('pending_write create_class chỉ có `type` -> input được chuẩn hóa thêm `classType` để FE prefill', async () => {
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
        content: 'tạo lớp Toán A1 theo tuần trong khóa Toán Cao Cấp',
      })
      .mockResolvedValueOnce({ id: 101, role: 'assistant', content: '{}' });
    mockPrisma.aiAgentSessionMessage.findMany.mockResolvedValue([]);
    mockAgentRunner.run.mockResolvedValue({
      type: 'pending_write',
      pendingAction: {
        tool_name: 'create_class',
        input: { courseId: 86, title: 'Toán A1', type: 'WEEKLY' },
        summary: 'Tạo lớp học mới: Toán A1',
        intent: 'create_class',
        status: 'waiting_confirm',
      },
      contextPatch: {},
      message: 'Chuẩn bị tạo lớp',
    });
    mockPrisma.aiAgentSession.update.mockResolvedValue({ id: 1, state: {} });
    mockPrisma.aiCopilotTurnEvent.create.mockResolvedValue({ id: 1 });

    const result = await service.createTurn(
      { tenantId: 10, userId: 20, role: 'ADMIN' },
      1,
      'tạo lớp Toán A1 theo tuần trong khóa Toán Cao Cấp',
    );

    const savedPending =
      mockPrisma.aiAgentSession.update.mock.calls[0][0].data.state
        .pending_action;
    expect(savedPending.input).toEqual(
      expect.objectContaining({ type: 'WEEKLY', classType: 'WEEKLY' }),
    );
    expect(savedPending.display_input).toEqual(
      expect.objectContaining({ type: 'WEEKLY', classType: 'WEEKLY' }),
    );
    expect((result as any).response.input).toEqual(
      expect.objectContaining({ classType: 'WEEKLY' }),
    );
  });

  it('pending_write update_class -> display_input được điền dữ liệu hiện tại của lớp (form không trống)', async () => {
    (mockPrisma as any).courseClass = {
      findFirst: jest.fn().mockResolvedValue({
        id: 38,
        tenantId: 10,
        title: 'Toán 2',
        classCode: 'TOAN_TOAN_2_WEEKLY',
        type: 'WEEKLY',
        teacherName: 'Cô Hoa',
        startDate: new Date('2026-07-09T00:00:00Z'),
        endDate: null,
        status: 'ACTIVE',
        description: null,
        course: { id: 5, title: 'Toán' },
      }),
    };
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
        content: 'chuyển lớp Toán 2 sang loại luyện đề',
      })
      .mockResolvedValueOnce({ id: 101, role: 'assistant', content: '{}' });
    mockPrisma.aiAgentSessionMessage.findMany.mockResolvedValue([]);
    mockAgentRunner.run.mockResolvedValue({
      type: 'pending_write',
      pendingAction: {
        tool_name: 'update_class',
        input: { classId: 38, classType: 'EXAM_PRACTICE' },
        summary: 'Cập nhật lớp học',
        intent: 'update_class',
        status: 'waiting_confirm',
      },
      contextPatch: {},
      message: 'Chuẩn bị cập nhật',
    });
    mockPrisma.aiAgentSession.update.mockResolvedValue({ id: 1, state: {} });
    mockPrisma.aiCopilotTurnEvent.create.mockResolvedValue({ id: 1 });

    const result = await service.createTurn(
      { tenantId: 10, userId: 20, role: 'ADMIN' },
      1,
      'chuyển lớp Toán 2 sang loại luyện đề',
    );

    const savedPending =
      mockPrisma.aiAgentSession.update.mock.calls[0][0].data.state
        .pending_action;
    // display_input: dữ liệu hiện tại + field đổi đè lên.
    expect(savedPending.display_input).toEqual(
      expect.objectContaining({
        title: 'Toán 2',
        classCode: 'TOAN_TOAN_2_WEEKLY',
        classType: 'EXAM_PRACTICE',
        teacherName: 'Cô Hoa',
        startDate: '2026-07-09',
      }),
    );
    // input ghi DB vẫn tối thiểu: chỉ classId + classType.
    expect(savedPending.input).toEqual({
      classId: 38,
      classType: 'EXAM_PRACTICE',
    });
    expect((result as any).response.type).toBe('preview_card');
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
    process.env.AGENT_MINI_MODE = 'false';
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

  it('bản nháp create_student + chat info không marker -> merge vào bản nháp, KHÔNG chặn', async () => {
    const content =
      'Hoang Van A, hva@gmail.com, 0987645231, 12/03/2000, địa chỉ Ninh Bình';
    mockPrisma.aiAgentSession.findFirst.mockResolvedValue({
      id: 1,
      tenantId: 10,
      userId: 20,
      status: 'ACTIVE',
      state: {
        pending_action: {
          tool_name: 'create_student',
          input: { fullName: '', email: '', phone: '' },
          summary: 'Tạo học viên mới',
          intent: 'create_student',
          status: 'waiting_confirm',
        },
      },
    });
    mockPrisma.aiAgentSessionMessage.create
      .mockResolvedValueOnce({ id: 100, role: 'user', content })
      .mockResolvedValueOnce({ id: 101, role: 'assistant', content: '{}' });
    mockPrisma.aiAgentSession.update.mockResolvedValue({ id: 1, state: {} });
    mockPrisma.aiCopilotTurnEvent.create.mockResolvedValue({ id: 1 });
    mockDeterministic.parseStudentInfo.mockReturnValue({
      fullName: 'Hoang Van A',
      email: 'hva@gmail.com',
      phone: '0987645231',
      birthDate: '2000-03-12',
      address: 'Ninh Bình',
    });

    const result = await service.createTurn(
      { tenantId: 10, userId: 20, role: 'ADMIN' },
      1,
      content,
    );

    // Merge vào bản nháp: không block, không LLM, không execute.
    expect(mockDeterministic.parseStudentInfo).toHaveBeenCalledWith(content);
    expect(mockAgentRunner.run).not.toHaveBeenCalled();
    expect(mockToolRegistry.execute).not.toHaveBeenCalled();
    expect(result.response.type).toBe('preview_card');

    const updateArg = mockPrisma.aiAgentSession.update.mock.calls[0][0];
    const pendingInput = updateArg.data.state.pending_action.input;
    expect(pendingInput.fullName).toBe('Hoang Van A');
    expect(pendingInput.email).toBe('hva@gmail.com');
    expect(pendingInput.phone).toBe('0987645231');
    expect(pendingInput.birthDate).toBe('2000-03-12');
    expect(pendingInput.address).toBe('Ninh Bình');
  });

  it('bản nháp create_student + "tên là A, sdt là 09..." -> tên KHÔNG ăn cả phần sdt', async () => {
    const content = 'tên là Hoàng Văn A, sdt là 0987625341';
    mockPrisma.aiAgentSession.findFirst.mockResolvedValue({
      id: 1,
      tenantId: 10,
      userId: 20,
      status: 'ACTIVE',
      state: {
        pending_action: {
          tool_name: 'create_student',
          input: { fullName: '' },
          summary: 'Tạo học viên mới',
          intent: 'create_student',
          status: 'waiting_confirm',
        },
      },
    });
    mockPrisma.aiAgentSessionMessage.create
      .mockResolvedValueOnce({ id: 100, role: 'user', content })
      .mockResolvedValueOnce({ id: 101, role: 'assistant', content: '{}' });
    mockPrisma.aiAgentSession.update.mockResolvedValue({ id: 1, state: {} });
    mockPrisma.aiCopilotTurnEvent.create.mockResolvedValue({ id: 1 });

    const result = await service.createTurn(
      { tenantId: 10, userId: 20, role: 'ADMIN' },
      1,
      content,
    );

    expect(result.response.type).toBe('preview_card');
    const updateArg = mockPrisma.aiAgentSession.update.mock.calls[0][0];
    const pendingInput = updateArg.data.state.pending_action.input;
    expect(pendingInput.fullName).toBe('Hoàng Văn A');
    expect(pendingInput.phone).toBe('0987625341');
  });

  it('trả lời tên lớp khi đang chờ (pending_class_creation) -> preview create_class, không hỏi thêm (cả mini mode)', async () => {
    process.env.AGENT_MINI_MODE = 'true';
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
      .mockResolvedValueOnce({
        id: 100,
        role: 'user',
        content: 'Lớp Tiếng Bi 2',
      })
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

  it('bản nháp lớp chưa có khóa (courseId=0): trả lời tên khóa -> preview create_class đủ loại/ngày', async () => {
    process.env.AGENT_MINI_MODE = 'true';
    mockPrisma.aiAgentSession.findFirst.mockResolvedValue({
      id: 1,
      tenantId: 10,
      userId: 20,
      status: 'ACTIVE',
      state: {
        pending_class_creation: {
          courseId: 0,
          title: 'Toán A1',
          type: 'WEEKLY',
          startDate: '2026-07-09',
          endDate: '2026-07-31',
        },
      },
    });
    mockPrisma.aiAgentSessionMessage.create
      .mockResolvedValueOnce({
        id: 100,
        role: 'user',
        content: 'trong khóa Toán Cao Cấp',
      })
      .mockResolvedValueOnce({ id: 101, role: 'assistant', content: '{}' });
    mockDeterministic.resolveClassCourseReply.mockResolvedValue({
      type: 'pending_write',
      pending: {
        tool_name: 'create_class',
        input: {
          courseId: 86,
          title: 'Toán A1',
          type: 'WEEKLY',
          sessions: [],
          startDate: '2026-07-09',
          endDate: '2026-07-31',
        },
        display_input: { courseName: 'Toán Cao Cấp' },
        summary: 'Tạo lớp học mới: Toán A1 trong khóa Toán Cao Cấp',
        intent: 'create_class',
        status: 'waiting_confirm',
        severity: 'default',
      },
      contextPatch: {
        last_intent: 'create_class',
        selected_course_id: 86,
        pending_class_creation: null,
      },
    });
    mockPrisma.aiAgentSession.update.mockResolvedValue({ id: 1, state: {} });
    mockPrisma.aiCopilotTurnEvent.create.mockResolvedValue({ id: 1 });

    const result = await service.createTurn(
      { tenantId: 10, userId: 20, role: 'ADMIN' },
      1,
      'trong khóa Toán Cao Cấp',
    );

    expect(mockDeterministic.resolveClassCourseReply).toHaveBeenCalledWith(
      10,
      expect.objectContaining({ courseId: 0, title: 'Toán A1' }),
      'trong khóa Toán Cao Cấp',
    );
    expect(mockAgentRunner.run).not.toHaveBeenCalled();
    expect(mockToolRegistry.execute).not.toHaveBeenCalled();
    expect(result.response.type).toBe('preview_card');

    const updateArg = mockPrisma.aiAgentSession.update.mock.calls[0][0];
    expect(updateArg.data.state.pending_action.tool_name).toBe('create_class');
    expect(updateArg.data.state.pending_action.input.type).toBe('WEEKLY');
    expect(updateArg.data.state.pending_class_creation).toBeNull();
  });

  it('mini mode: pending_write với tool ngoài phạm vi (delete_students) -> trả "chưa được bật", KHÔNG tạo pending', async () => {
    process.env.AGENT_MINI_MODE = 'true';
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
        content: 'Xóa học viên 5',
      })
      .mockResolvedValueOnce({ id: 101, role: 'assistant', content: '{}' });
    mockPrisma.aiAgentSessionMessage.findMany.mockResolvedValue([]);
    mockAgentRunner.run.mockResolvedValue({
      type: 'pending_write',
      pendingAction: {
        tool_name: 'delete_students',
        input: { ids: [5] },
        summary: 'Xóa học viên',
        status: 'waiting_confirm',
      },
      contextPatch: {},
      message: 'Chuẩn bị xóa',
    });
    mockPrisma.aiAgentSession.update.mockResolvedValue({ id: 1, state: {} });
    mockPrisma.aiCopilotTurnEvent.create.mockResolvedValue({ id: 1 });

    const result = await service.createTurn(
      { tenantId: 10, userId: 20, role: 'ADMIN' },
      1,
      'Xóa học viên 5',
    );

    expect(mockToolRegistry.execute).not.toHaveBeenCalled();
    expect(result.response.type).toBe('text_message');
    expect((result.response as any).message).toContain('chưa được bật');
    const updateArg = mockPrisma.aiAgentSession.update.mock.calls[0][0];
    expect(updateArg.data.state.pending_action ?? null).toBeNull();
  });

  it('mini mode: pending_write create_class ĐƯỢC phép -> trả preview_card', async () => {
    process.env.AGENT_MINI_MODE = 'true';
    mockPrisma.aiAgentSession.findFirst.mockResolvedValue({
      id: 1,
      tenantId: 10,
      userId: 20,
      status: 'ACTIVE',
      state: {},
    });
    mockPrisma.aiAgentSessionMessage.create
      .mockResolvedValueOnce({ id: 100, role: 'user', content: 'Tạo lớp A1' })
      .mockResolvedValueOnce({ id: 101, role: 'assistant', content: '{}' });
    mockPrisma.aiAgentSessionMessage.findMany.mockResolvedValue([]);
    mockAgentRunner.run.mockResolvedValue({
      type: 'pending_write',
      pendingAction: {
        tool_name: 'create_class',
        input: { courseId: 5, title: 'A1', type: 'WEEKLY' },
        summary: 'Tạo lớp học mới: A1',
        intent: 'create_class',
        status: 'waiting_confirm',
      },
      contextPatch: {},
      message: 'Chuẩn bị tạo lớp',
    });
    mockPrisma.aiAgentSession.update.mockResolvedValue({ id: 1, state: {} });
    mockPrisma.aiCopilotTurnEvent.create.mockResolvedValue({ id: 1 });

    const result = await service.createTurn(
      { tenantId: 10, userId: 20, role: 'ADMIN' },
      1,
      'Tạo lớp A1',
    );

    expect(mockToolRegistry.execute).not.toHaveBeenCalled();
    expect(result.response.type).toBe('preview_card');
    const updateArg = mockPrisma.aiAgentSession.update.mock.calls[0][0];
    expect(updateArg.data.state.pending_action.tool_name).toBe('create_class');
  });

  it('mini mode: deterministic trả clarification intent update_course -> ĐI TIẾP (update được phép)', async () => {
    process.env.AGENT_MINI_MODE = 'true';
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
        content: 'cập nhật khóa học',
      })
      .mockResolvedValueOnce({ id: 101, role: 'assistant', content: '{}' });
    mockDeterministic.resolve.mockResolvedValue({
      type: 'clarification',
      message: 'Bạn muốn cập nhật khóa học nào?',
      missingFields: ['courseId'],
      intent: 'update_course',
      contextPatch: { last_intent: 'update_course' },
    });
    mockPrisma.aiAgentSession.update.mockResolvedValue({ id: 1, state: {} });
    mockPrisma.aiCopilotTurnEvent.create.mockResolvedValue({ id: 1 });

    const result = await service.createTurn(
      { tenantId: 10, userId: 20, role: 'ADMIN' },
      1,
      'cập nhật khóa học',
    );

    expect(mockAgentRunner.run).not.toHaveBeenCalled();
    expect(result.response.type).toBe('clarification');
    expect((result.response as any).message).toBe(
      'Bạn muốn cập nhật khóa học nào?',
    );
  });

  it('mini mode: deterministic trả clarification intent delete_courses -> trả "chưa được bật"', async () => {
    process.env.AGENT_MINI_MODE = 'true';
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
        content: 'xóa khóa học',
      })
      .mockResolvedValueOnce({ id: 101, role: 'assistant', content: '{}' });
    mockDeterministic.resolve.mockResolvedValue({
      type: 'clarification',
      message: 'Bạn muốn xóa khóa học nào?',
      missingFields: ['courseId'],
      intent: 'delete_courses',
      contextPatch: { last_intent: 'delete_courses' },
    });
    mockPrisma.aiAgentSession.update.mockResolvedValue({ id: 1, state: {} });
    mockPrisma.aiCopilotTurnEvent.create.mockResolvedValue({ id: 1 });

    const result = await service.createTurn(
      { tenantId: 10, userId: 20, role: 'ADMIN' },
      1,
      'xóa khóa học',
    );

    expect(mockAgentRunner.run).not.toHaveBeenCalled();
    expect(result.response.type).toBe('text_message');
    expect((result.response as any).message).toContain('chưa được bật');
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
    // Trả card thông tin học viên có sẵn (tool_result) kèm gợi ý tiếp theo.
    expect(result.response.type).toBe('tool_result');

    const updateArg = mockPrisma.aiAgentSession.update.mock.calls[0][0];
    expect(updateArg.data.state.selected_student_id).toBe(7);
    expect(updateArg.data.state.duplicate_student_context).toBeNull();
  });

  describe('duplicate_student_context state machine', () => {
    const dupState = {
      duplicate_student_context: {
        intended_action: 'create',
        status: 'waiting_choice',
        searched_email: 'old@test.com',
        searched_phone: '0978636121',
        existing_student: {
          id: 106,
          value: 106,
          label: 'Hoang Anh Toàn',
          email: 'old@test.com',
          phone: '0978636933',
        },
        original_input: {
          fullName: 'Hoang Anh Toàn',
          email: 'old@test.com',
          phone: '0978636121',
          birthDate: '2005-01-01',
          address: 'Ninh Bình',
        },
        conflict_fields: ['email'],
      },
    };

    const setupTurn = (content: string, state: unknown = dupState) => {
      mockPrisma.aiAgentSession.findFirst.mockResolvedValue({
        id: 1,
        tenantId: 10,
        userId: 20,
        status: 'ACTIVE',
        state,
      });
      mockPrisma.aiAgentSessionMessage.create
        .mockResolvedValueOnce({ id: 100, role: 'user', content })
        .mockResolvedValueOnce({ id: 101, role: 'assistant', content: '{}' });
      mockPrisma.aiAgentSession.update.mockResolvedValue({ id: 1, state: {} });
      mockPrisma.aiCopilotTurnEvent.create.mockResolvedValue({ id: 1 });
    };

    it('nhập "2" -> mời nhập email/SĐT mới, KHÔNG lặp cảnh báo trùng, không gọi model', async () => {
      setupTurn('2');

      const result = await service.createTurn(
        { tenantId: 10, userId: 20, role: 'ADMIN' },
        1,
        '2',
      );

      expect(mockAgentRunner.run).not.toHaveBeenCalled();
      expect(mockToolRegistry.execute).not.toHaveBeenCalled();
      expect(result.response.type).toBe('clarification');
      expect((result.response as any).message).toContain(
        'Mời bạn nhập email hoặc SĐT mới',
      );
      expect((result.response as any).message).toContain('Hoang Anh Toàn');
      expect((result.response as any).message).not.toContain('đã tồn tại');

      const updateArg = mockPrisma.aiAgentSession.update.mock.calls[0][0];
      expect(updateArg.data.state.duplicate_student_context.status).toBe(
        'waiting_new_contact',
      );
    });

    it('đang chờ contact mới, nhập email mới không trùng -> preview create_student email mới, chưa ghi DB', async () => {
      setupTurn('toannew@gmail.com', {
        duplicate_student_context: {
          ...dupState.duplicate_student_context,
          status: 'waiting_new_contact',
        },
      });
      mockUsersService.findDuplicateStudentByEmailOrPhone.mockResolvedValue(
        null,
      );

      const result = await service.createTurn(
        { tenantId: 10, userId: 20, role: 'ADMIN' },
        1,
        'toannew@gmail.com',
      );

      expect(mockAgentRunner.run).not.toHaveBeenCalled();
      expect(mockToolRegistry.execute).not.toHaveBeenCalled();
      expect(result.response.type).toBe('preview_card');

      const updateArg = mockPrisma.aiAgentSession.update.mock.calls[0][0];
      const pendingInput = updateArg.data.state.pending_action.input;
      expect(pendingInput.email).toBe('toannew@gmail.com');
      expect(pendingInput.fullName).toBe('Hoang Anh Toàn');
      expect(pendingInput.phone).toBe('0978636121');
      expect(pendingInput.address).toBe('Ninh Bình');
      expect(updateArg.data.state.duplicate_student_context).toBeNull();
    });

    it('nhập thẳng email mới ngay ở bước 1/2/3 -> tự hiểu là option 2, trả preview', async () => {
      setupTurn('toannew@gmail.com');
      mockUsersService.findDuplicateStudentByEmailOrPhone.mockResolvedValue(
        null,
      );

      const result = await service.createTurn(
        { tenantId: 10, userId: 20, role: 'ADMIN' },
        1,
        'toannew@gmail.com',
      );

      expect(mockAgentRunner.run).not.toHaveBeenCalled();
      expect(result.response.type).toBe('preview_card');
      const updateArg = mockPrisma.aiAgentSession.update.mock.calls[0][0];
      expect(updateArg.data.state.pending_action.input.email).toBe(
        'toannew@gmail.com',
      );
    });

    it('nhập thẳng SĐT mới -> tự hiểu là option 2, patch phone, trả preview', async () => {
      setupTurn('sdt mới 0987654321');
      mockUsersService.findDuplicateStudentByEmailOrPhone.mockResolvedValue(
        null,
      );

      const result = await service.createTurn(
        { tenantId: 10, userId: 20, role: 'ADMIN' },
        1,
        'sdt mới 0987654321',
      );

      expect(result.response.type).toBe('preview_card');
      const updateArg = mockPrisma.aiAgentSession.update.mock.calls[0][0];
      const pendingInput = updateArg.data.state.pending_action.input;
      expect(pendingInput.phone).toBe('0987654321');
      // Email cũ giữ nguyên -> nếu còn trùng thì savePendingWriteTurn sẽ bắt lại.
      expect(pendingInput.fullName).toBe('Hoang Anh Toàn');
    });

    it('email mới nhưng VẪN trùng -> hỏi lại 1/2/3 với học viên trùng mới, không tạo pending', async () => {
      setupTurn('trung2@test.com');
      mockUsersService.findDuplicateStudentByEmailOrPhone.mockResolvedValue({
        id: 207,
        fullName: 'Người Trùng Khác',
        email: 'trung2@test.com',
        phone: '0911222333',
      });

      const result = await service.createTurn(
        { tenantId: 10, userId: 20, role: 'ADMIN' },
        1,
        'trung2@test.com',
      );

      expect(mockAgentRunner.run).not.toHaveBeenCalled();
      expect(result.response.type).toBe('clarification');
      expect((result.response as any).message).toContain('đã tồn tại');
      expect((result.response as any).message).toContain('Người Trùng Khác');

      const updateArg = mockPrisma.aiAgentSession.update.mock.calls[0][0];
      expect(updateArg.data.state.pending_action).toBeNull();
      expect(
        updateArg.data.state.duplicate_student_context.existing_student.id,
      ).toBe(207);
      expect(
        updateArg.data.state.duplicate_student_context.original_input.email,
      ).toBe('trung2@test.com');
    });

    it('nhập "1" -> chọn học viên có sẵn, clear context, trả card học viên', async () => {
      setupTurn('1');

      const result = await service.createTurn(
        { tenantId: 10, userId: 20, role: 'ADMIN' },
        1,
        '1',
      );

      expect(mockAgentRunner.run).not.toHaveBeenCalled();
      expect(mockToolRegistry.execute).not.toHaveBeenCalled();
      expect(result.response.type).toBe('tool_result');

      const updateArg = mockPrisma.aiAgentSession.update.mock.calls[0][0];
      expect(updateArg.data.state.selected_student_id).toBe(106);
      expect(updateArg.data.state.duplicate_student_context).toBeNull();
    });

    it('nhập "3" -> hủy, clear context, không ghi DB', async () => {
      setupTurn('3');

      const result = await service.createTurn(
        { tenantId: 10, userId: 20, role: 'ADMIN' },
        1,
        '3',
      );

      expect(mockToolRegistry.execute).not.toHaveBeenCalled();
      expect(result.response.type).toBe('text_message');
      expect((result.response as any).message).toContain('Đã hủy');

      const updateArg = mockPrisma.aiAgentSession.update.mock.calls[0][0];
      expect(updateArg.data.state.duplicate_student_context).toBeNull();
    });

    it('input không hiểu ("4") -> nhắc lại menu 1/2/3, KHÔNG gọi model', async () => {
      setupTurn('4');

      const result = await service.createTurn(
        { tenantId: 10, userId: 20, role: 'ADMIN' },
        1,
        '4',
      );

      expect(mockAgentRunner.run).not.toHaveBeenCalled();
      expect(result.response.type).toBe('clarification');
      expect((result.response as any).message).toContain(
        'Mình chưa hiểu lựa chọn của bạn',
      );
      expect((result.response as any).options).toEqual([
        { key: '1', label: 'Dùng học viên có sẵn này' },
        { key: '2', label: 'Nhập email/SĐT khác để tạo học viên mới' },
        { key: '3', label: 'Hủy thao tác' },
      ]);
    });
  });

  it('createTurn trả preview_card cho assign_student_to_course, không execute (full mode)', async () => {
    process.env.AGENT_MINI_MODE = 'false';
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

  it('confirm execute assign_student_to_course với đúng input (full mode)', async () => {
    process.env.AGENT_MINI_MODE = 'false';
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

  it('confirm assign_student_to_course lỗi nhiều lớp thì chuyển sang clarification chọn lớp (full mode)', async () => {
    process.env.AGENT_MINI_MODE = 'false';
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

  it('user chọn lớp sau khi nhiều lớp thì tạo preview assign_student_to_class kèm classId (full mode)', async () => {
    process.env.AGENT_MINI_MODE = 'false';
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

  it('nhiều lớp TRÙNG TÊN khác khóa (courseId=0): trả lời "1" tạo preview, suy courseId từ lớp được chọn', async () => {
    // Tái hiện sự cố "thêm Tran Văn A vào lớp Test 1": 2 lớp cùng tên Test 1
    // thuộc 2 khóa khác nhau. Câu trả lời "1" PHẢI ra preview card chờ xác nhận,
    // tuyệt đối không rơi xuống LLM (LLM từng bịa "đã thêm thành công").
    process.env.AGENT_MINI_MODE = 'true';
    mockPrisma.aiAgentSession.findFirst.mockResolvedValue({
      id: 1,
      tenantId: 10,
      userId: 20,
      status: 'ACTIVE',
      state: {
        pending_enrollment_context: {
          userId: 124,
          courseId: 0,
          candidateClasses: [
            {
              id: 50,
              label: 'Test 1',
              metadata: { id: 50, courseId: 91, classCode: 'ANH_VAN_TEST_1_WEEKLY' },
            },
            {
              id: 40,
              label: 'Test 1',
              metadata: { id: 40, courseId: 89, classCode: 'TEST_TEST_1_WEEKLY' },
            },
          ],
        },
      },
    });
    mockPrisma.aiAgentSessionMessage.create
      .mockResolvedValueOnce({ id: 100, role: 'user', content: '1' })
      .mockResolvedValueOnce({ id: 101, role: 'assistant', content: '{}' });
    mockPrisma.aiAgentSession.update.mockResolvedValue({ id: 1, state: {} });
    mockPrisma.aiCopilotTurnEvent.create.mockResolvedValue({ id: 1 });

    const result = await service.createTurn(
      { tenantId: 10, userId: 20, role: 'ADMIN' },
      1,
      '1',
    );

    expect(mockToolRegistry.execute).not.toHaveBeenCalled();
    expect(mockAgentRunner.run).not.toHaveBeenCalled();
    expect(result.response.type).toBe('preview_card');

    const updateArg = mockPrisma.aiAgentSession.update.mock.calls[0][0];
    const pending = updateArg.data.state.pending_action;
    expect(pending.tool_name).toBe('assign_student_to_class');
    expect(pending.input).toEqual({ userId: 124, classId: 50 });
    expect(pending.display_input.courseId).toBe(91);
    expect(pending.summary).toContain('khóa #91');
    expect(updateArg.data.state.pending_enrollment_context).toBeNull();
  });

  it('nhiều HỌC VIÊN trùng tên: trả lời "1" chọn đúng người và tạo preview ghi danh (không rơi xuống LLM)', async () => {
    // Tái hiện sự cố "them toan h vao lop nay" -> 4 học viên trùng tên, user
    // gõ "1" nhưng câu trả lời rơi xuống LLM và LLM chỉ trả text suông không
    // tạo bản nháp nào. Giờ state machine phải resolve học viên và đi tiếp.
    process.env.AGENT_MINI_MODE = 'true';
    mockPrisma.aiAgentSession.findFirst.mockResolvedValue({
      id: 1,
      tenantId: 10,
      userId: 20,
      status: 'ACTIVE',
      state: {
        pending_enrollment_context: {
          userId: 0,
          courseId: 0,
          candidateClasses: [],
          candidateStudents: [
            { id: 132, value: 132, label: 'Toan H' },
            { id: 131, value: 131, label: 'Toan Hoang' },
          ],
          targetType: 'class',
          targetKeyword: 'này',
        },
      },
    });
    mockDeterministic.resolveEnrollStudentReply.mockResolvedValue({
      type: 'pending_write',
      pending: {
        tool_name: 'assign_student_to_class',
        input: { userId: 132, classId: 7 },
        display_input: { userId: 132, classId: 7, className: 'hehe' },
        summary: 'Thêm học viên Toan H vào lớp hehe',
        intent: 'assign_student_to_class',
        status: 'waiting_confirm',
        severity: 'default',
      },
      contextPatch: { selected_class_id: 7 },
    });
    mockPrisma.aiAgentSessionMessage.create
      .mockResolvedValueOnce({ id: 100, role: 'user', content: '1' })
      .mockResolvedValueOnce({ id: 101, role: 'assistant', content: '{}' });
    mockPrisma.aiAgentSession.update.mockResolvedValue({ id: 1, state: {} });
    mockPrisma.aiCopilotTurnEvent.create.mockResolvedValue({ id: 1 });

    const result = await service.createTurn(
      { tenantId: 10, userId: 20, role: 'ADMIN' },
      1,
      '1',
    );

    expect(mockAgentRunner.run).not.toHaveBeenCalled();
    expect(mockDeterministic.resolveEnrollStudentReply).toHaveBeenCalledWith(
      10,
      expect.anything(),
      expect.objectContaining({ candidateStudents: expect.any(Array) }),
      { id: 132, label: 'Toan H' },
    );
    expect(result.response.type).toBe('preview_card');

    const updateArg = mockPrisma.aiAgentSession.update.mock.calls[0][0];
    const pending = updateArg.data.state.pending_action;
    expect(pending.tool_name).toBe('assign_student_to_class');
    expect(pending.input).toEqual({ userId: 132, classId: 7 });
    expect(updateArg.data.state.pending_enrollment_context).toBeNull();
    expect(updateArg.data.state.selected_student_id).toBe(132);
  });

  it('chọn NHIỀU học viên "1,3,5" từ danh sách trùng tên -> đi tiếp bản nháp ghi danh GỘP', async () => {
    process.env.AGENT_MINI_MODE = 'true';
    mockPrisma.aiAgentSession.findFirst.mockResolvedValue({
      id: 1,
      tenantId: 10,
      userId: 20,
      status: 'ACTIVE',
      state: {
        pending_enrollment_context: {
          userId: 0,
          courseId: 0,
          candidateClasses: [],
          candidateStudents: [
            { id: 132, value: 132, label: 'Toan H' },
            { id: 131, value: 131, label: 'Toan Hoang' },
            { id: 127, value: 127, label: 'Toan Haha' },
            { id: 125, value: 125, label: 'Toand' },
            { id: 114, value: 114, label: 'Toàn Hoàng' },
          ],
          targetType: 'class',
          targetKeyword: 'test 1',
        },
      },
    });
    mockDeterministic.resolveEnrollStudentReply.mockResolvedValue({
      type: 'pending_write',
      pending: {
        tool_name: 'assign_student_to_class',
        input: { userIds: [132, 127, 114], classId: 50 },
        display_input: {
          userIds: [132, 127, 114],
          classId: 50,
          className: 'Test 1',
          students: [
            { id: 132, label: 'Toan H', email: null },
            { id: 127, label: 'Toan Haha', email: null },
            { id: 114, label: 'Toàn Hoàng', email: null },
          ],
        },
        summary: 'Thêm 3 học viên (Toan H, Toan Haha, Toàn Hoàng) vào lớp Test 1',
        intent: 'assign_student_to_class',
        status: 'waiting_confirm',
        severity: 'default',
      },
      contextPatch: { selected_class_id: 50 },
    });
    mockPrisma.aiAgentSessionMessage.create
      .mockResolvedValueOnce({ id: 100, role: 'user', content: '1,3,5' })
      .mockResolvedValueOnce({ id: 101, role: 'assistant', content: '{}' });
    mockPrisma.aiAgentSession.update.mockResolvedValue({ id: 1, state: {} });
    mockPrisma.aiCopilotTurnEvent.create.mockResolvedValue({ id: 1 });

    const result = await service.createTurn(
      { tenantId: 10, userId: 20, role: 'ADMIN' },
      1,
      '1,3,5',
    );

    expect(mockAgentRunner.run).not.toHaveBeenCalled();
    // PHẢI truyền đúng 3 người theo số thứ tự 1/3/5 (dạng mảng -> bản gộp).
    expect(mockDeterministic.resolveEnrollStudentReply).toHaveBeenCalledWith(
      10,
      expect.anything(),
      expect.anything(),
      [
        { id: 132, label: 'Toan H' },
        { id: 127, label: 'Toan Haha' },
        { id: 114, label: 'Toàn Hoàng' },
      ],
    );
    expect(result.response.type).toBe('preview_card');
    const updateArg = mockPrisma.aiAgentSession.update.mock.calls[0][0];
    expect(updateArg.data.state.pending_action.input).toEqual({
      userIds: [132, 127, 114],
      classId: 50,
    });
    expect(updateArg.data.state.pending_enrollment_context).toBeNull();
  });

  it('ghi danh GỘP nhiều học viên + nhiều lớp trùng tên: chọn lớp xong tạo preview userIds', async () => {
    process.env.AGENT_MINI_MODE = 'true';
    mockPrisma.aiAgentSession.findFirst.mockResolvedValue({
      id: 1,
      tenantId: 10,
      userId: 20,
      status: 'ACTIVE',
      state: {
        pending_enrollment_context: {
          userId: 0,
          userIds: [3, 132],
          studentLabels: ['Tiến', 'Toan H'],
          courseId: 0,
          candidateClasses: [
            { id: 50, label: 'Test 1', metadata: { courseId: 91 } },
            { id: 40, label: 'Test 1', metadata: { courseId: 89 } },
          ],
        },
      },
    });
    mockPrisma.aiAgentSessionMessage.create
      .mockResolvedValueOnce({ id: 100, role: 'user', content: '2' })
      .mockResolvedValueOnce({ id: 101, role: 'assistant', content: '{}' });
    mockPrisma.aiAgentSession.update.mockResolvedValue({ id: 1, state: {} });
    mockPrisma.aiCopilotTurnEvent.create.mockResolvedValue({ id: 1 });

    const result = await service.createTurn(
      { tenantId: 10, userId: 20, role: 'ADMIN' },
      1,
      '2',
    );

    expect(mockAgentRunner.run).not.toHaveBeenCalled();
    expect(result.response.type).toBe('preview_card');
    const updateArg = mockPrisma.aiAgentSession.update.mock.calls[0][0];
    const pending = updateArg.data.state.pending_action;
    expect(pending.input).toEqual({ userIds: [3, 132], classId: 40 });
    expect(pending.summary).toContain('2 học viên (Tiến, Toan H)');
    expect(updateArg.data.state.pending_enrollment_context).toBeNull();
  });

  it('confirm bản nháp GỘP: partial success -> message báo cáo từng dòng ✓/⚠, chốt ngữ cảnh lớp', async () => {
    process.env.AGENT_MINI_MODE = 'true';
    mockPrisma.aiAgentSession.findFirst.mockResolvedValue({
      id: 1,
      tenantId: 10,
      userId: 20,
      status: 'ACTIVE',
      state: {
        pending_action: {
          tool_name: 'assign_student_to_class',
          input: { userIds: [3, 132], classId: 8 },
          summary: 'Thêm 2 học viên vào lớp',
          intent: 'assign_student_to_class',
        },
      },
    });
    mockToolRegistry.execute.mockResolvedValue({
      bulk: true,
      classId: 8,
      className: 'Tiếng Bỉ 1',
      courseId: 20,
      courseName: 'Tiếng Bỉ',
      total: 2,
      successCount: 1,
      items: [
        { userId: 3, studentName: 'Tiến', status: 'SUCCESS', message: null },
        {
          userId: 132,
          studentName: null,
          status: 'ALREADY_IN_CLASS',
          message: 'Người dùng đã có trong lớp này',
        },
      ],
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

    expect(mockToolRegistry.execute).toHaveBeenCalledWith(
      1,
      expect.anything(),
      'assign_student_to_class',
      expect.objectContaining({ userIds: [3, 132], classId: 8 }),
    );
    expect(result.response.type).toBe('tool_result');
    expect(result.response.message).toContain('1/2 thêm thành công');
    expect(result.response.message).toContain('✓ Tiến — đã thêm vào lớp');
    expect(result.response.message).toContain(
      '⚠ học viên #132 — đã có trong lớp từ trước',
    );

    const updateArg = mockPrisma.aiAgentSession.update.mock.calls[0][0];
    expect(updateArg.data.state.pending_action).toBeNull();
    expect(updateArg.data.state.selected_class_id).toBe(8);
    expect(updateArg.data.state.selected_course_id).toBe(20);
  });

  it('mini mode: preview + confirm assign_student_to_class execute đúng input và set context lớp', async () => {
    process.env.AGENT_MINI_MODE = 'true';
    mockPrisma.aiAgentSession.findFirst.mockResolvedValue({
      id: 1,
      tenantId: 10,
      userId: 20,
      status: 'ACTIVE',
      state: {
        pending_action: {
          tool_name: 'assign_student_to_class',
          input: { userId: 3, classId: 8 },
          summary: 'Thêm học viên Tiến vào lớp Tiếng Bỉ 1',
          intent: 'assign_student_to_class',
        },
      },
    });
    mockToolRegistry.execute.mockResolvedValue({
      id: 55,
      userId: 3,
      classId: 8,
      roleInClass: 'STUDENT',
      user: { id: 3, fullName: 'Tiến' },
      courseClass: {
        id: 8,
        title: 'Tiếng Bỉ 1',
        courseId: 20,
        course: { id: 20, title: 'Tiếng Bỉ' },
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

    expect(mockToolRegistry.execute).toHaveBeenCalledWith(
      1,
      { tenantId: 10, userId: 20, role: 'ADMIN' },
      'assign_student_to_class',
      expect.objectContaining({ userId: 3, classId: 8 }),
    );
    expect(result.response.type).toBe('tool_result');
    expect((result.response as any).message).toContain(
      'Đã thêm học viên vào lớp thành công',
    );

    const updateArg = mockPrisma.aiAgentSession.update.mock.calls[0][0];
    expect(updateArg.data.state.pending_action).toBeNull();
    expect(updateArg.data.state.selected_student_id).toBe(3);
    expect(updateArg.data.state.selected_class_id).toBe(8);
    expect(updateArg.data.state.selected_course_id).toBe(20);
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
      // Không có session ACTIVE trống -> tạo bản ghi mới.
      mockPrisma.aiAgentSession.findFirst.mockResolvedValue(null);
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

    it('createSession tái sử dụng session ACTIVE trống thay vì tạo mới', async () => {
      mockPrisma.aiAgentSession.findFirst.mockResolvedValue({
        id: 7,
        tenantId: 10,
        userId: 20,
        status: 'ACTIVE',
      });
      mockPrisma.aiAgentSession.update.mockResolvedValue({ id: 7 });

      await service.createSession(10, 20, { title: 'X' });

      expect(mockPrisma.aiAgentSession.create).not.toHaveBeenCalled();
      const arg = mockPrisma.aiAgentSession.update.mock.calls[0][0];
      expect(arg.where).toEqual({ id: 7 });
      expect(arg.data.title).toBe('X');
      // State phải được reset sạch như session vừa tạo.
      expect(arg.data.state.pending_action).toBeNull();
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
