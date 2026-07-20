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

/** Một dòng trong bảng danh sách học viên (theo lớp hoặc theo khóa). */
export interface StudentTableRow {
  id: number;
  fullName: string;
  email?: string | null;
  phone?: string | null;
  className?: string | null;
  classType?: string | null;
  roleInClass?: string | null;
  joinedAt?: string | null;
}

/** Một dòng trong bảng danh sách lớp học của khóa. */
export interface ClassTableRow {
  id: number;
  title: string;
  classCode?: string | null;
  type?: string | null;
  teacherName?: string | null;
  studentCount?: number;
  status?: string | null;
  courseTitle?: string | null;
  startDate?: string | null;
  endDate?: string | null;
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
  source?: string;
  draftId?: string;
  /** Chống double-submit: sinh khi tạo pending, so khớp khi confirm. */
  idempotency_key?: string;
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
  /** State machine: chờ chọn 1/2/3 hay chờ user nhập email/SĐT mới (option 2). */
  status?: 'waiting_choice' | 'waiting_new_contact';
  /** Input tạo học viên ban đầu — giữ lại tên/ngày sinh/địa chỉ khi đổi email/SĐT. */
  original_input?: Record<string, unknown>;
  conflict_fields?: Array<'email' | 'phone'>;
}

export interface PendingEnrollmentContext {
  /** 0 = chưa chốt học viên (đang chờ chọn) HOẶC bản gộp nhiều người (userIds). */
  userId: number;
  /** Ghi danh GỘP nhiều học viên: danh sách id + nhãn hiển thị tương ứng. */
  userIds?: number[];
  studentLabels?: string[];
  courseId: number;
  candidateClasses: EntityOption[];
  /** Nhiều học viên trùng tên: danh sách chờ chọn (theo số thứ tự hoặc tên). */
  candidateStudents?: EntityOption[];
  /** Nhiều khóa trùng tên: danh sách chờ chọn; chọn xong mới liệt kê lớp. */
  candidateCourses?: EntityOption[];
  /** Đích ghi danh gốc, giữ lại để đi tiếp sau khi user chọn học viên. */
  targetType?: 'course' | 'class';
  targetKeyword?: string;
  targetCourseKeyword?: string;
  expireDate?: string | null;
  allowLatePayment?: boolean | null;
}

/**
 * Đang chờ user trả lời TÊN LỚP để hoàn tất tạo lớp. Đã xác định được khóa học
 * (courseId) nên lượt sau user chỉ cần nhập tên lớp là tạo preview ngay, KHÔNG
 * hỏi thêm ngày/giáo viên/lịch học.
 */
export interface PendingClassCreationContext {
  /** 0 = chưa xác định khóa; user sẽ trả lời tên khóa ở lượt sau. */
  courseId: number;
  courseTitle?: string | null;
  courseCode?: string | null;
  type: 'WEEKLY' | 'EXAM_PRACTICE';
  title?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  teacherName?: string | null;
}

export interface SuggestionAction {
  type: 'suggestion_action';
  action: AiToolName;
  input: Record<string, unknown>;
  source?: string;
  draftId?: string;
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
      /** 'target_disambiguation' -> frontend render các nút chọn nhanh (options). */
      clarification_type?: string;
      options?: Array<{ key: string; label: string }>;
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
      type: 'student_table';
      title: string;
      message?: string;
      scope: 'course' | 'class' | 'system';
      students: StudentTableRow[];
      suggestions?: ProactiveSuggestion[];
    }
  | {
      type: 'class_table';
      title: string;
      message?: string;
      classes: ClassTableRow[];
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

/**
 * Cập nhật học viên đang dở: đã parse được field cần đổi nhưng chưa chốt
 * học viên (đang hỏi "học viên nào?"), hoặc ngược lại đã chốt học viên nhưng
 * chưa biết đổi gì. Câu trả lời tiếp theo (số thứ tự/tên/field) đi tiếp từ đây.
 */
export interface PendingStudentUpdateContext {
  /** Field muốn đổi đã parse sẵn (phone, email, birthDate, address, fullName). */
  fields: Record<string, string>;
  /** Học viên đã chốt (khi đang hỏi field cần đổi). */
  student_id?: number | null;
  student_label?: string | null;
}

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
  /**
   * Đang chờ user CHỌN KHÓA từ danh sách candidates để đi tiếp intent gốc
   * (xem danh sách học viên/lớp của khóa). Chọn xong phải trả kết quả luôn,
   * không dừng ở "đã chọn khóa".
   */
  pending_course_choice?: {
    intent: 'list_students' | 'list_classes';
    studentKeyword?: string;
    classKeyword?: string;
    classType?: 'WEEKLY' | 'EXAM_PRACTICE';
  } | null;
  pending_class_creation?: PendingClassCreationContext | null;
  pending_student_update?: PendingStudentUpdateContext | null;
  /** Idempotency key của pending action ĐÃ execute gần nhất (chống double-submit). */
  last_executed_idempotency_key?: string | null;
  [key: string]: unknown;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  toolName?: string;
}
