import { BadRequestException } from '@nestjs/common';
import { AiToolName } from './decision.types';

export interface AgentToolDefinition {
  type: 'function';
  function: {
    name: AiToolName;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

const stringField = (description: string, enumValues?: string[]) => ({
  type: 'string',
  description,
  ...(enumValues ? { enum: enumValues } : {}),
});

const numberField = (description: string) => ({
  type: 'number',
  description,
});

const numberArrayField = (description: string) => ({
  type: 'array',
  description,
  items: { type: 'number' },
});

const classSessionArrayField = () => ({
  type: 'array',
  description: 'Danh sách buổi học/lịch học của lớp.',
  items: {
    type: 'object',
    properties: {
      title: stringField('Tên buổi học'),
      dayOfWeek: numberField(
        'Thứ trong tuần: chủ nhật=0, thứ 2=2, ..., thứ 7=7',
      ),
      startTime: stringField('Giờ bắt đầu dạng HH:mm'),
      endTime: stringField('Giờ kết thúc dạng HH:mm'),
      sessionDate: stringField('Ngày học cụ thể dạng YYYY-MM-DD nếu có'),
      room: stringField('Phòng học'),
      note: stringField('Ghi chú buổi học'),
    },
  },
});

export const READ_TOOL_NAMES: string[] = [
  'search_student',
  'get_student_detail',
  'search_course',
  'get_course_detail',
  'get_course_classes',
  'search_class',
  'get_class_detail',
  'get_class_students',
];

export const WRITE_TOOL_NAMES: string[] = [
  'create_student',
  'update_student',
  'delete_students',
  'create_course',
  'update_course',
  'delete_courses',
  'create_class',
  'update_class',
  'close_class',
  'assign_student_to_class',
  'assign_student_to_course',
  'remove_student_from_class',
  'remove_student_from_course_classes',
];

export const FULL_AGENT_TOOLS: AgentToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'search_student',
      description: 'Tìm học viên theo tên, email hoặc số điện thoại.',
      parameters: {
        type: 'object',
        properties: {
          keyword: stringField('Từ khóa tìm kiếm học viên'),
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_student_detail',
      description: 'Lấy chi tiết một học viên bằng ID đã biết.',
      parameters: {
        type: 'object',
        properties: {
          userId: numberField('ID học viên'),
        },
        required: ['userId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_course',
      description: 'Tìm khóa học/chương trình đào tạo.',
      parameters: {
        type: 'object',
        properties: {
          keyword: stringField('Từ khóa tìm kiếm khóa học'),
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_course_detail',
      description: 'Lấy chi tiết một khóa học bằng ID đã biết.',
      parameters: {
        type: 'object',
        properties: {
          courseId: numberField('ID khóa học'),
        },
        required: ['courseId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_course_classes',
      description: 'Liệt kê các lớp thuộc một khóa học.',
      parameters: {
        type: 'object',
        properties: {
          courseId: numberField('ID khóa học'),
        },
        required: ['courseId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_class',
      description: 'Tìm lớp học cụ thể.',
      parameters: {
        type: 'object',
        properties: {
          keyword: stringField('Từ khóa tìm kiếm lớp học'),
          courseId: numberField('Giới hạn trong khóa học ID này nếu đã biết'),
          classType: stringField('Loại lớp', ['WEEKLY', 'EXAM_PRACTICE']),
          status: stringField('Trạng thái lớp'),
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_class_detail',
      description: 'Lấy chi tiết một lớp học bằng ID đã biết.',
      parameters: {
        type: 'object',
        properties: {
          classId: numberField('ID lớp học'),
        },
        required: ['classId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_class_students',
      description: 'Xem danh sách học viên trong một lớp.',
      parameters: {
        type: 'object',
        properties: {
          classId: numberField('ID lớp học'),
        },
        required: ['classId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_student',
      description: 'Tạo học viên mới.',
      parameters: {
        type: 'object',
        properties: {
          fullName: stringField('Họ tên học viên'),
          email: stringField('Email'),
          phone: stringField('Số điện thoại'),
          address: stringField('Địa chỉ'),
          birthDate: stringField('Ngày sinh dạng YYYY-MM-DD'),
        },
        required: ['fullName'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_student',
      description: 'Cập nhật thông tin học viên.',
      parameters: {
        type: 'object',
        properties: {
          userId: numberField('ID học viên'),
          fullName: stringField('Họ tên mới'),
          email: stringField('Email mới'),
          phone: stringField('Số điện thoại mới'),
          address: stringField('Địa chỉ mới'),
          birthDate: stringField('Ngày sinh dạng YYYY-MM-DD'),
        },
        required: ['userId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_students',
      description: 'Xóa một hoặc nhiều học viên.',
      parameters: {
        type: 'object',
        properties: {
          ids: numberArrayField('Danh sách ID học viên cần xóa'),
          all: {
            type: 'boolean',
            description: 'true nếu người dùng yêu cầu xóa toàn bộ học viên',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_course',
      description:
        'Tạo khóa học mới. Khóa học KHÔNG có ngày bắt đầu/kết thúc — ngày chỉ thuộc lớp học (create_class).',
      parameters: {
        type: 'object',
        properties: {
          title: stringField('Tên khóa học'),
          courseCode: stringField(
            'Mã khóa học. Có thể bỏ trống, hệ thống sẽ tự sinh từ tên khóa học, ví dụ Toán 12 -> TOAN_12',
          ),
          description: stringField('Mô tả khóa học'),
          level: stringField('Cấp độ khóa học'),
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_course',
      description:
        'Cập nhật thông tin khóa học đang chọn/vừa tạo. Chỉ truyền các field cần đổi. Khóa học KHÔNG có ngày — muốn đổi ngày hãy dùng update_class.',
      parameters: {
        type: 'object',
        properties: {
          courseId: numberField('ID khóa học'),
          title: stringField('Tên khóa học mới'),
          courseCode: stringField('Mã khóa học mới'),
          description: stringField('Mô tả mới'),
          level: stringField('Cấp độ mới, ví dụ "Cấp độ 1", "Cơ bản"'),
          status: stringField('Trạng thái mới nếu có'),
        },
        required: ['courseId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_courses',
      description: 'Xóa một hoặc nhiều khóa học.',
      parameters: {
        type: 'object',
        properties: {
          ids: numberArrayField('Danh sách ID khóa học cần xóa'),
          all: {
            type: 'boolean',
            description: 'true nếu người dùng yêu cầu xóa toàn bộ khóa học',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_class',
      description: 'Tạo lớp học cụ thể trong một khóa học.',
      parameters: {
        type: 'object',
        properties: {
          courseId: numberField('ID khóa học cha'),
          title: stringField('Tên lớp học'),
          type: stringField('Loại lớp', ['WEEKLY', 'EXAM_PRACTICE']),
          description: stringField('Mô tả lớp học'),
          teacherName: stringField('Tên giáo viên'),
          startDate: stringField('Ngày bắt đầu dạng YYYY-MM-DD'),
          endDate: stringField('Ngày kết thúc dạng YYYY-MM-DD'),
          sessions: classSessionArrayField(),
        },
        required: ['courseId', 'title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_class',
      description: 'Cập nhật thông tin lớp học.',
      parameters: {
        type: 'object',
        properties: {
          classId: numberField('ID lớp học'),
          title: stringField('Tên lớp học mới'),
          classCode: stringField('Mã lớp học mới'),
          classType: stringField('Loại lớp', ['WEEKLY', 'EXAM_PRACTICE']),
          description: stringField('Mô tả mới'),
          teacherName: stringField('Tên giáo viên mới'),
          startDate: stringField('Ngày bắt đầu dạng YYYY-MM-DD'),
          endDate: stringField('Ngày kết thúc dạng YYYY-MM-DD'),
          status: stringField('Trạng thái lớp'),
        },
        required: ['classId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'close_class',
      description: 'Đóng/ngưng/dừng một lớp học nhưng vẫn giữ lịch sử.',
      parameters: {
        type: 'object',
        properties: {
          classId: numberField('ID lớp học'),
          expectedStatus: stringField('Trạng thái hiện tại nếu cần kiểm tra'),
          reason: stringField('Lý do đóng lớp'),
        },
        required: ['classId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'assign_student_to_class',
      description:
        'Thêm học viên vào một lớp học cụ thể. Nhiều học viên cùng lúc thì dùng userIds (1 lần gọi cho cả nhóm, KHÔNG gọi lặp từng người).',
      parameters: {
        type: 'object',
        properties: {
          userId: numberField('ID học viên (khi chỉ thêm 1 người)'),
          userIds: {
            type: 'array',
            items: { type: 'number' },
            description: 'Danh sách ID học viên khi thêm NHIỀU người cùng lúc',
          },
          classId: numberField('ID lớp học'),
          roleInClass: stringField('Vai trò trong lớp', ['STUDENT', 'TEACHER']),
          joinedAt: stringField('Ngày tham gia dạng YYYY-MM-DD'),
        },
        required: ['classId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'assign_student_to_course',
      description:
        'Ghi danh một học viên vào một khóa học. Dùng khi user nói thêm/ghi danh học viên vào khóa học (không nói rõ lớp cụ thể).',
      parameters: {
        type: 'object',
        properties: {
          userId: numberField('ID học viên cần ghi danh'),
          courseId: numberField('ID khóa học cần ghi danh'),
          expireDate: stringField(
            'Ngày hết hạn học/ghi danh nếu user cung cấp, định dạng ISO yyyy-mm-dd',
          ),
          allowLatePayment: {
            type: 'boolean',
            description:
              'Có cho phép thanh toán muộn không, nếu nghiệp vụ hỗ trợ',
          },
          note: stringField('Ghi chú thêm nếu có'),
        },
        required: ['userId', 'courseId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remove_student_from_class',
      description: 'Xóa học viên khỏi một lớp học cụ thể.',
      parameters: {
        type: 'object',
        properties: {
          userId: numberField('ID học viên'),
          classId: numberField('ID lớp học'),
        },
        required: ['userId', 'classId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remove_student_from_course_classes',
      description: 'Xóa học viên khỏi toàn bộ lớp thuộc một khóa học.',
      parameters: {
        type: 'object',
        properties: {
          userId: numberField('ID học viên'),
          courseId: numberField('ID khóa học'),
        },
        required: ['userId', 'courseId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ask_clarification',
      description:
        'Hỏi lại khi thiếu thông tin bắt buộc hoặc có nhiều lựa chọn. Không tự bịa ID.',
      parameters: {
        type: 'object',
        properties: {
          message: stringField('Câu hỏi làm rõ bằng tiếng Việt'),
          missingFields: {
            type: 'array',
            items: { type: 'string' },
          },
          intent: stringField('Tool hoặc ý định đang cần làm rõ'),
        },
        required: ['message', 'missingFields'],
      },
    },
  },
];

export function isReadTool(name: unknown): name is AiToolName {
  return typeof name === 'string' && READ_TOOL_NAMES.includes(name);
}

export function isWriteTool(name: unknown): name is AiToolName {
  return typeof name === 'string' && WRITE_TOOL_NAMES.includes(name);
}

/**
 * Danh sách tool được phép trong bản Copilot mini — 7 nghiệp vụ:
 * tạo học viên, tạo khóa học, tạo lớp học trong khóa (WEEKLY/EXAM_PRACTICE),
 * thêm học viên vào LỚP học (assign_student_to_class),
 * và sửa thông tin học viên/khóa học/lớp học (update_*).
 * Ghi danh cấp khóa (assign_student_to_course) KHÔNG expose để LLM không gọi nhầm;
 * mọi tool xóa/đóng/gỡ vẫn bị chặn.
 */
export const MINI_AGENT_TOOL_NAMES = [
  'search_student',
  'get_student_detail',
  'search_course',
  'get_course_detail',
  'get_course_classes',
  'search_class',
  'get_class_detail',
  'create_student',
  'create_course',
  'create_class',
  'update_student',
  'update_course',
  'update_class',
  'assign_student_to_class',
  'ask_clarification',
] as const;

export const MINI_AGENT_TOOLS: AgentToolDefinition[] = FULL_AGENT_TOOLS.filter(
  (tool) =>
    (MINI_AGENT_TOOL_NAMES as readonly string[]).includes(tool.function.name),
);

/**
 * Mini mode bật khi AGENT_MINI_MODE khác 'false'. Mặc định true cho bản mini.
 */
export function isAgentMiniMode(): boolean {
  return process.env.AGENT_MINI_MODE !== 'false';
}

export function isToolAllowedInMiniMode(name: unknown): boolean {
  return (
    typeof name === 'string' &&
    (MINI_AGENT_TOOL_NAMES as readonly string[]).includes(name)
  );
}

/** Trả về danh sách tool đúng theo mode hiện tại (đọc env lúc runtime). */
export function getConfiguredAgentTools(): AgentToolDefinition[] {
  return isAgentMiniMode() ? MINI_AGENT_TOOLS : FULL_AGENT_TOOLS;
}

/**
 * Guard backend: chặn tool ngoài phạm vi mini mode (kể cả READ/WRITE gửi từ
 * suggestion action hoặc pending_action cũ). Full mode thì không chặn.
 */
export function assertToolAllowedInCurrentMode(toolName: string): void {
  if (!isAgentMiniMode()) return;
  if (!isToolAllowedInMiniMode(toolName)) {
    throw new BadRequestException({
      code: 'TOOL_DISABLED_IN_MINI_MODE',
      message: 'Tính năng này chưa được bật trong bản Copilot mini.',
      toolName,
    });
  }
}
