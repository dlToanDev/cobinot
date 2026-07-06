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
  EntityOption,
  PendingAction,
  SuggestionAction,
} from '../ai-agent/decision.types';
import { ToolRegistryService } from '../ai-agent/tool-registry.service';
import { isWriteTool } from '../ai-agent/tool-definitions';
import { ActorPayload } from '../common/decorators/get-actor.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { defaultCopilotState } from './copilot-state';
import { CreateCopilotMessageDto } from './dto/create-message.dto';
import { CreateCopilotSessionDto } from './dto/create-session.dto';

@Injectable()
export class CopilotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly toolRegistry: ToolRegistryService,
    private readonly agentRunner: AgentRunnerService,
  ) {}

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
        state: defaultCopilotState,
      },
    });
  }

  findSessions(tenantId: number, userId: number) {
    return this.prisma.aiAgentSession.findMany({
      where: { tenantId, userId },
      orderBy: { updatedAt: 'desc' },
    });
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
    return this.prisma.aiAgentSession.update({
      where: { id },
      data: { status: 'CLOSED' },
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

    const actionResult = this.pendingActionFromSuggestion(action);
    if (actionResult) {
      try {
        const executeResult = await this.toolRegistry.execute(
          sessionId,
          actor,
          actionResult.tool_name,
          actionResult.input,
        );
        const response: CopilotResponse = {
          type: 'tool_result',
          message: 'Đã thực hiện xong.',
          tool_name: actionResult.tool_name,
          status: 'SUCCESS',
          result: executeResult,
          data: executeResult,
        };
        const nextState = this.mergeState(state, {
          ...this.statePatchFromToolResult(actionResult.tool_name, executeResult),
          pending_action: null,
          pending_clarification: null,
          last_intent: actionResult.tool_name,
        });
        return this.saveAssistantTurn({
          sessionId,
          userMessageId: userMessage.id,
          startedAt,
          response,
          state: nextState,
          toolName: actionResult.tool_name,
        });
      } catch (error: any) {
        const response: CopilotResponse = {
          type: 'text_message',
          message: error?.message || 'Có lỗi xảy ra khi thực hiện thao tác.',
        };
        const nextState = this.mergeState(state, {
          pending_action: null,
          pending_clarification: null,
        });
        return this.saveAssistantTurn({
          sessionId,
          userMessageId: userMessage.id,
          startedAt,
          response,
          state: nextState,
          toolName: actionResult.tool_name,
        });
      }
    }

    const history = await this.loadRecentHistory(sessionId, userMessage.id);
    const result = await this.agentRunner.run({
      tenantId: actor.tenantId,
      userId: actor.userId,
      sessionId,
      userMessage: content,
      context: state,
      sessionHistory: history,
    });

    if (result.type === 'pending_write') {
      const pending = result.pendingAction;
      try {
        const executeResult = await this.toolRegistry.execute(
          sessionId,
          actor,
          pending.tool_name,
          pending.input,
        );
        const response: CopilotResponse = {
          type: 'tool_result',
          message: 'Đã thực hiện xong.',
          tool_name: pending.tool_name,
          status: 'SUCCESS',
          result: executeResult,
          data: executeResult,
        };
        const nextState = this.mergeState(state, {
          ...this.statePatchFromToolResult(pending.tool_name, executeResult),
          pending_action: null,
          pending_clarification: null,
          last_intent: pending.tool_name,
          ...(result.contextPatch || {}),
        });

        return this.saveAssistantTurn({
          sessionId,
          userMessageId: userMessage.id,
          startedAt,
          response,
          state: nextState,
          toolName: pending.tool_name,
        });
      } catch (error: any) {
        const response: CopilotResponse = {
          type: 'text_message',
          message: error?.message || 'Có lỗi xảy ra khi thực hiện thao tác.',
        };
        const nextState = this.mergeState(state, {
          pending_action: null,
          pending_clarification: null,
          ...(result.contextPatch || {}),
        });

        return this.saveAssistantTurn({
          sessionId,
          userMessageId: userMessage.id,
          startedAt,
          response,
          state: nextState,
          toolName: pending.tool_name,
        });
      }
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
        message: 'Đã thực hiện xong.',
        tool_name: pending.tool_name,
        status: 'SUCCESS',
        result,
        data: result,
      };
      const nextState = this.mergeState(state, {
        ...this.statePatchFromToolResult(pending.tool_name, result),
        pending_action: null,
        pending_clarification: null,
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
      const response: CopilotResponse = {
        type: 'text_message',
        message: error?.message || 'Có lỗi xảy ra khi thực hiện thao tác.',
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
      message: 'Mình đã hủy thao tác đang chờ.',
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
      patch as Partial<DecisionContext>,
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
      throw new BadRequestException('Phiên chat đã đóng');
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
      message: 'Bạn xác nhận để mình thực hiện thao tác này nhé.',
      tool_name: pendingAction.tool_name,
      input: pendingAction.input,
      display_input: pendingAction.display_input || pendingAction.input,
      pending_action: pendingAction,
      actions: ['confirm', 'cancel'],
      summary: pendingAction.summary,
    };
  }

  private pendingActionFromSuggestion(
    action?: SuggestionAction,
  ): PendingAction | null {
    if (!action || !isWriteTool(action.action)) return null;
    return {
      tool_name: action.action,
      input: action.input || {},
      display_input: action.input || {},
      summary: `Chuẩn bị chạy ${action.action}`,
      intent: action.action,
      status: 'waiting_confirm',
      severity: ['delete_students', 'delete_courses', 'close_class'].includes(
        action.action,
      )
        ? 'danger'
        : 'default',
    };
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
    return this.mergeState(
      defaultCopilotState as DecisionContext,
      (value || {}) as Partial<DecisionContext>,
    );
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

  private isConfirmText(content: string): boolean {
    const text = this.normalizeText(content);
    return [
      'ok',
      'oke',
      'yes',
      'confirm',
      'cf',
      'xn',
      'dong y',
      'xac nhan',
      'duyet',
      'chot',
      'dung roi',
      'lam di',
    ].some((keyword) => text === keyword || text.includes(keyword));
  }

  private isCancelText(content: string): boolean {
    const text = this.normalizeText(content);
    return ['huy', 'thoi', 'bo qua', 'khong lam nua', 'cancel'].some(
      (keyword) => text === keyword || text.includes(keyword),
    );
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
