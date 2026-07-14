import { Injectable, Logger } from '@nestjs/common';
import { AiService } from '../ai/ai.service';
import { AgentContextBuilderService } from './agent-context-builder.service';
import {
  AiIntent,
  AiToolName,
  ChatMessage,
  DecisionContext,
  PendingAction,
  PendingClarification,
} from './decision.types';
import { ToolExecutorService } from './tool-executor.service';
import {
  getConfiguredAgentTools,
  isAgentMiniMode,
  isReadTool,
  isWriteTool,
} from './tool-definitions';
import { formatReadResultMessage } from './agent-formatters';

export interface AgentRunInput {
  userMessage: string;
  sessionHistory: ChatMessage[];
  context: DecisionContext;
  tenantId: number;
  userId: number;
  sessionId: number;
}

export type AgentRunResult =
  | {
      type: 'text';
      message: string;
      contextPatch?: Partial<DecisionContext>;
      /** true nếu LLM không dùng được (quota/lỗi mạng) -> caller có thể fallback. */
      llmUnavailable?: boolean;
    }
  | {
      type: 'clarification';
      clarification: PendingClarification;
      message: string;
      contextPatch?: Partial<DecisionContext>;
    }
  | {
      type: 'pending_write';
      pendingAction: PendingAction;
      message: string;
      contextPatch?: Partial<DecisionContext>;
    };

const MAX_TOOL_LOOPS = 5;

/**
 * Câu text thuần của model tự tuyên bố ĐÃ thực hiện xong một thao tác ghi.
 * Agent runner KHÔNG BAO GIỜ tự execute write tool (mọi write đều phải qua
 * preview + confirm ở CopilotService), nên câu khớp pattern này chắc chắn là
 * kết quả bịa (hallucination) -> phải chặn trước khi trả về user.
 */
const FAKE_WRITE_SUCCESS_RE =
  /(đã|vừa)\s+(được\s+)?(thêm|tạo|cập nhật|sửa|xóa|xoá|ghi danh|gán|đóng|hủy|huỷ|lưu|thực hiện)[\s\S]{0,160}?(thành công|hoàn tất)/iu;

const FAKE_WRITE_SUCCESS_REPLACEMENT =
  'Mình CHƯA thực hiện thao tác nào cả — mọi thao tác ghi dữ liệu đều cần bạn xác nhận trên thẻ xem trước trước khi chạy. ' +
  'Bạn nói lại yêu cầu cụ thể (tên học viên, tên lớp/khóa...) để mình chuẩn bị thao tác nhé.';

@Injectable()
export class AgentRunnerService {
  private readonly logger = new Logger(AgentRunnerService.name);

  constructor(
    private readonly aiModel: AiService,
    private readonly contextBuilder: AgentContextBuilderService,
    private readonly toolExecutor: ToolExecutorService,
  ) {
    this.logger.log(`AI Agent mini mode enabled: ${isAgentMiniMode()}`);
  }

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    const systemPrompt = this.contextBuilder.buildSystemPrompt(input.context);
    const tools = getConfiguredAgentTools();
    const messages: ChatMessage[] = [
      ...(input.sessionHistory || []).slice(-12),
      { role: 'user', content: input.userMessage },
    ];
    let lastReadResult: unknown = null;

    for (let index = 0; index < MAX_TOOL_LOOPS; index += 1) {
      const modelResult = await this.aiModel.callWithTools(
        systemPrompt,
        messages,
        tools,
      );

      if (modelResult.type === 'error') {
        return {
          type: 'text',
          message:
            modelResult.content?.trim() ||
            'Mình chưa xử lý được yêu cầu này. Bạn thử nói lại ngắn gọn hơn nhé.',
          contextPatch: {},
          llmUnavailable: true,
        };
      }

      if (modelResult.type !== 'tool_call' || !modelResult.toolCall) {
        return {
          type: 'text',
          message:
            this.sanitizeModelText(modelResult.content) ||
            this.messageFromReadResult(lastReadResult),
          contextPatch: this.contextPatchFromReadResult(lastReadResult),
        };
      }

      const toolName = modelResult.toolCall.name as AiToolName;
      const args = modelResult.toolCall.args || {};

      if (toolName === 'ask_clarification') {
        const clarification = this.buildClarification(args);
        return {
          type: 'clarification',
          clarification,
          message:
            clarification.message ||
            'Bạn bổ sung thêm thông tin để mình xử lý chính xác nhé.',
          contextPatch: { pending_clarification: clarification },
        };
      }

      if (isReadTool(toolName)) {
        const result = await this.toolExecutor.executeRead(
          input.tenantId,
          toolName,
          args,
        );
        lastReadResult = { toolName, args, result };
        messages.push({
          role: 'tool',
          toolName,
          toolCallId: modelResult.toolCall.callId || toolName,
          content: `Data: ${JSON.stringify(result, null, 2)}`,
        });
        continue;
      }

      if (isWriteTool(toolName)) {
        const pendingAction: PendingAction = {
          tool_name: toolName,
          input: args,
          display_input: args,
          summary: this.summarizeWriteTool(toolName, args),
          intent: toolName,
          status: 'waiting_confirm',
          severity: this.isDangerTool(toolName) ? 'danger' : 'default',
        };
        return {
          type: 'pending_write',
          pendingAction,
          message:
            'Mình đã chuẩn bị thao tác. Bạn kiểm tra lại rồi xác nhận nhé.',
          contextPatch: {
            pending_action: pendingAction,
            pending_clarification: null,
          },
        };
      }

      this.logger.warn(
        `Model gọi tool không hỗ trợ: ${modelResult.toolCall.name}`,
      );
      const clarification: PendingClarification = {
        type: 'missing_fields',
        intent: 'unknown',
        missing_fields: ['tool'],
        message:
          'Mình chưa chắc thao tác cần làm. Bạn nói rõ hơn giúp mình nhé?',
      };
      return {
        type: 'clarification',
        clarification,
        message: clarification.message || '',
        contextPatch: { pending_clarification: clarification },
      };
    }

    return {
      type: 'text',
      message: this.messageFromReadResult(lastReadResult),
      contextPatch: this.contextPatchFromReadResult(lastReadResult),
    };
  }

  /**
   * Chặn model bịa kết quả: text thuần tuyên bố "đã ... thành công" trong khi
   * runner chưa hề execute write tool nào -> thay bằng câu trả lời trung thực.
   */
  private sanitizeModelText(content?: string): string {
    const text = content?.trim() || '';
    if (!text) return '';
    if (FAKE_WRITE_SUCCESS_RE.test(text)) {
      this.logger.warn(
        `Chặn message bịa kết quả write từ model: "${text.slice(0, 120)}"`,
      );
      return FAKE_WRITE_SUCCESS_REPLACEMENT;
    }
    return text;
  }

  private buildClarification(
    args: Record<string, unknown>,
  ): PendingClarification {
    const missingFields = Array.isArray(args.missingFields)
      ? args.missingFields.filter(
          (item): item is string => typeof item === 'string',
        )
      : [];

    return {
      type: 'missing_fields',
      intent: typeof args.intent === 'string' ? args.intent : 'unknown',
      missing_fields: missingFields,
      message:
        typeof args.message === 'string' && args.message.trim()
          ? args.message.trim()
          : 'Bạn bổ sung thêm thông tin giúp mình nhé?',
      entities: {},
    };
  }

  private summarizeWriteTool(
    toolName: AiToolName,
    args: Record<string, unknown>,
  ): string {
    if (toolName === 'assign_student_to_course') {
      return `Ghi danh học viên #${args.userId ?? '?'} vào khóa học #${
        args.courseId ?? '?'
      }`;
    }

    if (toolName === 'create_course') {
      const name = String(args.title ?? args.name ?? '').trim();
      return `Tạo khóa học mới${name ? `: ${name}` : ''}`;
    }

    if (toolName === 'create_class') {
      const title = String(args.title ?? '').trim();
      const courseId = args.courseId ? ` trong khóa #${args.courseId}` : '';
      return `Tạo lớp học mới${title ? `: ${title}` : ''}${courseId}`;
    }

    const labels: Record<string, string> = {
      create_student: 'Tạo học viên mới',
      update_student: 'Cập nhật học viên',
      delete_students: 'Xóa học viên',
      create_course: 'Tạo khóa học mới',
      update_course: 'Cập nhật khóa học',
      delete_courses: 'Xóa khóa học',
      create_class: 'Tạo lớp học mới',
      update_class: 'Cập nhật lớp học',
      close_class: 'Đóng lớp học',
      assign_student_to_class: 'Thêm học viên vào lớp',
      assign_student_to_course: 'Ghi danh học viên vào khóa học',
      remove_student_from_class: 'Xóa học viên khỏi lớp',
      remove_student_from_course_classes:
        'Xóa học viên khỏi các lớp trong khóa',
      ask_clarification: 'Hỏi làm rõ',
      search_student: 'Tìm học viên',
      get_student_detail: 'Xem học viên',
      search_course: 'Tìm khóa học',
      get_course_detail: 'Xem khóa học',
      get_course_classes: 'Xem lớp trong khóa',
      search_class: 'Tìm lớp',
      get_class_detail: 'Xem lớp',
      get_class_students: 'Xem học viên trong lớp',
    };
    return `${labels[toolName] || toolName}: ${JSON.stringify(args)}`;
  }

  private isDangerTool(toolName: AiToolName): boolean {
    return ['delete_students', 'delete_courses', 'close_class'].includes(
      toolName,
    );
  }

  private messageFromReadResult(lastReadResult: unknown): string {
    if (!lastReadResult) {
      return 'Mình đã nhận yêu cầu. Bạn muốn mình làm gì tiếp?';
    }
    const { toolName, result } = lastReadResult as {
      toolName?: string;
      result?: unknown;
    };
    // Format tiếng Việt dễ đọc, KHÔNG dump JSON thô ra chat.
    const formatted = formatReadResultMessage(toolName, result);
    return formatted || 'Mình đã lấy được dữ liệu bạn cần.';
  }

  private contextPatchFromReadResult(
    lastReadResult: unknown,
  ): Partial<DecisionContext> {
    if (!lastReadResult || typeof lastReadResult !== 'object') return {};
    const { toolName, result } = lastReadResult as {
      toolName?: AiToolName;
      result?: unknown;
    };

    if (toolName === 'search_student' && Array.isArray(result)) {
      return { last_candidates: { students: this.toOptions(result) } };
    }
    if (toolName === 'search_course' && Array.isArray(result)) {
      return { last_candidates: { courses: this.toOptions(result) } };
    }
    if (toolName === 'search_class' && Array.isArray(result)) {
      return { last_candidates: { classes: this.toOptions(result) } };
    }
    if (toolName === 'get_course_classes' && Array.isArray(result)) {
      return { last_candidates: { classes: this.toOptions(result) } };
    }
    if (toolName === 'get_class_students' && Array.isArray(result)) {
      return { last_candidates: { students: this.toOptions(result) } };
    }
    if (
      toolName === 'get_student_detail' &&
      result &&
      typeof result === 'object'
    ) {
      const option = this.toSingleOption(result);
      if (option) {
        return {
          last_selected_student: option as any,
          selected_student_id: option.id,
        };
      }
    }
    if (
      toolName === 'get_course_detail' &&
      result &&
      typeof result === 'object'
    ) {
      const option = this.toSingleOption(result);
      if (option) {
        return {
          last_selected_course: option as any,
          selected_course_id: option.id,
        };
      }
    }
    if (
      toolName === 'get_class_detail' &&
      result &&
      typeof result === 'object'
    ) {
      const option = this.toSingleOption(result);
      if (option) {
        return {
          last_selected_class: option as any,
          selected_class_id: option.id,
        };
      }
    }
    return {};
  }

  private toSingleOption(row: unknown): {
    id: number;
    value: number;
    label: string;
    description: string;
    metadata: unknown;
  } | null {
    if (!row || typeof row !== 'object') return null;
    const r = row as any;
    if (!r.id) return null;
    return {
      id: Number(r.id),
      value: Number(r.id),
      label: String(r.fullName || r.title || r.name || `#${r.id}`),
      description: [r.phone, r.email, r.courseCode, r.classCode]
        .filter(Boolean)
        .join(' | '),
      metadata: r,
    };
  }

  private toOptions(rows: unknown[]) {
    return rows.slice(0, 10).map((row: any) => ({
      id: Number(row.id),
      value: Number(row.id),
      label: String(row.fullName || row.title || row.name || `#${row.id}`),
      description: [row.phone, row.email, row.courseCode, row.classCode]
        .filter(Boolean)
        .join(' | '),
      metadata: row,
    }));
  }
}
