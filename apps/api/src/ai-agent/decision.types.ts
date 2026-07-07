export type AiToolName =
  | 'search_student'
  | 'get_student_detail'
  | 'search_course'
  | 'get_course_detail'
  | 'get_course_classes'
  | 'search_class'
  | 'get_class_detail'
  | 'get_class_students'
  | 'create_student'
  | 'update_student'
  | 'delete_students'
  | 'create_course'
  | 'update_course'
  | 'delete_courses'
  | 'create_class'
  | 'update_class'
  | 'close_class'
  | 'assign_student_to_class'
  | 'assign_student_to_course'
  | 'remove_student_from_class'
  | 'remove_student_from_course_classes'
  | 'ask_clarification';

export type AiIntent = AiToolName | 'confirm' | 'cancel' | 'unknown';

export interface EntityOption {
  id: number;
  value?: number;
  label: string;
  description?: string;
  email?: string | null;
  phone?: string | null;
  birthDate?: string | null;
  dateOfBirth?: string | null;
  address?: string | null;
  metadata?: Record<string, unknown>;
}

export type PendingActionStatus =
  | 'draft'
  | 'validation_error'
  | 'ready'
  | 'waiting_selection'
  | 'waiting_more_info'
  | 'waiting_confirm';

export interface PendingAction {
  tool_name: AiToolName;
  input: Record<string, unknown>;
  display_input?: Record<string, unknown>;
  summary: string;
  intent: AiIntent;
  status?: PendingActionStatus;
  validation_errors?: Record<string, string>;
  severity?: 'default' | 'danger';
}

export interface PendingClarification {
  type?: 'missing_fields' | 'target_disambiguation';
  intent?: AiIntent | string;
  missing_fields: string[];
  message?: string;
  entities?: Record<string, unknown>;
}

export interface DuplicateStudentContext {
  searched_email?: string | null;
  searched_phone?: string | null;
  existing_student: EntityOption;
  intended_action: 'create' | 'assign' | 'update';
}

export interface PendingEnrollmentContext {
  userId: number;
  courseId: number;
  candidateClasses: EntityOption[];
  expireDate?: string | null;
  allowLatePayment?: boolean | null;
}

/**
 * Đang chờ user trả lời TÊN LỚP để hoàn tất tạo lớp. Đã xác định được khóa học
 * (courseId) nên lượt sau user chỉ cần nhập tên lớp là tạo preview ngay, KHÔNG
 * hỏi thêm ngày/giáo viên/lịch học.
 */
export interface PendingClassCreationContext {
  courseId: number;
  courseTitle?: string | null;
  courseCode?: string | null;
  type: 'WEEKLY' | 'EXAM_PRACTICE';
  title?: string | null;
}

export interface SuggestionAction {
  type: 'suggestion_action';
  action: AiToolName;
  input: Record<string, unknown>;
}

export interface ProactiveSuggestion {
  id: string;
  title: string;
  message: string;
  intent: AiIntent;
  draft_message: string;
  priority: number;
  kind?:
    | 'action'
    | 'course_picker'
    | 'class_picker'
    | 'student_picker'
    | 'enrollment_picker';
  entity_refs?: {
    student_id?: number;
    course_id?: number;
    class_id?: number;
    enrollment_id?: number;
  };
  action?: SuggestionAction;
  options?: Array<{
    id: number;
    label: string;
    entity_type: 'student' | 'course' | 'class' | 'enrollment' | 'action';
    reason: string;
    draft_message?: string;
    action?: SuggestionAction;
    priority?: number;
    metadata?: Record<string, unknown>;
  }>;
  reason?: string;
}

export type CopilotResponse =
  | {
      type: 'text_message';
      message: string;
      suggestions?: ProactiveSuggestion[];
    }
  | {
      type: 'clarification';
      message: string;
      missing_fields: string[];
      intent?: AiIntent | string;
      entities: Record<string, unknown>;
      suggestions?: ProactiveSuggestion[];
    }
  | {
      type: 'student_create_form';
      title?: string;
      message: string;
      intent: 'create_student';
      /** Giá trị điền sẵn từ những gì user đã cung cấp (email/SĐT/ngày sinh). */
      values?: Record<string, string>;
      submit_label?: string;
      suggestions?: ProactiveSuggestion[];
    }
  | {
      type: 'course_create_form';
      title?: string;
      message: string;
      intent: 'create_course';
      values?: Record<string, string>;
      submit_label?: string;
      suggestions?: ProactiveSuggestion[];
    }
  | {
      type: 'preview_card';
      status?: PendingActionStatus;
      title?: string;
      message: string;
      tool_name: AiToolName;
      input: Record<string, unknown>;
      display_input?: Record<string, unknown>;
      pending_action?: PendingAction;
      actions?: Array<'confirm' | 'cancel'>;
      summary: string;
      suggestions?: ProactiveSuggestion[];
    }
  | {
      type: 'tool_result';
      message: string;
      tool_name: AiToolName;
      status: 'SUCCESS' | 'FAILED';
      result?: unknown;
      data?: unknown;
      suggestions?: ProactiveSuggestion[];
    }
  | {
      type: 'error';
      message: string;
      code?: string;
      error?: {
        code?: string;
        message: string;
      };
      suggestions?: ProactiveSuggestion[];
    };

export interface DecisionContext {
  last_intent?: AiIntent | string | null;
  selected_student_id?: number | null;
  selected_course_id?: number | null;
  selected_class_id?: number | null;
  last_selected_student?: EntityOption | null;
  last_selected_course?: EntityOption | null;
  last_selected_class?: EntityOption | null;
  last_created_student?: EntityOption | null;
  last_created_course?: EntityOption | null;
  last_created_class?: EntityOption | null;
  last_candidates?: {
    students?: EntityOption[];
    courses?: EntityOption[];
    classes?: EntityOption[];
  };
  pending_action?: PendingAction | null;
  pending_clarification?: PendingClarification | null;
  duplicate_student_context?: DuplicateStudentContext | null;
  pending_enrollment_context?: PendingEnrollmentContext | null;
  pending_class_creation?: PendingClassCreationContext | null;
  [key: string]: unknown;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  toolName?: string;
}
