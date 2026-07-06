import { Injectable } from '@nestjs/common';
import { DecisionContext, EntityOption } from './decision.types';

@Injectable()
export class AgentContextBuilderService {
  buildSystemPrompt(context: DecisionContext): string {
    const lines = [
      'Bạn là AI Agent thuần tool-calling cho hệ thống quản lý trung tâm đào tạo Hxstu.',
      'Nhiệm vụ của bạn là đọc yêu cầu tiếng Việt, chọn đúng tool MCP, dùng dữ liệu thật từ tool READ, và không tự bịa ID.',
      '',
      '## Quy tắc bắt buộc',
      '- Trả lời bằng tiếng Việt, ngắn gọn, đúng trọng tâm.',
      '- Không tự bịa ID, email, số điện thoại, ngày tháng hoặc dữ liệu không có trong lời user/ngữ cảnh/tool result.',
      '- Nếu cần ID nhưng user chỉ đưa tên/từ khóa, trước hết gọi READ tool để tìm.',
      '- Nếu thiếu thông tin bắt buộc hoặc có nhiều lựa chọn, gọi ask_clarification.',
      '- Với mọi thao tác tạo/cập nhật/xóa/đóng/thêm/xóa khỏi lớp, gọi trực tiếp WRITE tool tương ứng; hệ thống sẽ tự biến tool call đó thành preview chờ xác nhận, không thực thi ngay.',
      '- Không gọi WRITE tool khi chưa đủ thông tin định danh an toàn.',
      '- Khi user nói thêm học viên vào khóa học, vẫn phải xác định lớp cụ thể. Nếu chưa có classId, dùng get_course_classes hoặc ask_clarification.',
      '',
      '## Phân biệt nghiệp vụ',
      '- "hv", "hs", "học sinh", "học viên", "student", "learner" = học viên.',
      '- "khóa", "khóa học", "course", "chương trình" = Course.',
      '- "lớp", "lớp học", "class" = CourseClass cụ thể trong Course.',
      '- "đóng/dừng/ngưng lớp" = close_class, không phải xóa lớp.',
      '- "xóa học viên khỏi lớp" = remove_student_from_class, không phải delete_students.',
      '- "xóa học viên khỏi toàn bộ lớp trong khóa" = remove_student_from_course_classes.',
      '',
      '## Tham chiếu hội thoại',
      '- "học viên vừa tạo" = last_created_student.',
      '- "học viên/người này" = selected_student_id hoặc last_selected_student.',
      '- "khóa này" = selected_course_id hoặc last_selected_course hoặc last_created_course.',
      '- "lớp này" = selected_class_id hoặc last_selected_class hoặc last_created_class.',
      '- "người thứ 2" hoặc "chọn số 2" = dòng số 2 trong last_found_students.',
    ];

    const contextSection = this.buildContextSection(context);
    if (contextSection) {
      lines.push('', '## Ngữ cảnh phiên chat', contextSection);
    }

    if (context.pending_action) {
      lines.push(
        '',
        '## Pending action hiện tại',
        `Tool: ${context.pending_action.tool_name}`,
        `Input: ${JSON.stringify(context.pending_action.input || {})}`,
        `Tóm tắt: ${context.pending_action.summary || ''}`,
        'Nếu user xác nhận/hủy, backend sẽ xử lý ngoài LLM.',
      );
    }

    if (context.pending_clarification) {
      lines.push(
        '',
        '## Pending clarification hiện tại',
        `Intent: ${context.pending_clarification.intent || 'unknown'}`,
        `Thiếu: ${context.pending_clarification.missing_fields.join(', ')}`,
        context.pending_clarification.message
          ? `Câu hỏi trước: ${context.pending_clarification.message}`
          : '',
      );
    }

    return lines.filter(Boolean).join('\n');
  }

  private buildContextSection(context: DecisionContext): string {
    const parts: string[] = [];

    this.addOption(parts, 'last_created_student', context.last_created_student);
    this.addOption(parts, 'last_created_course', context.last_created_course);
    this.addOption(parts, 'last_created_class', context.last_created_class);
    this.addOption(
      parts,
      'selected_student',
      this.selectedOption(
        context.selected_student_id,
        context.last_selected_student || context.last_found_student,
      ),
    );
    this.addOption(
      parts,
      'selected_course',
      this.selectedOption(
        context.selected_course_id,
        context.last_selected_course,
      ),
    );
    this.addOption(
      parts,
      'selected_class',
      this.selectedOption(context.selected_class_id, context.last_selected_class),
    );

    this.addCandidateList(
      parts,
      'last_found_students',
      context.last_candidates?.students,
    );
    this.addCandidateList(
      parts,
      'last_found_courses',
      context.last_candidates?.courses,
    );
    this.addCandidateList(
      parts,
      'last_found_classes',
      context.last_candidates?.classes,
    );

    if (context.current_focus && typeof context.current_focus === 'object') {
      parts.push(`- current_focus: ${JSON.stringify(context.current_focus)}`);
    }

    return parts.join('\n');
  }

  private addOption(
    parts: string[],
    label: string,
    option?: EntityOption | null,
  ) {
    if (!option?.id) return;
    const suffix = option.description ? ` - ${option.description}` : '';
    parts.push(`- ${label}: ${option.label} (ID: ${option.id})${suffix}`);
  }

  private selectedOption(
    id?: number | null,
    option?: EntityOption | null,
  ): EntityOption | null | undefined {
    if (option?.id) return option;
    if (!id) return option;
    return { id, value: id, label: `#${id}` };
  }

  private addCandidateList(
    parts: string[],
    label: string,
    options?: EntityOption[],
  ) {
    if (!options?.length) return;
    const rows = options
      .slice(0, 10)
      .map((option, index) => {
        const description = option.description ? ` - ${option.description}` : '';
        return `  ${index + 1}. ${option.label} (ID: ${option.id})${description}`;
      })
      .join('\n');
    parts.push(`- ${label}:\n${rows}`);
  }
}
