import { Injectable } from '@nestjs/common';
import { toSearchKey } from '../common/normalization';
import { CoursesService } from '../courses/courses.service';
import { UsersService } from '../users/users.service';
import {
  AiIntent,
  ClassTableRow,
  DecisionContext,
  EntityOption,
  PendingAction,
  PendingClassCreationContext,
  PendingEnrollmentContext,
  StudentTableRow,
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
    }
  | {
      type: 'student_table';
      title: string;
      message?: string;
      scope: 'course' | 'class' | 'system';
      students: StudentTableRow[];
      contextPatch: Partial<DecisionContext>;
    }
  | {
      type: 'class_table';
      title: string;
      message?: string;
      classes: ClassTableRow[];
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
  startDate?: string;
  endDate?: string;
};

// Động từ tìm kiếm (đã bỏ dấu). "tra cuu" gồm 2 token tra + cuu.
const SEARCH_VERB_RE =
  /(^|\s)(tim kiem|tim|kiem|search|tra cuu|tracuu|liet ke|danh sach)(\s|$)/;
const CREATE_VERB_RE = /(^|\s)(tao|them|create|add|dang ky)(\s|$)/;
const CREATE_CLASS_VERB_RE = /(^|\s)(tao|mo|create|open)(\s|$)/;

const STUDENT_RE =
  /(^|\s)(hoc vien|hoc sinh|hocvien|hv|hs|student|learner)(\s|$)/;
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
  'toi',
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

// Cụm THAM CHIẾU ngữ cảnh thay cho tên thật: "bên trên", "vừa tạo", "này",
// "đó", "vừa rồi"... So khớp trên chuỗi đã normalize (không dấu): MỌI token
// phải thuộc CORE ∪ FILLER và có ít nhất 1 token CORE. Tên người/lớp thật gần
// như không bao giờ chỉ gồm các từ này nên rủi ro nhầm rất thấp.
const CONTEXT_REF_CORE = new Set([
  'tren',
  'vua',
  'moi',
  'do',
  'day',
  'nay',
  'kia',
  'truoc',
]);
const CONTEXT_REF_FILLER = new Set([
  'ben',
  'o',
  'phia',
  'tao',
  'them',
  'nhac',
  'den',
  'toi',
  'xong',
  'roi',
  'luc',
  'ban',
  'minh',
  'em',
  'anh',
  'chi',
  'cai',
  'ma',
  // Đuôi lịch sự gõ KHÔNG dấu mà stripPoliteTail (regex có dấu) bỏ sót.
  'cho',
  'giup',
  'gium',
  'ho',
  'nhe',
  'nha',
  'a',
  'voi',
  'di',
]);

const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

// Ngày sinh DD/MM/YYYY hoặc DD-MM-YYYY.
const BIRTHDATE_RE = /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}$/;

// Động từ sửa/xóa: câu chứa các từ này KHÔNG phải follow-up bổ sung thông tin
// tạo học viên (tránh hijack "cập nhật sđt 09..." thành create_student).
const MODIFY_VERB_RE =
  /(^|\s)(sua|cap nhat|capnhat|chinh sua|thay doi|update|edit|doi|xoa|delete|remove|huy)(\s|$)/;

// Động từ cập nhật MẠNH (không thể là tên riêng như "Sửa"/"Đổi") — dùng để
// phân xử câu vừa có động từ tạo vừa có động từ sửa ("cập nhật thêm sđt...").
const STRONG_UPDATE_VERB_RE =
  /(^|\s)(cap nhat|capnhat|chinh sua|thay doi|update|edit)(\s|$)/;

// Động từ xem danh sách học viên trong khóa/lớp ("xem ds", "liệt kê", "cho tôi
// xem danh sách", "tất cả học viên"...).
const LIST_STUDENTS_VERB_RE =
  /(^|\s)(xem|hien thi|danh sach|ds|liet ke|list|show|tim kiem|tim|kiem|tat ca)(\s|$)/;

// Tên tỉnh/thành VN (key đã normalize qua toSearchKey) để nhận diện phần đuôi
// địa chỉ trong câu KHÔNG có dấu phẩy ("tên Hoang Anh Toan Hà Nội").
// Heuristic: chỉ dùng cho cụm >= 2 token ở đuôi tên (một số tỉnh trùng tên
// người như "Hòa Bình", "Long An" -> chấp nhận rủi ro nhỏ này).
const VN_PROVINCE_KEYS = new Set([
  'an giang',
  'ba ria vung tau',
  'vung tau',
  'bac giang',
  'bac kan',
  'bac lieu',
  'bac ninh',
  'ben tre',
  'bien hoa',
  'binh dinh',
  'binh duong',
  'binh phuoc',
  'binh thuan',
  'buon ma thuot',
  'ca mau',
  'can tho',
  'cao bang',
  'da lat',
  'da nang',
  'dak lak',
  'dak nong',
  'dien bien',
  'dong nai',
  'dong thap',
  'gia lai',
  'ha giang',
  'ha long',
  'ha nam',
  'ha noi',
  'ha tinh',
  'hai duong',
  'hai phong',
  'hau giang',
  'hoa binh',
  'ho chi minh',
  'hung yen',
  'khanh hoa',
  'kien giang',
  'kon tum',
  'lai chau',
  'lam dong',
  'lang son',
  'lao cai',
  'long an',
  'nam dinh',
  'nghe an',
  'nha trang',
  'ninh binh',
  'ninh thuan',
  'phu tho',
  'phu yen',
  'quang binh',
  'quang nam',
  'quang ngai',
  'quang ninh',
  'quang tri',
  'quy nhon',
  'sai gon',
  'soc trang',
  'son la',
  'tay ninh',
  'thai binh',
  'thai nguyen',
  'thanh hoa',
  'thua thien hue',
  'thu duc',
  'tien giang',
  'tp hcm',
  'tp ho chi minh',
  'tphcm',
  'hcm',
  'tra vinh',
  'tuyen quang',
  'viet tri',
  'vinh long',
  'vinh phuc',
  'yen bai',
]);

export type ParsedStudentInfo = {
  fullName: string;
  email?: string;
  phone?: string;
  birthDate?: string;
  address?: string;
};

// Nhãn field user hay gõ kèm đầu mỗi segment ("địa chỉ Ninh Bình",
// "sđt 0987...", "ngày sinh 12/03/2000") -> bỏ nhãn trước khi phân loại.
const SEGMENT_FIELD_LABEL_RE =
  /^(họ\s+và\s+tên|họ\s+tên|ho\s+va\s+ten|ho\s+ten|tên|ten|name|email|mail|sđt|sdt|số\s+điện\s+thoại|so\s+dien\s+thoai|phone|ngày\s+sinh|ngay\s+sinh|dob|địa\s+chỉ|dia\s+chi|address)\s*(là|la|:|=)?\s*/i;

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

    // 0. Cập nhật học viên đang dở: đang hỏi "học viên nào?"/"đổi gì?" ->
    // câu trả lời (số thứ tự, tên, field mới) đi tiếp thay vì rơi xuống LLM.
    if (state.pending_student_update) {
      const reply = await this.handleUpdateStudentReply(
        tenantId,
        state,
        message,
        norm,
      );
      if (reply) return reply;
    }

    // 1. Ghi danh: "thêm X vào lớp/khóa Y" -> ưu tiên trước create/search.
    const enroll = this.parseEnroll(norm, origTokens);
    if (enroll) {
      return this.handleEnroll(tenantId, state, enroll);
    }

    // 2. Tạo lớp học trong khóa: phải xác định courseId thật trước khi preview.
    const createClass = this.parseCreateClass(message, norm);
    if (createClass) {
      return this.handleCreateClass(tenantId, state, createClass);
    }

    // 2b. Tạo khóa học: parse deterministic kể cả khi có tên + ngày. Đặt TRƯỚC
    // mọi nhánh tạo học viên để "Tạo khóa học IELTS 6.5 từ 10/08/2026..." không
    // bao giờ bị hiểu nhầm thành create_student (kể cả khi đang ở flow tạo HV).
    const createCourse = this.parseCreateCourse(message, norm);
    if (createCourse) {
      return this.handleCreateCourse(createCourse);
    }

    // 2c. Cập nhật học viên: "cập nhật thêm sđt là 09...", "sửa email học viên
    // A thành ..." — mặc định nhắm vào học viên VỪA TẠO/vừa chọn trong ngữ
    // cảnh. Đặt TRƯỚC nhánh tạo học viên để "cập nhật thêm sđt..." không bị
    // hiểu nhầm thành create_student (chữ "thêm" ở đây chỉ là trạng từ).
    const updateStudent = this.parseUpdateStudent(message, norm, state);
    if (updateStudent) {
      return this.handleUpdateStudent(tenantId, state, updateStudent);
    }

    // 3. Tạo học viên: "tạo/thêm học viên ..." nhưng KHÔNG có "vào" (tránh nhầm
    // với ghi danh "thêm ... vào lớp/khóa" mà thiếu tên học viên) và KHÔNG nhắc
    // tới khóa học/LỚP (câu có "khóa/lớp" tuyệt đối không được thành
    // create_student — kể cả khi "vào" bị gõ thiếu thành "ào": thà đẩy xuống
    // LLM còn hơn preview tạo học viên với tên rác "ào lớp này cho tôi").
    if (
      CREATE_VERB_RE.test(norm) &&
      STUDENT_RE.test(norm) &&
      !COURSE_RE.test(norm) &&
      !CLASS_RE.test(norm) &&
      !/(^|\s)vao(\s|$)/.test(norm)
    ) {
      return this.handleCreateStudent(origTokens);
    }

    // 3a. Follow-up tạo học viên: user đã vào flow create_student (bấm nút
    // hoặc câu trước) rồi nhắn tiếp thông tin ("tên A, email, sđt...") KHÔNG
    // kèm động từ tạo. Chỉ nhận khi chưa có preview chờ confirm, không phải
    // câu sửa/xóa/tìm kiếm/nhắc tới khóa, để không hijack các intent khác.
    if (
      state.last_intent === 'create_student' &&
      !state.pending_action &&
      !MODIFY_VERB_RE.test(norm) &&
      !SEARCH_VERB_RE.test(norm) &&
      !COURSE_RE.test(norm) &&
      this.hasStudentInfoSignal(origTokens, norm)
    ) {
      return this.handleCreateStudent(origTokens);
    }

    // 3b. Đổi NGÀY lớp học: "ngày bắt đầu là hôm nay", "kết thúc 30/9/2026".
    // Ngày CHỈ thuộc lớp học nên mặc định nhắm vào lớp trong ngữ cảnh (vừa
    // tạo/vừa chọn). Đặt TRƯỚC update_course để "cập nhật ngày bắt đầu..."
    // không bị nhánh khóa học nuốt rồi hỏi ngược "khóa học nào?".
    const updateClassDates = this.parseUpdateClassDates(message, norm);
    if (updateClassDates) {
      return this.handleUpdateClassDates(tenantId, state, updateClassDates);
    }

    // 3c. Cập nhật khóa học: câu ngắn kiểu "cấp độ 1", "mô tả là...", "ngày bắt
    // đầu...", "đổi tên thành..." khi đang có khóa trong ngữ cảnh -> update_course.
    const updateCourse = this.parseUpdateCourse(message, norm);
    if (updateCourse) {
      return this.handleUpdateCourse(tenantId, state, updateCourse);
    }

    // 3d. Chuyển LOẠI lớp: "chuyển lớp X sang loại theo tuần/luyện đề" ->
    // update_class CHỈ đổi classType, tuyệt đối không đụng tên lớp.
    const changeType = this.parseChangeClassType(message, norm);
    if (changeType) {
      return this.handleChangeClassType(tenantId, state, changeType);
    }

    // 3e. Đổi tên lớp theo tên: "sửa tên lớp X thành Y" -> tìm lớp X, preview
    // update_class ngay (không bắt user nhắc lại tên lớp).
    const renameClass = this.parseRenameClass(message, norm);
    if (renameClass) {
      return this.handleRenameClass(tenantId, state, renameClass);
    }

    // 3f. Xem DANH SÁCH học viên trong khóa/lớp: "cho tôi xem danh sách học
    // viên trong khóa Toán Cao Cấp", "ds học viên lớp 3" -> trả bảng học viên.
    const listStudents = this.parseListStudents(norm, origTokens);
    if (listStudents) {
      return this.handleListStudents(tenantId, state, listStudents);
    }

    // 3g. Xem DANH SÁCH LỚP (của khóa): "xem danh sách lớp trong khóa Toán Cao
    // Cấp", "ds lớp khóa này" -> trả bảng lớp học.
    const listClasses = this.parseListClasses(norm, origTokens);
    if (listClasses) {
      return this.handleListClasses(tenantId, state, listClasses);
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
  ): Promise<{
    message: string;
    contextPatch: Partial<DecisionContext>;
  } | null> {
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
      },
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

  // ---- Create course ---------------------------------------------------------

  /**
   * Parse câu tạo khóa học: "Tạo khóa học IELTS 6.5" -> { title: "IELTS 6.5" }.
   * Khóa học KHÔNG có ngày bắt đầu/kết thúc (ngày chỉ thuộc lớp học) — nếu
   * user gõ kèm ngày thì phần ngày chỉ dùng để cắt tên khóa, không lưu.
   * Trả null nếu không phải intent tạo khóa (để các nhánh khác/LLM xử lý).
   */
  private parseCreateCourse(
    message: string,
    norm: string,
  ): { title: string } | null {
    if (!CREATE_VERB_RE.test(norm)) return null;
    if (!COURSE_RE.test(norm)) return null;
    if (CLASS_RE.test(norm)) return null; // "tạo lớp trong khóa" -> không phải
    if (STUDENT_RE.test(norm)) return null; // "tạo học viên cho khóa..." -> để LLM
    if (/(^|\s)vao(\s|$)/.test(norm)) return null; // ghi danh

    const match = message.match(
      /(?:khóa học|khoa hoc|khóa|khoa|course|chương trình|chuong trinh)\s*(.*)$/i,
    );
    const rest = match ? match[1].trim() : '';

    // Tên khóa = phần trước marker ngày đầu tiên; bỏ từ đệm ở hai đầu.
    // Dùng lookahead (?=\s|$) thay \b vì \b không đúng sau ký tự có dấu ("từ").
    const cutMatch = rest.match(
      /\s+(?:từ|tu|bắt đầu|bat dau|khai giảng|khai giang|đến|den|tới|toi|kết thúc|ket thuc|hết hạn|het han|ngày|ngay)(?=\s|$)/iu,
    );
    const titleRaw =
      cutMatch && cutMatch.index !== undefined
        ? rest.slice(0, cutMatch.index)
        : rest;
    const title = this.stripCourseTitleFillers(titleRaw);

    return { title };
  }

  /** Bỏ từ đệm ("mới", "cho tôi", "tên là"...) ở hai đầu tên khóa. */
  private stripCourseTitleFillers(value: string): string {
    const FILLERS = new Set([
      'moi',
      'new',
      'cho',
      'toi',
      'minh',
      'giup',
      'dum',
      'ho',
      'voi',
      'mot',
      '1',
      'nhe',
      'di',
      'a',
      'ten',
      'la',
      'dao',
      'tao',
    ]);
    const tokens = this.cleanText(value).split(/\s+/).filter(Boolean);
    while (tokens.length && FILLERS.has(toSearchKey(tokens[0]))) tokens.shift();
    while (
      tokens.length &&
      FILLERS.has(toSearchKey(tokens[tokens.length - 1]))
    ) {
      tokens.pop();
    }
    return tokens.join(' ').trim();
  }

  private handleCreateCourse(parsed: { title: string }): DeterministicOutcome {
    // Không có tên -> trả FORM nhập liệu, KHÔNG tạo pending_action ngay ->
    // không khóa ô chat.
    if (!parsed.title) {
      return {
        type: 'course_form',
        message:
          'Bạn điền thông tin khóa học vào form bên dưới rồi bấm "Xem trước" để mình kiểm tra và tạo nhé.',
        values: {},
        contextPatch: { last_intent: 'create_course' },
      };
    }

    const input: Record<string, unknown> = { title: parsed.title };
    const pending: PendingAction = {
      tool_name: 'create_course',
      input,
      display_input: { ...input },
      summary: `Tạo khóa học mới: ${parsed.title}`,
      intent: 'create_course',
      status: 'waiting_confirm',
      severity: 'default',
    };
    return {
      type: 'pending_write',
      pending,
      contextPatch: { last_intent: 'create_course' },
    };
  }

  // ---- Update student ------------------------------------------------------

  /**
   * Nhận diện câu cập nhật học viên ("cập nhật thêm sđt là 09...", "sửa email
   * học viên A thành ..."). Trả về field cần đổi + tên học viên (nếu user nêu
   * đích danh), hoặc null nếu không phải để nhánh khác/LLM xử lý.
   */
  private parseUpdateStudent(
    message: string,
    norm: string,
    state: DecisionContext,
  ): { fields: Record<string, string>; studentKeyword?: string } | null {
    // Loại trừ các intent khác để tránh false positive.
    if (/(^|\s)vao(\s|$)/.test(norm)) return null; // ghi danh
    if (CLASS_RE.test(norm)) return null; // liên quan lớp
    if (COURSE_RE.test(norm)) return null; // liên quan khóa -> update_course
    if (SEARCH_VERB_RE.test(norm)) return null; // tìm kiếm

    const hasStrongVerb = STRONG_UPDATE_VERB_RE.test(norm);
    const hasUpdateVerb =
      hasStrongVerb || /(^|\s)(sua|doi)(\s|$)/.test(norm);
    if (!hasUpdateVerb) return null;

    // Câu có động từ tạo + "học viên" chỉ được coi là update khi có động từ
    // update MẠNH ("sửa"/"đổi" có thể là tên riêng: "thêm học viên Ng Văn Sửa").
    // "vừa tạo/mới tạo/đã tạo/vừa thêm" là cụm THAM CHIẾU ngữ cảnh ("sửa sđt
    // của hv vừa tạo") — không phải động từ tạo -> bỏ khỏi norm trước khi xét.
    const normNoCtxRef = norm.replace(
      /(^|\s)(vua|moi|da)\s+(tao|them)(?=\s|$)/g,
      '$1',
    );
    if (
      CREATE_VERB_RE.test(normNoCtxRef) &&
      STUDENT_RE.test(norm) &&
      !hasStrongVerb
    ) {
      return null;
    }

    const mentionsStudent = STUDENT_RE.test(norm);
    // Học viên có phải thực thể user đang thao tác không (vừa tạo/vừa sửa)?
    const studentIsFocus =
      mentionsStudent ||
      state.last_intent === 'create_student' ||
      state.last_intent === 'update_student';

    const fields = this.parseStudentUpdateFields(message, studentIsFocus);

    if (Object.keys(fields).length === 0) {
      // Không bóc được field học viên nào: chỉ nhận khi user nhắc "học viên"
      // hoặc học viên là thực thể vừa thao tác VÀ đang có trong ngữ cảnh
      // (vd gõ mỗi "cập nhật" ngay sau khi tạo học viên).
      const hasStudentContext = Boolean(
        state.last_created_student?.id ||
          state.last_selected_student?.id ||
          state.selected_student_id,
      );
      if (!mentionsStudent && !(studentIsFocus && hasStudentContext)) {
        return null;
      }
    }

    // "... học viên <tên> ..." -> tự tìm học viên đó thay vì lấy từ ngữ cảnh.
    let studentKeyword: string | undefined;
    // Lookahead nhãn field đòi khoảng trắng bao quanh để không cắt giữa token
    // ("an2@gmail.com" chứa "mail" nhưng không phải nhãn).
    const kwMatch = message.match(
      /(?:học\s*viên|hoc\s*vien|hv|hs)\s+([^,;:=]+?)(?=\s*[,;:=]|\s+(?:sđt|sdt|số\s*điện\s*thoại|so\s*dien\s*thoai|phone|email|mail|ngày\s*sinh|ngay\s*sinh|dob|địa\s*chỉ|dia\s*chi|address)(?:\s|[,;:=]|$)|$)/iu,
    );
    if (kwMatch && kwMatch[1].trim()) {
      let keyword = this.cleanText(kwMatch[1]);
      // Bỏ từ nối dính cuối tên trước nhãn field ("Minh Nguyễn CÓ ngày sinh
      // là..." -> "Minh Nguyễn").
      keyword = keyword
        .replace(/(?:\s+(?:có|co|và|va|với|voi|của|cua))+$/iu, '')
        .trim();
      const tail = keyword.match(/^(.+?)\s+(?:là|thành)\s+(\S.*)$/iu);
      if (tail) {
        // Đuôi "là/thành <giá trị>" là giá trị đã bóc vào fields -> cắt khỏi
        // tên ("học viên An là 0987..." -> "An").
        const tailKey = toSearchKey(tail[2]);
        const tailDigits = tail[2].replace(/\D/g, '');
        const matchesField = Object.values(fields).some((value) => {
          const valueDigits = String(value).replace(/\D/g, '');
          return (
            toSearchKey(String(value)) === tailKey ||
            (valueDigits.length >= 8 && valueDigits === tailDigits)
          );
        });
        if (matchesField) {
          keyword = tail[1].trim();
        } else if (
          !fields.fullName &&
          /(?:đổi|sửa|cập\s*nhật|thay\s*đổi)\s+tên/iu.test(message)
        ) {
          // "đổi tên học viên A thành B": trước "thành" là tên cần tìm, sau
          // là tên mới. KHÔNG áp dụng khi không có chữ "tên" (tránh cắt nhầm
          // tên chứa "Thành": "cập nhật học viên Nguyễn Thành Nam").
          keyword = tail[1].trim();
          const newName = this.stripPoliteTail(tail[2]);
          if (newName) fields.fullName = newName;
        }
      }
      keyword = this.stripPoliteTail(keyword);
      if (keyword) studentKeyword = keyword;
    }

    return { fields, studentKeyword };
  }

  /** Bóc các field cập nhật học viên từ câu tiếng Việt. */
  private parseStudentUpdateFields(
    message: string,
    allowName: boolean,
  ): Record<string, string> {
    const fields: Record<string, string> = {};

    // SĐT có nhãn đứng ngay trước số ("sđt là 0987...", "phone: 0987...").
    const phone = message.match(
      /(?:sđt|sdt|số\s*điện\s*thoại|so\s*dien\s*thoai|phone|điện\s*thoại|dien\s*thoai)\s*(?:là|la|thành|thanh|sang|:|=)?\s*(\+?[\d\s.\-]{9,15})/iu,
    );
    if (phone) {
      const digits = phone[1].replace(/[\s.\-]/g, '');
      if (/^\+?\d{9,12}$/.test(digits)) fields.phone = digits;
    }
    // Nhãn SĐT và số đứng xa nhau ("sđt học viên An thành 0987...").
    if (
      !fields.phone &&
      /(sđt|sdt|số\s*điện\s*thoại|so\s*dien\s*thoai|phone|điện\s*thoại|dien\s*thoai)/iu.test(
        message,
      )
    ) {
      const token = message
        .split(/\s+/)
        .map((t) => t.replace(/[,;.]+$/, ''))
        .find((t) => /^\+?\d{9,12}$/.test(t.replace(/[.\-]/g, '')));
      if (token) fields.phone = token.replace(/[.\-]/g, '');
    }

    // Email: token dạng email là tín hiệu không thể nhầm.
    const email = message
      .split(/\s+/)
      .map((t) => t.replace(/[,;]+$/, ''))
      .find((t) => EMAIL_RE.test(t));
    if (email) fields.email = email;

    // Ngày sinh.
    const birth = message.match(
      /(?:ngày\s*sinh|ngay\s*sinh|dob|sinh\s*ngày|sinh\s*ngay)\s*(?:là|la|thành|thanh|sang|:|=)?\s*([\d\/.\-]+)/iu,
    );
    if (birth) {
      const iso = this.parseViDate(birth[1]);
      if (iso) fields.birthDate = iso;
    }

    // Địa chỉ: lấy tới dấu phẩy/chấm phẩy hoặc hết câu.
    const address = message.match(
      /(?:địa\s*chỉ|dia\s*chi|address)\s*(?:là|la|thành|thanh|sang|:|=)?\s*(.+?)(?=[,;]|$)/iu,
    );
    if (address && address[1].trim()) {
      const clean = this.stripPoliteTail(address[1]);
      if (clean) fields.address = clean;
    }

    // Tên: CHỈ khi học viên đang là thực thể trong focus (tránh giẫm chân
    // "đổi tên khóa/lớp"). Nhãn "tên" phải đứng NGAY trước thành/là để
    // "sửa tên học viên A thành B" không bị bóc nhầm ở đây (đã xử lý riêng).
    if (allowName) {
      const name = message.match(
        /(?:^|\s)(?:đổi\s+)?tên\s+(?:thành|là)\s+(.+?)(?=[,;]|$)/iu,
      );
      if (name && name[1].trim()) {
        const clean = this.stripPoliteTail(name[1]);
        if (clean) fields.fullName = clean;
      }
    }

    return fields;
  }

  private async handleUpdateStudent(
    tenantId: number,
    state: DecisionContext,
    parsed: { fields: Record<string, string>; studentKeyword?: string },
  ): Promise<DeterministicOutcome> {
    let student = this.resolveContextStudent(state);

    // User nêu đích danh tên học viên trong câu -> tìm học viên đó thay vì
    // lấy từ ngữ cảnh ("vừa tạo"/"bên trên" vẫn tính là ngữ cảnh).
    if (
      parsed.studentKeyword &&
      !this.isContextRefPhrase(parsed.studentKeyword)
    ) {
      const students = await this.usersService.searchStudents(
        tenantId,
        parsed.studentKeyword,
      );
      if (students.length === 0) {
        return {
          type: 'clarification',
          message: `Mình chưa tìm thấy học viên "${parsed.studentKeyword}". Bạn kiểm tra lại tên (hoặc email/SĐT) giúp mình nhé.`,
          missingFields: ['userId'],
          intent: 'update_student',
          contextPatch: {
            last_intent: 'update_student',
            pending_student_update: { fields: parsed.fields },
          },
        };
      }
      if (students.length > 1) {
        const rows = students
          .slice(0, 10)
          .map((item: any, index: number) => {
            const extra = [item.email, item.phone].filter(Boolean).join(' | ');
            return `${index + 1}. ${item.fullName || `#${item.id}`}${extra ? ` (${extra})` : ''}`;
          })
          .join('\n');
        return {
          type: 'clarification',
          message: `Mình tìm thấy nhiều học viên "${parsed.studentKeyword}". Bạn muốn cập nhật học viên nào? (nhắn số thứ tự hoặc tên)\n\n${rows}`,
          missingFields: ['userId'],
          intent: 'update_student',
          contextPatch: {
            last_intent: 'update_student',
            last_candidates: { students: this.toOptions(students) },
            pending_student_update: { fields: parsed.fields },
          },
        };
      }
      const found: any = students[0];
      student = {
        id: Number(found.id),
        label: String(found.fullName || `#${found.id}`),
      };
    }

    if (!student) {
      return {
        type: 'clarification',
        message:
          'Bạn muốn cập nhật học viên nào? Bạn cho mình tên (hoặc email/SĐT) của học viên nhé.',
        missingFields: ['userId'],
        intent: 'update_student',
        contextPatch: {
          last_intent: 'update_student',
          pending_student_update: { fields: parsed.fields },
        },
      };
    }

    return this.buildUpdateStudentPending(student, parsed.fields);
  }

  /**
   * Đã chốt học viên: đủ field -> preview update_student chờ confirm; chưa có
   * field -> hỏi tiếp và ghi nhớ học viên trong pending_student_update.
   */
  private buildUpdateStudentPending(
    student: { id: number; label: string },
    fields: Record<string, string>,
  ): DeterministicOutcome {
    if (Object.keys(fields).length === 0) {
      return {
        type: 'clarification',
        message: `Bạn muốn cập nhật thông tin gì cho học viên "${student.label}"? (tên, email, số điện thoại, ngày sinh, địa chỉ)`,
        missingFields: [],
        intent: 'update_student',
        contextPatch: {
          last_intent: 'update_student',
          selected_student_id: student.id,
          pending_student_update: {
            fields: {},
            student_id: student.id,
            student_label: student.label,
          },
          last_candidates: { students: [] },
        },
      };
    }

    const input: Record<string, unknown> = {
      userId: student.id,
      ...fields,
    };
    const pending: PendingAction = {
      tool_name: 'update_student',
      input,
      display_input: { ...input, studentName: student.label },
      summary: `Cập nhật học viên ${student.label}`,
      intent: 'update_student',
      status: 'waiting_confirm',
      severity: 'default',
    };
    return {
      type: 'pending_write',
      pending,
      contextPatch: {
        last_intent: 'update_student',
        selected_student_id: student.id,
        pending_student_update: null,
        last_candidates: { students: [] },
      },
    };
  }

  /**
   * Follow-up khi đang có pending_student_update:
   * - Đã chốt học viên (đang hỏi đổi gì) -> bóc field từ câu trả lời.
   * - Đang hỏi học viên nào -> nhận số thứ tự/tên trong danh sách ứng viên,
   *   hoặc coi câu trả lời ngắn là tên để tìm tiếp.
   * - "hủy" -> dừng, xóa context. Câu không hiểu -> trả null cho luồng khác/LLM.
   */
  private async handleUpdateStudentReply(
    tenantId: number,
    state: DecisionContext,
    message: string,
    norm: string,
  ): Promise<DeterministicOutcome | null> {
    const ctx = state.pending_student_update;
    if (!ctx) return null;

    if (
      ['huy', 'huy bo', 'cancel', 'thoi', 'khong', 'bo qua', 'huy thao tac'].includes(
        norm,
      )
    ) {
      return {
        type: 'message',
        message:
          'Đã hủy thao tác cập nhật học viên. Dữ liệu chưa được ghi vào hệ thống.',
        contextPatch: {
          pending_student_update: null,
          last_candidates: { students: [] },
        },
      };
    }

    // Đã chốt học viên, đang hỏi field cần đổi -> bóc field từ câu trả lời.
    if (ctx.student_id) {
      const fields = this.parseStudentUpdateFields(message, true);
      if (Object.keys(fields).length === 0) return null;
      return this.buildUpdateStudentPending(
        {
          id: Number(ctx.student_id),
          label: String(ctx.student_label || `#${ctx.student_id}`),
        },
        fields,
      );
    }

    const candidates = state.last_candidates?.students || [];

    // Chọn theo số thứ tự trong danh sách ("2", "số 2", "người 2", "hv 2").
    const idxMatch = norm.match(
      /^(?:chon\s+)?(?:so|thu|nguoi|hoc vien|hv|hs)?\s*(\d{1,2})$/,
    );
    if (idxMatch && candidates.length > 0) {
      const chosen = candidates[Number(idxMatch[1]) - 1];
      if (!chosen?.id) {
        return {
          type: 'clarification',
          message: `Danh sách chỉ có ${candidates.length} học viên. Bạn chọn số thứ tự từ 1 đến ${candidates.length} giúp mình nhé.`,
          missingFields: ['userId'],
          intent: 'update_student',
          contextPatch: {},
        };
      }
      return this.buildUpdateStudentPending(
        { id: Number(chosen.id), label: String(chosen.label || `#${chosen.id}`) },
        ctx.fields || {},
      );
    }

    // Chọn theo tên trong danh sách ứng viên (ưu tiên khớp CHÍNH XÁC để
    // "Minh Nguyễn" không dính "Minh Nguyễn Hoàng").
    const key = toSearchKey(message);
    if (candidates.length > 0 && key) {
      const exact = candidates.filter(
        (c) => toSearchKey(String(c.label || '')) === key,
      );
      const matched =
        exact.length > 0
          ? exact
          : candidates.filter((c) =>
              toSearchKey(String(c.label || '')).includes(key),
            );
      if (matched.length === 1 && matched[0].id) {
        return this.buildUpdateStudentPending(
          { id: Number(matched[0].id), label: String(matched[0].label) },
          ctx.fields || {},
        );
      }
    }

    // Đang hỏi tên học viên -> câu trả lời NGẮN không kèm intent khác là TÊN.
    if (
      candidates.length === 0 &&
      key &&
      !/^\d+$/.test(key) &&
      !MODIFY_VERB_RE.test(norm) &&
      !CREATE_VERB_RE.test(norm) &&
      !SEARCH_VERB_RE.test(norm) &&
      !COURSE_RE.test(norm) &&
      !CLASS_RE.test(norm) &&
      message.trim().split(/\s+/).length <= 6
    ) {
      return this.handleUpdateStudent(tenantId, state, {
        fields: ctx.fields || {},
        studentKeyword: message.trim(),
      });
    }

    return null;
  }

  /** Học viên vừa tạo/đang chọn trong ngữ cảnh, hoặc null. */
  private resolveContextStudent(
    state: DecisionContext,
  ): { id: number; label: string } | null {
    const opt = state.last_created_student || state.last_selected_student;
    const id = Number(opt?.id) || Number(state.selected_student_id) || 0;
    if (!id) return null;
    return { id, label: String(opt?.label || `#${id}`) };
  }

  // ---- Update course -------------------------------------------------------

  /**
   * Nhận diện câu cập nhật khóa học ngắn ("cấp độ 1", "mô tả là...", "ngày bắt
   * đầu...", "đổi tên thành..."). Trả về field cần đổi, hoặc null nếu không phải.
   */
  private parseUpdateCourse(
    message: string,
    norm: string,
  ): { fields: Record<string, string>; courseKeyword?: string } | null {
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

    // "sửa tên khóa <X> thành <Y>": phần trước "thành" là TÊN KHÓA cần sửa,
    // phần sau là tên mới -> tách ra để tự tìm khóa, không hỏi lại.
    let courseKeyword: string | undefined;
    if (fields.title) {
      const rename = fields.title.match(/^(.+?)\s+(?:thành|sang)\s+(.+)$/iu);
      if (rename) {
        const keyword = this.stripPoliteTail(rename[1]);
        const keywordKey = toSearchKey(keyword);
        if (
          keyword &&
          !['nay', 'do', 'hoc', 'khoa', 'khoa hoc', 'hien tai'].includes(
            keywordKey,
          )
        ) {
          courseKeyword = keyword;
        }
        fields.title = rename[2].trim();
      }
      fields.title = this.stripPoliteTail(fields.title);
      if (!fields.title) delete fields.title;
    }

    return { fields, courseKeyword };
  }

  /**
   * Bỏ đuôi lịch sự cuối câu ("cho tôi", "giúp mình", "nhé", "ạ"...), kể cả gõ
   * KHÔNG dấu ("cho toi", "giup minh") và đuôi ghép ("cho tôi nhé"). Chỉ nhận
   * "toi/minh/chi" không dấu khi đứng sau cho/giúp/giùm/hộ — không strip từ đơn
   * không dấu (vd "a", "di") để khỏi cắt nhầm đuôi tên riêng ("Tran Văn A").
   */
  private stripPoliteTail(value: string): string {
    return value
      .trim()
      .replace(
        /(?:\s*(?:(?:cho|giúp|giup|giùm|gium|hộ|ho)\s+(?:tôi|toi|mình|minh|em|anh|chị|chi)|nhé|nhe|nha|nhá|ạ|với|đi))+\s*$/iu,
        '',
      )
      .trim();
  }

  private async handleUpdateCourse(
    tenantId: number,
    state: DecisionContext,
    parsed: { fields: Record<string, string>; courseKeyword?: string },
  ): Promise<DeterministicOutcome> {
    let course = this.resolveContextCourse(state);

    // User nêu đích danh tên/mã khóa trong câu -> tìm khóa đó thay vì hỏi lại.
    if (parsed.courseKeyword) {
      const courses = await this.coursesService.searchCourses(
        tenantId,
        parsed.courseKeyword,
      );
      if (courses.length === 0) {
        return {
          type: 'clarification',
          message: `Mình chưa tìm thấy khóa học "${parsed.courseKeyword}". Bạn kiểm tra lại tên hoặc mã khóa học giúp mình nhé.`,
          missingFields: ['courseId'],
          intent: 'update_course',
          contextPatch: { last_intent: 'update_course' },
        };
      }
      if (courses.length > 1) {
        const rows = courses
          .slice(0, 10)
          .map((item: any, index: number) => {
            const code = item.courseCode ? ` (${item.courseCode})` : '';
            return `${index + 1}. ${item.title || item.name || `#${item.id}`}${code}`;
          })
          .join('\n');
        return {
          type: 'clarification',
          message: `Mình tìm thấy nhiều khóa "${parsed.courseKeyword}". Bạn muốn cập nhật khóa nào?\n\n${rows}`,
          missingFields: ['courseId'],
          intent: 'update_course',
          contextPatch: {
            last_intent: 'update_course',
            last_candidates: { courses: this.toOptions(courses) },
          },
        };
      }
      const found: any = courses[0];
      course = {
        id: Number(found.id),
        label: String(found.title || found.courseCode || `#${found.id}`),
      };
    }

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
    // Chỉ dùng label của option khi nó đúng là khóa có id này — tránh ghép
    // id mới (từ selected_course_id) với tên của khóa cũ trong ngữ cảnh.
    const label = opt && Number(opt.id) === id ? opt.label : `#${id}`;
    return { id, label: String(label) };
  }

  // ---- Change class type ----------------------------------------------------

  /**
   * "chuyển (lớp X) sang loại (lớp) theo tuần/luyện đề", "đổi loại lớp X thành
   * luyện đề"... -> {classKeyword?, type}. CHỈ đổi loại, không đổi tên.
   */
  private parseChangeClassType(
    message: string,
    norm: string,
  ): { classKeyword?: string; type: 'WEEKLY' | 'EXAM_PRACTICE' } | null {
    if (!CLASS_RE.test(norm)) return null;
    if (STUDENT_RE.test(norm)) return null;
    if (CREATE_VERB_RE.test(norm)) return null;
    if (SEARCH_VERB_RE.test(norm)) return null;
    if (
      !/(^|\s)(chuyen|doi|sua|cap nhat|thay doi|update)(\s|$)/.test(norm)
    ) {
      return null;
    }

    const type = /luyen de|exam/.test(norm)
      ? 'EXAM_PRACTICE'
      : /theo tuan|hang tuan|weekly/.test(norm)
        ? 'WEEKLY'
        : null;
    if (!type) return null;

    // Tên lớp (nếu nêu đích danh): phần giữa "lớp" và "sang/thành/qua".
    const match = message.match(
      /(?:lớp học|lop hoc|lớp|lop|class)\s+(.+?)\s+(?:sang|thành|thanh|qua)\s/iu,
    );
    let classKeyword = match ? this.stripPoliteTail(match[1]) : undefined;
    if (classKeyword) {
      const key = toSearchKey(classKeyword);
      // Cụm bắt được chỉ là mô tả loại lớp/từ ngữ cảnh -> không phải tên lớp.
      if (
        ['nay', 'do', 'hoc', 'hien tai'].includes(key) ||
        /(loai|theo tuan|hang tuan|luyen de|weekly|exam)/.test(key)
      ) {
        classKeyword = undefined;
      }
    }

    return { classKeyword, type };
  }

  private async handleChangeClassType(
    tenantId: number,
    state: DecisionContext,
    parsed: { classKeyword?: string; type: 'WEEKLY' | 'EXAM_PRACTICE' },
  ): Promise<DeterministicOutcome> {
    const typeLabel =
      parsed.type === 'WEEKLY' ? 'Học theo tuần' : 'Luyện đề';
    const resolved = await this.resolveClassTarget(
      tenantId,
      state,
      parsed.classKeyword,
      'update_class',
      `chuyển sang loại "${typeLabel}"`,
    );
    if ('outcome' in resolved) return resolved.outcome;

    const input: Record<string, unknown> = {
      classId: resolved.target.id,
      classType: parsed.type,
    };
    const pending: PendingAction = {
      tool_name: 'update_class',
      input,
      display_input: { ...input, className: resolved.target.label },
      summary: `Chuyển lớp ${resolved.target.label} sang loại ${typeLabel} (${parsed.type})`,
      intent: 'update_class',
      status: 'waiting_confirm',
      severity: 'default',
    };
    return {
      type: 'pending_write',
      pending,
      contextPatch: {
        last_intent: 'update_class',
        selected_class_id: resolved.target.id,
      },
    };
  }

  /**
   * Xác định lớp đích cho thao tác sửa: theo keyword (search DB) hoặc theo
   * ngữ cảnh chat. Trả {outcome} (clarification) nếu chưa chốt được 1 lớp.
   */
  private async resolveClassTarget(
    tenantId: number,
    state: DecisionContext,
    classKeyword: string | undefined,
    intent: AiIntent,
    actionLabel: string,
  ): Promise<
    { target: { id: number; label: string } } | { outcome: DeterministicOutcome }
  > {
    if (classKeyword) {
      const classes = await this.coursesService.searchClasses(
        tenantId,
        classKeyword,
      );
      if (classes.length === 0) {
        return {
          outcome: {
            type: 'clarification',
            message: `Mình chưa tìm thấy lớp "${classKeyword}". Bạn kiểm tra lại tên hoặc mã lớp giúp mình nhé.`,
            missingFields: ['classId'],
            intent,
            contextPatch: { last_intent: intent },
          },
        };
      }
      if (classes.length > 1) {
        const rows = classes
          .slice(0, 10)
          .map((item: any, index: number) => {
            const code = item.classCode ? ` (${item.classCode})` : '';
            return `${index + 1}. ${item.title || `#${item.id}`}${code}`;
          })
          .join('\n');
        return {
          outcome: {
            type: 'clarification',
            message: `Mình tìm thấy nhiều lớp "${classKeyword}". Bạn muốn ${actionLabel} cho lớp nào?\n\n${rows}`,
            missingFields: ['classId'],
            intent,
            contextPatch: {
              last_intent: intent,
              last_candidates: { classes: this.toOptions(classes) },
            },
          },
        };
      }
      const found: any = classes[0];
      return {
        target: {
          id: Number(found.id),
          label: String(found.title || found.classCode || `#${found.id}`),
        },
      };
    }

    const opt = state.last_selected_class || state.last_created_class || null;
    const id = Number(state.selected_class_id) || Number(opt?.id) || 0;
    if (id) {
      return { target: { id, label: String(opt?.label || `#${id}`) } };
    }

    return {
      outcome: {
        type: 'clarification',
        message: `Bạn muốn ${actionLabel} cho lớp nào? Vui lòng nhập tên lớp hoặc mã lớp.`,
        missingFields: ['classId'],
        intent,
        contextPatch: { last_intent: intent },
      },
    };
  }

  // ---- Update class dates ---------------------------------------------------

  /**
   * Nhận diện câu đổi ngày lớp học: "ngày bắt đầu là hôm nay", "lớp Test 12
   * kết thúc 30/9/2026". Ngày chỉ thuộc lớp học (khóa không có ngày, học viên
   * chỉ có ngày sinh) nên câu nói về ngày bắt đầu/kết thúc là về LỚP.
   */
  private parseUpdateClassDates(
    message: string,
    norm: string,
  ): { startDate?: string; endDate?: string; classKeyword?: string } | null {
    if (/(^|\s)vao(\s|$)/.test(norm)) return null; // ghi danh "từ hôm nay"
    if (STUDENT_RE.test(norm)) return null;
    if (COURSE_RE.test(norm)) return null;
    if (SEARCH_VERB_RE.test(norm)) return null;
    // Câu tạo lớp/khóa tự parse ngày trong luồng create.
    if (CREATE_VERB_RE.test(norm) || CREATE_CLASS_VERB_RE.test(norm)) {
      return null;
    }
    if (/(^|\s)ngay sinh(\s|$)/.test(norm)) return null; // ngày sinh học viên

    const { startDate, endDate } = this.parseClassDateRange(message);
    if (!startDate && !endDate) return null;

    // Tên lớp nêu đích danh: "lớp Test 12 bắt đầu ..." -> tự tìm lớp đó.
    let classKeyword: string | undefined;
    const kw = message.match(
      /(?:lớp học|lop hoc|lớp|lop|class)\s+(.+?)(?=\s+(?:bắt đầu|bat dau|khai giảng|khai giang|kết thúc|ket thuc|từ|tu|đến|den|tới|toi|ngày|ngay|là|la|hết hạn|het han)(?:\s|$)|\s*[,;:]|$)/iu,
    );
    if (kw && kw[1].trim()) {
      const keyword = this.stripPoliteTail(this.cleanText(kw[1]));
      const key = toSearchKey(keyword);
      if (
        keyword &&
        !['nay', 'do', 'hoc', 'hien tai', 'vua tao', 'moi tao'].includes(key)
      ) {
        classKeyword = keyword;
      }
    }

    return { startDate, endDate, classKeyword };
  }

  private async handleUpdateClassDates(
    tenantId: number,
    state: DecisionContext,
    parsed: { startDate?: string; endDate?: string; classKeyword?: string },
  ): Promise<DeterministicOutcome> {
    const resolved = await this.resolveClassTarget(
      tenantId,
      state,
      parsed.classKeyword,
      'update_class',
      'đổi ngày bắt đầu/kết thúc',
    );
    if ('outcome' in resolved) return resolved.outcome;

    const input: Record<string, unknown> = { classId: resolved.target.id };
    const parts: string[] = [];
    if (parsed.startDate) {
      input.startDate = parsed.startDate;
      parts.push(`ngày bắt đầu ${parsed.startDate}`);
    }
    if (parsed.endDate) {
      input.endDate = parsed.endDate;
      parts.push(`ngày kết thúc ${parsed.endDate}`);
    }

    const pending: PendingAction = {
      tool_name: 'update_class',
      input,
      display_input: { ...input, className: resolved.target.label },
      summary: `Cập nhật ${parts.join(', ')} cho lớp ${resolved.target.label}`,
      intent: 'update_class',
      status: 'waiting_confirm',
      severity: 'default',
    };
    return {
      type: 'pending_write',
      pending,
      contextPatch: {
        last_intent: 'update_class',
        selected_class_id: resolved.target.id,
      },
    };
  }

  // ---- Rename class ---------------------------------------------------------

  /**
   * "sửa/đổi tên lớp <X> thành <Y>" -> {classKeyword: X, title: Y}.
   * X trống hoặc là từ chỉ ngữ cảnh ("này") -> dùng lớp trong ngữ cảnh chat.
   */
  private parseRenameClass(
    message: string,
    norm: string,
  ): { classKeyword?: string; title: string } | null {
    if (!CLASS_RE.test(norm)) return null;
    if (STUDENT_RE.test(norm)) return null;
    if (CREATE_VERB_RE.test(norm)) return null;

    const match = message.match(
      /(?:đổi|sửa|cập nhật|thay đổi)\s+tên\s+(?:lớp học|lop hoc|lớp|lop|class)\s*(.*?)\s*(?:thành|sang)\s+(.+)$/iu,
    );
    if (!match) return null;

    const title = this.stripPoliteTail(match[2]);
    if (!title) return null;

    // "thành (loại lớp) theo tuần/luyện đề" là ĐỔI LOẠI, không phải đổi tên
    // -> trả null để nhánh parseChangeClassType xử lý (không ghi đè tên lớp).
    const titleKey = toSearchKey(title);
    if (
      /(^|\s)(loai lop|theo tuan|hang tuan|luyen de|weekly|exam practice)(\s|$)/.test(
        titleKey,
      )
    ) {
      return null;
    }

    const rawKeyword = this.stripPoliteTail(match[1] || '');
    const keywordKey = toSearchKey(rawKeyword);
    const classKeyword =
      rawKeyword && !['nay', 'do', 'hoc', 'hien tai'].includes(keywordKey)
        ? rawKeyword
        : undefined;

    return { classKeyword, title };
  }

  private async handleRenameClass(
    tenantId: number,
    state: DecisionContext,
    parsed: { classKeyword?: string; title: string },
  ): Promise<DeterministicOutcome> {
    const resolved = await this.resolveClassTarget(
      tenantId,
      state,
      parsed.classKeyword,
      'update_class',
      'đổi tên',
    );
    if ('outcome' in resolved) return resolved.outcome;

    const input: Record<string, unknown> = {
      classId: resolved.target.id,
      title: parsed.title,
    };
    const pending: PendingAction = {
      tool_name: 'update_class',
      input,
      display_input: { ...input, className: resolved.target.label },
      summary: `Đổi tên lớp ${resolved.target.label} thành ${parsed.title}`,
      intent: 'update_class',
      status: 'waiting_confirm',
      severity: 'default',
    };
    return {
      type: 'pending_write',
      pending,
      contextPatch: {
        last_intent: 'update_class',
        selected_class_id: resolved.target.id,
      },
    };
  }

  /** Bóc các field cập nhật khóa học từ câu tiếng Việt. */
  private parseCourseUpdateFields(message: string): Record<string, string> {
    const fields: Record<string, string> = {};
    const NEXT =
      '(?=,|;|\\.|$|\\s+cấp\\s*độ|\\s+mô\\s*tả|\\s+ngày|\\s+đổi|\\s+tên\\s+khóa|\\s+mã\\s+khóa|\\s+trạng\\s*thái)';

    // Khóa học KHÔNG có ngày bắt đầu/kết thúc — "ngày ..." trong câu sửa khóa
    // bị bỏ qua; ngày chỉ thuộc lớp học (update_class).

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

  /**
   * Parse ngày tiếng Việt -> ISO (yyyy-mm-dd). Hỗ trợ:
   * - "hôm nay"/"nay"/"today" -> ngày hiện tại
   * - "ngày mai"/"mai" -> ngày mai
   * - dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy, 31/072026, 31072026, yyyy/mm/dd
   * - dd/mm (thiếu năm) -> mặc định năm hiện tại
   */
  parseViDate(raw: string): string | undefined {
    const trimmed = raw.trim();
    const key = toSearchKey(trimmed);
    if (['hom nay', 'homnay', 'nay', 'today', 'bua nay'].includes(key)) {
      return this.toLocalIso(new Date());
    }
    if (['ngay mai', 'mai', 'tomorrow'].includes(key)) {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      return this.toLocalIso(d);
    }

    const s = trimmed.replace(/[.\-]/g, '/');
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
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    // Thiếu năm: "30/07" -> năm hiện tại (user lười gõ năm).
    m = s.match(/^(\d{1,2})\/(\d{1,2})$/);
    if (m) return toIso(m[1], m[2], String(new Date().getFullYear()));
    return undefined;
  }

  /** Date -> yyyy-mm-dd theo giờ địa phương (không dùng toISOString vì lệch UTC). */
  private toLocalIso(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`;
  }

  // ---- Create student ------------------------------------------------------

  private handleCreateStudent(origTokens: string[]): DeterministicOutcome {
    // Dấu phẩy là ranh giới field tin cậy nhất user cung cấp ("tên A, email,
    // sđt, địa chỉ, ngày sinh") -> ưu tiên parse theo segment dấu phẩy; chỉ
    // fallback parse phẳng theo token khi câu không có dấu phẩy.
    const segments = this.splitCommaSegments(origTokens);

    const { fullName, email, phone, birthDate, address } =
      segments.length >= 2
        ? this.parseStudentFromSegments(segments)
        : this.parseStudentFromTokens(
            origTokens.map((t) => t.replace(/,+$/, '')),
          );

    const clearedCandidates: Partial<DecisionContext> = {
      last_intent: 'create_student',
      last_candidates: { students: [], courses: [], classes: [] },
      pending_student_update: null,
    };

    // Thiếu tên -> KHÔNG hỏi cụt lủn nữa. Trả về form nhập liệu (điền sẵn những
    // gì user đã cung cấp) để user điền đủ trong 1 bước, sau đó đi tiếp preview.
    if (!fullName) {
      const values: Record<string, string> = {};
      if (email) values.email = email;
      if (phone) values.phone = phone;
      if (birthDate) values.birthDate = birthDate;
      if (address) values.address = address;
      return {
        type: 'student_form',
        message:
          'Bạn điền thông tin học viên vào form bên dưới rồi bấm "Xem trước" để mình kiểm tra và tạo nhé.',
        values,
        contextPatch: clearedCandidates,
      };
    }

    const input: Record<string, unknown> = { fullName };

    if (email) input.email = email;
    if (phone) input.phone = phone;
    if (birthDate) input.birthDate = birthDate;
    if (address) input.address = address;

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

  /** Gom token thành các segment theo dấu phẩy (kể cả phẩy dính giữa token). */
  private splitCommaSegments(origTokens: string[]): string[][] {
    const segments: string[][] = [[]];
    for (const raw of origTokens) {
      const parts = raw.split(',');
      parts.forEach((part, idx) => {
        if (part) segments[segments.length - 1].push(part);
        if (idx < parts.length - 1) segments.push([]);
      });
    }
    return segments.filter((seg) => seg.length > 0);
  }

  /** "13/10/2003" | "13-10-2003" -> "2003-10-13". */
  private birthdateToIso(token: string): string {
    const sep = token.includes('/') ? '/' : '-';
    const [d, m, y] = token.split(sep);
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  /**
   * Parse thông tin học viên từ câu tự do. Public để CopilotService dùng lại
   * khi user chat bổ sung thông tin lúc đang có bản nháp create_student.
   */
  parseStudentInfo(message: string): ParsedStudentInfo {
    const origTokens = message.trim().split(/\s+/).filter(Boolean);
    if (origTokens.length === 0) return { fullName: '' };

    const segments = this.splitCommaSegments(origTokens);
    return segments.length >= 2
      ? this.parseStudentFromSegments(segments)
      : this.parseStudentFromTokens(
          origTokens.map((t) => t.replace(/,+$/, '')),
        );
  }

  /** Bỏ nhãn field ở đầu segment ("địa chỉ Ninh Bình" -> "Ninh Bình"). */
  private stripSegmentFieldLabel(seg: string[]): string[] {
    const joined = seg.join(' ');
    const stripped = joined.replace(SEGMENT_FIELD_LABEL_RE, '').trim();
    if (!stripped) return [];
    return stripped.split(/\s+/);
  }

  /**
   * Câu CÓ dấu phẩy: phân loại từng segment (email/sđt/ngày sinh/tỉnh thành).
   * Segment đầu tiên không phân loại được là TÊN (sau khi bỏ từ đệm); các
   * segment còn lại là ĐỊA CHỈ — nhờ vậy địa chỉ đứng trước hay sau ngày sinh
   * đều nhận đúng.
   */
  private parseStudentFromSegments(rawSegments: string[][]): ParsedStudentInfo {
    const segments = rawSegments
      .map((seg) => this.stripSegmentFieldLabel(seg))
      .filter((seg) => seg.length > 0);

    let email: string | undefined;
    let phone: string | undefined;
    let birthDate: string | undefined;
    const unclassified: string[][] = [];

    for (const seg of segments) {
      const joined = seg.join(' ');
      if (!email && seg.length === 1 && EMAIL_RE.test(seg[0])) {
        email = seg[0];
        continue;
      }
      if (!birthDate && seg.length === 1 && BIRTHDATE_RE.test(seg[0])) {
        birthDate = this.birthdateToIso(seg[0]);
        continue;
      }
      if (!phone && !EMAIL_RE.test(joined) && this.looksLikePhone(joined)) {
        phone = joined.replace(/\s+/g, '');
        continue;
      }
      unclassified.push(seg);
    }

    // Segment trùng tên tỉnh/thành chắc chắn là địa chỉ, không phải tên người.
    let nameSeg: string[] | null = null;
    const addressSegs: string[] = [];
    for (const seg of unclassified) {
      const isProvince = VN_PROVINCE_KEYS.has(toSearchKey(seg.join(' ')));
      if (!nameSeg && !isProvince) {
        nameSeg = seg;
      } else {
        addressSegs.push(seg.join(' '));
      }
    }

    // Bỏ từ đệm đầu segment tên ("tôi", "hv", "tên là"...) + từ nối; nhặt nốt
    // email/sđt/ngày sinh nếu user gõ chung trong segment tên không có phẩy.
    const nameTokens: string[] = [];
    for (const token of this.stripLeading(nameSeg || [])) {
      if (CONNECTORS.has(toSearchKey(token))) continue;
      if (EMAIL_RE.test(token)) {
        if (!email) email = token;
        continue;
      }
      if (BIRTHDATE_RE.test(token)) {
        if (!birthDate) birthDate = this.birthdateToIso(token);
        continue;
      }
      if (this.looksLikePhone(token)) {
        if (!phone) phone = token;
        continue;
      }
      nameTokens.push(token);
    }

    return {
      fullName: nameTokens.join(' ').trim(),
      email,
      phone,
      birthDate,
      address: addressSegs.join(', ').trim() || undefined,
    };
  }

  /**
   * Câu KHÔNG có dấu phẩy: parse phẳng theo token. Địa chỉ nhận qua 2 heuristic:
   * (1) các token đứng sau ngày sinh, (2) đuôi tên trùng tên tỉnh/thành VN.
   */
  private parseStudentFromTokens(cleanedTokens: string[]): ParsedStudentInfo {
    const rest = this.stripLeading(cleanedTokens).filter(
      (token) => !CONNECTORS.has(toSearchKey(token)),
    );

    const emailToken = rest.find((token) => EMAIL_RE.test(token));

    const phoneToken = rest.find(
      (token) => !EMAIL_RE.test(token) && this.looksLikePhone(token),
    );

    const birthdateToken = rest.find(
      (token) =>
        token !== emailToken &&
        token !== phoneToken &&
        BIRTHDATE_RE.test(token),
    );

    const birthDate = birthdateToken
      ? this.birthdateToIso(birthdateToken)
      : undefined;

    const isNameOrAddressToken = (token: string): boolean =>
      token !== emailToken && token !== phoneToken && token !== birthdateToken;

    const birthdateIndex = birthdateToken ? rest.indexOf(birthdateToken) : -1;

    let nameTokens =
      birthdateIndex >= 0
        ? rest.filter(
            (token, index) =>
              index < birthdateIndex && isNameOrAddressToken(token),
          )
        : rest.filter((token) => isNameOrAddressToken(token));

    const addressParts =
      birthdateIndex >= 0
        ? rest.filter(
            (token, index) =>
              index > birthdateIndex && isNameOrAddressToken(token),
          )
        : [];

    // Đuôi tên trùng tỉnh/thành VN (thử cụm 3 rồi 2 token, phải còn lại ít
    // nhất 1 token tên) -> tách sang địa chỉ.
    for (let len = 3; len >= 2; len -= 1) {
      if (nameTokens.length <= len) continue;
      const tail = nameTokens.slice(-len).join(' ');
      if (VN_PROVINCE_KEYS.has(toSearchKey(tail))) {
        addressParts.unshift(tail);
        nameTokens = nameTokens.slice(0, -len);
        break;
      }
    }

    return {
      fullName: nameTokens.join(' ').trim(),
      email: emailToken,
      phone: phoneToken,
      birthDate,
      address: addressParts.join(' ').trim() || undefined,
    };
  }

  /** Câu có tín hiệu thông tin học viên (email/sđt/ngày sinh/"tên ...")? */
  private hasStudentInfoSignal(origTokens: string[], norm: string): boolean {
    if (/(^|\s)ten(\s|$)/.test(norm)) return true;
    return origTokens.some((raw) => {
      const token = raw.replace(/,+$/, '');
      return (
        EMAIL_RE.test(token) ||
        BIRTHDATE_RE.test(token) ||
        this.looksLikePhone(token)
      );
    });
  }

  // ---- Create class --------------------------------------------------------

  private parseCreateClass(
    message: string,
    norm: string,
  ): CreateClassParsed | null {
    if (!CREATE_CLASS_VERB_RE.test(norm) || !CLASS_RE.test(norm)) return null;

    // Bỏ qua từ đệm giữa động từ và danh từ "lớp" (vd "tạo cho tôi 1 lớp học...").
    // Lấy phần sau lần xuất hiện đầu tiên của danh từ lớp.
    const match = message.match(/(?:lớp học|lop hoc|lớp|lop|class)\s+(.+)$/i);

    const type = this.parseClassType(message);
    const teacherName = this.parseTeacherName(message);
    const sessions = this.parseClassSessions(message);
    const { startDate, endDate } = this.parseClassDateRange(message);

    // "tạo lớp" trống -> thiếu cả tên lẫn khóa, vẫn nhận intent để hỏi tiếp.
    const rest = match ? match[1].trim() : '';
    if (!rest) {
      return {
        title: '',
        courseKeyword: undefined,
        type,
        teacherName,
        sessions,
        startDate,
        endDate,
      };
    }

    const { titlePart, courseKeyword } = this.splitCreateClassParts(rest);
    let title = this.cleanText(titlePart);

    // "tên (lớp) là X" -> X chính là tên lớp (ưu tiên hơn phần bóc mặc định).
    const explicitName = message.match(
      /tên(?:\s+lớp(?:\s+học)?)?\s*(?:là|:)\s*(.+)$/iu,
    );
    if (explicitName?.[1]) {
      title = this.cleanText(
        this.splitCreateClassParts(this.stripPoliteTail(explicitName[1]))
          .titlePart,
      );
    }

    // Bỏ cụm loại lớp dính đầu tên ("theo tuần Văn 1" -> "Văn 1"). Riêng
    // "luyện đề" chỉ bỏ khi có chữ "loại lớp" đứng trước — vì tên lớp thật
    // thường bắt đầu bằng "Luyện đề..." ("Luyện đề tháng 8").
    title = title
      .replace(
        /^(?:(?:loại\s+lớp\s+)?(?:theo\s+tuần|hàng\s+tuần|weekly)|loại\s+lớp\s+(?:luyện\s+đề|exam\s+practice))\s+(?:tên\s+(?:là|:)?\s*)?/iu,
        '',
      )
      .trim();

    // "hsk1, lớp luyện đề" -> đoạn sau dấu phẩy chỉ mô tả LOẠI lớp, không
    // thuộc tên (loại đã được parseClassType nhận riêng từ cả câu) -> bỏ.
    title = this.dropClassTypeSegments(title);

    // "theo tuần"/"hàng tuần"... chỉ là loại lớp, KHÔNG phải tên -> để trống,
    // sẽ hỏi tên lớp ngắn gọn ở bước sau.
    if (this.isBareClassTypePhrase(title)) title = '';

    return {
      title,
      courseKeyword,
      type,
      teacherName,
      sessions,
      startDate,
      endDate,
    };
  }

  /**
   * "ngày bắt đầu là 09/07/2026 ... kết thúc là ngày 31/07/2026" -> ISO range.
   * Hỗ trợ cả "từ hôm nay đến ngày 30/07" (hôm nay = ngày hiện tại; thiếu năm
   * -> năm hiện tại, xem parseViDate).
   */
  parseClassDateRange(message: string): {
    startDate?: string;
    endDate?: string;
  } {
    // "hôm nay"/"ngày mai" hoặc chuỗi số dạng ngày (30/07, 09/07/2026...).
    // n[aà]y: chấp nhận cả lỗi gõ phổ biến "hôm này" (parseViDate bỏ dấu nên
    // vẫn ra "hom nay").
    const DATE_TOKEN =
      '(hôm\\s*n[aà]y|hom\\s*n[aà]y|bữa\\s*n[aà]y|bua\\s*n[aà]y|ngày\\s*mai|ngay\\s*mai|today|tomorrow|[0-9][0-9/\\-.]{2,})';
    const startMatch = message.match(
      new RegExp(
        `(?:bắt đầu|bat dau|khai giảng|khai giang|từ ngày|tu ngay|từ|tu)\\s*(?:là|la)?\\s*(?:ngày|ngay)?\\s*${DATE_TOKEN}`,
        'iu',
      ),
    );
    const endMatch = message.match(
      new RegExp(
        `(?:kết thúc|ket thuc|đến|den|tới|toi|hết hạn|het han)\\s*(?:là|la)?\\s*(?:ngày|ngay)?\\s*${DATE_TOKEN}`,
        'iu',
      ),
    );
    return {
      startDate: startMatch ? this.parseViDate(startMatch[1]) : undefined,
      endDate: endMatch ? this.parseViDate(endMatch[1]) : undefined,
    };
  }

  /**
   * Bỏ các đoạn (ngăn bởi dấu phẩy) chỉ mô tả loại lớp: "hsk1, lớp luyện đề"
   * -> "hsk1". Giữ đoạn đầu vì tên thật thường bắt đầu bằng "Luyện đề...".
   */
  private dropClassTypeSegments(title: string): string {
    const TYPE_SEGMENT_KEYS = new Set([
      'luyen de',
      'lop luyen de',
      'loai lop luyen de',
      'loai luyen de',
      'exam practice',
      'lop exam practice',
      'theo tuan',
      'lop theo tuan',
      'hoc theo tuan',
      'hang tuan',
      'lop hang tuan',
      'loai lop theo tuan',
      'lop thuong',
      'weekly',
      'lop weekly',
    ]);
    return title
      .split(',')
      .map((segment) => segment.trim())
      .filter(
        (segment, index) =>
          segment && (index === 0 || !TYPE_SEGMENT_KEYS.has(toSearchKey(segment))),
      )
      .join(', ');
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
    state: DecisionContext,
    parsed: CreateClassParsed,
  ): Promise<DeterministicOutcome> {
    const contextBase: Partial<DecisionContext> = {
      last_intent: 'create_class',
    };

    if (!parsed.courseKeyword) {
      // Không nêu khóa nhưng ngữ cảnh ĐANG có khóa (vd vừa tạo/vừa chọn xong)
      // -> dùng luôn khóa đó, không hỏi lại. Preview vẫn cho đổi khóa trên form.
      const ctxCourse = this.resolveContextCourse(state);
      if (ctxCourse) {
        const courseCtx: Partial<DecisionContext> = {
          ...contextBase,
          selected_course_id: ctxCourse.id,
        };
        if (!parsed.title) {
          const pendingClass: PendingClassCreationContext = {
            courseId: ctxCourse.id,
            courseTitle: ctxCourse.label,
            type: parsed.type,
            startDate: parsed.startDate ?? null,
            endDate: parsed.endDate ?? null,
            teacherName: parsed.teacherName ?? null,
          };
          return {
            type: 'clarification',
            message: `Bạn muốn đặt tên lớp là gì? (lớp sẽ tạo trong khóa "${ctxCourse.label}")`,
            missingFields: ['title'],
            intent: 'create_class',
            contextPatch: {
              ...courseCtx,
              pending_class_creation: pendingClass,
            },
          };
        }
        return {
          type: 'pending_write',
          pending: this.buildCreateClassPending({
            courseId: ctxCourse.id,
            courseLabel: ctxCourse.label,
            title: parsed.title,
            type: parsed.type,
            teacherName: parsed.teacherName,
            sessions: parsed.sessions,
            startDate: parsed.startDate,
            endDate: parsed.endDate,
          }),
          contextPatch: courseCtx,
        };
      }

      // Thiếu khóa -> hỏi khóa trước, NHƯNG nhớ lại những gì đã hiểu được
      // (tên lớp, loại lớp, ngày) để lượt sau user chỉ cần trả lời tên khóa
      // là đi tiếp — không phụ thuộc LLM ghép lại từ lịch sử chat.
      const draft: PendingClassCreationContext = {
        courseId: 0,
        type: parsed.type,
        title: parsed.title || null,
        startDate: parsed.startDate ?? null,
        endDate: parsed.endDate ?? null,
        teacherName: parsed.teacherName ?? null,
      };
      return {
        type: 'clarification',
        message: 'Bạn muốn tạo lớp trong khóa học nào?',
        missingFields: ['courseId'],
        intent: 'create_class',
        contextPatch: { ...contextBase, pending_class_creation: draft },
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
        startDate: parsed.startDate ?? null,
        endDate: parsed.endDate ?? null,
        teacherName: parsed.teacherName ?? null,
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
        startDate: parsed.startDate,
        endDate: parsed.endDate,
      }),
      contextPatch: courseCtx,
    };
  }

  /**
   * User trả lời TÊN KHÓA khi đang có bản nháp tạo lớp chưa xác định khóa
   * (pending_class_creation.courseId = 0). Trả null nếu không bóc được keyword
   * (để LLM xử lý với context trong prompt).
   */
  async resolveClassCourseReply(
    tenantId: number,
    ctx: PendingClassCreationContext,
    message: string,
  ): Promise<DeterministicOutcome | null> {
    const keyword = this.extractCourseReplyKeyword(message);
    if (!keyword) return null;

    const courses = await this.coursesService.searchCourses(tenantId, keyword);

    if (courses.length === 0) {
      return {
        type: 'clarification',
        message: `Mình chưa tìm thấy khóa học "${keyword}". Bạn muốn tạo lớp trong khóa học nào?`,
        missingFields: ['courseId'],
        intent: 'create_class',
        contextPatch: {
          last_intent: 'create_class',
          pending_class_creation: ctx,
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
        message: `Mình tìm thấy nhiều khóa ${keyword}. Bạn muốn tạo lớp trong khóa nào?\n\n${rows}`,
        missingFields: ['courseId'],
        intent: 'create_class',
        contextPatch: {
          last_intent: 'create_class',
          pending_class_creation: ctx,
          last_candidates: { courses: this.toOptions(courses) },
        },
      };
    }

    const course: any = courses[0];
    const courseLabel = course.title || course.courseCode || `#${course.id}`;
    const courseCtx: Partial<DecisionContext> = {
      last_intent: 'create_class',
      selected_course_id: Number(course.id),
      last_selected_course: this.toOptions([course])[0] || null,
      last_candidates: { courses: [] },
    };

    // Đã có khóa nhưng bản nháp chưa có tên lớp -> hỏi tên, giữ đủ draft.
    if (!ctx.title) {
      return {
        type: 'clarification',
        message: 'Bạn muốn đặt tên lớp là gì?',
        missingFields: ['title'],
        intent: 'create_class',
        contextPatch: {
          ...courseCtx,
          pending_class_creation: {
            ...ctx,
            courseId: Number(course.id),
            courseTitle: course.title ?? null,
            courseCode: course.courseCode ?? null,
          },
        },
      };
    }

    return {
      type: 'pending_write',
      pending: this.buildCreateClassPending({
        courseId: Number(course.id),
        courseLabel,
        title: ctx.title,
        type: ctx.type,
        teacherName: ctx.teacherName ?? undefined,
        startDate: ctx.startDate ?? undefined,
        endDate: ctx.endDate ?? undefined,
      }),
      contextPatch: { ...courseCtx, pending_class_creation: null },
    };
  }

  /** Bóc tên khóa từ câu trả lời kiểu "trong khóa Toán Cao Cấp" / "khóa X". */
  private extractCourseReplyKeyword(message: string): string {
    const LEADING = new Set([
      'trong',
      'thuoc',
      'cho',
      'la',
      'chon',
      'khoa',
      'hoc',
      'course',
      'chuong',
      'trinh',
    ]);
    const tokens = message.trim().split(/\s+/).filter(Boolean);
    let start = 0;
    while (start < tokens.length && LEADING.has(toSearchKey(tokens[start]))) {
      start += 1;
    }
    const keyword = tokens.slice(start).join(' ').trim();
    // Không bóc được gì (câu chỉ toàn từ đệm) -> dùng nguyên câu.
    return keyword || message.trim();
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
    startDate?: string;
    endDate?: string;
  }): PendingAction {
    const sessions = params.sessions ?? [];
    const input: Record<string, unknown> = {
      courseId: params.courseId,
      title: params.title,
      type: params.type,
      sessions,
    };
    if (params.teacherName) input.teacherName = params.teacherName;
    if (params.startDate) input.startDate = params.startDate;
    if (params.endDate) input.endDate = params.endDate;

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
    /** "vào lớp X trong/thuộc/của khóa Y" -> tên khóa để lọc đúng lớp. */
    courseKeyword?: string;
  } | null {
    const normTokens = origTokens.map((token) => toSearchKey(token));

    // "vào" + biến thể gõ thiếu/vùng miền: "ào" (rớt chữ v), "vô", "zô". Chỉ
    // dùng biến thể khi không có "vao" chuẩn để không cắt nhầm tên chứa "Ao".
    let sepIndex = normTokens.indexOf('vao');
    if (sepIndex < 0) {
      sepIndex = normTokens.findIndex((t) => ['ao', 'vo', 'zo'].includes(t));
    }

    let targetType: 'course' | 'class' | null = null;
    let targetStart = -1;
    // Vị trí kết thúc phần học viên (token đầu tiên KHÔNG thuộc tên học viên).
    let studentEnd = -1;

    if (sepIndex >= 0 && sepIndex < normTokens.length - 1) {
      // Loại thực thể đích ngay sau "vào".
      const after = normTokens.slice(sepIndex + 1);
      for (let i = 0; i < after.length; i += 1) {
        if (['lop', 'class'].includes(after[i])) {
          targetType = 'class';
          targetStart = sepIndex + 1 + i + 1;
          break;
        }
        if (['khoa', 'course'].includes(after[i])) {
          targetType = 'course';
          targetStart = sepIndex + 1 + i + 1;
          break;
        }
      }
      studentEnd = sepIndex;
    } else {
      // Câu ghi danh THIẾU hẳn "vào" ("thêm học viên bên trên lớp này"): chỉ
      // nhận khi có động từ ghi danh thật (không tính "tạo") và không phải câu
      // tìm kiếm, để không hijack intent create/search.
      const hasEnrollVerb = normTokens.some((t) =>
        ['them', 'ghi', 'xep', 'gan', 'add', 'enroll'].includes(t),
      );
      if (!hasEnrollVerb || SEARCH_VERB_RE.test(norm)) return null;
      for (let i = 1; i < normTokens.length - 1; i += 1) {
        if (['lop', 'class'].includes(normTokens[i])) {
          targetType = 'class';
          targetStart = i + 1;
          studentEnd = i;
          break;
        }
        if (['khoa', 'course'].includes(normTokens[i])) {
          targetType = 'course';
          targetStart = i + 1;
          studentEnd = i;
          break;
        }
      }
    }
    if (!targetType || targetStart < 0) return null;

    // "lớp học"/"khóa học" -> bỏ luôn "học" đứng ngay sau.
    if (toSearchKey(origTokens[targetStart] || '') === 'hoc') targetStart += 1;

    // "vào lớp X trong/thuộc/của khóa Y": tách riêng tên lớp và tên khóa —
    // nếu để nguyên cụm ("Test 1 trong khóa Test") đem search sẽ không match
    // lớp nào và trả "không tìm thấy" sai.
    let targetTokens = origTokens.slice(targetStart);
    let courseKeyword: string | undefined;
    if (targetType === 'class') {
      const targetNorm = targetTokens.map((token) => toSearchKey(token));
      for (let i = 0; i < targetNorm.length - 1; i += 1) {
        if (
          ['trong', 'thuoc', 'cua', 'o'].includes(targetNorm[i]) &&
          ['khoa', 'course'].includes(targetNorm[i + 1])
        ) {
          let courseStart = i + 2;
          if (toSearchKey(targetTokens[courseStart] || '') === 'hoc') {
            courseStart += 1;
          }
          courseKeyword =
            this.stripPoliteTail(
              targetTokens.slice(courseStart).join(' ').trim(),
            ) || undefined;
          targetTokens = targetTokens.slice(0, i);
          break;
        }
      }
    }

    // Bỏ đuôi lịch sự ("cho tôi", "giúp mình", "nhé"...) để "vào lớp này cho
    // tôi" ra đúng keyword "này".
    const targetKeyword = this.stripPoliteTail(targetTokens.join(' ').trim());

    // Phần học viên: các token trước "vào" (hoặc trước "lớp/khóa" nếu câu
    // thiếu "vào"), bỏ động từ + danh từ học viên.
    const studentTokens = origTokens.slice(0, studentEnd).filter((token) => {
      const key = toSearchKey(token);
      return !ENROLL_VERBS.has(key) && !STUDENT_WORDS.has(key);
    });
    const studentKeyword = this.stripPoliteTail(studentTokens.join(' ').trim());

    if (!studentKeyword || !targetKeyword) return null;
    return { studentKeyword, target: targetType, targetKeyword, courseKeyword };
  }

  /**
   * Cụm chỉ THAM CHIẾU ngữ cảnh ("bên trên", "vừa tạo", "này", "đó"...) thay vì
   * tên thật. Ví dụ: "thêm học viên bên trên vào lớp này" -> học viên/lớp lấy
   * từ state, KHÔNG đem "bên trên" đi search như tên.
   */
  private isContextRefPhrase(phrase: string): boolean {
    const tokens = toSearchKey(phrase).split(' ').filter(Boolean);
    if (!tokens.length) return false;
    let hasCore = false;
    for (const token of tokens) {
      if (CONTEXT_REF_CORE.has(token)) {
        hasCore = true;
        continue;
      }
      if (!CONTEXT_REF_FILLER.has(token)) return false;
    }
    return hasCore;
  }

  private async handleEnroll(
    tenantId: number,
    state: DecisionContext,
    enroll: {
      studentKeyword: string;
      target: 'course' | 'class';
      targetKeyword: string;
      courseKeyword?: string;
    },
  ): Promise<DeterministicOutcome> {
    // 0. Nhiều học viên trong 1 câu ("thêm A, B và C vào lớp X") -> tách theo
    // dấu phẩy/"và", resolve từng người rồi tạo 1 bản nháp GỘP.
    const keywords = this.splitStudentKeywords(enroll.studentKeyword);
    if (keywords.length > 1) {
      return this.handleBulkEnrollStudents(tenantId, state, keywords, enroll);
    }

    // 1. Học viên: "bên trên"/"vừa tạo"... -> lấy từ ngữ cảnh hội thoại.
    let student: any;
    if (this.isContextRefPhrase(enroll.studentKeyword)) {
      const ctxStudent =
        state.last_created_student || state.last_selected_student;
      if (!ctxStudent?.id) {
        return {
          type: 'clarification',
          message:
            'Mình chưa thấy học viên nào vừa được tạo hoặc nhắc tới trong hội thoại này. ' +
            'Bạn cho mình tên (hoặc email/SĐT) của học viên cần thêm nhé.',
          missingFields: ['userId'],
          intent: 'assign_student_to_class',
          contextPatch: { last_intent: 'assign_student_to_class' },
        };
      }
      student = { id: ctxStudent.id, fullName: ctxStudent.label };
    } else {
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
        // Nhiều học viên trùng tên: hỏi chọn nhưng PHẢI lưu đích ghi danh vào
        // pending_enrollment_context để lượt trả lời "1"/tên được state machine
        // đưa thẳng vào preview — không rơi xuống LLM (LLM không hoàn tất được
        // ghi danh, từng trả lời suông không tạo bản nháp nào).
        const options = this.toOptions(students);
        return {
          type: 'clarification',
          message:
            `${formatCandidateList('student', students)}\n` +
            'Bạn có thể chọn nhiều người cùng lúc, ví dụ: "1, 3, 5".',
          missingFields: ['userId'],
          intent: 'assign_student_to_class',
          contextPatch: {
            last_intent: 'assign_student_to_class',
            last_candidates: { students: options },
            pending_enrollment_context: {
              userId: 0,
              courseId: 0,
              candidateClasses: [],
              candidateStudents: options,
              targetType: enroll.target,
              targetKeyword: enroll.targetKeyword,
              targetCourseKeyword: enroll.courseKeyword,
            },
          },
        };
      }
      student = students[0];
    }

    return this.resolveEnrollTarget(tenantId, state, student, enroll);
  }

  /**
   * Tách phần học viên thành nhiều keyword: "A, B và C" -> ["A","B","C"].
   * Ngăn cách bởi dấu phẩy hoặc liên từ đứng riêng ("và"/"va"/"cùng"/"with").
   */
  private splitStudentKeywords(keyword: string): string[] {
    return keyword
      .split(/\s*,\s*|\s+(?:và|va|cùng|cung|voi|với|and|with)\s+/iu)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  /**
   * Ghi danh NHIỀU học viên trong 1 câu. Resolve từng người độc lập:
   * - Tất cả chốt được duy nhất -> 1 bản nháp gộp (confirm 1 lần, kết quả
   *   từng người khi execute).
   * - Có tên không thấy/trùng nhiều người -> hỏi lại NÊU RÕ từng tên có vấn
   *   đề, không hủy cả nhóm.
   */
  private async handleBulkEnrollStudents(
    tenantId: number,
    state: DecisionContext,
    keywords: string[],
    enroll: {
      target: 'course' | 'class';
      targetKeyword: string;
      courseKeyword?: string;
    },
  ): Promise<DeterministicOutcome> {
    const resolved: any[] = [];
    const notFound: string[] = [];
    const ambiguous: Array<{ keyword: string; candidates: any[] }> = [];

    for (const keyword of keywords) {
      // "học viên vừa tạo" đứng trong danh sách -> lấy từ ngữ cảnh.
      if (this.isContextRefPhrase(keyword)) {
        const ctxStudent =
          state.last_created_student || state.last_selected_student;
        if (ctxStudent?.id) {
          resolved.push({ id: ctxStudent.id, fullName: ctxStudent.label });
        } else {
          notFound.push(keyword);
        }
        continue;
      }
      const students = await this.usersService.searchStudents(
        tenantId,
        keyword,
      );
      if (students.length === 0) notFound.push(keyword);
      else if (students.length > 1) ambiguous.push({ keyword, candidates: students });
      else resolved.push(students[0]);
    }

    if (notFound.length || ambiguous.length) {
      const lines: string[] = [];
      if (notFound.length) {
        lines.push(
          `- Không tìm thấy: ${notFound.map((k) => `"${k}"`).join(', ')}.`,
        );
      }
      for (const item of ambiguous) {
        const rows = item.candidates
          .slice(0, 5)
          .map((s: any) => {
            const extra = [s.email, s.phone].filter(Boolean).join(' | ');
            return `   • ${s.fullName || `#${s.id}`} (ID: ${s.id}${extra ? ` | ${extra}` : ''})`;
          })
          .join('\n');
        lines.push(`- "${item.keyword}" có nhiều người trùng tên:\n${rows}`);
      }
      return {
        type: 'clarification',
        message:
          'Mình chưa chốt được danh sách học viên:\n\n' +
          lines.join('\n') +
          '\n\nBạn ghi rõ hơn (kèm email/SĐT hoặc ID) rồi gửi lại cả câu giúp mình nhé.',
        missingFields: ['userId'],
        intent: 'assign_student_to_class',
        contextPatch: { last_intent: 'assign_student_to_class' },
      };
    }

    // Cùng 1 người bị nhắc 2 lần -> khử trùng theo id.
    const unique = new Map<number, any>();
    for (const s of resolved) unique.set(Number(s.id), s);
    const students = [...unique.values()];
    return this.resolveEnrollTarget(
      tenantId,
      state,
      students.length === 1 ? students[0] : students,
      enroll,
    );
  }

  /**
   * Đã chốt học viên -> xác định ĐÍCH ghi danh (lớp/khóa) và trả preview hoặc
   * câu hỏi chọn tiếp. Dùng chung cho handleEnroll và lượt trả lời chọn học
   * viên (resolveEnrollStudentReply). `student` có thể là MỘT học viên hoặc
   * MẢNG học viên (bản nháp gộp).
   */
  private async resolveEnrollTarget(
    tenantId: number,
    state: DecisionContext,
    student: any,
    enroll: {
      target: 'course' | 'class';
      targetKeyword: string;
      courseKeyword?: string;
    },
  ): Promise<DeterministicOutcome> {
    // 2. Đích là KHÓA: ghi danh vẫn CHỈ ở cấp lớp -> xác định khóa rồi dẫn user
    //    tới lớp cụ thể (khóa 1 lớp thì preview luôn, nhiều lớp thì hỏi chọn).
    if (enroll.target !== 'class') {
      return this.handleEnrollIntoCourse(tenantId, state, student, enroll);
    }

    // 3. Đích là LỚP: "lớp này"/"lớp vừa tạo" -> lấy lớp từ ngữ cảnh.
    if (this.isContextRefPhrase(enroll.targetKeyword)) {
      const ctxClass = state.last_created_class || state.last_selected_class;
      if (!ctxClass?.id) {
        return {
          type: 'clarification',
          message:
            'Mình chưa rõ "lớp này" là lớp nào vì hội thoại chưa nhắc tới lớp nào. ' +
            'Bạn nhập tên lớp hoặc mã lớp giúp mình nhé.',
          missingFields: ['classId'],
          intent: 'assign_student_to_class',
          contextPatch: { last_intent: 'assign_student_to_class' },
        };
      }
      const meta = (ctxClass.metadata || {}) as Record<string, unknown>;
      const course = (meta.course || {}) as Record<string, unknown>;
      return this.buildEnrollPending(student, {
        classId: Number(ctxClass.id),
        courseId:
          Number(meta.courseId ?? course.id) || undefined,
        classLabel: ctxClass.label,
        courseLabel:
          typeof course.title === 'string' ? course.title : undefined,
      });
    }

    let classes = await this.coursesService.searchClasses(
      tenantId,
      enroll.targetKeyword,
    );
    // "vào lớp X trong khóa Y": lọc các lớp match tên theo khóa user nêu.
    if (enroll.courseKeyword && classes.length > 0) {
      const courseKey = toSearchKey(enroll.courseKeyword);
      const filtered = classes.filter((cls: any) => {
        const title = toSearchKey(String(cls.course?.title || ''));
        const code = toSearchKey(String(cls.course?.courseCode || ''));
        return (
          (courseKey && title.includes(courseKey)) ||
          (courseKey && code.includes(courseKey))
        );
      });
      if (filtered.length === 0) {
        return {
          type: 'message',
          message: `Không tìm thấy lớp "${enroll.targetKeyword}" trong khóa "${enroll.courseKeyword}". Bạn kiểm tra lại tên lớp/khóa giúp mình nhé.`,
          contextPatch: { last_intent: 'assign_student_to_class' },
        };
      }
      classes = filtered;
    }
    if (classes.length === 0) {
      return this.notFound('class', enroll.targetKeyword, this.toOptions([]));
    }
    if (classes.length > 1) {
      // Nhiều lớp trùng tên: hỏi chọn lớp nhưng PHẢI lưu pending_enrollment_context
      // (giữ userId đã resolve) để lượt trả lời "1"/tên lớp được state machine
      // handlePendingEnrollmentReply đưa thẳng vào preview ghi danh. Nếu chỉ dùng
      // chooseFrom (mất userId) thì câu trả lời rơi xuống LLM — LLM không có cách
      // hoàn tất ghi danh nên từng bịa "đã thêm thành công" mà không ghi DB.
      const options = this.toOptions(classes);
      const students: any[] = Array.isArray(student) ? student : [student];
      const names = students
        .map((s) => s.fullName || s.name || `học viên #${s.id}`)
        .join(', ');
      return {
        type: 'clarification',
        message:
          `${formatCandidateList('class', classes)}\n` +
          `Bạn muốn thêm ${names} vào lớp nào?`,
        missingFields: ['classId'],
        intent: 'assign_student_to_class',
        contextPatch: {
          last_intent: 'assign_student_to_class',
          pending_enrollment_context: {
            userId: students.length === 1 ? Number(students[0].id) : 0,
            ...(students.length > 1
              ? {
                  userIds: students.map((s) => Number(s.id)),
                  studentLabels: students.map(
                    (s) => s.fullName || s.name || `#${s.id}`,
                  ),
                }
              : {}),
            // Các lớp trùng tên có thể thuộc nhiều khóa khác nhau -> chưa chốt
            // khóa; courseId thật được suy từ lớp user chọn ở lượt sau.
            courseId: 0,
            candidateClasses: options,
          },
          last_candidates: { classes: options },
        },
      };
    }
    const cls: any = classes[0];
    return this.buildEnrollPending(student, {
      courseId: Number(cls.courseId ?? cls.course?.id) || undefined,
      classId: Number(cls.id),
      courseLabel: cls.course?.title || cls.course?.courseCode,
      classLabel: cls.title || cls.classCode,
    });
  }

  /**
   * User trả lời CHỌN HỌC VIÊN (số thứ tự/tên) khi đang có
   * pending_enrollment_context.candidateStudents. Học viên đã được copilot
   * resolve từ danh sách; đi tiếp phần đích ghi danh đã lưu trong context.
   * Chọn nhiều người ("1,3,5") -> truyền mảng -> bản nháp ghi danh GỘP.
   */
  async resolveEnrollStudentReply(
    tenantId: number,
    state: DecisionContext,
    ctx: PendingEnrollmentContext,
    student:
      | { id: number; label: string }
      | Array<{ id: number; label: string }>,
  ): Promise<DeterministicOutcome | null> {
    if (!ctx.targetType) return null;
    const list = Array.isArray(student) ? student : [student];
    const students = list.map((item) => ({
      id: item.id,
      fullName: item.label,
    }));
    return this.resolveEnrollTarget(
      tenantId,
      state,
      students.length === 1 ? students[0] : students,
      {
        target: ctx.targetType,
        targetKeyword: ctx.targetKeyword || '',
        courseKeyword: ctx.targetCourseKeyword,
      },
    );
  }

  /**
   * "thêm X vào khóa Y/khóa này": xác định khóa (theo ngữ cảnh hoặc tên) rồi
   * liệt kê lớp của khóa — 1 lớp thì preview ghi danh luôn, nhiều lớp thì hỏi
   * chọn (lưu pending_enrollment_context để lượt sau user chỉ cần nói tên lớp).
   */
  private async handleEnrollIntoCourse(
    tenantId: number,
    state: DecisionContext,
    student: any,
    enroll: { targetKeyword: string },
  ): Promise<DeterministicOutcome> {
    let courseId = 0;
    let courseLabel = '';

    if (this.isContextRefPhrase(enroll.targetKeyword)) {
      const ctxCourse =
        state.last_created_course || state.last_selected_course;
      if (ctxCourse?.id) {
        courseId = Number(ctxCourse.id);
        courseLabel = ctxCourse.label;
      } else {
        // Chưa có khóa trong ngữ cảnh nhưng có LỚP vừa tạo/chọn -> suy ra khóa
        // của lớp đó (vd: vừa tạo lớp trong khóa Test rồi nói "vào khóa này").
        const ctxClass = state.last_created_class || state.last_selected_class;
        const meta = (ctxClass?.metadata || {}) as Record<string, any>;
        courseId =
          Number(meta.courseId ?? meta.course?.id) ||
          Number(state.selected_course_id) ||
          0;
        courseLabel =
          typeof meta.course?.title === 'string' ? meta.course.title : '';
      }
      if (!courseId) {
        return {
          type: 'clarification',
          message:
            'Mình chưa rõ "khóa này" là khóa nào vì hội thoại chưa nhắc tới khóa nào. ' +
            'Bạn nhập tên khóa học hoặc tên lớp cụ thể giúp mình nhé.',
          missingFields: ['classId'],
          intent: 'assign_student_to_class',
          contextPatch: { last_intent: 'assign_student_to_class' },
        };
      }
    } else {
      const courses = await this.coursesService.searchCourses(
        tenantId,
        enroll.targetKeyword,
      );
      if (courses.length === 0) {
        return this.notFound(
          'course',
          enroll.targetKeyword,
          this.toOptions([]),
        );
      }
      if (courses.length > 1) {
        // Nhiều khóa trùng tên: hỏi chọn khóa nhưng PHẢI lưu
        // pending_enrollment_context (giữ học viên đã resolve) — giống case
        // nhiều lớp trùng tên. Nếu chỉ dùng chooseFrom thì câu trả lời
        // "1"/"ID 93" rơi xuống LLM/fallback và mất mạch ghi danh.
        const courseOptions = this.toOptions(courses);
        const studentList: any[] = Array.isArray(student) ? student : [student];
        const names = studentList
          .map((s) => s.fullName || s.name || `học viên #${s.id}`)
          .join(', ');
        return {
          type: 'clarification',
          message:
            `${formatCandidateList('course', courses)}\n` +
            `Bạn muốn thêm ${names} vào khóa nào?`,
          missingFields: ['courseId'],
          intent: 'assign_student_to_class',
          contextPatch: {
            last_intent: 'assign_student_to_class',
            pending_enrollment_context: {
              userId: studentList.length === 1 ? Number(studentList[0].id) : 0,
              ...(studentList.length > 1
                ? { userIds: studentList.map((s) => Number(s.id)) }
                : {}),
              studentLabels: studentList.map(
                (s) => s.fullName || s.name || `#${s.id}`,
              ),
              courseId: 0,
              candidateClasses: [],
              candidateCourses: courseOptions,
            },
            last_candidates: { courses: courseOptions },
          },
        };
      }
      courseId = Number(courses[0].id);
      courseLabel = String(courses[0].title || courses[0].courseCode || '');
    }

    return this.enrollIntoResolvedCourse(
      tenantId,
      student,
      courseId,
      courseLabel,
    );
  }

  /**
   * User trả lời CHỌN KHÓA (số thứ tự/tên/ID) khi đang có
   * pending_enrollment_context.candidateCourses. Học viên đã resolve từ trước;
   * đi tiếp phần liệt kê lớp của khóa vừa chọn.
   */
  async resolveEnrollCourseReply(
    tenantId: number,
    ctx: PendingEnrollmentContext,
    course: { id: number; label: string },
  ): Promise<DeterministicOutcome | null> {
    const students = ctx.userIds?.length
      ? ctx.userIds.map((id, index) => ({
          id,
          fullName: ctx.studentLabels?.[index] || `#${id}`,
        }))
      : ctx.userId
        ? [
            {
              id: ctx.userId,
              fullName: ctx.studentLabels?.[0] || `#${ctx.userId}`,
            },
          ]
        : [];
    if (!students.length) return null;
    return this.enrollIntoResolvedCourse(
      tenantId,
      students.length === 1 ? students[0] : students,
      course.id,
      course.label,
    );
  }

  /** Khóa đã chốt -> liệt kê lớp: 0 lớp báo tạo lớp, 1 lớp preview luôn, nhiều lớp hỏi chọn. */
  private async enrollIntoResolvedCourse(
    tenantId: number,
    student: any,
    courseId: number,
    courseLabel: string,
  ): Promise<DeterministicOutcome> {
    const classes = await this.coursesService.searchClasses(tenantId, '', {
      courseId,
    });
    if (classes.length === 0) {
      return {
        type: 'message',
        message: `Khóa "${courseLabel || `#${courseId}`}" chưa có lớp nào nên chưa thể thêm học viên. Bạn tạo lớp trong khóa này trước nhé.`,
        contextPatch: {
          last_intent: 'assign_student_to_class',
          // Nhớ khóa vừa nhắc tới: user thường nói tiếp "tạo lớp trong khóa
          // này" — không patch thì resolveContextCourse rơi về khóa cũ.
          selected_course_id: courseId,
          last_selected_course: {
            id: courseId,
            label: courseLabel || `#${courseId}`,
          },
        },
      };
    }
    if (classes.length === 1) {
      const cls: any = classes[0];
      return this.buildEnrollPending(student, {
        classId: Number(cls.id),
        courseId,
        courseLabel: courseLabel || undefined,
        classLabel: cls.title || cls.classCode,
      });
    }

    const options = this.toOptions(classes);
    const students: any[] = Array.isArray(student) ? student : [student];
    const names = students
      .map((s) => s.fullName || s.name || `học viên #${s.id}`)
      .join(', ');
    // Intent để assign_student_to_class (KHÔNG phải _to_course): ghi danh luôn
    // ở cấp lớp, và _to_course bị chặn trong mini mode -> tránh dính guard
    // isOutcomeOutsideMiniScope trả lời "chưa được bật trong bản mini".
    return {
      type: 'clarification',
      message:
        `${formatCandidateList('class', classes)}\n` +
        `Bạn muốn thêm ${names} vào lớp nào?`,
      missingFields: ['classId'],
      intent: 'assign_student_to_class',
      contextPatch: {
        last_intent: 'assign_student_to_class',
        pending_enrollment_context: {
          userId: students.length === 1 ? Number(students[0].id) : 0,
          ...(students.length > 1
            ? {
                userIds: students.map((s) => Number(s.id)),
                studentLabels: students.map(
                  (s) => s.fullName || s.name || `#${s.id}`,
                ),
              }
            : {}),
          courseId,
          candidateClasses: options,
        },
        last_candidates: { classes: options },
      },
    };
  }

  // ---- List students in course/class ---------------------------------------

  /**
   * "xem danh sách học viên trong khóa X" / "ds học viên lớp Y" -> scope +
   * keyword (keyword rỗng hoặc là cụm tham chiếu -> lấy từ ngữ cảnh).
   */
  private parseListStudents(
    norm: string,
    origTokens: string[],
  ): {
    scope: 'course' | 'class' | 'system';
    keyword: string;
    /** Lọc học viên theo tên/email/SĐT: "tìm học viên TUẤN trong khóa X". */
    studentKeyword: string;
  } | null {
    if (!STUDENT_RE.test(norm)) return null;
    if (!LIST_STUDENTS_VERB_RE.test(norm)) return null;
    if (MODIFY_VERB_RE.test(norm)) return null;
    if (CREATE_VERB_RE.test(norm)) return null;

    const normTokens = origTokens.map((token) => toSearchKey(token));

    // Vị trí KẾT THÚC cụm "học viên/hv/hs..." đầu tiên (để cắt keyword học viên).
    let studentEnd = -1;
    for (let i = 0; i < normTokens.length; i += 1) {
      if (
        ['hocvien', 'hv', 'hs', 'student', 'learner'].includes(normTokens[i])
      ) {
        studentEnd = i + 1;
        break;
      }
      if (
        normTokens[i] === 'hoc' &&
        ['vien', 'sinh'].includes(normTokens[i + 1] || '')
      ) {
        studentEnd = i + 2;
        break;
      }
    }

    let scope: 'course' | 'class' | 'system' | null = null;
    let start = -1;
    let markerIndex = normTokens.length;
    for (let i = Math.max(studentEnd, 0); i < normTokens.length; i += 1) {
      if (['lop', 'class'].includes(normTokens[i])) {
        scope = 'class';
        start = i + 1;
        markerIndex = i;
        break;
      }
      if (['khoa', 'course'].includes(normTokens[i])) {
        scope = 'course';
        start = i + 1;
        markerIndex = i;
        break;
      }
    }

    // Keyword học viên = phần giữa "học viên" và marker khóa/lớp, bỏ từ nối và
    // cụm "tất cả/toàn bộ" ("tìm học viên tuấn trong khóa test" -> "tuấn").
    // Cụm 2 từ phải bỏ THEO CẶP: bỏ token đơn 'toan'/'ca' sẽ nuốt mất tên
    // riêng như "Toàn".
    const SKIP_SINGLE = new Set([
      'trong', 'o', 'thuoc', 'cua', 'tai', 'ten', 'la', 'co',
      'het', 'cac', 'nhung', 'all',
    ]);
    const SKIP_PAIRS = [
      ['tat', 'ca'],
      ['toan', 'bo'],
      ['danh', 'sach'],
    ];
    const kwTokens: string[] = [];
    for (let i = studentEnd; i >= 0 && i < markerIndex; i += 1) {
      const key = toSearchKey(origTokens[i] || '');
      const nextKey = toSearchKey(origTokens[i + 1] || '');
      if (
        i + 1 < markerIndex &&
        SKIP_PAIRS.some(([a, b]) => key === a && nextKey === b)
      ) {
        i += 1;
        continue;
      }
      if (SKIP_SINGLE.has(key)) continue;
      kwTokens.push(origTokens[i]);
    }
    const studentKeyword =
      studentEnd >= 0
        ? this.stripPoliteTail(kwTokens.join(' ').trim())
        : '';

    if (!scope || start < 0) {
      // Không nêu khóa/lớp: chỉ nhận scope TOÀN HỆ THỐNG khi có tín hiệu "xem
      // tất cả/danh sách" và không kèm tên cụ thể — "tìm học viên An" vẫn đi
      // flow search thường (trả candidates để chọn).
      const hasAllSignal =
        /(^|\s)(tat ca|toan bo|danh sach|ds|liet ke|all)(\s|$)/.test(norm);
      if (hasAllSignal && !studentKeyword) {
        return { scope: 'system', keyword: '', studentKeyword: '' };
      }
      return null;
    }

    // "khóa học X"/"lớp học X" -> bỏ "học" ngay sau marker.
    if (toSearchKey(origTokens[start] || '') === 'hoc') start += 1;
    const keyword = this.stripPoliteTail(
      origTokens.slice(start).join(' ').trim(),
    );
    return { scope, keyword, studentKeyword };
  }

  private async handleListStudents(
    tenantId: number,
    state: DecisionContext,
    parsed: {
      scope: 'course' | 'class' | 'system';
      keyword: string;
      studentKeyword: string;
    },
  ): Promise<DeterministicOutcome> {
    const { scope, keyword, studentKeyword } = parsed;
    const useContext = !keyword || this.isContextRefPhrase(keyword);

    // Toàn hệ thống: "tìm tất cả học viên", "danh sách học viên".
    if (scope === 'system') {
      const students = await this.usersService.findAllStudents(tenantId, {
        keyword: studentKeyword || undefined,
      });
      return this.buildStudentTable({
        scope: 'system',
        label: 'toàn hệ thống',
        contextPatch: {},
        filterKeyword: studentKeyword,
        // Chặn payload quá lớn; UI phân trang 10 học viên/trang.
        rows: (students || []).slice(0, 100).map((s: any) => ({
          id: Number(s.id) || 0,
          fullName: String(s.fullName || `#${s.id}`),
          email: s.email ?? null,
          phone: s.phone ?? null,
        })),
      });
    }

    if (scope === 'class') {
      let classId = 0;
      let classLabel = '';
      if (useContext) {
        const ctxClass = state.last_created_class || state.last_selected_class;
        classId = Number(ctxClass?.id) || Number(state.selected_class_id) || 0;
        classLabel = ctxClass?.label || (classId ? `#${classId}` : '');
        if (!classId) {
          return {
            type: 'clarification',
            message:
              'Bạn muốn xem học viên của lớp nào? Cho mình tên lớp hoặc mã lớp nhé.',
            missingFields: ['classId'],
            intent: 'get_class_students',
            contextPatch: {},
          };
        }
      } else {
        const classes = await this.coursesService.searchClasses(
          tenantId,
          keyword,
        );
        if (classes.length === 0) {
          return this.notFound('class', keyword, this.toOptions([]));
        }
        if (classes.length > 1) {
          return this.chooseFrom('class', classes);
        }
        const cls: any = classes[0];
        classId = Number(cls.id);
        classLabel = cls.title || cls.classCode || `#${classId}`;
      }

      const rows = await this.coursesService.getClassStudents(
        tenantId,
        classId,
      );
      return this.buildStudentTable({
        scope: 'class',
        label: classLabel,
        contextPatch: { selected_class_id: classId },
        filterKeyword: studentKeyword,
        rows: (rows || []).map((row: any) => ({
          id: Number(row.student?.id) || 0,
          fullName: String(row.student?.fullName || `#${row.student?.id}`),
          email: row.student?.email ?? null,
          phone: row.student?.phone ?? null,
          className: classLabel,
          roleInClass: row.roleInClass ?? null,
          joinedAt: row.joinedAt
            ? new Date(row.joinedAt).toISOString()
            : null,
        })),
      });
    }

    let courseId = 0;
    let courseLabel = '';
    if (useContext) {
      const ctxCourse = state.last_created_course || state.last_selected_course;
      if (ctxCourse?.id) {
        courseId = Number(ctxCourse.id);
        courseLabel = ctxCourse.label;
      } else {
        // Suy ra khóa từ lớp gần nhất trong ngữ cảnh (vd vừa tạo lớp xong).
        const ctxClass = state.last_created_class || state.last_selected_class;
        const meta = (ctxClass?.metadata || {}) as Record<string, any>;
        courseId =
          Number(meta.courseId ?? meta.course?.id) ||
          Number(state.selected_course_id) ||
          0;
        courseLabel =
          typeof meta.course?.title === 'string'
            ? meta.course.title
            : courseId
              ? `#${courseId}`
              : '';
      }
      if (!courseId) {
        return {
          type: 'clarification',
          message:
            'Bạn muốn xem học viên của khóa học nào? Cho mình tên khóa nhé.',
          missingFields: ['courseId'],
          intent: 'get_course_detail',
          contextPatch: {},
        };
      }
    } else {
      const courses = await this.coursesService.searchCourses(
        tenantId,
        keyword,
      );
      if (courses.length === 0) {
        return this.notFound('course', keyword, this.toOptions([]));
      }
      if (courses.length > 1) {
        // Nhớ intent gốc: chọn khóa xong phải hiện danh sách LUÔN.
        return this.chooseFromCourseWithContinuation(courses, {
          intent: 'list_students',
          studentKeyword,
        });
      }
      courseId = Number(courses[0].id);
      courseLabel = String(
        courses[0].title || courses[0].courseCode || `#${courseId}`,
      );
    }

    return this.listCourseStudents(
      tenantId,
      courseId,
      courseLabel,
      studentKeyword,
    );
  }

  /**
   * Bảng học viên của MỘT khóa đã chốt. Public để CopilotService gọi tiếp sau
   * khi user chọn khóa từ danh sách candidates.
   */
  async listCourseStudents(
    tenantId: number,
    courseId: number,
    courseLabel: string,
    studentKeyword: string,
  ): Promise<DeterministicOutcome> {
    const rows = await this.coursesService.getCourseStudents(
      tenantId,
      courseId,
    );
    const enrollmentRows: StudentTableRow[] = (rows || []).map((row: any) => ({
      id: Number(row.student?.id) || 0,
      fullName: String(row.student?.fullName || `#${row.student?.id}`),
      email: row.student?.email ?? null,
      phone: row.student?.phone ?? null,
      className: row.classTitle ?? null,
      classType: row.classType ?? null,
      roleInClass: row.roleInClass ?? null,
      joinedAt: row.joinedAt ? new Date(row.joinedAt).toISOString() : null,
    }));

    // Gộp 1 DÒNG / HỌC VIÊN: học nhiều lớp trong khóa thì cột Lớp ghi
    // "Toán 3, Tiếng Bỉ 1" thay vì lặp lại học viên mỗi lớp một dòng.
    const byStudent = new Map<number, StudentTableRow>();
    for (const row of enrollmentRows) {
      const existing = byStudent.get(row.id);
      if (!existing) {
        byStudent.set(row.id, { ...row });
        continue;
      }
      const classNames = (existing.className || '')
        .split(', ')
        .filter(Boolean);
      if (row.className && !classNames.includes(row.className)) {
        classNames.push(row.className);
        existing.className = classNames.join(', ');
        // Nhiều lớp có thể khác loại -> bỏ badge loại lớp cho dòng gộp.
        existing.classType = null;
      }
    }

    return this.buildStudentTable({
      scope: 'course',
      label: courseLabel,
      contextPatch: { selected_course_id: courseId },
      filterKeyword: studentKeyword,
      rows: Array.from(byStudent.values()),
    });
  }

  /** chooseFrom('course') + lưu intent gốc để chọn khóa xong đi tiếp luôn. */
  private chooseFromCourseWithContinuation(
    courses: any[],
    choice: NonNullable<DecisionContext['pending_course_choice']>,
  ): DeterministicOutcome {
    const outcome = this.chooseFrom('course', courses);
    return {
      ...outcome,
      contextPatch: {
        ...outcome.contextPatch,
        pending_course_choice: choice,
      },
    };
  }

  /** Dựng outcome bảng học viên + lưu candidates để follow-up "chọn số 2". */
  private buildStudentTable(params: {
    scope: 'course' | 'class' | 'system';
    label: string;
    rows: StudentTableRow[];
    contextPatch: Partial<DecisionContext>;
    /** Có -> chỉ giữ học viên khớp tên/email/SĐT (không phân biệt dấu). */
    filterKeyword?: string;
  }): DeterministicOutcome {
    const scopeLabel =
      params.scope === 'course'
        ? `khóa "${params.label}"`
        : params.scope === 'class'
          ? `lớp "${params.label}"`
          : 'hệ thống';

    const filterKey = toSearchKey(params.filterKeyword || '');
    const rows = filterKey
      ? params.rows.filter((row) =>
          toSearchKey(
            [row.fullName, row.email || '', row.phone || ''].join(' '),
          ).includes(filterKey),
        )
      : params.rows;

    if (rows.length === 0) {
      return {
        type: 'message',
        message: filterKey
          ? `Không tìm thấy học viên nào khớp "${params.filterKeyword}" trong ${scopeLabel}.`
          : params.scope === 'system'
            ? 'Hệ thống chưa có học viên nào.'
            : `${params.scope === 'course' ? 'Khóa' : 'Lớp'} "${params.label}" chưa có học viên nào.`,
        contextPatch: params.contextPatch,
      };
    }

    const seen = new Set<number>();
    const options: EntityOption[] = [];
    for (const row of rows) {
      if (!row.id || seen.has(row.id)) continue;
      seen.add(row.id);
      if (options.length < 10) {
        options.push({
          id: row.id,
          value: row.id,
          label: row.fullName,
          email: row.email ?? null,
          phone: row.phone ?? null,
        });
      }
    }
    const uniqueCount = seen.size;

    const title =
      params.scope === 'system'
        ? 'Danh sách học viên toàn hệ thống'
        : `Danh sách học viên ${params.scope === 'course' ? 'khóa' : 'lớp'} ${params.label}`;
    const message = filterKey
      ? `Tìm thấy ${uniqueCount} học viên khớp "${params.filterKeyword}" trong ${scopeLabel}.`
      : params.scope === 'course' && uniqueCount !== rows.length
        ? `${uniqueCount} học viên · ${rows.length} lượt ghi danh (một học viên có thể học nhiều lớp).`
        : `Sĩ số hiện tại: ${uniqueCount} học viên.`;

    return {
      type: 'student_table',
      title,
      message,
      scope: params.scope,
      students: rows,
      contextPatch: {
        ...params.contextPatch,
        last_intent: 'search_student',
        last_candidates: { students: options },
      },
    };
  }

  // ---- List classes of course ----------------------------------------------

  /**
   * "xem danh sách lớp (trong) khóa X", "ds lớp khóa này", "xem tất cả lớp".
   * KHÔNG nhận khi câu nhắc học viên (đã có bảng học viên) hoặc là câu tìm
   * kiếm lớp cụ thể ("tìm lớp ielts" -> vẫn đi flow search chọn lớp).
   */
  private parseListClasses(
    norm: string,
    origTokens: string[],
  ): {
    courseKeyword: string;
    classKeyword: string;
    /** "lớp THEO TUẦN/LUYỆN ĐỀ" -> lọc theo LOẠI lớp, không phải tên lớp. */
    classType?: 'WEEKLY' | 'EXAM_PRACTICE';
    /** "trong (cả) hệ thống" -> bỏ qua khóa trong ngữ cảnh, liệt kê tất cả. */
    systemWide?: boolean;
    /** Câu có nhắc tới "khóa" không — không nhắc thì KHÔNG lấy khóa ngữ cảnh. */
    mentionsCourse?: boolean;
  } | null {
    if (STUDENT_RE.test(norm)) return null;
    if (!CLASS_RE.test(norm)) return null;
    if (
      !/(^|\s)(xem|hien thi|danh sach|ds|liet ke|list|show|tat ca)(\s|$)/.test(
        norm,
      )
    ) {
      return null;
    }
    if (MODIFY_VERB_RE.test(norm)) return null;

    const normTokens = origTokens.map((token) => toSearchKey(token));
    const lopIdx = normTokens.findIndex((t) => ['lop', 'class'].includes(t));
    if (lopIdx < 0) return null;
    const khoaIdx = normTokens.findIndex(
      (t, i) => i > lopIdx && ['khoa', 'course'].includes(t),
    );

    const CONNECT = new Set(['hoc', 'trong', 'thuoc', 'cua', 'o']);
    let courseKeyword = '';
    let classKeyword = '';
    if (khoaIdx >= 0) {
      let start = khoaIdx + 1;
      if (normTokens[start] === 'hoc') start += 1;
      courseKeyword = this.stripPoliteTail(
        origTokens.slice(start).join(' ').trim(),
      );
      classKeyword = origTokens
        .slice(lopIdx + 1, khoaIdx)
        .filter((token) => !CONNECT.has(toSearchKey(token)))
        .join(' ')
        .trim();
    } else {
      let start = lopIdx + 1;
      if (normTokens[start] === 'hoc') start += 1;
      classKeyword = this.stripPoliteTail(
        origTokens.slice(start).join(' ').trim(),
      );
    }
    // Cụm tham chiếu ("này", "vừa tạo") ở vị trí tên lớp thực ra trỏ ngữ cảnh
    // chung -> không dùng làm filter tên.
    if (classKeyword && this.isContextRefPhrase(classKeyword)) {
      classKeyword = '';
    }

    // "theo tuần"/"luyện đề" trong phần tên lớp -> đó là LOẠI lớp: tách ra
    // làm filter type, phần còn lại (nếu có) mới là keyword tên lớp.
    let classType: 'WEEKLY' | 'EXAM_PRACTICE' | undefined;
    const kwNorm = toSearchKey(classKeyword);
    if (/(^|\s)(luyen de|exam)(\s|$)/.test(kwNorm)) {
      classType = 'EXAM_PRACTICE';
    } else if (/(^|\s)(theo tuan|hang tuan|weekly)(\s|$)/.test(kwNorm)) {
      classType = 'WEEKLY';
    }
    if (classType) {
      const tokens = classKeyword.split(/\s+/).filter(Boolean);
      const cleaned: string[] = [];
      for (let i = 0; i < tokens.length; i += 1) {
        const key = toSearchKey(tokens[i]);
        const next = toSearchKey(tokens[i + 1] || '');
        if ((key === 'theo' || key === 'hang') && next === 'tuan') {
          i += 1;
          continue;
        }
        if (key === 'luyen' && next === 'de') {
          i += 1;
          continue;
        }
        if (['weekly', 'exam', 'practice'].includes(key)) continue;
        cleaned.push(tokens[i]);
      }
      classKeyword = cleaned.join(' ').trim();
    }

    // "trong (cả/toàn) hệ thống" -> cắt cụm đó khỏi keyword khóa/lớp.
    const systemWide = /(^|\s)(he thong)(\s|$)/.test(norm);
    if (systemWide) {
      const stripSystem = (value: string) => {
        const tokens = value.split(/\s+/).filter(Boolean);
        const norms = tokens.map((t) => toSearchKey(t));
        let cut = -1;
        for (let i = 0; i < norms.length - 1; i += 1) {
          if (norms[i] === 'he' && norms[i + 1] === 'thong') {
            cut = i;
            break;
          }
        }
        if (cut < 0) return value.trim();
        while (
          cut > 0 &&
          ['trong', 'ca', 'toan', 'o'].includes(norms[cut - 1])
        ) {
          cut -= 1;
        }
        return tokens.slice(0, cut).join(' ').trim();
      };
      courseKeyword = stripSystem(courseKeyword);
      classKeyword = stripSystem(classKeyword);
    }

    return {
      courseKeyword,
      classKeyword,
      classType,
      systemWide,
      mentionsCourse: khoaIdx >= 0,
    };
  }

  private async handleListClasses(
    tenantId: number,
    state: DecisionContext,
    parsed: {
      courseKeyword: string;
      classKeyword: string;
      classType?: 'WEEKLY' | 'EXAM_PRACTICE';
      systemWide?: boolean;
      mentionsCourse?: boolean;
    },
  ): Promise<DeterministicOutcome> {
    let courseId = 0;
    let courseLabel = '';

    // Toàn hệ thống khi: nói rõ "hệ thống", HOẶC câu không hề nhắc tới khóa
    // ("xem ds lớp luyện đề") — không được tự lấy khóa trong ngữ cảnh, muốn
    // xem theo khóa user sẽ nói "khóa này"/"trong khóa X".
    if (
      !parsed.courseKeyword &&
      (parsed.systemWide || !parsed.mentionsCourse)
    ) {
      return this.listCourseClasses(
        tenantId,
        0,
        '',
        parsed.classKeyword,
        parsed.classType,
      );
    }

    const wantsContextCourse =
      !parsed.courseKeyword || this.isContextRefPhrase(parsed.courseKeyword);
    if (parsed.courseKeyword && !wantsContextCourse) {
      const courses = await this.coursesService.searchCourses(
        tenantId,
        parsed.courseKeyword,
      );
      if (courses.length === 0) {
        return this.notFound('course', parsed.courseKeyword, this.toOptions([]));
      }
      if (courses.length > 1) {
        // Nhớ intent gốc: chọn khóa xong phải hiện danh sách lớp LUÔN.
        return this.chooseFromCourseWithContinuation(courses, {
          intent: 'list_classes',
          classKeyword: parsed.classKeyword,
          ...(parsed.classType ? { classType: parsed.classType } : {}),
        });
      }
      courseId = Number(courses[0].id);
      courseLabel = String(
        courses[0].title || courses[0].courseCode || `#${courseId}`,
      );
    } else {
      const ctxCourse = state.last_created_course || state.last_selected_course;
      if (ctxCourse?.id) {
        courseId = Number(ctxCourse.id);
        courseLabel = ctxCourse.label;
      } else {
        const ctxClass = state.last_created_class || state.last_selected_class;
        const meta = (ctxClass?.metadata || {}) as Record<string, any>;
        courseId =
          Number(meta.courseId ?? meta.course?.id) ||
          Number(state.selected_course_id) ||
          0;
        courseLabel =
          typeof meta.course?.title === 'string'
            ? meta.course.title
            : courseId
              ? `#${courseId}`
              : '';
      }
      // User nói rõ "khóa này" mà ngữ cảnh trống -> hỏi lại thay vì liệt kê hết.
      if (!courseId && parsed.courseKeyword) {
        return {
          type: 'clarification',
          message:
            'Mình chưa rõ "khóa này" là khóa nào. Bạn cho mình tên khóa học nhé.',
          missingFields: ['courseId'],
          intent: 'get_course_classes',
          contextPatch: {},
        };
      }
    }

    return this.listCourseClasses(
      tenantId,
      courseId,
      courseLabel,
      parsed.classKeyword,
      parsed.classType,
    );
  }

  /**
   * Bảng lớp học của MỘT khóa đã chốt (courseId = 0 -> mọi lớp trong hệ
   * thống), lọc được theo LOẠI lớp (theo tuần/luyện đề). Public để
   * CopilotService gọi tiếp sau khi user chọn khóa.
   */
  async listCourseClasses(
    tenantId: number,
    courseId: number,
    courseLabel: string,
    classKeyword: string,
    classType?: 'WEEKLY' | 'EXAM_PRACTICE',
  ): Promise<DeterministicOutcome> {
    const classes = await this.coursesService.searchClasses(
      tenantId,
      classKeyword,
      {
        ...(courseId ? { courseId } : {}),
        ...(classType ? { type: classType } : {}),
      },
    );

    const typeLabel = classType
      ? classType === 'WEEKLY'
        ? ' theo tuần'
        : ' luyện đề'
      : '';
    const title = courseId
      ? `Danh sách lớp${typeLabel} khóa ${courseLabel}`
      : `Danh sách lớp${typeLabel} toàn hệ thống`;
    if (!classes.length) {
      return {
        type: 'message',
        message: courseId
          ? `Khóa "${courseLabel}" chưa có lớp${typeLabel} nào${classKeyword ? ` khớp "${classKeyword}"` : ''}.`
          : `Hệ thống chưa có lớp${typeLabel} nào${classKeyword ? ` khớp "${classKeyword}"` : ''}.`,
        contextPatch: courseId ? { selected_course_id: courseId } : {},
      };
    }

    const toDateIso = (value: unknown) =>
      value ? new Date(value as any).toISOString() : null;
    const rows: ClassTableRow[] = classes.map((cls: any) => ({
      id: Number(cls.id),
      title: String(cls.title || cls.classCode || `#${cls.id}`),
      classCode: cls.classCode ?? null,
      type: cls.type ?? null,
      teacherName: cls.teacherName ?? null,
      studentCount: Number(cls._count?.enrollments ?? 0),
      status: cls.status ?? null,
      courseTitle: cls.course?.title ?? null,
      startDate: toDateIso(cls.startDate),
      endDate: toDateIso(cls.endDate),
    }));

    return {
      type: 'class_table',
      title,
      message: `${rows.length} lớp.`,
      classes: rows,
      contextPatch: {
        ...(courseId ? { selected_course_id: courseId } : {}),
        last_intent: 'search_class',
        last_candidates: { classes: this.toOptions(classes) },
      },
    };
  }

  private buildEnrollPending(
    studentOrStudents: any,
    target: {
      classId: number;
      courseId?: number;
      courseLabel?: string;
      classLabel?: string;
      joinedAt?: string;
      roleInClass?: string;
    },
  ): DeterministicOutcome {
    const students: any[] = Array.isArray(studentOrStudents)
      ? studentOrStudents
      : [studentOrStudents];
    const classLabel = target.classLabel || `#${target.classId}`;
    const labelOf = (s: any) => s.fullName || s.name || s.label || `#${s.id}`;

    // Nhiều học viên -> 1 bản nháp GỘP (userIds), xác nhận 1 lần cho cả nhóm.
    if (students.length > 1) {
      const names = students.map(labelOf);
      const input: Record<string, unknown> = {
        userIds: students.map((s) => Number(s.id)),
        classId: target.classId,
      };
      if (target.joinedAt) input.joinedAt = target.joinedAt;
      if (target.roleInClass) input.roleInClass = target.roleInClass;

      const displayInput: Record<string, unknown> = {
        ...input,
        className: classLabel,
        students: students.map((s) => ({
          id: Number(s.id),
          label: labelOf(s),
          email: s.email ?? null,
        })),
      };
      if (target.courseLabel) displayInput.courseName = target.courseLabel;

      const pending: PendingAction = {
        tool_name: 'assign_student_to_class',
        input,
        display_input: displayInput,
        summary: `Thêm ${students.length} học viên (${names.join(', ')}) vào lớp ${classLabel}`,
        intent: 'assign_student_to_class',
        status: 'waiting_confirm',
        severity: 'default',
      };
      return {
        type: 'pending_write',
        pending,
        contextPatch: {
          last_intent: 'assign_student_to_class',
          selected_class_id: target.classId,
          ...(target.courseId ? { selected_course_id: target.courseId } : {}),
        },
      };
    }

    const student = students[0];
    const studentLabel = labelOf(student);
    const input: Record<string, unknown> = {
      userId: Number(student.id),
      classId: target.classId,
    };
    if (target.joinedAt) input.joinedAt = target.joinedAt;
    if (target.roleInClass) input.roleInClass = target.roleInClass;

    const displayInput: Record<string, unknown> = {
      ...input,
      studentName: studentLabel,
      className: classLabel,
    };
    if (target.courseLabel) displayInput.courseName = target.courseLabel;

    const pending: PendingAction = {
      tool_name: 'assign_student_to_class',
      input,
      display_input: displayInput,
      summary: `Thêm học viên ${studentLabel} vào lớp ${classLabel}`,
      intent: 'assign_student_to_class',
      status: 'waiting_confirm',
      severity: 'default',
    };
    return {
      type: 'pending_write',
      pending,
      contextPatch: {
        last_intent: 'assign_student_to_class',
        selected_student_id: Number(student.id),
        selected_class_id: target.classId,
        ...(target.courseId ? { selected_course_id: target.courseId } : {}),
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

    // Cắt phần chi tiết (ngày/lịch/giáo viên...) đứng trước "trong khóa" để
    // không dính vào tên lớp, giống nhánh không nêu khóa.
    const titlePart = this.stripClassDetailSuffix(
      rest.slice(0, courseMarker.index),
    ).titlePart;
    const courseRest = rest
      .slice(courseMarker.index + courseMarker[0].length)
      .trim();
    const courseParts = this.splitCourseKeywordAndDetails(courseRest);

    return {
      titlePart,
      courseKeyword: this.cleanText(courseParts.courseKeyword),
    };
  }

  // Marker mở đầu phần "chi tiết lớp" (lịch/loại/ngày/giáo viên...) — phần
  // đứng sau KHÔNG thuộc tên lớp/tên khóa. "loại (lớp)"/"ngày" để câu kiểu
  // "Toán A1 loại lớp theo tuần ngày bắt đầu là ..." cho ra title "Toán A1".
  private static readonly CLASS_DETAIL_MARKER_RE =
    /\s+(?:học|hoc|lịch|lich|thứ|thu|phòng|phong|room|giáo viên|giao vien|gv|teacher|từ|tu|loại|loai|ngày|ngay|bắt đầu|bat dau|kết thúc|ket thuc)(?=\s|$)/iu;

  private splitCourseKeywordAndDetails(value: string): {
    courseKeyword: string;
    details: string;
  } {
    const detailMarker = value.match(
      DeterministicIntentService.CLASS_DETAIL_MARKER_RE,
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
      DeterministicIntentService.CLASS_DETAIL_MARKER_RE,
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
    // Bỏ dấu câu để "hsk1, lớp luyện đề, ngày..." vẫn khớp "luyen de".
    const norm = toSearchKey(message).replace(/[,.;:]+/g, ' ').replace(/\s+/g, ' ');
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
    const explicit = message.match(
      /\b(?:phòng|phong|room)\s+([A-Za-z0-9_-]+)/i,
    );
    if (explicit?.[1]) return explicit[1].replace(/[,.]+$/, '');

    const shorthand = message.match(/\bP\d{2,4}\b/i);
    return shorthand?.[0];
  }

  private parseTeacherName(message: string): string | undefined {
    const match = message.match(/(?:giáo viên|giao vien|teacher|gv)\s+(.+)$/i);
    if (!match?.[1]) return undefined;

    const name = match[1]
      .replace(/\s+(?:học|hoc|lịch|lich|thứ|thu|phòng|phong|room)\b.*$/i, '')
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
    // Intent assign_student_to_class: _to_course không có trong mini mode nên
    // clarification mang intent đó sẽ bị guard chặn thành "chưa được bật".
    return {
      type: 'clarification',
      message,
      missingFields: [entity === 'student' ? 'userId' : `${entity}Id`],
      intent: 'assign_student_to_class',
      contextPatch: {
        last_candidates: {
          [entity === 'class' ? 'classes' : `${entity}s`]: options,
        },
      },
    };
  }

  private notFound(
    entity: SearchEntity,
    keyword: string,
    _options: EntityOption[],
  ): DeterministicOutcome {
    const label =
      entity === 'student'
        ? 'học viên'
        : entity === 'course'
          ? 'khóa học'
          : 'lớp';
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
    while (start < origTokens.length) {
      const key = toSearchKey(origTokens[start]);
      // Nhãn "tên/name (là)": mọi thứ phía sau là TÊN thật -> dừng strip NGAY,
      // kể cả khi token đầu của tên trùng từ đệm ("tên Minh Nguyễn" — "Minh"
      // trùng "mình" — không được cắt mất).
      if (key === 'ten' || key === 'name') {
        start += 1;
        if (
          start < origTokens.length &&
          toSearchKey(origTokens[start]) === 'la'
        ) {
          start += 1;
        }
        break;
      }
      if (LEADING_STRIP.has(key)) {
        start += 1;
        continue;
      }
      // Số lượng đứng trước danh từ thực thể ("1 hv", "2 học viên") là từ đệm.
      if (
        /^\d{1,2}$/.test(key) &&
        start + 1 < origTokens.length &&
        LEADING_STRIP.has(toSearchKey(origTokens[start + 1]))
      ) {
        start += 1;
        continue;
      }
      break;
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
