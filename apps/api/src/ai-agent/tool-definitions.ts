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
  'remove_student_from_class',
  'remove_student_from_course_classes',
];

export const AGENT_TOOLS: AgentToolDefinition[] = [
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
          classType: stringField('Loại lớp', ['WEEKLY', 'PRACTICE']),
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
      description: 'Tạo khóa học/chương trình đào tạo mới.',
      parameters: {
        type: 'object',
        properties: {
          title: stringField('Tên khóa học'),
          courseCode: stringField(
            'Mã khóa học. Có thể bỏ trống, hệ thống sẽ tự sinh từ tên khóa học, ví dụ Toán 12 -> TOAN_12',
          ),
          description: stringField('Mô tả khóa học'),
          level: stringField('Cấp độ khóa học'),
          startDate: stringField('Ngày bắt đầu dạng YYYY-MM-DD'),
          endDate: stringField('Ngày kết thúc dạng YYYY-MM-DD'),
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_course',
      description: 'Cập nhật thông tin khóa học.',
      parameters: {
        type: 'object',
        properties: {
          courseId: numberField('ID khóa học'),
          title: stringField('Tên khóa học mới'),
          courseCode: stringField('Mã khóa học mới'),
          description: stringField('Mô tả mới'),
          level: stringField('Cấp độ mới'),
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
          classCode: stringField(
            'Mã lớp học. Có thể bỏ trống, hệ thống sẽ tự sinh từ mã khóa, tên lớp và loại lớp',
          ),
          classType: stringField('Loại lớp', ['WEEKLY', 'PRACTICE']),
          description: stringField('Mô tả lớp học'),
          teacherName: stringField('Tên giáo viên'),
          startDate: stringField('Ngày bắt đầu dạng YYYY-MM-DD'),
          endDate: stringField('Ngày kết thúc dạng YYYY-MM-DD'),
          enrollStudentId: numberField('ID học viên cần thêm ngay khi tạo lớp'),
        },
        required: ['courseId', 'title', 'classType'],
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
          classType: stringField('Loại lớp', ['WEEKLY', 'PRACTICE']),
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
      description: 'Thêm học viên vào một lớp học cụ thể.',
      parameters: {
        type: 'object',
        properties: {
          userId: numberField('ID học viên'),
          classId: numberField('ID lớp học'),
          roleInClass: stringField('Vai trò trong lớp', ['STUDENT', 'TEACHER']),
          joinedAt: stringField('Ngày tham gia dạng YYYY-MM-DD'),
        },
        required: ['userId', 'classId'],
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
