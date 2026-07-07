import { Injectable } from '@nestjs/common';
import { toSearchKey } from '../common/normalization';
import { CoursesService } from '../courses/courses.service';
import { UsersService } from '../users/users.service';
import {
  DecisionContext,
  EntityOption,
  PendingAction,
  PendingClassCreationContext,
} from './decision.types';
import { formatCandidateList } from './agent-formatters';

/**
 * Kết quả xử lý deterministic (KHÔNG cần LLM). CopilotService sẽ biến thành turn.
 */
export type DeterministicOutcome =
  | {
      type: 'message';
      message: string;
      contextPatch: Partial<DecisionContext>;
    }
  | {
      type: 'clarification';
      message: string;
      missingFields: string[];
      intent: string;
      contextPatch: Partial<DecisionContext>;
    }
  | {
      type: 'pending_write';
      pending: PendingAction;
      contextPatch: Partial<DecisionContext>;
    }
  | {
      type: 'student_form';
      message: string;
      values: Record<string, string>;
      contextPatch: Partial<DecisionContext>;
    }
  | {
      type: 'course_form';
      message: string;
      values: Record<string, string>;
      contextPatch: Partial<DecisionContext>;
    };

type SearchEntity = 'student' | 'course' | 'class';
type CourseClassType = 'WEEKLY' | 'EXAM_PRACTICE';
type ClassSessionDraft = {
  title?: string;
  dayOfWeek?: number;
  startTime?: string;
  endTime?: string;
  sessionDate?: string;
  room?: string;
  note?: string;
};
type CreateClassParsed = {
  title: string;
  courseKeyword?: string;
  type: CourseClassType;
  teacherName?: string;
  sessions: ClassSessionDraft[];
};

// Động từ tìm kiếm (đã bỏ dấu). "tra cuu" gồm 2 token tra + cuu.
const SEARCH_VERB_RE =
  /(^|\s)(tim kiem|tim|kiem|search|tra cuu|tracuu|liet ke|danh sach)(\s|$)/;
const CREATE_VERB_RE = /(^|\s)(tao|them|create|add|dang ky)(\s|$)/;
const CREATE_CLASS_VERB_RE = /(^|\s)(tao|mo|create|open)(\s|$)/;

const STUDENT_RE = /(^|\s)(hoc vien|hoc sinh|hocvien|hv|hs|student|learner)(\s|$)/;
const COURSE_RE = /(^|\s)(khoa hoc|khoa|course|chuong trinh)(\s|$)/;
const CLASS_RE = /(^|\s)(lop hoc|lop|class)(\s|$)/;

// Token bỏ ở đầu câu (động từ + danh từ thực thể + từ nối).
const LEADING_STRIP = new Set([
  'tim',
  'kiem',
  'search',
  'tra',
  'cuu',
  'tracuu',
  'liet',
  'ke',
  'danh',
  'sach',
  'tao',
  'them',
  'create',
  'add',
  'moi',
  'new',
  'hoc',
  'vien',
  'sinh',
  'hv',
  'hs',
  'student',
  'learner',
  'khoa',
  'course',
  'chuong',
  'trinh',
  'lop',
  'class',
  'cho',
  'minh',
  'giup',
  'voi',
  'theo',
  'ten',
  'name',
  'co',
  'la',
  'cua',
  'cac',
  'tat',
  'ca',
  've',
  'email',
  'mail',
  'sdt',
  'so',
  'dien',
  'thoai',
  'phone',
  'ma',
]);

// Marker đứng TRƯỚC/GIỮA phần liên hệ (số/email) và không bao giờ là tên người.
// Cố ý GIỮ LẠI các từ có thể là tên (Minh, Cho, La...) để không xóa nhầm tên.
// Các từ nối ở đầu câu ("theo", "tên", "có"...) đã được xử lý bởi LEADING_STRIP.
const CONNECTORS = new Set([
  'email',
  'mail',
  'sdt',
  'so',
  'dien',
  'thoai',
  'phone',
  'va',
  'voi',
]);

const ENROLL_VERBS = new Set([
  'them',
  'ghi',
  'danh',
  'add',
  'enroll',
  'xep',
  'dang',
  'ky',
  'gan',
  'nap',
  // Cả động từ tạo, phòng câu "tạo học viên An vào lớp X" -> lấy đúng tên "An".
  'tao',
  'create',
]);

const STUDENT_WORDS = new Set([
  'hoc',
  'vien',
  'sinh',
  'hocvien',
  'hv',
  'hs',
  'student',
  'learner',
]);

const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

@Injectable()
export class DeterministicIntentService {
  constructor(
    private readonly usersService: UsersService,
    private readonly coursesService: CoursesService,
  ) {}

  /**
   * Cố gắng xử lý message bằng RULE (không gọi LLM). Trả null nếu câu mơ hồ để
   * CopilotService fallback sang LLM.
   */
  async resolve(
    tenantId: number,
    state: DecisionContext,
    message: string,
  ): Promise<DeterministicOutcome | null> {
    const norm = toSearchKey(message);
    if (!norm) return null;

    const origTokens = message.trim().split(/\s+/).filter(Boolean);

    // 1. Ghi danh: "thêm X vào lớp/khóa Y" -> ưu tiên trước create/search.
    const enroll = this.parseEnroll(norm, origTokens);
    if (enroll) {
      return this.handleEnroll(tenantId, enroll);
    }

    // 2. Tạo lớp học trong khóa: phải xác định courseId thật trước khi preview.
    const createClass = this.parseCreateClass(message, norm);
    if (createClass) {
      return this.handleCreateClass(tenantId, createClass);
    }

    // 3. Tạo học viên: "tạo/thêm học viên ..." nhưng KHÔNG có "vào" (tránh nhầm
    // với ghi danh "thêm ... vào lớp/khóa" mà thiếu tên học viên).
    if (
      CREATE_VERB_RE.test(norm) &&
      STUDENT_RE.test(norm) &&
      !/(^|\s)vao(\s|$)/.test(norm)
    ) {
      return this.handleCreateStudent(origTokens);
    }

    // 3b. Tạo khóa học dạng "tạo khóa học (mới)" KHÔNG kèm tên -> mở preview form
    // rỗng ngay, không hỏi từng field. Nếu user có nhập tên/chi tiết thì để LLM
    // parse (ngày tháng...), nên chỉ bắt trường hợp "trống".
    if (this.isBareCreateCourse(message, norm)) {
      return this.handleBareCreateCourse();
    }

    // 3c. Cập nhật khóa học: câu ngắn kiểu "cấp độ 1", "mô tả là...", "ngày bắt
    // đầu...", "đổi tên thành..." khi đang có khóa trong ngữ cảnh -> update_course.
    const updateCourse = this.parseUpdateCourse(message, norm);
    if (updateCourse) {
      return this.handleUpdateCourse(state, updateCourse);
    }

    // 4. Tìm kiếm: cần động từ tìm + đúng 1 loại thực thể (không mơ hồ).
    const search = this.parseSearch(norm, origTokens);
    if (search) {
      return this.handleSearch(tenantId, search.entity, search.keyword);
    }

    return null;
  }

  /**
   * Fallback khi LLM lỗi/hết quota: cố gắng tìm kiếm trực tiếp trong DB. Trả null
   * nếu không suy ra được ý định tìm kiếm nào.
   */
  async fallbackSearch(
    tenantId: number,
    message: string,
  ): Promise<{ message: string; contextPatch: Partial<DecisionContext> } | null> {
    const norm = toSearchKey(message);
    if (!norm) return null;
    const origTokens = message.trim().split(/\s+/).filter(Boolean);

    const search = this.parseSearch(norm, origTokens);
    const entity: SearchEntity = search?.entity || 'student';
    const keyword =
      search?.keyword || this.extractKeyword(origTokens, entity) || '';
    if (!keyword) return null;

    const outcome = await this.handleSearch(tenantId, entity, keyword);
    if (outcome.type === 'message') {
      return { message: outcome.message, contextPatch: outcome.contextPatch };
    }
    return null;
  }

  // ---- Search --------------------------------------------------------------

  private parseSearch(
    norm: string,
    origTokens: string[],
  ): { entity: SearchEntity; keyword: string } | null {
    if (!SEARCH_VERB_RE.test(norm)) return null;

    const isStudent = STUDENT_RE.test(norm);
    const isCourse = COURSE_RE.test(norm);
    const isClass = CLASS_RE.test(norm);
    const matched = [isStudent, isCourse, isClass].filter(Boolean).length;

    let entity: SearchEntity | null = null;
    if (matched === 1) {
      entity = isStudent ? 'student' : isCourse ? 'course' : 'class';
    } else if (matched === 0) {
      // Không nêu thực thể nhưng có email/SĐT -> mặc định tìm học viên.
      if (this.hasContactSignal(origTokens)) entity = 'student';
    }
    if (!entity) return null;

    const keyword = this.extractKeyword(origTokens, entity);
    return { entity, keyword };
  }

  private async handleSearch(
    tenantId: number,
    entity: SearchEntity,
    keyword: string,
  ): Promise<DeterministicOutcome> {
    const rows = await this.runSearch(tenantId, entity, keyword);
    const options = this.toOptions(rows);
    const message = formatCandidateList(entity, rows);
    const contextPatch: Partial<DecisionContext> = {
      last_intent:
        entity === 'student'
          ? 'search_student'
          : entity === 'course'
            ? 'search_course'
            : 'search_class',
      last_candidates: {
        [entity === 'class' ? 'classes' : `${entity}s`]: options,
      } as DecisionContext['last_candidates'],
    };
    return { type: 'message', message, contextPatch };
  }

  private runSearch(
    tenantId: number,
    entity: SearchEntity,
    keyword: string,
  ): Promise<any[]> {
    if (entity === 'student') {
      return this.usersService.searchStudents(tenantId, keyword);
    }
    if (entity === 'course') {
      return this.coursesService.searchCourses(tenantId, keyword);
    }
    return this.coursesService.searchClasses(tenantId, keyword);
  }

  // ---- Create course (bare) ------------------------------------------------

  /**
   * true nếu câu là "tạo/thêm khóa (học) (mới)" KHÔNG kèm tên/chi tiết -> mở preview
   * form rỗng thay vì hỏi tên. Có tên/chi tiết -> false (để LLM parse ngày tháng).
   */
  private isBareCreateCourse(message: string, norm: string): boolean {
    if (!CREATE_VERB_RE.test(norm)) return false;
    if (!COURSE_RE.test(norm)) return false;
    if (CLASS_RE.test(norm)) return false; // "tạo lớp trong khóa" -> không phải
    if (/(^|\s)vao(\s|$)/.test(norm)) return false; // ghi danh

    const match = message.match(
      /(?:khóa học|khoa hoc|khóa|khoa|course|chương trình|chuong trinh)\s*(.*)$/i,
    );
    const rest = match ? toSearchKey(match[1]) : '';
    // Bỏ các từ đệm phổ biến; nếu không còn gì -> là câu "trống".
    const cleaned = rest
      .replace(
        /\b(moi|new|cho|toi|minh|giup|dum|ho|voi|mot|1|nhe|di|a|dao tao)\b/g,
        '',
      )
      .replace(/\s+/g, ' ')
      .trim();
    return cleaned.length === 0;
  }

  private handleBareCreateCourse(): DeterministicOutcome {
    // Trả FORM nhập liệu (giống tạo học viên), KHÔNG tạo pending_action ngay ->
    // không khóa ô chat. Chỉ khi user bấm "Xem trước" mới sang preview/confirm.
    return {
      type: 'course_form',
      message:
        'Bạn điền thông tin khóa học vào form bên dưới rồi bấm "Xem trước" để mình kiểm tra và tạo nhé.',
      values: {},
      contextPatch: { last_intent: 'create_course' },
    };
  }

  // ---- Update course -------------------------------------------------------

  /**
   * Nhận diện câu cập nhật khóa học ngắn ("cấp độ 1", "mô tả là...", "ngày bắt
   * đầu...", "đổi tên thành..."). Trả về field cần đổi, hoặc null nếu không phải.
   */
  private parseUpdateCourse(
    message: string,
    norm: string,
  ): { fields: Record<string, string> } | null {
    // Loại trừ các intent khác để tránh false positive.
    if (/(^|\s)vao(\s|$)/.test(norm)) return null; // ghi danh
    if (CLASS_RE.test(norm)) return null; // liên quan lớp
    if (STUDENT_RE.test(norm)) return null; // liên quan học viên
    if (SEARCH_VERB_RE.test(norm)) return null; // tìm kiếm
    if (CREATE_VERB_RE.test(norm) && COURSE_RE.test(norm)) return null; // tạo khóa

    const fields = this.parseCourseUpdateFields(message);
    const hasUpdateVerb =
      /(^|\s)(cap nhat|chinh sua|sua|thay doi|update)(\s|$)/.test(norm) ||
      /(^|\s)doi (ten|ma|trang thai)/.test(norm);

    if (Object.keys(fields).length === 0 && !hasUpdateVerb) return null;
    return { fields };
  }

  private handleUpdateCourse(
    state: DecisionContext,
    parsed: { fields: Record<string, string> },
  ): DeterministicOutcome {
    const course = this.resolveContextCourse(state);
    if (!course) {
      return {
        type: 'clarification',
        message:
          'Bạn muốn cập nhật khóa học nào? Vui lòng nhập tên khóa học hoặc mã khóa học.',
        missingFields: ['courseId'],
        intent: 'update_course',
        contextPatch: { last_intent: 'update_course' },
      };
    }

    if (Object.keys(parsed.fields).length === 0) {
      return {
        type: 'clarification',
        message: `Bạn muốn cập nhật thông tin gì cho khóa học "${course.label}"? (tên, mã, cấp độ, mô tả, ngày bắt đầu/kết thúc)`,
        missingFields: [],
        intent: 'update_course',
        contextPatch: {
          last_intent: 'update_course',
          selected_course_id: course.id,
        },
      };
    }

    const input: Record<string, unknown> = {
      courseId: course.id,
      ...parsed.fields,
    };
    const displayInput: Record<string, unknown> = {
      ...input,
      courseName: course.label,
    };
    const pending: PendingAction = {
      tool_name: 'update_course',
      input,
      display_input: displayInput,
      summary: `Cập nhật khóa học ${course.label}`,
      intent: 'update_course',
      status: 'waiting_confirm',
      severity: 'default',
    };
    return {
      type: 'pending_write',
      pending,
      contextPatch: {
        last_intent: 'update_course',
        selected_course_id: course.id,
      },
    };
  }

  /** Khóa học đang chọn/vừa tạo trong ngữ cảnh, hoặc null. */
  private resolveContextCourse(
    state: DecisionContext,
  ): { id: number; label: string } | null {
    const opt = state.last_selected_course || state.last_created_course || null;
    const id = Number(state.selected_course_id) || Number(opt?.id) || 0;
    if (!id) return null;
    return { id, label: String(opt?.label || `#${id}`) };
  }

  /** Bóc các field cập nhật khóa học từ câu tiếng Việt. */
  private parseCourseUpdateFields(message: string): Record<string, string> {
    const fields: Record<string, string> = {};
    const NEXT =
      '(?=,|;|\\.|$|\\s+cấp\\s*độ|\\s+mô\\s*tả|\\s+ngày|\\s+đổi|\\s+tên\\s+khóa|\\s+mã\\s+khóa|\\s+trạng\\s*thái)';

    // Ngày bắt đầu / kết thúc (parse nhiều dạng, kể cả 31/072026).
    const start = message.match(
      /ngày\s+bắt\s+đầu\s*(?:là|:)?\s*([0-9][0-9/\-.]{4,})/iu,
    );
    if (start) {
      const iso = this.parseViDate(start[1]);
      if (iso) fields.startDate = iso;
    }
    const end = message.match(
      /ngày\s+(?:kết\s+thúc|hết\s+hạn)\s*(?:là|:)?\s*([0-9][0-9/\-.]{4,})/iu,
    );
    if (end) {
      const iso = this.parseViDate(end[1]);
      if (iso) fields.expireDate = iso;
    }

    // Đổi tên -> title.
    const title = message.match(
      new RegExp(
        `(?:đổi\\s+tên|tên\\s+khóa)\\s*(?:khóa\\s*(?:này|học)?)?\\s*(?:thành|là|:)?\\s*(.+?)${NEXT}`,
        'iu',
      ),
    );
    if (title && title[1].trim()) fields.title = title[1].trim();

    // Đổi mã -> courseCode.
    const code = message.match(
      /(?:đổi\s+mã|mã\s+khóa)\s*(?:khóa\s*(?:này|học)?)?\s*(?:thành|là|:)?\s*([A-Za-z0-9_\-]+)/iu,
    );
    if (code && code[1].trim()) fields.courseCode = code[1].trim();

    // Cấp độ: số -> "Cấp độ N"; chữ -> title-case.
    const level = message.match(
      new RegExp(`cấp\\s*độ\\s*(?:là|:)?\\s*(.+?)${NEXT}`, 'iu'),
    );
    if (level && level[1].trim()) {
      const raw = level[1].trim();
      fields.level = /^\d+$/.test(raw)
        ? `Cấp độ ${raw}`
        : raw.charAt(0).toUpperCase() + raw.slice(1);
    }

    // Trạng thái.
    const status = message.match(/trạng\s*thái\s*(?:là|:)?\s*([A-Za-z_]+)/iu);
    if (status && status[1].trim()) fields.status = status[1].trim();

    // Mô tả: "mô tả là ..." hoặc "khóa học dành cho ...".
    const desc = message.match(/mô\s*tả\s*(?:là|:)?\s*(.+)$/iu);
    if (desc && desc[1].trim()) {
      const raw = desc[1].trim();
      fields.description = raw.charAt(0).toUpperCase() + raw.slice(1);
    } else {
      const forWho = message.match(/(khóa\s*học\s+dành\s+cho\s+.+)$/iu);
      if (forWho && forWho[1].trim()) {
        const raw = forWho[1].trim();
        fields.description = raw.charAt(0).toUpperCase() + raw.slice(1);
      }
    }

    return fields;
  }

  /** Parse ngày tiếng Việt (dd/mm/yyyy, dd-mm-yyyy, 31/072026...) -> ISO. */
  private parseViDate(raw: string): string | undefined {
    const s = raw.trim().replace(/[.\-]/g, '/');
    const toIso = (d: string, m: string, y: string): string | undefined => {
      const dd = Number(d);
      const mm = Number(m);
      const yy = Number(y);
      if (mm < 1 || mm > 12 || dd < 1 || dd > 31 || yy < 1900) return undefined;
      return `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    };
    let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return toIso(m[1], m[2], m[3]);
    // Thiếu 1 dấu "/": 31/072026 -> 31 / 07 / 2026
    m = s.match(/^(\d{1,2})\/(\d{2})(\d{4})$/);
    if (m) return toIso(m[1], m[2], m[3]);
    // Không dấu: 31072026
    m = s.match(/^(\d{2})(\d{2})(\d{4})$/);
    if (m) return toIso(m[1], m[2], m[3]);
    // Đã là ISO yyyy/mm/dd
    m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
    if (m)
      return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    return undefined;
  }

  // ---- Create student ------------------------------------------------------

  private handleCreateStudent(origTokens: string[]): DeterministicOutcome {
    // Strip trailing commas (user hay nhập "tên, email, ngày")
    const cleanedTokens = origTokens.map((t) => t.replace(/,+$/, ''));

    const rest = this.stripLeading(cleanedTokens).filter(
      (token) => !CONNECTORS.has(toSearchKey(token)),
    );

    const emailToken = rest.find((token) => EMAIL_RE.test(token));

    const phoneToken = rest.find(
      (token) => !EMAIL_RE.test(token) && this.looksLikePhone(token),
    );

    // Nhận diện ngày sinh DD/MM/YYYY hoặc DD-MM-YYYY
    const birthdateToken = rest.find(
      (token) =>
        token !== emailToken &&
        token !== phoneToken &&
        /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}$/.test(token),
    );

    const birthDate = birthdateToken
      ? (() => {
          const sep = birthdateToken.includes('/') ? '/' : '-';
          const [d, m, y] = birthdateToken.split(sep);
          return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
        })()
      : undefined;

    const nameTokens = rest.filter(
      (token) =>
        token !== emailToken &&
        token !== phoneToken &&
        token !== birthdateToken,
    );

    const fullName = nameTokens.join(' ').trim();

    const clearedCandidates: Partial<DecisionContext> = {
      last_intent: 'create_student',
      last_candidates: { students: [], courses: [], classes: [] },
    };

    // Thiếu tên -> KHÔNG hỏi cụt lủn nữa. Trả về form nhập liệu (điền sẵn những
    // gì user đã cung cấp) để user điền đủ trong 1 bước, sau đó đi tiếp preview.
    if (!fullName) {
      const values: Record<string, string> = {};
      if (emailToken) values.email = emailToken;
      if (phoneToken) values.phone = phoneToken;
      if (birthDate) values.birthDate = birthDate;
      return {
        type: 'student_form',
        message:
          'Bạn điền thông tin học viên vào form bên dưới rồi bấm "Xem trước" để mình kiểm tra và tạo nhé.',
        values,
        contextPatch: clearedCandidates,
      };
    }

    const input: Record<string, unknown> = { fullName };

    if (emailToken) input.email = emailToken;
    if (phoneToken) input.phone = phoneToken;
    if (birthDate) input.birthDate = birthDate;

    const pending: PendingAction = {
      tool_name: 'create_student',
      input,
      display_input: input,
      summary: `Tạo học viên mới: ${fullName}`,
      intent: 'create_student',
      status: 'waiting_confirm',
      severity: 'default',
    };

    return {
      type: 'pending_write',
      pending,
      contextPatch: clearedCandidates,
    };
  }

  // ---- Create class --------------------------------------------------------

  private parseCreateClass(
    message: string,
    norm: string,
  ): CreateClassParsed | null {
    if (!CREATE_CLASS_VERB_RE.test(norm) || !CLASS_RE.test(norm)) return null;

    // Bỏ qua từ đệm giữa động từ và danh từ "lớp" (vd "tạo cho tôi 1 lớp học...").
    // Lấy phần sau lần xuất hiện đầu tiên của danh từ lớp.
    const match = message.match(
      /(?:lớp học|lop hoc|lớp|lop|class)\s+(.+)$/i,
    );

    const type = this.parseClassType(message);
    const teacherName = this.parseTeacherName(message);
    const sessions = this.parseClassSessions(message);

    // "tạo lớp" trống -> thiếu cả tên lẫn khóa, vẫn nhận intent để hỏi tiếp.
    const rest = match ? match[1].trim() : '';
    if (!rest) {
      return { title: '', courseKeyword: undefined, type, teacherName, sessions };
    }

    const { titlePart, courseKeyword } = this.splitCreateClassParts(rest);
    let title = this.cleanText(titlePart);
    // "theo tuần"/"hàng tuần"... chỉ là loại lớp, KHÔNG phải tên -> để trống,
    // sẽ hỏi tên lớp ngắn gọn ở bước sau.
    if (this.isBareClassTypePhrase(title)) title = '';

    return { title, courseKeyword, type, teacherName, sessions };
  }

  /** true nếu "tên lớp" thực chất chỉ là cụm mô tả loại lớp theo tuần. */
  private isBareClassTypePhrase(title: string): boolean {
    const key = toSearchKey(title);
    return [
      'theo tuan',
      'hang tuan',
      'lop tuan',
      'lop thuong',
      'thuong',
      'weekly',
      'hoc hang tuan',
      'theo tuan hoc',
    ].includes(key);
  }

  private async handleCreateClass(
    tenantId: number,
    parsed: CreateClassParsed,
  ): Promise<DeterministicOutcome> {
    const contextBase: Partial<DecisionContext> = {
      last_intent: 'create_class',
    };

    // Thiếu khóa -> hỏi khóa trước (chưa cần tên lớp).
    if (!parsed.courseKeyword) {
      return {
        type: 'clarification',
        message: 'Bạn muốn tạo lớp trong khóa học nào?',
        missingFields: ['courseId'],
        intent: 'create_class',
        contextPatch: contextBase,
      };
    }

    const courses = await this.coursesService.searchCourses(
      tenantId,
      parsed.courseKeyword,
    );
    const courseOptions = this.toOptions(courses);

    if (courses.length === 0) {
      return {
        type: 'clarification',
        message:
          'Mình chưa tìm thấy khóa học phù hợp. Bạn muốn tạo lớp trong khóa học nào?',
        missingFields: ['courseId'],
        intent: 'create_class',
        contextPatch: {
          ...contextBase,
          last_candidates: { courses: [] },
        },
      };
    }

    if (courses.length > 1) {
      const rows = courses
        .slice(0, 10)
        .map((course: any, index) => {
          const code = course.courseCode ? ` (${course.courseCode})` : '';
          return `${index + 1}. ${course.title || course.name || `#${course.id}`}${code}`;
        })
        .join('\n');
      return {
        type: 'clarification',
        message: `Mình tìm thấy nhiều khóa ${parsed.courseKeyword}. Bạn muốn tạo lớp trong khóa nào?\n\n${rows}`,
        missingFields: ['courseId'],
        intent: 'create_class',
        contextPatch: {
          ...contextBase,
          last_candidates: { courses: courseOptions },
        },
      };
    }

    const course: any = courses[0];
    const courseLabel = course.title || course.courseCode || `#${course.id}`;
    const courseCtx: Partial<DecisionContext> = {
      ...contextBase,
      selected_course_id: Number(course.id),
      last_selected_course: this.toOptions([course])[0] || null,
      last_candidates: { courses: [] },
    };

    // Đã có khóa nhưng thiếu tên lớp -> hỏi NGẮN GỌN và lưu context để lượt sau
    // user chỉ cần trả lời tên lớp là tạo preview ngay (không hỏi thêm gì nữa).
    if (!parsed.title) {
      const pendingClass: PendingClassCreationContext = {
        courseId: Number(course.id),
        courseTitle: course.title ?? null,
        courseCode: course.courseCode ?? null,
        type: parsed.type,
      };
      return {
        type: 'clarification',
        message: 'Bạn muốn đặt tên lớp là gì?',
        missingFields: ['title'],
        intent: 'create_class',
        contextPatch: { ...courseCtx, pending_class_creation: pendingClass },
      };
    }

    // Đủ khóa + tên -> preview ngay. KHÔNG hỏi ngày/giáo viên/lịch học.
    return {
      type: 'pending_write',
      pending: this.buildCreateClassPending({
        courseId: Number(course.id),
        courseLabel,
        title: parsed.title,
        type: parsed.type,
        teacherName: parsed.teacherName,
        sessions: parsed.sessions,
      }),
      contextPatch: courseCtx,
    };
  }

  /**
   * Dựng PendingAction create_class dạng "form linh hoạt": chỉ courseId + title là
   * bắt buộc, các field phụ để trống (preview form ở FE cho sửa/để trống).
   */
  buildCreateClassPending(params: {
    courseId: number;
    courseLabel?: string | null;
    title: string;
    type: 'WEEKLY' | 'EXAM_PRACTICE';
    teacherName?: string;
    sessions?: ClassSessionDraft[];
  }): PendingAction {
    const sessions = params.sessions ?? [];
    const input: Record<string, unknown> = {
      courseId: params.courseId,
      title: params.title,
      type: params.type,
      sessions,
    };
    if (params.teacherName) input.teacherName = params.teacherName;

    const courseLabel = params.courseLabel || `#${params.courseId}`;
    const displayInput: Record<string, unknown> = {
      ...input,
      courseName: courseLabel,
    };

    return {
      tool_name: 'create_class',
      input,
      display_input: displayInput,
      summary: `Tạo lớp học mới: ${params.title} trong khóa ${courseLabel}`,
      intent: 'create_class',
      status: 'waiting_confirm',
      severity: 'default',
    };
  }

  // ---- Enroll --------------------------------------------------------------

  private parseEnroll(
    norm: string,
    origTokens: string[],
  ): {
    studentKeyword: string;
    target: 'course' | 'class';
    targetKeyword: string;
  } | null {
    const normTokens = origTokens.map((token) => toSearchKey(token));
    const vaoIndex = normTokens.indexOf('vao');
    if (vaoIndex < 0 || vaoIndex >= normTokens.length - 1) return null;

    const after = normTokens.slice(vaoIndex + 1);
    // Loại thực thể đích ngay sau "vào".
    let targetType: 'course' | 'class' | null = null;
    let targetStart = vaoIndex + 1;
    for (let i = 0; i < after.length; i += 1) {
      if (['lop', 'class'].includes(after[i])) {
        targetType = 'class';
        targetStart = vaoIndex + 1 + i + 1;
        break;
      }
      if (['khoa', 'course'].includes(after[i])) {
        targetType = 'course';
        targetStart = vaoIndex + 1 + i + 1;
        break;
      }
    }
    if (!targetType) return null;

    // "lớp học"/"khóa học" -> bỏ luôn "học" đứng ngay sau.
    if (toSearchKey(origTokens[targetStart] || '') === 'hoc') targetStart += 1;

    const targetKeyword = origTokens.slice(targetStart).join(' ').trim();

    // Phần học viên: các token trước "vào", bỏ động từ + danh từ học viên.
    const studentTokens = origTokens
      .slice(0, vaoIndex)
      .filter((token) => {
        const key = toSearchKey(token);
        return !ENROLL_VERBS.has(key) && !STUDENT_WORDS.has(key);
      });
    const studentKeyword = studentTokens.join(' ').trim();

    if (!studentKeyword || !targetKeyword) return null;
    return { studentKeyword, target: targetType, targetKeyword };
  }

  private async handleEnroll(
    tenantId: number,
    enroll: {
      studentKeyword: string;
      target: 'course' | 'class';
      targetKeyword: string;
    },
  ): Promise<DeterministicOutcome> {
    const students = await this.usersService.searchStudents(
      tenantId,
      enroll.studentKeyword,
    );
    if (students.length === 0) {
      return this.notFound(
        'student',
        enroll.studentKeyword,
        this.toOptions([]),
      );
    }
    if (students.length > 1) {
      return this.chooseFrom('student', students);
    }
    const student = students[0];

    if (enroll.target === 'class') {
      const classes = await this.coursesService.searchClasses(
        tenantId,
        enroll.targetKeyword,
      );
      if (classes.length === 0) {
        return this.notFound('class', enroll.targetKeyword, this.toOptions([]));
      }
      if (classes.length > 1) {
        return this.chooseFrom('class', classes);
      }
      const cls: any = classes[0];
      return this.buildEnrollPending(student, {
        courseId: Number(cls.courseId ?? cls.course?.id),
        classId: Number(cls.id),
        courseLabel: cls.course?.title || cls.course?.courseCode,
        classLabel: cls.title || cls.classCode,
      });
    }

    const courses = await this.coursesService.searchCourses(
      tenantId,
      enroll.targetKeyword,
    );
    if (courses.length === 0) {
      return this.notFound('course', enroll.targetKeyword, this.toOptions([]));
    }
    if (courses.length > 1) {
      return this.chooseFrom('course', courses);
    }
    const course: any = courses[0];
    return this.buildEnrollPending(student, {
      courseId: Number(course.id),
      courseLabel: course.title || course.courseCode,
    });
  }

  private buildEnrollPending(
    student: any,
    target: {
      courseId: number;
      classId?: number;
      courseLabel?: string;
      classLabel?: string;
    },
  ): DeterministicOutcome {
    const studentLabel = student.fullName || student.name || `#${student.id}`;
    const input: Record<string, unknown> = {
      userId: Number(student.id),
      courseId: target.courseId,
    };
    if (target.classId) input.classId = target.classId;

    const displayInput: Record<string, unknown> = {
      ...input,
      studentName: studentLabel,
      courseName: target.courseLabel,
    };
    if (target.classLabel) displayInput.className = target.classLabel;

    const pending: PendingAction = {
      tool_name: 'assign_student_to_course',
      input,
      display_input: displayInput,
      summary: `Ghi danh học viên ${studentLabel} vào ${
        target.classLabel
          ? `lớp ${target.classLabel}`
          : `khóa ${target.courseLabel || `#${target.courseId}`}`
      }`,
      intent: 'assign_student_to_course',
      status: 'waiting_confirm',
      severity: 'default',
    };
    return {
      type: 'pending_write',
      pending,
      contextPatch: {
        last_intent: 'assign_student_to_course',
        selected_student_id: Number(student.id),
        selected_course_id: target.courseId,
        selected_class_id: target.classId ?? null,
      },
    };
  }

  // ---- Create class helpers ------------------------------------------------

  private splitCreateClassParts(rest: string): {
    titlePart: string;
    courseKeyword?: string;
  } {
    const courseMarker = rest.match(
      /\s*(?:,|\s)\s*(?:(?:trong|cho|thuộc|thuoc)\s+)?(?:khóa học|khoa hoc|khóa|khoa|course)\s+/i,
    );

    if (!courseMarker || courseMarker.index === undefined) {
      return {
        titlePart: this.stripClassDetailSuffix(rest).titlePart,
      };
    }

    const titlePart = rest.slice(0, courseMarker.index);
    const courseRest = rest
      .slice(courseMarker.index + courseMarker[0].length)
      .trim();
    const courseParts = this.splitCourseKeywordAndDetails(courseRest);

    return {
      titlePart,
      courseKeyword: this.cleanText(courseParts.courseKeyword),
    };
  }

  private splitCourseKeywordAndDetails(value: string): {
    courseKeyword: string;
    details: string;
  } {
    const detailMarker = value.match(
      /\s+(?:học|hoc|lịch|lich|thứ|thu|phòng|phong|room|giáo viên|giao vien|gv|teacher|từ|tu)\b/i,
    );

    if (!detailMarker || detailMarker.index === undefined) {
      return { courseKeyword: value, details: '' };
    }

    return {
      courseKeyword: value.slice(0, detailMarker.index),
      details: value.slice(detailMarker.index).trim(),
    };
  }

  private stripClassDetailSuffix(value: string): {
    titlePart: string;
    details: string;
  } {
    const detailMarker = value.match(
      /\s+(?:học|hoc|lịch|lich|thứ|thu|phòng|phong|room|giáo viên|giao vien|gv|teacher|từ|tu)\b/i,
    );

    if (!detailMarker || detailMarker.index === undefined) {
      return { titlePart: value, details: '' };
    }

    return {
      titlePart: value.slice(0, detailMarker.index),
      details: value.slice(detailMarker.index).trim(),
    };
  }

  private parseClassType(message: string): CourseClassType {
    const norm = toSearchKey(message);
    if (
      /(^|\s)(luyen de|on de|giai de|mock test|test practice|exam practice)(\s|$)/.test(
        norm,
      )
    ) {
      return 'EXAM_PRACTICE';
    }
    return 'WEEKLY';
  }

  private parseClassSessions(message: string): ClassSessionDraft[] {
    const days = this.parseWeekDays(message);
    if (!days.length) return [];

    const timeRange = this.parseTimeRange(message);
    const room = this.parseRoom(message);

    return days.map((dayOfWeek) => ({
      title:
        dayOfWeek === 0 ? 'Buổi học chủ nhật' : `Buổi học thứ ${dayOfWeek}`,
      dayOfWeek,
      ...(timeRange.startTime ? { startTime: timeRange.startTime } : {}),
      ...(timeRange.endTime ? { endTime: timeRange.endTime } : {}),
      ...(room ? { room } : {}),
    }));
  }

  private parseWeekDays(message: string): number[] {
    const norm = toSearchKey(message).replace(/[,.;:]+/g, ' ');
    const tokens = norm.split(/\s+/).filter(Boolean);
    const days = new Set<number>();

    for (let i = 0; i < tokens.length; i += 1) {
      if (tokens[i] === 'chu' && tokens[i + 1] === 'nhat') {
        days.add(0);
        i += 1;
        continue;
      }

      if (tokens[i] !== 'thu') continue;

      for (let j = i + 1; j < tokens.length; j += 1) {
        const token = tokens[j];
        if (/^[2-7]$/.test(token)) {
          days.add(Number(token));
          continue;
        }
        if (['va', 'v', '&'].includes(token)) continue;
        break;
      }
    }

    return Array.from(days);
  }

  private parseTimeRange(message: string): {
    startTime?: string;
    endTime?: string;
  } {
    const matches = Array.from(
      message.matchAll(/(\d{1,2})\s*h\s*(\d{1,2})?(?![\p{L}])/giu),
    );
    if (!matches.length) return {};

    const startTime = this.normalizeTime(matches[0][1], matches[0][2]);
    const endTime = matches[1]
      ? this.normalizeTime(matches[1][1], matches[1][2])
      : undefined;

    return { startTime, endTime };
  }

  private normalizeTime(hourText: string, minuteText?: string): string {
    const hour = Number(hourText);
    const minute = minuteText ? Number(minuteText) : 0;
    if (
      !Number.isFinite(hour) ||
      !Number.isFinite(minute) ||
      hour < 0 ||
      hour > 23 ||
      minute < 0 ||
      minute > 59
    ) {
      return '';
    }

    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  private parseRoom(message: string): string | undefined {
    const explicit = message.match(/\b(?:phòng|phong|room)\s+([A-Za-z0-9_-]+)/i);
    if (explicit?.[1]) return explicit[1].replace(/[,.]+$/, '');

    const shorthand = message.match(/\bP\d{2,4}\b/i);
    return shorthand?.[0];
  }

  private parseTeacherName(message: string): string | undefined {
    const match = message.match(/(?:giáo viên|giao vien|teacher|gv)\s+(.+)$/i);
    if (!match?.[1]) return undefined;

    const name = match[1]
      .replace(
        /\s+(?:học|hoc|lịch|lich|thứ|thu|phòng|phong|room)\b.*$/i,
        '',
      )
      .replace(/[,.]+$/, '')
      .trim();

    return name || undefined;
  }

  private cleanText(value: string): string {
    return value.replace(/^[,\s]+|[,\s]+$/g, '').trim();
  }

  // ---- Helpers -------------------------------------------------------------

  private chooseFrom(entity: SearchEntity, rows: any[]): DeterministicOutcome {
    const options = this.toOptions(rows);
    const message = formatCandidateList(entity, rows);
    return {
      type: 'clarification',
      message,
      missingFields: [entity === 'student' ? 'userId' : `${entity}Id`],
      intent: 'assign_student_to_course',
      contextPatch: {
        last_candidates: {
          [entity === 'class' ? 'classes' : `${entity}s`]: options,
        } as DecisionContext['last_candidates'],
      },
    };
  }

  private notFound(
    entity: SearchEntity,
    keyword: string,
    _options: EntityOption[],
  ): DeterministicOutcome {
    const label =
      entity === 'student' ? 'học viên' : entity === 'course' ? 'khóa học' : 'lớp';
    return {
      type: 'message',
      message: `Không tìm thấy ${label} nào phù hợp với "${keyword}". Bạn kiểm tra lại từ khóa giúp mình nhé.`,
      contextPatch: {},
    };
  }

  private hasContactSignal(origTokens: string[]): boolean {
    return origTokens.some(
      (token) => EMAIL_RE.test(token) || this.looksLikePhone(token),
    );
  }

  private looksLikePhone(token: string): boolean {
    const digits = token.replace(/\D/g, '');
    return digits.length >= 9 && digits.length <= 12 && /\d/.test(token);
  }

  private stripLeading(origTokens: string[]): string[] {
    let start = 0;
    while (
      start < origTokens.length &&
      LEADING_STRIP.has(toSearchKey(origTokens[start]))
    ) {
      start += 1;
    }
    return origTokens.slice(start);
  }

  private extractKeyword(origTokens: string[], _entity: SearchEntity): string {
    const rest = this.stripLeading(origTokens).filter(
      (token) => !CONNECTORS.has(toSearchKey(token)),
    );
    return rest.join(' ').trim();
  }

  private toOptions(rows: any[]): EntityOption[] {
    return (rows || []).slice(0, 10).map((row: any) => ({
      id: Number(row.id),
      value: Number(row.id),
      label: String(row.fullName || row.title || row.name || `#${row.id}`),
      email: row.email ?? null,
      phone: row.phone ?? null,
      description: [row.phone, row.email, row.courseCode, row.classCode]
        .filter(Boolean)
        .join(' | '),
      metadata: row,
    }));
  }
}
