import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
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
  ProactiveSuggestion,
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

  async createSession(
    tenantId: number,
    userId: number,
    dto: CreateCopilotSessionDto,
  ) {
    // Chống session rác: bấm "Chat mới" liên tục mà chưa nhắn gì thì tái sử
    // dụng session ACTIVE trống thay vì tạo bản ghi mới. Reset title + state
    // sạch nên hành vi giống hệt một session vừa tạo.
    const emptyActive = await this.prisma.aiAgentSession.findFirst({
      where: { tenantId, userId, status: 'ACTIVE', messages: { none: {} } },
      orderBy: { updatedAt: 'desc' },
    });
    if (emptyActive) {
      return this.prisma.aiAgentSession.update({
        where: { id: emptyActive.id },
        data: {
          title: dto.title || 'Phiên chat mới',
          state: createDefaultCopilotState() as any,
        },
      });
    }

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

  /**
   * Danh sách session có phân trang (sidebar chỉ hiển thị 1 trang, bấm
   * "Xem thêm" mới tải tiếp). Lấy limit+1 bản ghi để biết còn trang sau
   * hay không mà không cần COUNT riêng.
   */
  async findSessions(
    tenantId: number,
    userId: number,
    pagination?: { limit?: number; offset?: number },
  ) {
    const rawLimit = Number(pagination?.limit);
    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(Math.trunc(rawLimit), 1), 50)
      : 10;
    const rawOffset = Number(pagination?.offset);
    const offset =
      Number.isFinite(rawOffset) && rawOffset > 0 ? Math.trunc(rawOffset) : 0;

    const rows = await this.prisma.aiAgentSession.findMany({
      where: { tenantId, userId },
      // Thêm id làm tiebreaker để thứ tự ổn định giữa các trang khi
      // updatedAt trùng nhau.
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      skip: offset,
      take: limit + 1,
    });

    return { items: rows.slice(0, limit), hasMore: rows.length > limit };
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
      // Session quá cũ nhưng TRỐNG (chưa nhắn gì) -> reset dùng lại luôn,
      // đóng rồi tạo mới chỉ tích thêm session rác CLOSED.
      const messageCount = await this.prisma.aiAgentSessionMessage.count({
        where: { sessionId: active.id },
      });
      if (messageCount === 0) {
        return this.prisma.aiAgentSession.update({
          where: { id: active.id },
          data: {
            title: 'Phiên chat mới',
            state: createDefaultCopilotState() as any,
          },
        });
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

  /**
   * Mở lại phiên đã đóng để user nhắn tiếp trong đoạn chat cũ. State đã được
   * reset sạch lúc close nên không có pending_action cũ nào sống lại — an toàn.
   */
  async reopenSession(tenantId: number, userId: number, id: number) {
    const session = await this.findSession(tenantId, userId, id);
    if (session.status === 'ACTIVE') return session;
    return this.prisma.aiAgentSession.update({
      where: { id },
      data: { status: 'ACTIVE' },
    });
  }

  async renameSession(
    tenantId: number,
    userId: number,
    id: number,
    title: string,
  ) {
    await this.findSession(tenantId, userId, id);
    const trimmed = title.trim();
    if (!trimmed) {
      throw new BadRequestException('Tên phiên chat không được để trống');
    }
    return this.prisma.aiAgentSession.update({
      where: { id },
      data: { title: trimmed },
    });
  }

  async deleteSession(tenantId: number, userId: number, id: number) {
    await this.findSession(tenantId, userId, id);
    return this.prisma.aiAgentSession.delete({ where: { id } });
  }

  /**
   * Tin nhắn của session, mặc định chỉ trả `limit` tin MỚI NHẤT (UI chat mở
   * từ cuối). Truyền `before` (id tin cũ nhất đang hiển thị) để tải trang cũ
   * hơn. Lấy limit+1 để biết còn tin cũ hơn không mà không cần COUNT.
   */
  async findMessages(
    tenantId: number,
    userId: number,
    sessionId: number,
    pagination?: { limit?: number; before?: number },
  ) {
    await this.findSession(tenantId, userId, sessionId);

    const rawLimit = Number(pagination?.limit);
    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(Math.trunc(rawLimit), 1), 200)
      : 50;
    const rawBefore = Number(pagination?.before);
    const before =
      Number.isFinite(rawBefore) && rawBefore > 0 ? Math.trunc(rawBefore) : 0;

    const rows = await this.prisma.aiAgentSessionMessage.findMany({
      where: { sessionId, ...(before ? { id: { lt: before } } : {}) },
      // id autoincrement trùng thứ tự tạo -> sort id desc lấy tin mới nhất,
      // rồi đảo lại thành asc cho UI hiển thị từ trên xuống.
      orderBy: { id: 'desc' },
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    return { items: rows.slice(0, limit).reverse(), hasMore };
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

    // Đang chờ user trả lời sau khi phát hiện trùng học viên: state machine xử lý
    // TRỌN VẸN ở backend (1/2/3, nhập thẳng email/SĐT mới, câu không hiểu) —
    // KHÔNG rơi xuống model để tránh lặp lại cảnh báo trùng.
    if (state.duplicate_student_context) {
      const handled = await this.handleDuplicateStudentReply(
        actor,
        sessionId,
        state,
        content,
        userMessage.id,
        startedAt,
      );
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
      if (state.pending_action) {
        return this.blockNewWriteWhilePending(
          sessionId,
          state,
          userMessage.id,
          startedAt,
        );
      }
      return this.savePendingWriteTurn({
        actor,
        sessionId,
        state,
        pending: suggestionPending,
        userMessageId: userMessage.id,
        startedAt,
      });
    }

    if (state.pending_action) {
      const draftPatch = this.extractPendingDraftPatch(
        state.pending_action.tool_name,
        content,
      );
      if (draftPatch) {
        return this.saveDraftUpdateTurn({
          sessionId,
          state,
          pending: state.pending_action,
          inputPatch: draftPatch,
          userMessageId: userMessage.id,
          startedAt,
        });
      }

      // Bản nháp create_student + user chat thông tin KHÔNG kèm marker
      // ("Hoang Van A, hva@gmail.com, 0987..., 12/03/2000, Ninh Bình")
      // -> parse deterministic rồi merge vào bản nháp thay vì chặn lại.
      // Chỉ nhận khi có tín hiệu cứng (email/sđt/ngày sinh) để câu chat
      // thường không bị hiểu nhầm thành tên.
      if (state.pending_action.tool_name === 'create_student') {
        const parsed = this.deterministic.parseStudentInfo(content);
        if (parsed.email || parsed.phone || parsed.birthDate) {
          const studentPatch: Record<string, unknown> = {};
          if (parsed.fullName) studentPatch.fullName = parsed.fullName;
          if (parsed.email) studentPatch.email = parsed.email;
          if (parsed.phone) studentPatch.phone = parsed.phone;
          if (parsed.birthDate) studentPatch.birthDate = parsed.birthDate;
          if (parsed.address) studentPatch.address = parsed.address;
          return this.saveDraftUpdateTurn({
            sessionId,
            state,
            pending: state.pending_action,
            inputPatch: studentPatch,
            userMessageId: userMessage.id,
            startedAt,
          });
        }
      }

      if (this.isNewWriteIntentWhilePending(content)) {
        return this.blockNewWriteWhilePending(
          sessionId,
          state,
          userMessage.id,
          startedAt,
        );
      }
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
      if (state.pending_action) {
        return this.blockNewWriteWhilePending(
          sessionId,
          state,
          userMessage.id,
          startedAt,
        );
      }
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

    // Mini mode: lớp deterministic vẫn parse được các intent ngoài phạm vi
    // (update_course, create_class...) -> trả lời "chưa được bật" thay vì đi
    // tiếp vào flow đó.
    if (isAgentMiniMode() && this.isOutcomeOutsideMiniScope(outcome)) {
      return this.saveMiniModeBlockedTurn({
        sessionId,
        state,
        userMessageId,
        startedAt,
      });
    }

    if (
      state.pending_action &&
      (outcome.type === 'student_form' ||
        outcome.type === 'course_form' ||
        (outcome.type === 'clarification' && isWriteTool(outcome.intent)))
    ) {
      return this.blockNewWriteWhilePending(
        sessionId,
        state,
        userMessageId,
        startedAt,
      );
    }

    if (outcome.type === 'pending_write') {
      if (state.pending_action) {
        return this.blockNewWriteWhilePending(
          sessionId,
          state,
          userMessageId,
          startedAt,
        );
      }
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

    if (outcome.type === 'student_table') {
      const response: CopilotResponse = {
        type: 'student_table',
        title: outcome.title,
        message: outcome.message,
        scope: outcome.scope,
        students: outcome.students,
      };
      return this.saveAssistantTurn({
        sessionId,
        userMessageId,
        startedAt,
        response,
        state: this.mergeState(state, outcome.contextPatch),
      });
    }

    if (outcome.type === 'class_table') {
      const response: CopilotResponse = {
        type: 'class_table',
        title: outcome.title,
        message: outcome.message,
        classes: outcome.classes,
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
    idempotencyKey?: string,
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
      // Double-submit: confirm thứ 2 tới sau khi pending đã execute + clear.
      // Key khớp với action vừa chạy -> trả thông báo idempotent, KHÔNG ghi DB lần 2.
      if (
        idempotencyKey &&
        state.last_executed_idempotency_key === idempotencyKey
      ) {
        const response: CopilotResponse = {
          type: 'text_message',
          message:
            'Thao tác này vừa được thực hiện rồi, mình không thực hiện lại lần nữa.',
        };
        return this.saveAssistantTurn({
          sessionId,
          startedAt,
          response,
          state,
        });
      }
      throw new BadRequestException('Không có hành động nào đang chờ xác nhận');
    }

    // Confirm gửi key của một bản nháp CŨ (không khớp pending hiện tại) -> chặn,
    // tránh xác nhận nhầm bản nháp đã bị thay thế.
    if (
      idempotencyKey &&
      pending.idempotency_key &&
      idempotencyKey !== pending.idempotency_key
    ) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_MISMATCH',
        message:
          'Bản nháp đã thay đổi so với lúc bạn mở preview. Vui lòng kiểm tra lại bản nháp mới nhất rồi xác nhận.',
      });
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

    const finalInput = this.normalizePendingInput(pending.tool_name, {
      ...(pending.input || {}),
      ...(input || {}),
    });
    const validation = this.validatePendingRequired(
      pending.tool_name,
      finalInput,
    );
    if (validation) {
      const nextPending: PendingAction = {
        ...pending,
        input: finalInput,
        display_input: finalInput,
        status: 'validation_error',
        validation_errors: validation.errors,
      };
      const response: CopilotResponse = {
        ...this.previewResponse(nextPending),
        status: 'validation_error' as const,
        message: validation.message,
      };
      const nextState = this.mergeState(state, {
        pending_action: nextPending,
      });
      return this.saveAssistantTurn({
        sessionId,
        startedAt,
        response,
        state: nextState,
        toolName: pending.tool_name,
      });
    }
    try {
      const result = await this.toolRegistry.execute(
        sessionId,
        actor,
        pending.tool_name,
        finalInput,
      );
      const patch = this.statePatchFromToolResult(pending.tool_name, result);
      // Gợi ý bước tiếp theo: vừa tạo lớp -> gợi ý thêm học viên mới tạo gần
      // đây vào lớp; vừa tạo học viên -> gợi ý thêm vào lớp mới tạo gần nhất.
      const suggestions = await this.buildPostCreateSuggestions(
        actor.tenantId,
        pending.tool_name,
        state,
        patch,
      );
      const response: CopilotResponse = {
        type: 'tool_result',
        message: this.buildToolResultMessage(pending.tool_name, result),
        tool_name: pending.tool_name,
        status: 'SUCCESS',
        result,
        data: result,
        ...(suggestions.length ? { suggestions } : {}),
      };
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
        // Ghi nhớ key vừa execute: confirm lặp lại (double-click) sẽ được trả
        // lời idempotent thay vì ghi DB lần 2.
        last_executed_idempotency_key: pending.idempotency_key || null,
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

  async updatePendingAction(
    actor: ActorPayload,
    sessionId: number,
    body: {
      inputPatch?: Record<string, unknown>;
      input?: Record<string, unknown>;
    },
  ) {
    const session = await this.findActiveSession(
      actor.tenantId,
      actor.userId,
      sessionId,
    );
    const state = this.normalizeState(session.state);
    const pending = state.pending_action;

    if (!pending) {
      throw new BadRequestException({
        code: 'NO_PENDING_ACTION',
        message: 'Không có bản nháp nào đang chờ xác nhận.',
      });
    }

    const mergedInput = this.normalizePendingInput(pending.tool_name, {
      ...(pending.input || {}),
      ...(body.input || {}),
      ...(body.inputPatch || {}),
    });
    const nextPending: PendingAction = {
      ...pending,
      input: mergedInput,
      display_input: mergedInput,
      status: pending.status === 'validation_error' ? 'draft' : pending.status,
      validation_errors: undefined,
    };
    const nextState = this.mergeState(state, {
      pending_action: nextPending,
    });
    const updated = await this.prisma.aiAgentSession.update({
      where: { id: sessionId },
      data: {
        state: nextState as any,
        updatedAt: new Date(),
      },
    });

    return {
      session: updated,
      state: updated.state,
      phase: this.phaseFromState(nextState),
      response: this.previewResponse(nextPending),
    };
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

  private previewResponse(
    pendingAction: PendingAction,
  ): Extract<CopilotResponse, { type: 'preview_card' }> {
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
        bullet('ID', row.id),
      ]
        .filter((line) => line !== null)
        .join('\n');
    }

    if (toolName === 'create_class') {
      const scheduleLines = this.formatClassSessionLines(row.sessions);
      const hasExtra =
        row.teacherName || row.startDate || row.endDate || scheduleLines.length;
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

    if (toolName === 'assign_student_to_class' && row.bulk) {
      // Kết quả GỘP: báo cáo từng dòng ✓ / ⚠ / ✗, không all-or-nothing.
      const className = row.className || `#${row.classId}`;
      const lines = (Array.isArray(row.items) ? row.items : []).map(
        (item: any) => {
          const name = item.studentName || `học viên #${item.userId}`;
          if (item.status === 'SUCCESS') return `✓ ${name} — đã thêm vào lớp`;
          if (item.status === 'ALREADY_IN_CLASS')
            return `⚠ ${name} — đã có trong lớp từ trước`;
          return `✗ ${name} — ${item.message || 'lỗi không xác định'}`;
        },
      );
      return [
        `Đã xử lý ${row.total} học viên cho lớp ${className}: ${row.successCount}/${row.total} thêm thành công.`,
        '',
        ...lines,
      ].join('\n');
    }

    if (toolName === 'assign_student_to_class') {
      const studentName =
        row.user?.fullName || row.user?.name || `#${row.userId}`;
      const className =
        row.courseClass?.title || row.courseClass?.name || `#${row.classId}`;
      const courseName =
        row.courseClass?.course?.title || row.courseClass?.course?.name;
      return [
        'Đã thêm học viên vào lớp thành công.',
        '',
        bullet('Học viên', studentName),
        bullet('Lớp', className),
        bullet('Khóa', courseName),
        bullet('Vai trò', row.roleInClass),
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
      assign_student_to_class: 'Thêm học viên vào lớp học',
      assign_student_to_course: 'Ghi danh học viên vào khóa học',
    };
    return {
      tool_name: action.action,
      input: action.input || {},
      display_input: action.input || {},
      summary: summaries[action.action] || `Chuẩn bị chạy ${action.action}`,
      intent: action.action,
      status: 'waiting_confirm',
      source: action.source,
      draftId: action.draftId,
      severity: ['delete_students', 'delete_courses', 'close_class'].includes(
        action.action,
      )
        ? 'danger'
        : 'default',
    };
  }

  private async saveDraftUpdateTurn(params: {
    sessionId: number;
    state: DecisionContext;
    pending: PendingAction;
    inputPatch: Record<string, unknown>;
    userMessageId?: number;
    startedAt: number;
  }) {
    const input = this.normalizePendingInput(params.pending.tool_name, {
      ...(params.pending.input || {}),
      ...params.inputPatch,
    });
    const nextPending: PendingAction = {
      ...params.pending,
      input,
      display_input: input,
      status: 'draft',
      validation_errors: undefined,
    };
    const response: CopilotResponse = {
      ...this.previewResponse(nextPending),
      message:
        'Mình đã cập nhật bản nháp. Bạn kiểm tra lại rồi bấm Xác nhận nếu đúng.',
    };
    return this.saveAssistantTurn({
      sessionId: params.sessionId,
      userMessageId: params.userMessageId,
      startedAt: params.startedAt,
      response,
      state: this.mergeState(params.state, {
        pending_action: nextPending,
      }),
      toolName: params.pending.tool_name,
    });
  }

  private blockNewWriteWhilePending(
    sessionId: number,
    state: DecisionContext,
    userMessageId: number | undefined,
    startedAt: number,
  ) {
    const response: CopilotResponse = {
      type: 'clarification',
      message:
        'Bạn đang có một bản nháp chưa xác nhận. Bạn muốn xác nhận, hủy, sửa bản nháp hiện tại hay tạo thao tác mới?',
      missing_fields: [],
      intent: state.pending_action?.tool_name || 'unknown',
      entities: {},
    };
    return this.saveAssistantTurn({
      sessionId,
      userMessageId,
      startedAt,
      response,
      state,
    });
  }

  private extractPendingDraftPatch(
    toolName: AiToolName,
    content: string,
  ): Record<string, unknown> | null {
    const patch: Record<string, unknown> = {};
    if (toolName === 'create_student') {
      this.assignMatchedValue(patch, 'email', content, [
        'sửa email thành',
        'đổi email thành',
        'email là',
        'email:',
      ]);
      this.assignMatchedValue(patch, 'fullName', content, [
        'sửa tên thành',
        'đổi tên thành',
        'họ tên là',
        'tên là',
      ]);
      this.assignMatchedValue(patch, 'phone', content, [
        'số điện thoại là',
        'sdt là',
        'sđt là',
        'phone là',
      ]);
      this.assignMatchedValue(patch, 'birthDate', content, ['ngày sinh là']);
      this.assignMatchedValue(patch, 'address', content, ['địa chỉ là']);
      // "ngày sinh là 17/07/1998" -> chuẩn hóa về ISO cho Prisma.
      if (typeof patch.birthDate === 'string') {
        const iso = this.deterministic.parseViDate(patch.birthDate);
        if (iso) patch.birthDate = iso;
      }
    }

    if (toolName === 'create_course') {
      this.assignMatchedValue(patch, 'title', content, [
        'đổi tên khóa thành',
        'tên khóa là',
      ]);
      this.assignMatchedValue(patch, 'courseCode', content, [
        'mã khóa là',
        'mã khóa học là',
      ]);
      this.assignMatchedValue(patch, 'level', content, [
        'cấp độ là',
        'level là',
      ]);
      this.assignMatchedValue(patch, 'description', content, ['mô tả là']);
      // Khóa học KHÔNG có ngày bắt đầu/kết thúc — ngày chỉ thuộc lớp học.
    }

    if (toolName === 'create_class' || toolName === 'update_class') {
      this.assignMatchedValue(patch, 'title', content, [
        'đổi tên lớp thành',
        'tên lớp là',
      ]);
      this.assignMatchedValue(patch, 'classCode', content, ['mã lớp là']);
      this.assignMatchedValue(patch, 'teacherName', content, ['giáo viên là']);
      this.assignMatchedValue(patch, 'description', content, ['mô tả là']);
      // Ngày: hiểu cả "ngày bắt đầu là ...", "từ hôm nay đến ngày 30/07"...
      // ("hôm nay" = ngày hiện tại, thiếu năm -> năm hiện tại). Luôn trả ISO.
      const range = this.deterministic.parseClassDateRange(content);
      if (range.startDate) patch.startDate = range.startDate;
      if (range.endDate) patch.endDate = range.endDate;
      this.assignMatchedValue(patch, 'courseId', content, [
        'courseid là',
        'mã khóa là',
        'chọn khóa',
        'thuộc khóa',
      ]);
      const classType = this.extractClassType(content);
      if (classType) patch.classType = classType;
    }

    return Object.keys(patch).length > 0 ? patch : null;
  }

  private assignMatchedValue(
    patch: Record<string, unknown>,
    key: string,
    content: string,
    markers: string[],
  ) {
    const value = this.extractValueAfterMarker(content, markers);
    if (value === null) return;
    patch[key] =
      key === 'courseId' ? Number(value.replace(/\D/g, '')) || value : value;
  }

  // Tất cả marker của mọi field: dùng để CẮT value tại marker kế tiếp
  // ("tên là A, sdt là 09..." -> tên chỉ lấy "A", không ăn cả phần sdt).
  private static readonly DRAFT_FIELD_MARKERS = [
    'sửa email thành',
    'đổi email thành',
    'email là',
    'email:',
    'sửa tên thành',
    'đổi tên thành',
    'họ tên là',
    'tên là',
    'số điện thoại là',
    'sdt là',
    'sđt là',
    'phone là',
    'ngày sinh là',
    'địa chỉ là',
    'đổi tên khóa thành',
    'tên khóa là',
    'mã khóa là',
    'mã khóa học là',
    'cấp độ là',
    'level là',
    'mô tả là',
    'ngày bắt đầu là',
    'ngày kết thúc là',
    'đổi tên lớp thành',
    'tên lớp là',
    'mã lớp là',
    'giáo viên là',
    'courseid là',
    'chọn khóa',
    'thuộc khóa',
  ];

  /** Segment (ngăn bởi dấu phẩy) trông như dữ liệu field khác (email/sđt/ngày)? */
  private looksLikeFieldData(segment: string) {
    if (!segment) return false;
    if (/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(segment)) return true;
    if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}$/.test(segment)) return true;
    const digits = segment.replace(/\D/g, '');
    if (
      digits.length >= 9 &&
      digits.length <= 12 &&
      /^[\d\s+.()\-]+$/.test(segment)
    ) {
      return true;
    }
    return false;
  }

  private extractValueAfterMarker(content: string, markers: string[]) {
    const lower = content.toLowerCase();
    for (const marker of markers) {
      const index = lower.indexOf(marker);
      if (index < 0) continue;
      let value = content
        .slice(index + marker.length)
        .trim()
        .replace(/^[:=\-\s]+/, '')
        .trim();

      // Value kết thúc TRƯỚC marker của field khác trong cùng câu.
      const valueLower = value.toLowerCase();
      let cut = value.length;
      for (const other of CopilotService.DRAFT_FIELD_MARKERS) {
        const otherIndex = valueLower.indexOf(other);
        if (otherIndex >= 0 && otherIndex < cut) cut = otherIndex;
      }
      value = value.slice(0, cut);

      // Bỏ các đoạn đuôi sau dấu phẩy trông như dữ liệu field khác
      // ("tên là A, 0987xxxxxx" -> tên chỉ giữ "A").
      const segments = value.split(',').map((s) => s.trim());
      const kept: string[] = [];
      for (const segment of segments) {
        if (kept.length > 0 && this.looksLikeFieldData(segment)) break;
        if (segment) kept.push(segment);
      }
      value = kept
        .join(', ')
        .replace(/[\s,;:]+$/, '')
        .trim();
      return value || null;
    }
    return null;
  }

  private extractClassType(content: string) {
    const text = this.normalizeVietnamese(content);
    if (text.includes('theo tuan') || text.includes('weekly')) {
      return 'WEEKLY';
    }
    if (
      text.includes('luyen de') ||
      text.includes('exam prep') ||
      text.includes('exam practice')
    ) {
      return 'EXAM_PRACTICE';
    }
    return null;
  }

  private normalizePendingInput(
    toolName: AiToolName,
    input: Record<string, unknown>,
  ) {
    if (toolName !== 'create_class') return input;
    const next = { ...input };
    const classType = this.extractInputString(next.classType ?? next.type);
    const normalizedType = classType ? this.normalizeClassType(classType) : '';
    if (normalizedType) {
      next.classType = normalizedType;
      next.type = normalizedType;
    }
    return next;
  }

  private normalizeClassType(value: string) {
    const text = this.normalizeVietnamese(value);
    if (text === 'weekly' || text.includes('theo tuan')) return 'WEEKLY';
    if (
      text === 'exam_prep' ||
      text === 'exam prep' ||
      text === 'exam_practice' ||
      text === 'exam practice' ||
      text.includes('luyen de')
    ) {
      return 'EXAM_PRACTICE';
    }
    return value;
  }

  private validatePendingRequired(
    toolName: AiToolName,
    input: Record<string, unknown>,
  ): { message: string; errors: Record<string, string> } | null {
    const hasText = (key: string) =>
      Boolean(this.extractInputString(input[key]));
    if (toolName === 'create_student' && !hasText('fullName')) {
      return {
        message: 'Vui lòng nhập họ và tên học viên.',
        errors: { fullName: 'Vui lòng nhập họ và tên học viên.' },
      };
    }
    if (toolName === 'create_course' && !hasText('title')) {
      return {
        message: 'Vui lòng nhập tên khóa học.',
        errors: { title: 'Vui lòng nhập tên khóa học.' },
      };
    }
    if (toolName === 'create_class') {
      if (!Number(input.courseId || 0)) {
        return {
          message: 'Vui lòng chọn khóa học.',
          errors: { courseId: 'Vui lòng chọn khóa học.' },
        };
      }
      if (!hasText('title')) {
        return {
          message: 'Vui lòng nhập tên lớp học.',
          errors: { title: 'Vui lòng nhập tên lớp học.' },
        };
      }
      if (!hasText('classType') && !hasText('type')) {
        return {
          message: 'Vui lòng chọn loại lớp.',
          errors: { classType: 'Vui lòng chọn loại lớp.' },
        };
      }
    }
    if (toolName === 'assign_student_to_class') {
      const hasBulkUsers =
        Array.isArray(input.userIds) &&
        input.userIds.some((id) => Number(id) > 0);
      if (!hasBulkUsers && !Number(input.userId || 0)) {
        return {
          message: 'Vui lòng chọn học viên.',
          errors: { userId: 'Vui lòng chọn học viên.' },
        };
      }
      if (!Number(input.classId || 0)) {
        return {
          message: 'Vui lòng chọn lớp học.',
          errors: { classId: 'Vui lòng chọn lớp học.' },
        };
      }
    }
    return null;
  }

  private isNewWriteIntentWhilePending(content: string) {
    const text = this.normalizeVietnamese(content);
    return [
      'tao hoc vien',
      'tao khoa',
      'tao lop',
      'ghi danh',
      'them ',
      'xoa ',
      'cap nhat',
      'sua hoc vien',
      'sua khoa',
      'sua lop',
    ].some((keyword) => text.includes(keyword));
  }

  private normalizeVietnamese(content: string) {
    return content
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Outcome deterministic có thuộc nghiệp vụ NGOÀI phạm vi mini không. */
  private isOutcomeOutsideMiniScope(outcome: DeterministicOutcome): boolean {
    if (
      outcome.type === 'pending_write' &&
      !isToolAllowedInMiniMode(outcome.pending.tool_name)
    ) {
      return true;
    }
    if (
      outcome.type === 'clarification' &&
      isWriteTool(outcome.intent) &&
      !isToolAllowedInMiniMode(outcome.intent)
    ) {
      return true;
    }
    return false;
  }

  /**
   * Preview update_student/update_course/update_class: lấy dữ liệu hiện tại của
   * thực thể (theo tenant) làm nền cho display_input, field user muốn đổi đè lên.
   * Chỉ phục vụ HIỂN THỊ form; input ghi DB vẫn tối thiểu. Lỗi -> giữ display cũ.
   */
  private async enrichUpdateDisplayInput(
    tenantId: number,
    pending: PendingAction,
  ): Promise<Record<string, unknown>> {
    const display = { ...(pending.display_input || pending.input || {}) };
    const input = pending.input || {};
    const toDateStr = (value: unknown) => {
      if (!value) return '';
      const date = value instanceof Date ? value : new Date(String(value));
      return Number.isNaN(date.getTime())
        ? ''
        : date.toISOString().substring(0, 10);
    };

    try {
      if (pending.tool_name === 'update_class') {
        const id = Number(input.classId) || 0;
        if (!id) return display;
        const cls = await this.prisma.courseClass.findFirst({
          where: { id, tenantId },
          include: { course: true },
        });
        if (!cls) return display;
        return {
          title: cls.title,
          classCode: cls.classCode,
          classType: cls.type,
          teacherName: cls.teacherName || '',
          startDate: toDateStr(cls.startDate),
          endDate: toDateStr(cls.endDate),
          status: cls.status,
          description: cls.description || '',
          className: cls.title,
          courseName: cls.course?.title || '',
          ...display,
        };
      }

      if (pending.tool_name === 'update_course') {
        const id = Number(input.courseId) || 0;
        if (!id) return display;
        const course = await this.prisma.course.findFirst({
          where: { id, tenantId },
        });
        if (!course) return display;
        return {
          title: course.title,
          courseCode: course.courseCode,
          level: course.level || '',
          description: course.description || '',
          courseName: course.title,
          ...display,
        };
      }

      if (pending.tool_name === 'update_student') {
        const id = Number(input.userId ?? input.studentId) || 0;
        if (!id) return display;
        const student = await this.prisma.user.findFirst({
          where: { id, tenantId, role: 'STUDENT' },
        });
        if (!student) return display;
        return {
          fullName: student.fullName,
          email: student.email || '',
          phone: student.phone || '',
          birthDate: toDateStr(student.birthDate),
          address: student.address || '',
          studentName: student.fullName,
          ...display,
        };
      }
    } catch {
      return display;
    }
    return display;
  }

  /** Turn trả lời chuẩn khi user yêu cầu nghiệp vụ ngoài phạm vi bản mini. */
  private saveMiniModeBlockedTurn(params: {
    sessionId: number;
    state: DecisionContext;
    userMessageId?: number;
    startedAt: number;
  }) {
    const response: CopilotResponse = {
      type: 'text_message',
      message:
        'Chức năng này chưa được bật trong bản Copilot mini. ' +
        'Mình chỉ hỗ trợ: tạo học viên, tạo khóa học, tạo lớp học trong khóa, thêm học viên vào lớp học và sửa thông tin học viên/khóa học/lớp học.',
    };
    return this.saveAssistantTurn({
      sessionId: params.sessionId,
      userMessageId: params.userMessageId,
      startedAt: params.startedAt,
      response,
      state: this.mergeState(params.state, {
        pending_class_creation: null,
        pending_clarification: null,
      }),
    });
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

    // Guard mini mode NGAY khi tạo pending (mọi nguồn: LLM, suggestion,
    // deterministic, state cũ): tool ngoài 3 nghiệp vụ không được tạo preview.
    if (isAgentMiniMode() && !isToolAllowedInMiniMode(pending.tool_name)) {
      return this.saveMiniModeBlockedTurn({
        sessionId,
        state,
        userMessageId,
        startedAt,
      });
    }

    // Chuẩn hóa input cho MỌI nguồn pending (LLM/deterministic/suggestion):
    // create_class luôn có cả `type` lẫn `classType` để form FE prefill
    // đúng select "Loại lớp" ("theo tuần" -> WEEKLY, "luyện đề" -> EXAM_PRACTICE).
    pending.input = this.normalizePendingInput(
      pending.tool_name,
      pending.input || {},
    );
    pending.display_input = this.normalizePendingInput(
      pending.tool_name,
      pending.display_input || pending.input,
    );

    // Preview update_*: điền giá trị HIỆN TẠI của thực thể vào display_input để
    // form không trống trơn; pending.input giữ nguyên (chỉ chứa field cần đổi).
    pending.display_input = await this.enrichUpdateDisplayInput(
      actor.tenantId,
      pending,
    );

    // Mỗi pending có idempotency key riêng để confirm chống double-submit.
    if (!pending.idempotency_key) {
      pending.idempotency_key = randomUUID();
    }

    if (pending.tool_name === 'create_student') {
      const email = this.extractInputString(pending.input.email);
      const phone = this.extractInputString(pending.input.phone);
      const duplicate =
        await this.usersService.findDuplicateStudentByEmailOrPhone(
          actor.tenantId,
          { email, phone },
        );

      if (duplicate) {
        const conflictFields: Array<'email' | 'phone'> = [];
        if (
          email &&
          duplicate.email &&
          email.toLowerCase() === String(duplicate.email).toLowerCase()
        ) {
          conflictFields.push('email');
        }
        if (
          phone &&
          duplicate.phone &&
          phone.replace(/\D/g, '') ===
            String(duplicate.phone).replace(/\D/g, '')
        ) {
          conflictFields.push('phone');
        }
        if (conflictFields.length === 0) {
          conflictFields.push(email ? 'email' : 'phone');
        }

        const duplicateContext: DuplicateStudentContext = {
          searched_email: email,
          searched_phone: phone,
          existing_student: this.toStudentEntityOption(duplicate),
          intended_action: 'create',
          status: 'waiting_choice',
          original_input: { ...(pending.input || {}) },
          conflict_fields: conflictFields,
        };
        const message = this.buildDuplicateStudentMessage(duplicateContext);
        const response: CopilotResponse = {
          type: 'clarification',
          message,
          missing_fields: [],
          intent: 'create_student',
          entities: { duplicate_student_context: duplicateContext },
          clarification_type: 'target_disambiguation',
          options: DUPLICATE_CHOICE_OPTIONS,
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
   * State machine xử lý câu trả lời của user khi đang có duplicate_student_context.
   * LUÔN xử lý ở backend, KHÔNG rơi xuống model — tránh model lặp lại cảnh báo trùng.
   * - Option 1 (hoặc "dùng học viên có sẵn"): chọn học viên cũ, trả card thông tin.
   * - Option 2 (hoặc nhập thẳng email/SĐT mới): giữ tên/ngày sinh/địa chỉ cũ,
   *   patch contact mới, re-check trùng rồi trả preview (KHÔNG ghi DB).
   * - Option 3 (hoặc hủy): clear context.
   * - Không hiểu: nhắc lại menu 1/2/3.
   */
  private async handleDuplicateStudentReply(
    actor: ActorPayload,
    sessionId: number,
    state: DecisionContext,
    content: string,
    userMessageId: number,
    startedAt: number,
  ) {
    const dup = state.duplicate_student_context;
    if (!dup) return null;

    const normalized = this.normalizeConfirmText(content);
    const choice = this.parseDuplicateChoice(normalized);

    // Option 3: hủy
    if (
      choice === 3 ||
      this.isCancelText(content) ||
      ['thoat', 'bo qua', 'huy thao tac'].includes(normalized)
    ) {
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

    // Option 1: dùng học viên có sẵn -> trả card thông tin + gợi ý tiếp theo.
    if (choice === 1 || this.isUseExistingStudentText(content)) {
      const existing = dup.existing_student;
      const metadata = existing.metadata;
      const studentRecord =
        metadata && typeof metadata === 'object' && !Array.isArray(metadata)
          ? metadata
          : {
              id: existing.id,
              fullName: existing.label,
              email: existing.email ?? null,
              phone: existing.phone ?? null,
            };
      const response: CopilotResponse = {
        type: 'tool_result',
        tool_name: 'search_student',
        status: 'SUCCESS',
        message:
          'Đã chọn học viên có sẵn này. Bạn muốn dùng học viên này để làm gì?',
        result: studentRecord,
        suggestions: [
          {
            id: 'duplicate-use-existing-enroll',
            title: 'Thêm học viên này vào lớp học',
            message: `Thêm ${existing.label} vào một lớp học có sẵn.`,
            intent: 'assign_student_to_class',
            draft_message: `Thêm học viên ${existing.label} #${existing.id} vào lớp học`,
            priority: 1,
          },
          {
            id: 'duplicate-use-existing-create-new',
            title: 'Tạo học viên mới bằng email/SĐT khác',
            message: 'Mở form tạo học viên mới.',
            intent: 'create_student',
            draft_message: 'Tạo học viên mới',
            priority: 2,
          },
        ],
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

    // User nhập thẳng email/SĐT mới (ở bất kỳ status nào) -> hiểu là option 2.
    const contact = this.extractContactFromText(content);
    if (contact.email || contact.phone) {
      return this.retryCreateStudentWithNewContact({
        actor,
        sessionId,
        state,
        dup,
        contact,
        userMessageId,
        startedAt,
      });
    }

    // Option 2 nhưng CHƯA kèm email/SĐT -> mời nhập, giữ context chờ contact mới.
    if (choice === 2 || this.isNewContactIntentText(normalized)) {
      const original = dup.original_input || {};
      const heldName = this.extractInputString(original.fullName);
      const heldBirthDate = this.extractInputString(original.birthDate);
      const heldAddress = this.extractInputString(original.address);
      const heldLines = [
        `- Tên: ${heldName || 'Chưa có'}`,
        ...(heldBirthDate ? [`- Ngày sinh: ${heldBirthDate}`] : []),
        ...(heldAddress ? [`- Địa chỉ: ${heldAddress}`] : []),
      ];
      const response: CopilotResponse = {
        type: 'clarification',
        message: [
          'Mời bạn nhập email hoặc SĐT mới để tạo học viên mới.',
          '',
          'Thông tin đang giữ:',
          ...heldLines,
          '',
          'Bạn có thể nhập ví dụ:',
          '- newemail@example.com',
          '- 0987654321',
          '- newemail@example.com, 0987654321',
        ].join('\n'),
        missing_fields: [],
        intent: 'create_student',
        entities: {},
      };
      const nextState = this.mergeState(state, {
        duplicate_student_context: {
          ...dup,
          status: 'waiting_new_contact',
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

    // Không hiểu -> nhắc lại menu, KHÔNG gọi model, KHÔNG ghi DB.
    const response: CopilotResponse = {
      type: 'clarification',
      message: [
        'Mình chưa hiểu lựa chọn của bạn.',
        '',
        'Vui lòng chọn:',
        '1. Dùng học viên có sẵn này',
        '2. Nhập email/SĐT khác để tạo học viên mới',
        '3. Hủy thao tác',
        '',
        'Hoặc bạn có thể nhập thẳng email/SĐT mới.',
      ].join('\n'),
      missing_fields: [],
      intent: 'create_student',
      entities: {},
      clarification_type: 'target_disambiguation',
      options: DUPLICATE_CHOICE_OPTIONS,
    };
    return this.saveAssistantTurn({
      sessionId,
      userMessageId,
      startedAt,
      response,
      state,
    });
  }

  /** "1" | "so 2" | "option 3" | "chon 1"... -> 1 | 2 | 3, khác -> null. */
  private parseDuplicateChoice(normalized: string): 1 | 2 | 3 | null {
    const match = normalized.match(/^(?:so|option|chon|lua chon)?\s*([123])$/);
    if (!match) return null;
    return Number(match[1]) as 1 | 2 | 3;
  }

  /** User muốn nhập email/SĐT khác nhưng chưa gõ contact mới. */
  private isNewContactIntentText(normalized: string): boolean {
    return [
      'nhap email',
      'nhap sdt',
      'nhap so dien thoai',
      'email khac',
      'sdt khac',
      'so dien thoai khac',
      'so khac',
      'tao moi',
      'tao hoc vien moi',
      'dung email khac',
      'dung sdt khac',
    ].some((keyword) => normalized.includes(keyword));
  }

  /** Tìm email/SĐT trong câu tự do ("email là x@y.com", "sdt mới 0987..."). */
  private extractContactFromText(content: string): {
    email?: string;
    phone?: string;
  } {
    const result: { email?: string; phone?: string } = {};
    const emailMatch = content.match(
      /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,
    );
    if (emailMatch) result.email = emailMatch[0];

    const withoutEmail = emailMatch
      ? content.replace(emailMatch[0], ' ')
      : content;
    for (const token of withoutEmail.split(/[,;\s]+/)) {
      if (!token || /[a-zA-Z@\/]/.test(token)) continue;
      const digits = token.replace(/\D/g, '');
      if (digits.length >= 9 && digits.length <= 12) {
        result.phone = digits;
        break;
      }
    }
    return result;
  }

  /**
   * Option 2 kèm contact mới: giữ tên/ngày sinh/địa chỉ từ original_input, patch
   * email/SĐT mới rồi đi lại luồng preview chuẩn (savePendingWriteTurn tự
   * re-check trùng: còn trùng -> hỏi lại 1/2/3 với học viên trùng mới; hết trùng
   * -> preview_card chờ confirm). KHÔNG ghi DB ở bước này.
   */
  private async retryCreateStudentWithNewContact(params: {
    actor: ActorPayload;
    sessionId: number;
    state: DecisionContext;
    dup: DuplicateStudentContext;
    contact: { email?: string; phone?: string };
    userMessageId: number;
    startedAt: number;
  }) {
    const { actor, sessionId, state, dup, contact, userMessageId, startedAt } =
      params;
    const input: Record<string, unknown> = {
      ...(dup.original_input || {}),
    };
    if (contact.email) input.email = contact.email;
    if (contact.phone) input.phone = contact.phone;

    const fullName = this.extractInputString(input.fullName);
    const pending: PendingAction = {
      tool_name: 'create_student',
      input,
      display_input: input,
      summary: fullName ? `Tạo học viên mới: ${fullName}` : 'Tạo học viên mới',
      intent: 'create_student',
      status: 'waiting_confirm',
      severity: 'default',
    };
    const clearedState = this.mergeState(state, {
      duplicate_student_context: null,
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

    // Đang chờ chọn HỌC VIÊN (nhiều người trùng tên): resolve theo số thứ
    // tự/tên rồi đi tiếp phần đích ghi danh đã lưu — không rơi xuống LLM.
    // Hỗ trợ chọn NHIỀU người cùng lúc ("1,3,5") -> bản nháp ghi danh gộp.
    if (!ctx.userId && ctx.candidateStudents?.length) {
      const chosenStudents = this.resolveMultiChoice(
        content,
        ctx.candidateStudents,
      );
      if (!chosenStudents?.length) return null;

      let outcome: DeterministicOutcome | null = null;
      try {
        const picked = chosenStudents.map((option) => ({
          id: Number(option.id),
          label: option.label,
        }));
        outcome = await this.deterministic.resolveEnrollStudentReply(
          actor.tenantId,
          state,
          ctx,
          picked.length === 1 ? picked[0] : picked,
        );
      } catch {
        outcome = null;
      }
      if (!outcome) return null;

      const basePatch: Partial<DecisionContext> = {
        pending_enrollment_context: null,
        pending_clarification: null,
        ...(chosenStudents.length === 1
          ? { selected_student_id: Number(chosenStudents[0].id) }
          : {}),
      };
      if (outcome.type === 'pending_write') {
        return this.savePendingWriteTurn({
          actor,
          sessionId,
          state: this.mergeState(state, basePatch),
          pending: outcome.pending,
          userMessageId,
          startedAt,
          contextPatch: outcome.contextPatch,
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
          : { type: 'text_message', message: (outcome as any).message };
      return this.saveAssistantTurn({
        sessionId,
        userMessageId,
        startedAt,
        response,
        state: this.mergeState(state, {
          ...basePatch,
          ...outcome.contextPatch,
        }),
      });
    }

    const chosen = this.resolveClassChoice(content, ctx.candidateClasses || []);
    if (!chosen) {
      // Không xác định được lớp -> để agent xử lý tiếp, giữ context.
      return null;
    }

    // Đã có classId cụ thể -> dùng assign_student_to_class (ghi danh luôn ở cấp
    // lớp; _to_course còn bị chặn trong mini mode nên pending đó không confirm được).
    // courseId trong context có thể là 0 (các lớp trùng tên thuộc nhiều khóa) ->
    // suy khóa thật từ lớp user vừa chọn.
    const chosenMeta = (chosen.metadata || {}) as Record<string, any>;
    const courseId =
      Number(chosenMeta.courseId ?? chosenMeta.course?.id) ||
      ctx.courseId ||
      null;
    const isBulk = Array.isArray(ctx.userIds) && ctx.userIds.length > 1;
    const bulkStudents = isBulk
      ? ctx.userIds!.map((id, index) => ({
          id,
          label: ctx.studentLabels?.[index] || `#${id}`,
          email: null,
        }))
      : [];
    const pending: PendingAction = isBulk
      ? {
          tool_name: 'assign_student_to_class',
          input: {
            userIds: ctx.userIds,
            classId: chosen.id,
          },
          display_input: {
            userIds: ctx.userIds,
            ...(courseId ? { courseId } : {}),
            classId: chosen.id,
            className: chosen.label,
            students: bulkStudents,
          },
          summary: `Thêm ${ctx.userIds!.length} học viên (${bulkStudents.map((s) => s.label).join(', ')}) vào lớp ${chosen.label}`,
          intent: 'assign_student_to_class',
          status: 'waiting_confirm',
          severity: 'default',
        }
      : {
          tool_name: 'assign_student_to_class',
          input: {
            userId: ctx.userId,
            classId: chosen.id,
          },
          display_input: {
            userId: ctx.userId,
            ...(courseId ? { courseId } : {}),
            classId: chosen.id,
            className: chosen.label,
          },
          summary: `Thêm học viên #${ctx.userId} vào lớp ${chosen.label}${courseId ? ` (khóa #${courseId})` : ''}`,
          intent: 'assign_student_to_class',
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
   * Xử lý câu trả lời của user khi đang có pending_class_creation:
   * - Hủy -> clear context.
   * - Chưa biết khóa (courseId = 0) -> câu trả lời là TÊN KHÓA: tìm khóa thật,
   *   giữ nguyên bản nháp (tên/loại/ngày) rồi đi tiếp (preview hoặc hỏi tên lớp).
   * - Đã biết khóa -> câu trả lời là TÊN LỚP: tạo preview create_class NGAY.
   * - Trống -> hỏi lại, giữ context.
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

    // Bản nháp chưa có khóa -> hiểu câu trả lời là tên khóa học.
    if (!ctx.courseId) {
      let outcome: DeterministicOutcome | null = null;
      try {
        outcome = await this.deterministic.resolveClassCourseReply(
          actor.tenantId,
          ctx,
          content,
        );
      } catch {
        outcome = null;
      }
      // Không xử lý được -> để LLM lo (context đã có trong prompt).
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
      const response: CopilotResponse =
        outcome.type === 'clarification'
          ? {
              type: 'clarification',
              message: outcome.message,
              missing_fields: outcome.missingFields,
              intent: outcome.intent,
              entities: {},
            }
          : { type: 'text_message', message: (outcome as any).message };
      return this.saveAssistantTurn({
        sessionId,
        userMessageId,
        startedAt,
        response,
        state: this.mergeState(state, outcome.contextPatch),
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
      teacherName: ctx.teacherName ?? undefined,
      startDate: ctx.startDate ?? undefined,
      endDate: ctx.endDate ?? undefined,
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

  /**
   * Chọn NHIỀU mục theo số thứ tự: "1,3,5", "1 3 5", "1 và 3", "chọn 1, 2".
   * Câu chỉ gồm số + ngăn cách/liên từ -> lấy tất cả số hợp lệ (khử trùng).
   * Không phải dạng đó -> fallback chọn 1 mục theo số/tên (resolveClassChoice).
   */
  private resolveMultiChoice(
    content: string,
    candidates: EntityOption[],
  ): EntityOption[] | null {
    if (!candidates.length) return null;
    const text = this.normalizeText(content);
    const stripped = text
      .replace(/\b(chon|so|nguoi|hoc vien|va|and|them|ca)\b/g, ' ')
      .trim();
    if (stripped && /^[\d\s,.;+&-]+$/.test(stripped)) {
      const numbers = stripped.match(/\d{1,2}/g) || [];
      const indexes = [
        ...new Set(numbers.map((value) => parseInt(value, 10))),
      ].filter((value) => value >= 1 && value <= candidates.length);
      if (indexes.length) {
        return indexes.map((value) => candidates[value - 1]);
      }
    }
    const single = this.resolveClassChoice(content, candidates);
    return single ? [single] : null;
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
      // Phase kiểu FluentGo cho FE: PREVIEW -> khóa composer chờ confirm/cancel.
      phase: this.phaseFromState(params.state),
      userMessageId: params.userMessageId,
    };
  }

  /**
   * Suy ra phase phiên chat theo mô hình FluentGo từ state hiện tại:
   * - PREVIEW: có pending_action chờ xác nhận (composer nên bị khóa).
   * - DISAMBIGUATION: đang chờ user chọn/làm rõ (trùng học viên, chọn lớp...).
   * - IDLE: sẵn sàng nhận yêu cầu mới.
   */
  private phaseFromState(
    state: DecisionContext,
  ): 'IDLE' | 'DISAMBIGUATION' | 'PREVIEW' {
    if (state.pending_action) return 'PREVIEW';
    if (
      state.duplicate_student_context ||
      state.pending_enrollment_context ||
      state.pending_class_creation ||
      state.pending_clarification
    ) {
      return 'DISAMBIGUATION';
    }
    return 'IDLE';
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
      case 'assign_student_to_class': {
        const row = (result || {}) as any;
        // Kết quả GỘP nhiều học viên: chỉ chốt ngữ cảnh LỚP (không có "học
        // viên vừa chọn" duy nhất).
        if (row.bulk) {
          return {
            selected_class_id: Number(row.classId) || null,
            selected_course_id: Number(row.courseId) || null,
            last_candidates: { classes: [] },
          };
        }
        // Kết quả từ addStudentToClass: enrollment kèm user + courseClass.course.
        return {
          selected_student_id: Number(row.userId) || null,
          selected_class_id: Number(row.classId) || null,
          selected_course_id:
            Number(row.courseClass?.courseId ?? row.courseClass?.course?.id) ||
            null,
          last_selected_student: this.toEntityOption(row.user),
          last_selected_class: this.toEntityOption(row.courseClass),
          last_selected_course: this.toEntityOption(row.courseClass?.course),
          last_candidates: { classes: [] },
        };
      }
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

  /**
   * Gợi ý bước tiếp theo sau khi CONFIRM tạo thành công:
   * - create_class -> gợi ý thêm học viên tạo gần đây nhất vào lớp vừa tạo.
   * - create_student -> gợi ý thêm học viên vừa tạo vào lớp tạo gần đây nhất.
   * Ưu tiên thực thể trong ngữ cảnh phiên chat, không có thì lấy bản ghi mới
   * nhất trong DB. Không tìm được ứng viên -> không gợi ý gì.
   */
  private async buildPostCreateSuggestions(
    tenantId: number,
    toolName: AiToolName,
    state: DecisionContext,
    patch: Partial<DecisionContext>,
  ): Promise<ProactiveSuggestion[]> {
    try {
      if (toolName === 'create_class') {
        const newClass = patch.last_created_class;
        if (!newClass?.id) return [];
        const student =
          state.last_created_student ||
          state.last_selected_student ||
          (await this.findLatestStudentOption(tenantId));
        if (!student?.id) return [];
        return [
          {
            id: `post-create-class-enroll-${newClass.id}`,
            title: `Thêm học viên vào lớp ${newClass.label}`,
            message: `Gợi ý: thêm ${student.label} — học viên tạo gần đây — vào lớp này.`,
            intent: 'assign_student_to_class',
            draft_message: `Thêm học viên ${student.label} #${student.id} vào lớp ${newClass.label}`,
            priority: 1,
            action: {
              type: 'suggestion_action',
              action: 'assign_student_to_class',
              input: {
                userId: Number(student.id),
                classId: Number(newClass.id),
              },
              source: 'post_create_class_suggestion',
            },
          },
        ];
      }

      if (toolName === 'create_student') {
        const newStudent = patch.last_created_student;
        if (!newStudent?.id) return [];
        const cls =
          state.last_created_class ||
          state.last_selected_class ||
          (await this.findLatestClassOption(tenantId));
        if (!cls?.id) return [];
        return [
          {
            id: `post-create-student-enroll-${newStudent.id}`,
            title: `Thêm ${newStudent.label} vào lớp ${cls.label}`,
            message: `Gợi ý: ghi danh học viên vừa tạo vào lớp mới nhất (${cls.label}).`,
            intent: 'assign_student_to_class',
            draft_message: `Thêm học viên ${newStudent.label} #${newStudent.id} vào lớp ${cls.label}`,
            priority: 1,
            action: {
              type: 'suggestion_action',
              action: 'assign_student_to_class',
              input: {
                userId: Number(newStudent.id),
                classId: Number(cls.id),
              },
              source: 'post_create_student_suggestion',
            },
          },
        ];
      }
    } catch {
      // Gợi ý là tính năng phụ — lỗi không được làm hỏng turn chính.
    }
    return [];
  }

  private async findLatestStudentOption(
    tenantId: number,
  ): Promise<EntityOption | null> {
    const student = await this.prisma.user.findFirst({
      where: { tenantId, role: 'STUDENT' },
      orderBy: { createdAt: 'desc' },
    });
    return this.toEntityOption(student);
  }

  private async findLatestClassOption(
    tenantId: number,
  ): Promise<EntityOption | null> {
    const cls = await this.prisma.courseClass.findFirst({
      where: { tenantId, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    });
    return this.toEntityOption(cls);
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

// Nút chọn nhanh cho câu hỏi trùng học viên (frontend render thành 3 button,
// user bấm sẽ gửi key "1"/"2"/"3" — vẫn hỗ trợ gõ tay).
const DUPLICATE_CHOICE_OPTIONS = [
  { key: '1', label: 'Dùng học viên có sẵn này' },
  { key: '2', label: 'Nhập email/SĐT khác để tạo học viên mới' },
  { key: '3', label: 'Hủy thao tác' },
];

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
