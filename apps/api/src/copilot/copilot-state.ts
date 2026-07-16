import { DecisionContext } from '../ai-agent/decision.types';

/**
 * Tạo state mặc định SẠCH cho mỗi session mới. Luôn trả object mới để tránh
 * mutate object global dùng chung giữa các session.
 */
export function createDefaultCopilotState(): DecisionContext {
  return {
    last_intent: null,
    selected_student_id: null,
    selected_course_id: null,
    selected_class_id: null,
    last_selected_student: null,
    last_selected_course: null,
    last_selected_class: null,
    last_created_student: null,
    last_created_course: null,
    last_created_class: null,
    last_candidates: {
      students: [],
      courses: [],
      classes: [],
    },
    pending_action: null,
    pending_clarification: null,
    duplicate_student_context: null,
    pending_enrollment_context: null,
    pending_class_creation: null,
    pending_student_update: null,
    last_executed_idempotency_key: null,
  };
}

export const defaultCopilotState = createDefaultCopilotState();
