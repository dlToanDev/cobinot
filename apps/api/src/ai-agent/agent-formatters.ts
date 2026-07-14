/**
 * Formatter tiếng Việt cho message trả về user. KHÔNG bao giờ JSON.stringify
 * dữ liệu thô ra chat. Giới hạn tối đa 10 kết quả cho candidate list.
 */

const MAX_LIST_ITEMS = 10;

export function formatDateForVi(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${date.getUTCFullYear()}`;
}

const line = (label: string, value: unknown): string | null => {
  if (value === null || value === undefined || value === '') return null;
  return `   - ${label}: ${value}`;
};

export function formatStudentOption(student: any, index: number): string {
  const label = String(student?.fullName || student?.name || `#${student?.id}`);
  return [
    `${index + 1}. ${label}`,
    line('Email', student?.email),
    line('SĐT', student?.phone),
    line('ID', student?.id),
  ]
    .filter(Boolean)
    .join('\n');
}

export function formatCourseOption(course: any, index: number): string {
  const label = String(course?.title || course?.name || `#${course?.id}`);
  return [
    `${index + 1}. ${label}`,
    line('Mã khóa', course?.courseCode || course?.code),
    line('Cấp độ', course?.level),
    line('ID', course?.id),
  ]
    .filter(Boolean)
    .join('\n');
}

export function formatClassOption(courseClass: any, index: number): string {
  const label = String(
    courseClass?.title || courseClass?.name || `#${courseClass?.id}`,
  );
  return [
    `${index + 1}. ${label}`,
    line('Mã lớp', courseClass?.classCode),
    line('Trạng thái', courseClass?.status),
    line('ID lớp', courseClass?.id),
  ]
    .filter(Boolean)
    .join('\n');
}

type CandidateType = 'student' | 'course' | 'class';

const LIST_CONFIG: Record<
  CandidateType,
  {
    empty: string;
    single: (n: number) => string;
    many: string;
    ask: string;
    format: (row: any, index: number) => string;
  }
> = {
  student: {
    empty: 'Không tìm thấy học viên phù hợp.',
    single: () => 'Tôi tìm thấy 1 học viên:',
    many: 'Tôi tìm thấy nhiều học viên phù hợp:',
    ask: 'Bạn muốn chọn học viên nào?',
    format: formatStudentOption,
  },
  course: {
    empty: 'Không tìm thấy khóa học phù hợp.',
    single: () => 'Tôi tìm thấy 1 khóa học:',
    many: 'Tôi tìm thấy nhiều khóa học phù hợp:',
    ask: 'Bạn muốn chọn khóa nào?',
    format: formatCourseOption,
  },
  class: {
    empty: 'Khóa học này chưa có lớp nào.',
    single: () => 'Khóa học này có 1 lớp:',
    many: 'Khóa học này có các lớp:',
    ask: 'Bạn muốn chọn lớp nào?',
    format: formatClassOption,
  },
};

export function formatCandidateList(type: CandidateType, rows: any[]): string {
  const config = LIST_CONFIG[type];
  const list = Array.isArray(rows) ? rows : [];

  if (list.length === 0) return config.empty;

  const shown = list.slice(0, MAX_LIST_ITEMS);
  const items = shown
    .map((row, index) => config.format(row, index))
    .join('\n\n');

  const header = list.length === 1 ? config.single(1) : config.many;
  const parts = [header, '', items];

  if (list.length > MAX_LIST_ITEMS) {
    parts.push(
      '',
      `Tôi chỉ hiển thị ${MAX_LIST_ITEMS} kết quả đầu tiên. Bạn hãy nhập thêm từ khóa để thu hẹp kết quả.`,
    );
  }
  if (list.length > 1) {
    parts.push('', config.ask);
  }

  return parts.join('\n');
}

/**
 * Tạo message tiếng Việt dễ đọc từ kết quả READ tool. Trả null nếu không có
 * formatter phù hợp (caller sẽ dùng message mặc định, KHÔNG dump JSON).
 */
export function formatReadResultMessage(
  toolName: string | undefined,
  result: unknown,
): string | null {
  switch (toolName) {
    case 'search_student':
    case 'get_class_students':
      return formatCandidateList('student', asRows(result));
    case 'search_course':
      return formatCandidateList('course', asRows(result));
    case 'search_class':
    case 'get_course_classes':
      return formatCandidateList('class', asRows(result));
    case 'get_student_detail':
      return formatSingle('student', result);
    case 'get_course_detail':
      return formatSingle('course', result);
    case 'get_class_detail':
      return formatSingle('class', result);
    default:
      return null;
  }
}

function asRows(result: unknown): any[] {
  return Array.isArray(result) ? result : [];
}

function formatSingle(type: CandidateType, result: unknown): string | null {
  if (!result || typeof result !== 'object') return null;
  const config = LIST_CONFIG[type];
  const body = config.format(result, 0).replace(/^1\.\s*/, '');
  const header =
    type === 'student'
      ? 'Thông tin học viên:'
      : type === 'course'
        ? 'Thông tin khóa học:'
        : 'Thông tin lớp học:';
  return `${header}\n\n${body}`;
}
