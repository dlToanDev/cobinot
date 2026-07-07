import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AgentRunnerService,
  AgentRunResult,
} from '../ai-agent/agent-runner.service';
import {
  AiToolName,
  ChatMessage,
  CopilotResponse,
  DecisionContext,
  DuplicateStudentContext,
  EntityOption,
  PendingAction,
  PendingEnrollmentContext,
  SuggestionAction,
} from '../ai-agent/decision.types';
import { ToolRegistryService } from '../ai-agent/tool-registry.service';
import {
  DeterministicIntentService,
  DeterministicOutcome,
} from '../ai-agent/deterministic-intent.service';
import {
  isAgentMiniMode,
  isToolAllowedInMiniMode,
  isWriteTool,
} from '../ai-agent/tool-definitions';
import { ActorPayload } from '../common/decorators/get-actor.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { createDefaultCopilotState } from './copilot-state';
import { CreateCopilotMessageDto } from './dto/create-message.dto';
import { CreateCopilotSessionDto } from './dto/create-session.dto';

@Injectable()
export class CopilotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly toolRegistry: ToolRegistryService,
    private readonly agentRunner: AgentRunnerService,
    private readonly usersService: UsersService,
    private readonly deterministic: DeterministicIntentService,
  ) {}

  /**
   * Thông báo thân thiện khi AI hết quota/lỗi nhưng hệ thống vẫn tìm được dữ
   * liệu trực tiếp trong database.
   */
  private static readonly AI_FALLBACK_PREFIX =
    'AI đang tạm hết quota, mình sẽ tìm trực tiếp trong dữ liệu hệ thống.\n\n';

  createSession(
    tenantId: number,
    userId: number,
    dto: CreateCopilotSessionDto,
  ) {
    return this.prisma.aiAgentSession.create({
      data: {
        tenantId,
        userId,
        title: dto.title || 'Phiên chat mới',
        status: 'ACTIVE',
        // Luôn state SẠCH: không copy context từ session cũ.
        state: createDefaultCopilotState() as any,
      },
    });
  }

  findSessions(tenantId: number, userId: number) {
    return this.prisma.aiAgentSession.findMany({
      where: { tenantId, userId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  /**
   * Lấy session ACTIVE mới nhất của user (bootstrap khi reload trang). Nếu không
   * có, hoặc session quá TTL, thì tạo session mới sạch.
   */
  async getOrCreateCurrentSession(tenantId: number, userId: number) {
    const active = await this.prisma.aiAgentSession.findFirst({
      where: { tenantId, userId, status: 'ACTIVE' },
      orderBy: { updatedAt: 'desc' },
    });

    if (active) {
      const ttlHours = Number(process.env.COPILOT_SESSION_TTL_HOURS ?? 24);
      const ageMs = Date.now() - new Date(active.updatedAt).getTime();
      const expired = ttlHours > 0 && ageMs > ttlHours * 60 * 60 * 1000;
      if (!expired) {
        return active;
      }
      // Session quá cũ -> đóng (clear context) rồi tạo mới.
      await this.closeSession(tenantId, userId, active.id);
    }

    return this.createSession(tenantId, userId, {});
  }

  async findSession(tenantId: number, userId: number, id: number) {
    const session = await this.prisma.aiAgentSession.findFirst({
      where: { id, tenantId },
    });

    if (!session) {
      throw new NotFoundException('Không tìm thấy phiên chat');
    }
    if (session.userId !== userId) {
      throw new ForbiddenException('Bạn không có quyền xem phiên chat này');
    }

    return session;
  }

  async closeSession(tenantId: number, userId: number, id: number) {
    await this.findSession(tenantId, userId, id);
    // Đóng session: reset state sạch để mọi pending_action/context nguy hiểm bị
    // hủy, không thể mở lại session cũ rồi confirm action cũ.
    return this.prisma.aiAgentSession.update({
      where: { id },
      data: {
        status: 'CLOSED',
        state: createDefaultCopilotState() as any,
      },
    });
  }

  async deleteSession(tenantId: number, userId: number, id: number) {
    await this.findSession(tenantId, userId, id);
    return this.prisma.aiAgentSession.delete({ where: { id } });
  }

  async findMessages(tenantId: number, userId: number, sessionId: number) {
    await this.findSession(tenantId, userId, sessionId);
    return this.prisma.aiAgentSessionMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createMessage(
    tenantId: number,
    userId: number,
    sessionId: number,
    dto: CreateCopilotMessageDto,
  ) {
    if ((dto.role || 'user') === 'user') {
      return this.createTurn(
        { tenantId, userId, role: 'ADMIN' },
        sessionId,
        dto.content,
        dto.action,
      );
    }

    const session = await this.findSession(tenantId, userId, sessionId);
    const message = await this.prisma.aiAgentSessionMessage.create({
      data: {
        sessionId,
        role: dto.role || 'assistant',
        content: dto.content,
        toolName: dto.toolName || null,
      },
    });
    await this.touchSession(sessionId);

    return {
      message,
      assistantMessage: null,
      state: session.state,
    };
  }

  async createTurn(
    actor: ActorPayload,
    sessionId: number,
    content: string,
    action?: SuggestionAction,
  ) {
    const startedAt = Date.now();
    const session = await this.findActiveSession(
      actor.tenantId,
      actor.userId,
      sessionId,
    );
    const state = this.normalizeState(session.state);

    const userMessage = await this.prisma.aiAgentSessionMessage.create({
      data: { sessionId, role: 'user', content },
    });

    if (state.pending_action && this.isConfirmText(content)) {
      return this.confirm(actor, sessionId);
    }
    if (state.pending_action && this.isCancelText(content)) {
      return this.cancel(actor, sessionId);
    }

    // Đang chờ user trả lời sau khi phát hiện trùng học viên.
    if (state.duplicate_student_context) {
      const handled = await this.handleDuplicateStudentReply(
        sessionId,
        state,
        content,
        userMessage.id,
        startedAt,
      );
      // Case A (hủy) / Case C (dùng học viên có sẵn) đã được xử lý xong.
      // Case B (nhập email/SĐT khác) trả null -> để agent xử lý tiếp create_student
      // với duplicate_student_context vẫn còn để dẫn hướng prompt.
      if (handled) return handled;
    }

    // Đang chờ user chọn lớp để hoàn tất ghi danh (khóa có nhiều lớp).
    if (state.pending_enrollment_context) {
      const handled = await this.handlePendingEnrollmentReply(
        actor,
        sessionId,
        state,
        content,
        userMessage.id,
        startedAt,
      );
      if (handled) return handled;
    }

    // Đang chờ user nhập TÊN LỚP để hoàn tất tạo lớp (đã có khóa học).
    if (state.pending_class_creation) {
      const handled = await this.handlePendingClassCreationReply(
        actor,
        sessionId,
        state,
        content,
        userMessage.id,
        startedAt,
      );
      if (handled) return handled;
    }

    // Suggestion WRITE action: KHÔNG execute ngay. Đưa qua preview/confirm
    // giống flow chat thường (lưu pending_action rồi trả preview_card).
    const suggestionPending = this.pendingActionFromSuggestion(action);
    if (suggestionPending) {
      return this.savePendingWriteTurn({
        actor,
        sessionId,
        state,
        pending: suggestionPending,
        userMessageId: userMessage.id,
        startedAt,
      });
    }

    // Lớp xử lý deterministic TRƯỚC khi gọi LLM: tìm kiếm / tạo học viên / ghi
    // danh được rule detect thì xử lý thẳng bằng database, không phụ thuộc AI
    // (không chết vì quota/lỗi AI provider).
    const deterministic = await this.tryDeterministic(
      actor,
      sessionId,
      state,
      content,
      userMessage.id,
      startedAt,
    );
    if (deterministic) return deterministic;

    const history = await this.loadRecentHistory(sessionId, userMessage.id);
    const result = await this.agentRunner.run({
      tenantId: actor.tenantId,
      userId: actor.userId,
      sessionId,
      userMessage: content,
      context: state,
      sessionHistory: history,
    });

    // LLM không dùng được (quota/lỗi mạng) -> fallback tìm kiếm trực tiếp DB.
    if (
      result.type === 'text' &&
      result.llmUnavailable &&
      process.env.AI_ENABLE_FALLBACK !== 'false'
    ) {
      const fallback = await this.deterministic.fallbackSearch(
        actor.tenantId,
        content,
      );
      if (fallback) {
        const response: CopilotResponse = {
          type: 'text_message',
          message: CopilotService.AI_FALLBACK_PREFIX + fallback.message,
        };
        return this.saveAssistantTurn({
          sessionId,
          userMessageId: userMessage.id,
          startedAt,
          response,
          state: this.mergeState(state, fallback.contextPatch),
        });
      }
    }

    if (result.type === 'pending_write') {
      // WRITE tool: KHÔNG execute ngay. Với create_student còn phải kiểm tra
      // trùng email/SĐT trước khi cho preview (xem savePendingWriteTurn).
      return this.savePendingWriteTurn({
        actor,
        sessionId,
        state,
        pending: result.pendingAction,
        userMessageId: userMessage.id,
        startedAt,
        contextPatch: result.contextPatch,
      });
    }

    const response = this.responseFromRunResult(result);
    const nextState = this.mergeState(state, result.contextPatch || {});

    return this.saveAssistantTurn({
      sessionId,
      userMessageId: userMessage.id,
      startedAt,
      response,
      state: nextState,
    });
  }

  /**
   * Chạy lớp deterministic (không LLM). Trả turn đã lưu nếu xử lý được, null nếu
   * câu mơ hồ để tiếp tục gọi LLM.
   */
  private async tryDeterministic(
    actor: ActorPayload,
    sessionId: number,
    state: DecisionContext,
    content: string,
    userMessageId: number,
    startedAt: number,
  ) {
    let outcome: DeterministicOutcome | null;
    try {
      outcome = await this.deterministic.resolve(
        actor.tenantId,
        state,
        content,
      );
    } catch {
      // Lỗi bất ngờ ở lớp deterministic KHÔNG được làm chết flow -> để LLM lo.
      return null;
    }
    if (!outcome) return null;

    if (outcome.type === 'pending_write') {
      return this.savePendingWriteTurn({
        actor,
        sessionId,
        state,
        pending: outcome.pending,
        userMessageId,
        startedAt,
        contextPatch: outcome.contextPatch,
      });
    }

    if (outcome.type === 'student_form') {
      const response: CopilotResponse = {
        type: 'student_create_form',
        title: 'Tạo học viên mới',
        message: outcome.message,
        intent: 'create_student',
        values: outcome.values,
        submit_label: 'Xem trước',
      };
      return this.saveAssistantTurn({
        sessionId,
        userMessageId,
        startedAt,
        response,
        state: this.mergeState(state, outcome.contextPatch),
      });
    }

    if (outcome.type === 'course_form') {
      const response: CopilotResponse = {
        type: 'course_create_form',
        title: 'Tạo khóa học mới',
        message: outcome.message,
        intent: 'create_course',
        values: outcome.values,
        submit_label: 'Xem trước',
      };
      return this.saveAssistantTurn({
        sessionId,
        userMessageId,
        startedAt,
        response,
        state: this.mergeState(state, outcome.contextPatch),
      });
    }

    const response: CopilotResponse =
      outcome.type === 'clarification'
        ? {
            type: 'clarification',
            message: outcome.message,
            missing_fields: outcome.missingFields,
            intent: outcome.intent,
            entities: {},
          }
        : { type: 'text_message', message: outcome.message };

    return this.saveAssistantTurn({
      sessionId,
      userMessageId,
      startedAt,
      response,
      state: this.mergeState(state, outcome.contextPatch),
    });
  }

  async confirm(
    actor: ActorPayload,
    sessionId: number,
    input?: Record<string, unknown>,
  ) {
    const startedAt = Date.now();
    const session = await this.findActiveSession(
      actor.tenantId,
      actor.userId,
      sessionId,
    );
    const state = this.normalizeState(session.state);
    const pending = state.pending_action;

    if (!pending) {
      throw new BadRequestException('Không có hành động nào đang chờ xác nhận');
    }

    // Guard mini mode: pending_action cũ (trước khi bật mini mode) có thể là tool
    // nguy hiểm (delete_students...). Không cho confirm, hủy luôn pending.
    if (isAgentMiniMode() && !isToolAllowedInMiniMode(pending.tool_name)) {
      const response: CopilotResponse = {
        type: 'error',
        message:
          'Thao tác này không còn được hỗ trợ trong bản Copilot mini nên đã được hủy.',
        code: 'TOOL_DISABLED_IN_MINI_MODE',
      };
      const nextState = this.mergeState(state, {
        pending_action: null,
        pending_clarification: null,
        pending_enrollment_context: null,
      });
      return this.saveAssistantTurn({
        sessionId,
        startedAt,
        response,
        state: nextState,
      });
    }

    // Guard: chặn update_student khi user thực sự đang muốn TẠO học viên mới.
    // Không dựa vào prompt — kiểm tra ngay ở backend trước khi execute.
    if (
      pending.tool_name === 'update_student' &&
      (state.last_intent === 'create_student' ||
        state.duplicate_student_context?.intended_action === 'create')
    ) {
      const response: CopilotResponse = {
        type: 'clarification',
        message:
          'Bạn đang muốn TẠO học viên mới nên mình không tự cập nhật học viên cũ. ' +
          'Nếu muốn cập nhật, hãy nói rõ "cập nhật/sửa học viên ID ..." kèm thông tin cần đổi.',
        missing_fields: [],
        intent: 'create_student',
        entities: {},
      };
      const nextState = this.mergeState(state, {
        pending_action: null,
      });
      return this.saveAssistantTurn({
        sessionId,
        startedAt,
        response,
        state: nextState,
      });
    }

    const finalInput = { ...(pending.input || {}), ...(input || {}) };
    try {
      const result = await this.toolRegistry.execute(
        sessionId,
        actor,
        pending.tool_name,
        finalInput,
      );
      const response: CopilotResponse = {
        type: 'tool_result',
        message: this.buildToolResultMessage(pending.tool_name, result),
        tool_name: pending.tool_name,
        status: 'SUCCESS',
        result,
        data: result,
      };
      const patch = this.statePatchFromToolResult(pending.tool_name, result);
      // Cập nhật đúng khóa "vừa tạo" -> đồng bộ luôn last_created_course để card
      // "khóa vừa tạo" phản ánh dữ liệu mới.
      if (
        pending.tool_name === 'update_course' &&
        patch.last_selected_course &&
        state.last_created_course?.id === patch.last_selected_course.id
      ) {
        patch.last_created_course = patch.last_selected_course;
      }
      const nextState = this.mergeState(state, {
        ...patch,
        pending_action: null,
        pending_clarification: null,
        pending_enrollment_context: null,
        pending_class_creation: null,
        last_intent: pending.tool_name,
      });

      return this.saveAssistantTurn({
        sessionId,
        startedAt,
        response,
        state: nextState,
        toolName: pending.tool_name,
      });
    } catch (error: any) {
      return this.handleConfirmError(
        sessionId,
        state,
        pending,
        error,
        startedAt,
      );
    }
  }

  /**
   * Xử lý lỗi khi confirm một pending action (đặc biệt là ghi danh khóa).
   * - Khóa nhiều lớp -> chuyển sang clarification chọn lớp (giữ pending_enrollment_context).
   * - Lỗi không thể retry (đã ghi danh, không có lớp, không tìm thấy) -> clear pending_action.
   * - Lỗi khác (tạm thời) -> giữ pending_action để user thử lại.
   */
  private async handleConfirmError(
    sessionId: number,
    state: DecisionContext,
    pending: PendingAction,
    error: any,
    startedAt: number,
  ) {
    const info = this.extractErrorInfo(error);

    // Khóa có nhiều lớp -> hỏi user chọn lớp cụ thể để hoàn tất ghi danh.
    if (
      info.code === 'COURSE_HAS_MULTIPLE_CLASSES' &&
      pending.tool_name === 'assign_student_to_course'
    ) {
      const candidateClasses = (info.classes || []).map((c) =>
        this.classCandidateOption(c),
      );
      const enrollmentContext: PendingEnrollmentContext = {
        userId: Number(pending.input?.userId) || 0,
        courseId: Number(pending.input?.courseId) || 0,
        candidateClasses,
      };
      const message = this.buildMultiClassMessage(candidateClasses);
      const response: CopilotResponse = {
        type: 'clarification',
        message,
        missing_fields: ['classId'],
        intent: 'assign_student_to_course',
        entities: {},
      };
      const nextState = this.mergeState(state, {
        pending_action: null,
        pending_enrollment_context: enrollmentContext,
        pending_clarification: {
          intent: 'assign_student_to_course',
          missing_fields: ['classId'],
          message,
        },
        last_candidates: { classes: candidateClasses },
      });
      return this.saveAssistantTurn({
        sessionId,
        startedAt,
        response,
        state: nextState,
      });
    }

    // Các lỗi không nên retry -> clear pending_action.
    const nonRetryCodes = [
      'STUDENT_ALREADY_ASSIGNED_TO_COURSE',
      'COURSE_HAS_NO_ACTIVE_CLASS',
      'STUDENT_NOT_FOUND',
      'COURSE_NOT_FOUND',
    ];
    if (info.code && nonRetryCodes.includes(info.code)) {
      const response: CopilotResponse = {
        type: 'error',
        message: info.message,
        code: info.code,
      };
      const nextState = this.mergeState(state, {
        pending_action: null,
        pending_clarification: null,
      });
      return this.saveAssistantTurn({
        sessionId,
        startedAt,
        response,
        state: nextState,
        toolName: pending.tool_name,
      });
    }

    // Lỗi khác (có thể tạm thời) -> giữ pending_action để user thử lại.
    const response: CopilotResponse = {
      type: 'error',
      message: info.message,
    };
    return this.saveAssistantTurn({
      sessionId,
      startedAt,
      response,
      state: this.mergeState(state, {}),
      toolName: pending.tool_name,
    });
  }

  private extractErrorInfo(error: any): {
    code?: string;
    message: string;
    classes?: any[];
  } {
    const resp = error?.response;
    if (resp && typeof resp === 'object') {
      return {
        code: typeof resp.code === 'string' ? resp.code : undefined,
        message:
          resp.message ||
          error?.message ||
          'Có lỗi xảy ra khi thực hiện thao tác.',
        classes: Array.isArray(resp.classes) ? resp.classes : undefined,
      };
    }
    return {
      message: error?.message || 'Có lỗi xảy ra khi thực hiện thao tác.',
    };
  }

  async cancel(actor: ActorPayload, sessionId: number) {
    const startedAt = Date.now();
    const session = await this.findActiveSession(
      actor.tenantId,
      actor.userId,
      sessionId,
    );
    const state = this.normalizeState(session.state);
    const response: CopilotResponse = {
      type: 'text_message',
      message: 'Đã hủy thao tác. Dữ liệu chưa được ghi vào hệ thống.',
    };
    const nextState = this.mergeState(state, {
      pending_action: null,
      pending_clarification: null,
      pending_class_creation: null,
    });

    return this.saveAssistantTurn({
      sessionId,
      startedAt,
      response,
      state: nextState,
    });
  }

  async mergeSessionState(
    tenantId: number,
    userId: number,
    id: number,
    patch: Record<string, unknown>,
  ) {
    const session = await this.findSession(tenantId, userId, id);
    const nextState = this.mergeState(
      this.normalizeState(session.state),
      patch,
    );

    return this.prisma.aiAgentSession.update({
      where: { id },
      data: {
        state: nextState as any,
      },
    });
  }

  findActions(tenantId: number) {
    return this.toolRegistry.findActions(tenantId);
  }

  findAuditLogs(tenantId: number) {
    return this.toolRegistry.findAuditLogs(tenantId);
  }

  private async findActiveSession(
    tenantId: number,
    userId: number,
    id: number,
  ) {
    const session = await this.findSession(tenantId, userId, id);
    if (session.status !== 'ACTIVE') {
      throw new BadRequestException({
        code: 'SESSION_NOT_ACTIVE',
        message: 'Phiên chat này đã đóng. Vui lòng tạo phiên mới.',
      });
    }
    return session;
  }

  private async loadRecentHistory(
    sessionId: number,
    currentUserMessageId: number,
  ): Promise<ChatMessage[]> {
    const messages = await this.prisma.aiAgentSessionMessage.findMany({
      where: {
        sessionId,
        id: { lt: currentUserMessageId },
      },
      orderBy: { createdAt: 'desc' },
      take: 12,
    });

    return messages
      .reverse()
      .map((message): ChatMessage | null => {
        const content = this.messageContentForModel(message.content);
        if (!content) return null;
        if (message.role === 'assistant') {
          return { role: 'assistant', content };
        }
        if (message.role === 'tool') {
          return {
            role: 'tool',
            content,
            toolName: message.toolName || undefined,
            toolCallId: message.toolName || undefined,
          };
        }
        return { role: 'user', content };
      })
      .filter((message): message is ChatMessage => message !== null);
  }

  private messageContentForModel(content: string): string {
    try {
      const parsed = JSON.parse(content);
      if (typeof parsed?.message === 'string') return parsed.message;
      return JSON.stringify(parsed);
    } catch {
      return content;
    }
  }

  private responseFromRunResult(result: AgentRunResult): CopilotResponse {
    if (result.type === 'clarification') {
      return {
        type: 'clarification',
        message: result.message,
        missing_fields: result.clarification.missing_fields,
        intent: result.clarification.intent,
        entities: result.clarification.entities || {},
      };
    }

    if (result.type === 'pending_write') {
      return this.previewResponse(result.pendingAction);
    }

    return {
      type: 'text_message',
      message: result.message,
    };
  }

  private previewResponse(pendingAction: PendingAction): CopilotResponse {
    return {
      type: 'preview_card',
      status: 'waiting_confirm',
      title: 'Kiểm tra lại yêu cầu',
      message: this.previewMessage(pendingAction.tool_name),
      tool_name: pendingAction.tool_name,
      input: pendingAction.input,
      display_input: pendingAction.display_input || pendingAction.input,
      pending_action: pendingAction,
      actions: ['confirm', 'cancel'],
      summary: pendingAction.summary,
    };
  }

  /** Lời nhắc trên preview card, gợi ý theo từng loại thao tác. */
  private previewMessage(toolName: AiToolName): string {
    if (toolName === 'create_class') {
      return 'Mình đã chuẩn bị tạo lớp. Các trường trống (giáo viên, ngày bắt đầu/kết thúc, lịch học) có thể để trống và cập nhật sau. Bạn kiểm tra rồi bấm Xác nhận nhé.';
    }
    if (toolName === 'update_course') {
      return 'Mình sẽ cập nhật khóa học với các thông tin bên dưới. Bạn kiểm tra rồi bấm Xác nhận nhé.';
    }
    return 'Bạn xác nhận để mình thực hiện thao tác này nhé.';
  }

  /** Message tiếng Việt dễ hiểu sau khi confirm thành công (không dump JSON). */
  private buildToolResultMessage(
    toolName: AiToolName,
    result: unknown,
  ): string {
    const row = (result || {}) as any;
    const bullet = (label: string, value: unknown): string | null => {
      if (value === null || value === undefined || value === '') return null;
      return `- ${label}: ${value}`;
    };

    if (toolName === 'create_student') {
      return [
        'Đã tạo học viên thành công.',
        '',
        bullet('Tên', row.fullName || row.name),
        bullet('Email', row.email),
        bullet('SĐT', row.phone),
        bullet('ID', row.id),
      ]
        .filter((line) => line !== null)
        .join('\n');
    }

    if (toolName === 'create_course') {
      return [
        'Đã tạo khóa học thành công.',
        '',
        bullet('Tên khóa', row.title || row.name),
        bullet('Mã khóa', row.courseCode || row.code),
        bullet('Ngày bắt đầu', this.formatDateVi(row.startDate)),
        bullet(
          'Ngày kết thúc',
          this.formatDateVi(row.expireDate ?? row.endDate),
        ),
        bullet('ID', row.id),
      ]
        .filter((line) => line !== null)
        .join('\n');
    }

    if (toolName === 'update_course') {
      return [
        'Đã cập nhật khóa học thành công.',
        '',
        bullet('Tên khóa', row.title || row.name),
        bullet('Mã khóa', row.courseCode || row.code),
        bullet('Cấp độ', row.level),
        bullet('Mô tả', row.description),
        bullet('Trạng thái', row.status),
        bullet('Ngày bắt đầu', this.formatDateVi(row.startDate)),
        bullet('Ngày kết thúc', this.formatDateVi(row.expireDate ?? row.endDate)),
        bullet('ID', row.id),
      ]
        .filter((line) => line !== null)
        .join('\n');
    }

    if (toolName === 'create_class') {
      const scheduleLines = this.formatClassSessionLines(row.sessions);
      const hasExtra =
        row.teacherName ||
        row.startDate ||
        row.endDate ||
        scheduleLines.length;
      return [
        'Đã tạo lớp học thành công.',
        '',
        bullet('Tên lớp', row.title || row.name),
        bullet('Mã lớp', row.classCode),
        bullet('Khóa học', row.course?.title || row.courseName),
        bullet('Loại lớp', row.type),
        bullet('Giáo viên', row.teacherName),
        scheduleLines.length
          ? ['Lịch học:', ...scheduleLines.map((line) => `- ${line}`)].join(
              '\n',
            )
          : null,
        // Nếu tạo tối giản (chỉ tên + khóa), nhắc user có thể bổ sung sau.
        hasExtra
          ? null
          : '\nBạn có thể cập nhật giáo viên, ngày học và lịch học sau.',
      ]
        .filter((line) => line !== null)
        .join('\n');
    }

    if (toolName === 'assign_student_to_course') {
      const studentName =
        row.user?.fullName ||
        row.user?.name ||
        `#${row.studentId ?? row.userId}`;
      const courseName =
        row.course?.title || row.course?.name || `#${row.courseId}`;
      const className = row.courseClass?.title || row.courseClass?.name;
      return [
        'Đã ghi danh học viên vào khóa thành công.',
        '',
        bullet('Học viên', studentName),
        bullet('Khóa', courseName),
        bullet('Lớp', className),
      ]
        .filter((line) => line !== null)
        .join('\n');
    }

    return 'Đã thực hiện xong thao tác.';
  }

  private formatClassSessionLines(sessions: unknown): string[] {
    if (!Array.isArray(sessions)) return [];
    return sessions.map((session: any) => {
      const parts = [
        this.formatDayOfWeek(session.dayOfWeek),
        session.startTime || session.endTime
          ? [session.startTime, session.endTime].filter(Boolean).join('-')
          : '',
        session.room ? `phòng ${session.room}` : '',
      ].filter(Boolean);
      return parts.join(', ');
    });
  }

  private formatDayOfWeek(value: unknown): string {
    const day = Number(value);
    if (!Number.isFinite(day)) return '';
    if (day === 0) return 'Chủ nhật';
    if (day >= 2 && day <= 7) return `Thứ ${day}`;
    return '';
  }

  private formatDateVi(value: unknown): string | null {
    if (value === null || value === undefined || value === '') return null;
    const date = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(date.getTime())) return null;
    const day = String(date.getUTCDate()).padStart(2, '0');
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    return `${day}/${month}/${date.getUTCFullYear()}`;
  }

  private pendingActionFromSuggestion(
    action?: SuggestionAction,
  ): PendingAction | null {
    if (!action || !isWriteTool(action.action)) return null;
    const summaries: Partial<Record<AiToolName, string>> = {
      create_student: 'Tạo học viên mới',
      create_course: 'Tạo khóa học mới',
      create_class: 'Tạo lớp học mới',
      assign_student_to_course: 'Ghi danh học viên vào khóa học',
    };
    return {
      tool_name: action.action,
      input: action.input || {},
      display_input: action.input || {},
      summary: summaries[action.action] || `Chuẩn bị chạy ${action.action}`,
      intent: action.action,
      status: 'waiting_confirm',
      severity: ['delete_students', 'delete_courses', 'close_class'].includes(
        action.action,
      )
        ? 'danger'
        : 'default',
    };
  }

  /**
   * Lưu turn cho một WRITE tool. Riêng create_student: kiểm tra trùng email/SĐT
   * trước; nếu trùng thì KHÔNG tạo pending_action, trả clarification hỏi lại và
   * lưu duplicate_student_context. Nếu không trùng thì preview_card như Cụm 1.
   */
  private async savePendingWriteTurn(params: {
    actor: ActorPayload;
    sessionId: number;
    state: DecisionContext;
    pending: PendingAction;
    userMessageId?: number;
    startedAt: number;
    contextPatch?: Partial<DecisionContext>;
  }) {
    const { actor, sessionId, state, pending, userMessageId, startedAt } =
      params;

    if (pending.tool_name === 'create_student') {
      const email = this.extractInputString(pending.input.email);
      const phone = this.extractInputString(pending.input.phone);
      const duplicate =
        await this.usersService.findDuplicateStudentByEmailOrPhone(
          actor.tenantId,
          { email, phone },
        );

      if (duplicate) {
        const duplicateContext: DuplicateStudentContext = {
          searched_email: email,
          searched_phone: phone,
          existing_student: this.toStudentEntityOption(duplicate),
          intended_action: 'create',
        };
        const message = this.buildDuplicateStudentMessage(duplicateContext);
        const response: CopilotResponse = {
          type: 'clarification',
          message,
          missing_fields: [],
          intent: 'create_student',
          entities: { duplicate_student_context: duplicateContext },
        };
        const nextState = this.mergeState(state, {
          ...(params.contextPatch || {}),
          pending_action: null,
          last_intent: 'create_student',
          duplicate_student_context: duplicateContext,
          pending_clarification: {
            intent: 'create_student',
            missing_fields: [],
            message,
          },
        });
        return this.saveAssistantTurn({
          sessionId,
          userMessageId,
          startedAt,
          response,
          state: nextState,
        });
      }
    }

    const response = this.previewResponse(pending);
    const nextState = this.mergeState(state, {
      last_intent: pending.tool_name,
      pending_action: pending,
      duplicate_student_context: null,
      ...(params.contextPatch || {}),
    });
    return this.saveAssistantTurn({
      sessionId,
      userMessageId,
      startedAt,
      response,
      state: nextState,
      toolName: pending.tool_name,
    });
  }

  /**
   * Xử lý câu trả lời của user khi đang có duplicate_student_context.
   * - Case A: hủy -> clear context, báo đã hủy.
   * - Case C: dùng học viên có sẵn -> set selected student, clear context.
   * - Case B: nhập email/SĐT khác (hoặc yêu cầu khác) -> trả null để agent xử lý.
   */
  private async handleDuplicateStudentReply(
    sessionId: number,
    state: DecisionContext,
    content: string,
    userMessageId: number,
    startedAt: number,
  ) {
    const dup = state.duplicate_student_context;
    if (!dup) return null;

    // Case A: hủy
    if (this.isCancelText(content)) {
      const response: CopilotResponse = {
        type: 'text_message',
        message:
          'Đã hủy thao tác tạo học viên. Dữ liệu chưa được ghi vào hệ thống.',
      };
      const nextState = this.mergeState(state, {
        duplicate_student_context: null,
        pending_clarification: null,
        last_intent: null,
      });
      return this.saveAssistantTurn({
        sessionId,
        userMessageId,
        startedAt,
        response,
        state: nextState,
      });
    }

    // Case C: dùng học viên có sẵn (chưa ghi danh trong Cụm 2)
    if (this.isUseExistingStudentText(content)) {
      const existing = dup.existing_student;
      const response: CopilotResponse = {
        type: 'text_message',
        message: `Đã chọn học viên có sẵn: ${existing.label}. Bạn muốn làm gì tiếp theo với học viên này?`,
      };
      const nextState = this.mergeState(state, {
        selected_student_id: existing.id,
        last_selected_student: existing,
        duplicate_student_context: null,
        pending_clarification: null,
        last_intent: null,
      });
      return this.saveAssistantTurn({
        sessionId,
        userMessageId,
        startedAt,
        response,
        state: nextState,
      });
    }

    // Case B / khác: để agent xử lý tiếp (ví dụ nhập email/SĐT mới).
    return null;
  }

  /**
   * Xử lý user chọn lớp khi khóa có nhiều lớp (pending_enrollment_context).
   * - Hủy -> clear context.
   * - Chọn được lớp (theo số thứ tự hoặc tên) -> tạo preview assign_student_to_course
   *   kèm classId cụ thể (KHÔNG ghi DB ngay, vẫn phải confirm).
   * - Không rõ -> trả null để agent xử lý tiếp.
   */
  private async handlePendingEnrollmentReply(
    actor: ActorPayload,
    sessionId: number,
    state: DecisionContext,
    content: string,
    userMessageId: number,
    startedAt: number,
  ) {
    const ctx = state.pending_enrollment_context;
    if (!ctx) return null;

    if (this.isCancelText(content)) {
      const response: CopilotResponse = {
        type: 'text_message',
        message:
          'Đã hủy thao tác ghi danh. Dữ liệu chưa được ghi vào hệ thống.',
      };
      const nextState = this.mergeState(state, {
        pending_enrollment_context: null,
        pending_clarification: null,
      });
      return this.saveAssistantTurn({
        sessionId,
        userMessageId,
        startedAt,
        response,
        state: nextState,
      });
    }

    const chosen = this.resolveClassChoice(content, ctx.candidateClasses || []);
    if (!chosen) {
      // Không xác định được lớp -> để agent xử lý tiếp, giữ context.
      return null;
    }

    const pending: PendingAction = {
      tool_name: 'assign_student_to_course',
      input: {
        userId: ctx.userId,
        courseId: ctx.courseId,
        classId: chosen.id,
      },
      display_input: {
        userId: ctx.userId,
        courseId: ctx.courseId,
        classId: chosen.id,
      },
      summary: `Ghi danh học viên #${ctx.userId} vào khóa học #${ctx.courseId} (lớp ${chosen.label})`,
      intent: 'assign_student_to_course',
      status: 'waiting_confirm',
      severity: 'default',
    };
    const clearedState = this.mergeState(state, {
      pending_enrollment_context: null,
      pending_clarification: null,
    });
    return this.savePendingWriteTurn({
      actor,
      sessionId,
      state: clearedState,
      pending,
      userMessageId,
      startedAt,
    });
  }

  /**
   * Xử lý user trả lời TÊN LỚP khi đang có pending_class_creation (đã biết khóa).
   * - Hủy -> clear context.
   * - Có tên -> tạo preview create_class NGAY (sessions rỗng), không hỏi thêm.
   * - Trống -> hỏi lại tên, giữ context.
   */
  private async handlePendingClassCreationReply(
    actor: ActorPayload,
    sessionId: number,
    state: DecisionContext,
    content: string,
    userMessageId: number,
    startedAt: number,
  ) {
    const ctx = state.pending_class_creation;
    if (!ctx) return null;

    if (this.isCancelText(content)) {
      const response: CopilotResponse = {
        type: 'text_message',
        message: 'Đã hủy thao tác tạo lớp. Dữ liệu chưa được ghi vào hệ thống.',
      };
      const nextState = this.mergeState(state, {
        pending_class_creation: null,
        pending_clarification: null,
        last_intent: null,
      });
      return this.saveAssistantTurn({
        sessionId,
        userMessageId,
        startedAt,
        response,
        state: nextState,
      });
    }

    const title = content.trim();
    if (!title) {
      const response: CopilotResponse = {
        type: 'clarification',
        message: 'Bạn muốn đặt tên lớp là gì?',
        missing_fields: ['title'],
        intent: 'create_class',
        entities: {},
      };
      return this.saveAssistantTurn({
        sessionId,
        userMessageId,
        startedAt,
        response,
        state: this.mergeState(state, {}),
      });
    }

    const pending = this.deterministic.buildCreateClassPending({
      courseId: ctx.courseId,
      courseLabel: ctx.courseTitle || ctx.courseCode,
      title,
      type: ctx.type,
    });
    const clearedState = this.mergeState(state, {
      pending_class_creation: null,
      pending_clarification: null,
    });
    return this.savePendingWriteTurn({
      actor,
      sessionId,
      state: clearedState,
      pending,
      userMessageId,
      startedAt,
    });
  }

  private buildMultiClassMessage(classes: EntityOption[]): string {
    const rows = classes
      .map(
        (c, index) =>
          `${index + 1}. ${c.label}${c.description ? ` (${c.description})` : ''}`,
      )
      .join('\n');
    return [
      'Khóa học này có nhiều lớp. Vui lòng chọn lớp cụ thể để ghi danh:',
      rows,
      '',
      'Bạn muốn ghi danh vào lớp nào? (trả lời theo số thứ tự hoặc tên lớp)',
    ].join('\n');
  }

  private classCandidateOption(c: any): EntityOption {
    return {
      id: Number(c.id),
      value: Number(c.id),
      label: String(c.label || c.title || c.classCode || `#${c.id}`),
      description: [c.classCode, c.status].filter(Boolean).join(' | '),
      metadata: c,
    };
  }

  private resolveClassChoice(
    content: string,
    candidates: EntityOption[],
  ): EntityOption | null {
    if (!candidates.length) return null;
    const text = this.normalizeText(content);

    const idx = this.parseChoiceIndex(text);
    if (idx !== null && idx >= 0 && idx < candidates.length) {
      return candidates[idx];
    }

    const byName = candidates.find((c) => {
      const label = this.normalizeText(String(c.label || ''));
      const code = this.normalizeText(
        String((c.metadata as any)?.classCode || ''),
      );
      return (label && text.includes(label)) || (code && text.includes(code));
    });
    return byName || null;
  }

  private parseChoiceIndex(text: string): number | null {
    const withKeyword = text.match(
      /(?:thu|so|lop|class|khoa|nguoi|hoc vien)\s*(\d{1,2})/,
    );
    if (withKeyword) {
      const n = parseInt(withKeyword[1], 10);
      if (n >= 1) return n - 1;
    }
    const bare = text.match(/^\s*(\d{1,2})\s*$/);
    if (bare) {
      const n = parseInt(bare[1], 10);
      if (n >= 1) return n - 1;
    }
    return null;
  }

  private buildDuplicateStudentMessage(
    context: DuplicateStudentContext,
  ): string {
    const s = context.existing_student;
    return [
      'Email/SĐT này đã tồn tại trong hệ thống.',
      '',
      'Học viên tìm thấy:',
      `- Tên: ${s.label}`,
      `- Email: ${s.email || 'Chưa có'}`,
      `- SĐT: ${s.phone || 'Chưa có'}`,
      `- ID: ${s.id}`,
      '',
      'Bạn muốn:',
      '1. Dùng học viên có sẵn này',
      '2. Nhập email/SĐT khác để tạo học viên mới',
      '3. Hủy thao tác',
    ].join('\n');
  }

  private toStudentEntityOption(row: any): EntityOption {
    return {
      id: Number(row.id),
      value: Number(row.id),
      label: String(row.fullName || row.name || `#${row.id}`),
      email: row.email ?? null,
      phone: row.phone ?? null,
      description: [row.email, row.phone].filter(Boolean).join(' | '),
      metadata: row,
    };
  }

  private extractInputString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed || null;
  }

  private isUseExistingStudentText(content: string): boolean {
    const text = this.normalizeText(content);
    if (text === '1' || text === 'so 1' || text === 'option 1') return true;
    return [
      'dung hoc vien co san',
      'dung hoc vien nay',
      'dung hoc vien',
      'hoc vien co san',
      'chon hoc vien nay',
      'dung nguoi nay',
      'chon nguoi nay',
      'dung ban ghi nay',
      'su dung hoc vien',
    ].some((keyword) => text.includes(keyword));
  }

  private async saveAssistantTurn(params: {
    sessionId: number;
    userMessageId?: number;
    startedAt: number;
    response: CopilotResponse;
    state: DecisionContext;
    toolName?: string;
  }) {
    const assistantMessage = await this.prisma.aiAgentSessionMessage.create({
      data: {
        sessionId: params.sessionId,
        role: 'assistant',
        content: JSON.stringify(params.response),
        toolName: params.toolName || this.responseToolName(params.response),
      },
    });

    const session = await this.prisma.aiAgentSession.update({
      where: { id: params.sessionId },
      data: {
        state: params.state as any,
        updatedAt: new Date(),
      },
    });

    await this.prisma.aiCopilotTurnEvent.create({
      data: {
        sessionId: params.sessionId,
        messageId: assistantMessage.id,
        eventType: params.response.type,
        latencyMs: Date.now() - params.startedAt,
      },
    });

    return {
      assistantMessage,
      message: assistantMessage,
      response: params.response,
      state: session.state,
      userMessageId: params.userMessageId,
    };
  }

  private responseToolName(response: CopilotResponse): string | null {
    if ('tool_name' in response && response.tool_name) {
      return response.tool_name;
    }
    return null;
  }

  private touchSession(sessionId: number) {
    return this.prisma.aiAgentSession.update({
      where: { id: sessionId },
      data: { updatedAt: new Date() },
    });
  }

  private normalizeState(value: unknown): DecisionContext {
    return this.mergeState(createDefaultCopilotState(), value || {});
  }

  private mergeState(
    state: DecisionContext,
    patch: Partial<DecisionContext>,
  ): DecisionContext {
    return {
      ...state,
      ...patch,
      last_candidates: {
        ...(state.last_candidates || {}),
        ...(patch.last_candidates || {}),
      },
    };
  }

  private statePatchFromToolResult(
    toolName: AiToolName,
    result: unknown,
  ): Partial<DecisionContext> {
    const option = this.toEntityOption(result);

    switch (toolName) {
      case 'create_student':
        return {
          selected_student_id: option?.id || null,
          last_selected_student: option,
          last_created_student: option,
        };
      case 'update_student':
        return {
          selected_student_id: option?.id || null,
          last_selected_student: option,
        };
      case 'create_course':
        return {
          selected_course_id: option?.id || null,
          last_selected_course: option,
          last_created_course: option,
        };
      case 'update_course':
        return {
          selected_course_id: option?.id || null,
          last_selected_course: option,
        };
      case 'create_class':
        return {
          selected_class_id: option?.id || null,
          last_selected_class: option,
          last_created_class: option,
        };
      case 'update_class':
      case 'close_class':
        return {
          selected_class_id: option?.id || null,
          last_selected_class: option,
        };
      case 'assign_student_to_course': {
        const row = (result || {}) as any;
        return {
          selected_student_id: Number(row.studentId ?? row.userId) || null,
          selected_course_id: Number(row.courseId) || null,
          selected_class_id: Number(row.classId) || null,
          last_selected_student: this.toEntityOption(row.user),
          last_selected_course: this.toEntityOption(row.course),
          last_selected_class: this.toEntityOption(row.courseClass),
          last_candidates: { classes: [] },
        };
      }
      default:
        return {};
    }
  }

  private toEntityOption(value: unknown): EntityOption | null {
    if (!value || typeof value !== 'object') return null;
    const row = value as any;
    if (!row.id) return null;
    return {
      id: Number(row.id),
      value: Number(row.id),
      label: String(row.fullName || row.title || row.name || `#${row.id}`),
      description: [row.phone, row.email, row.courseCode, row.classCode]
        .filter(Boolean)
        .join(' | '),
      metadata: row,
    };
  }

  // Match TOÀN CHUỖI sau normalize để tránh false positive kiểu "book" chứa "ok",
  // hoặc "khong dong y" bị hiểu nhầm là "dong y".
  private isConfirmText(content: string): boolean {
    return CONFIRM_KEYWORDS.has(this.normalizeConfirmText(content));
  }

  private isCancelText(content: string): boolean {
    return CANCEL_KEYWORDS.has(this.normalizeConfirmText(content));
  }

  /** Normalize + gộp khoảng trắng để so khớp toàn chuỗi từ khóa confirm/cancel. */
  private normalizeConfirmText(content: string): string {
    return this.normalizeText(content).replace(/\s+/g, ' ');
  }

  private normalizeText(content: string): string {
    return content
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .toLowerCase()
      .trim();
  }
}

const CONFIRM_KEYWORDS = new Set([
  'ok',
  'okay',
  'oke',
  'dong y',
  'xac nhan',
  'confirm',
  'yes',
  'co',
  'duyet',
  'chot',
  'xn',
]);

const CANCEL_KEYWORDS = new Set([
  'huy',
  'cancel',
  'khong',
  'khong dong y',
  'bo qua',
  'thoi',
  'khong lam nua',
]);
