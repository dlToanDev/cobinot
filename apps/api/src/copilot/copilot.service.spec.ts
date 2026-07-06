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

  let service: CopilotService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CopilotService(
      mockPrisma as any,
      mockToolRegistry as any,
      mockAgentRunner as any,
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
          last_entities: {},
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

  it('createTurn gặp pending_write từ runner thì thực thi tool ngay lập tức', async () => {
    mockPrisma.aiAgentSession.findFirst.mockResolvedValue({
      id: 1,
      tenantId: 10,
      userId: 20,
      status: 'ACTIVE',
      state: {},
    });
    mockPrisma.aiAgentSessionMessage.create
      .mockResolvedValueOnce({ id: 100, role: 'user', content: 'Tạo học viên A' })
      .mockResolvedValueOnce({ id: 101, role: 'assistant', content: '{}' });
    mockPrisma.aiAgentSessionMessage.findMany.mockResolvedValue([]);
    mockAgentRunner.run.mockResolvedValue({
      type: 'pending_write',
      pendingAction: {
        tool_name: 'create_student',
        input: { fullName: 'Nguyễn Văn A' },
        summary: 'Tạo học viên',
        intent: 'create_student',
      },
      message: 'Chuẩn bị tạo',
    });
    mockToolRegistry.execute.mockResolvedValue({
      id: 9,
      fullName: 'Nguyễn Văn A',
    });
    mockPrisma.aiAgentSession.update.mockResolvedValue({
      id: 1,
      state: { pending_action: null },
    });
    mockPrisma.aiCopilotTurnEvent.create.mockResolvedValue({ id: 1 });

    const result = await service.createTurn(
      { tenantId: 10, userId: 20, role: 'ADMIN' },
      1,
      'Tạo học viên A',
    );

    expect(mockToolRegistry.execute).toHaveBeenCalledWith(
      1,
      { tenantId: 10, userId: 20, role: 'ADMIN' },
      'create_student',
      { fullName: 'Nguyễn Văn A' },
    );
    expect(result.response).toEqual({
      type: 'tool_result',
      message: 'Đã thực hiện xong.',
      tool_name: 'create_student',
      status: 'SUCCESS',
      result: { id: 9, fullName: 'Nguyễn Văn A' },
      data: { id: 9, fullName: 'Nguyễn Văn A' },
    });
  });

  it('createTurn gặp lỗi khi thực thi write tool thì bắt lỗi và trả text_message chứa lỗi đó', async () => {
    mockPrisma.aiAgentSession.findFirst.mockResolvedValue({
      id: 1,
      tenantId: 10,
      userId: 20,
      status: 'ACTIVE',
      state: {},
    });
    mockPrisma.aiAgentSessionMessage.create
      .mockResolvedValueOnce({ id: 100, role: 'user', content: 'Tạo học viên A' })
      .mockResolvedValueOnce({ id: 101, role: 'assistant', content: '{}' });
    mockPrisma.aiAgentSessionMessage.findMany.mockResolvedValue([]);
    mockAgentRunner.run.mockResolvedValue({
      type: 'pending_write',
      pendingAction: {
        tool_name: 'create_student',
        input: { fullName: 'Nguyễn Văn A' },
        summary: 'Tạo học viên',
        intent: 'create_student',
      },
      message: 'Chuẩn bị tạo',
    });
    mockToolRegistry.execute.mockRejectedValue(
      new Error('Email đã được sử dụng trong trung tâm này'),
    );
    mockPrisma.aiAgentSession.update.mockResolvedValue({
      id: 1,
      state: { pending_action: null },
    });
    mockPrisma.aiCopilotTurnEvent.create.mockResolvedValue({ id: 1 });

    const result = await service.createTurn(
      { tenantId: 10, userId: 20, role: 'ADMIN' },
      1,
      'Tạo học viên A',
    );

    expect(mockToolRegistry.execute).toHaveBeenCalledWith(
      1,
      { tenantId: 10, userId: 20, role: 'ADMIN' },
      'create_student',
      { fullName: 'Nguyễn Văn A' },
    );
    expect(result.response).toEqual({
      type: 'text_message',
      message: 'Email đã được sử dụng trong trung tâm này',
    });
  });
});
