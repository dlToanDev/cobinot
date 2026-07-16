import { DeterministicIntentService } from './deterministic-intent.service';

describe('DeterministicIntentService', () => {
  const usersService = {
    searchStudents: jest.fn(),
  };
  const coursesService = {
    searchCourses: jest.fn(),
    searchClasses: jest.fn(),
    getCourseStudents: jest.fn(),
    getClassStudents: jest.fn(),
  };
  let service: DeterministicIntentService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new DeterministicIntentService(
      usersService as any,
      coursesService as any,
    );
  });

  // Case 1: "tạo học viên" -> trả form nhập liệu, KHÔNG tự lấy tên context/keyword.
  it('tạo học viên không tên -> trả form nhập liệu (không tự điền tên)', async () => {
    const outcome = await service.resolve(1, {}, 'tạo học viên');
    expect(outcome).toEqual(
      expect.objectContaining({
        type: 'student_form',
        values: {},
      }),
    );
    expect(usersService.searchStudents).not.toHaveBeenCalled();
  });

  // Có email nhưng thiếu tên -> form điền sẵn email, không tạo pending ngay.
  it('tạo học viên có email nhưng thiếu tên -> form điền sẵn email', async () => {
    const outcome = await service.resolve(
      1,
      {},
      'tạo học viên email an@gmail.com',
    );
    expect(outcome).toEqual(
      expect.objectContaining({
        type: 'student_form',
        values: { email: 'an@gmail.com' },
      }),
    );
  });

  // Case 5: vừa tìm "toàn" rồi "tạo học viên" -> vẫn không lấy "toàn" làm tên.
  it('tạo học viên sau khi search -> không lấy keyword cũ làm tên', async () => {
    const stateWithSearch = {
      last_intent: 'search_student',
      last_candidates: { students: [{ id: 9, label: 'Toàn' }] },
    };
    const outcome = await service.resolve(1, stateWithSearch, 'tạo học viên');
    expect(outcome?.type).toBe('student_form');
    if (outcome?.type === 'pending_write') {
      throw new Error('không được tạo pending khi thiếu tên');
    }
  });

  // Case 2: "tạo học viên Lê Minh Tuấn" -> fullName đúng, không lấy tên admin.
  it('tạo học viên có tên -> pending_write với đúng fullName', async () => {
    const outcome = await service.resolve(1, {}, 'tạo học viên Lê Minh Tuấn');
    expect(outcome).toEqual(
      expect.objectContaining({
        type: 'pending_write',
        pending: expect.objectContaining({
          tool_name: 'create_student',
          input: { fullName: 'Lê Minh Tuấn' },
        }),
      }),
    );
  });

  it('tạo học viên kèm số điện thoại -> tách tên và phone', async () => {
    const outcome = await service.resolve(
      1,
      {},
      'tạo học viên Nguyễn Văn An số 0988888888',
    );
    expect(outcome?.type).toBe('pending_write');
    if (outcome?.type === 'pending_write') {
      expect(outcome.pending.input).toEqual({
        fullName: 'Nguyễn Văn An',
        phone: '0988888888',
      });
    }
  });

  it('tạo học viên dạng tên, email, ngày sinh -> tách đúng từng field', async () => {
    const outcome = await service.resolve(
      1,
      {},
      'tạo hv tên toàn, thanhtan13@gmail.com, 12/04/2004',
    );

    expect(outcome?.type).toBe('pending_write');
    if (outcome?.type === 'pending_write') {
      expect(outcome.pending).toEqual(
        expect.objectContaining({
          tool_name: 'create_student',
          input: {
            fullName: 'toàn',
            email: 'thanhtan13@gmail.com',
            birthDate: '2004-04-12',
          },
          status: 'waiting_confirm',
        }),
      );
    }
  });

  it('tạo hv kèm địa chỉ SAU ngày sinh -> tách address, không dính vào tên', async () => {
    const outcome = await service.resolve(
      1,
      {},
      'tạo hv tên là testttt1, test1@gmail.com, 0987625341, 12/03/2000, Bắc Ninh',
    );
    expect(outcome?.type).toBe('pending_write');
    if (outcome?.type === 'pending_write') {
      expect(outcome.pending.input).toEqual({
        fullName: 'testttt1',
        email: 'test1@gmail.com',
        phone: '0987625341',
        birthDate: '2000-03-12',
        address: 'Bắc Ninh',
      });
    }
  });

  it('tạo hv kèm địa chỉ TRƯỚC ngày sinh -> vẫn tách đúng address', async () => {
    const outcome = await service.resolve(
      1,
      {},
      'tạo hv tên Hoang Anh Toan, toan1@gmail.com, 0987656423, Hà Nội, 13/10/2003',
    );
    expect(outcome?.type).toBe('pending_write');
    if (outcome?.type === 'pending_write') {
      expect(outcome.pending.input).toEqual({
        fullName: 'Hoang Anh Toan',
        email: 'toan1@gmail.com',
        phone: '0987656423',
        birthDate: '2003-10-13',
        address: 'Hà Nội',
      });
    }
  });

  it('follow-up sau khi chọn tạo học viên (không động từ tạo) -> vẫn nhận deterministic', async () => {
    const outcome = await service.resolve(
      1,
      { last_intent: 'create_student' },
      'tên Hoang Anh Toan, toan1@gmail.com, 0987656423, Hà Nội, 13/10/2003',
    );
    expect(outcome?.type).toBe('pending_write');
    if (outcome?.type === 'pending_write') {
      expect(outcome.pending.input).toEqual({
        fullName: 'Hoang Anh Toan',
        email: 'toan1@gmail.com',
        phone: '0987656423',
        birthDate: '2003-10-13',
        address: 'Hà Nội',
      });
    }
  });

  it('follow-up không dấu phẩy "tôi hv tên ... Hà Nội" -> bỏ từ đệm, tách địa chỉ tỉnh/thành', async () => {
    const outcome = await service.resolve(
      1,
      { last_intent: 'create_student' },
      'tôi hv tên Hoang Anh Toan Hà Nội',
    );
    expect(outcome?.type).toBe('pending_write');
    if (outcome?.type === 'pending_write') {
      expect(outcome.pending.input).toEqual({
        fullName: 'Hoang Anh Toan',
        address: 'Hà Nội',
      });
    }
  });

  it('parseStudentInfo: bỏ nhãn field trong segment ("địa chỉ Ninh Bình", "sđt 09...")', () => {
    const parsed = service.parseStudentInfo(
      'Hoang Van A, hva@gmail.com, sđt 0987645231, ngày sinh 12/03/2000, địa chỉ Ninh Bình',
    );
    expect(parsed).toEqual({
      fullName: 'Hoang Van A',
      email: 'hva@gmail.com',
      phone: '0987645231',
      birthDate: '2000-03-12',
      address: 'Ninh Bình',
    });
  });

  it('câu tìm kiếm khi last_intent=create_student -> KHÔNG hijack thành tạo học viên', async () => {
    usersService.searchStudents.mockResolvedValue([]);
    const outcome = await service.resolve(
      1,
      { last_intent: 'create_student' },
      'tìm học viên tên Nam',
    );
    expect(outcome?.type).not.toBe('pending_write');
  });

  it('sửa tên khóa <X> thành <Y> -> tự tìm khóa X, preview update_course với title Y', async () => {
    coursesService.searchCourses.mockResolvedValue([
      { id: 7, title: 'Toán CC', courseCode: 'TOAN_CC' },
    ]);

    const outcome = await service.resolve(
      1,
      {},
      'Sửa tên khóa Toán CC thành Toán Cao Cấp cho tôi',
    );

    expect(coursesService.searchCourses).toHaveBeenCalledWith(1, 'Toán CC');
    expect(outcome?.type).toBe('pending_write');
    if (outcome?.type === 'pending_write') {
      expect(outcome.pending.tool_name).toBe('update_course');
      expect(outcome.pending.input).toEqual({
        courseId: 7,
        title: 'Toán Cao Cấp',
      });
    }
  });

  it('sửa tên khóa <X> thành <Y> nhưng không tìm thấy khóa -> hỏi lại kèm tên đã nhập', async () => {
    coursesService.searchCourses.mockResolvedValue([]);

    const outcome = await service.resolve(
      1,
      {},
      'sửa tên khóa Lý 12 thành Lý Nâng Cao',
    );

    expect(outcome?.type).toBe('clarification');
    if (outcome?.type === 'clarification') {
      expect(outcome.intent).toBe('update_course');
      expect(outcome.message).toContain('Lý 12');
    }
  });

  it('sửa tên lớp <X> thành <Y> -> tự tìm lớp X, preview update_class với title Y', async () => {
    coursesService.searchClasses.mockResolvedValue([
      { id: 21, title: 'Toán 2', classCode: 'TOAN_TOAN_2_WEEKLY' },
    ]);

    const outcome = await service.resolve(
      1,
      {},
      'sửa tên lớp Toán 2 thành Toán cho tôi',
    );

    expect(coursesService.searchClasses).toHaveBeenCalledWith(1, 'Toán 2');
    expect(outcome?.type).toBe('pending_write');
    if (outcome?.type === 'pending_write') {
      expect(outcome.pending.tool_name).toBe('update_class');
      expect(outcome.pending.input).toEqual({ classId: 21, title: 'Toán' });
    }
  });

  it('chuyển lớp <X> sang loại lớp theo tuần -> update_class CHỈ đổi classType, KHÔNG đổi tên', async () => {
    coursesService.searchClasses.mockResolvedValue([
      { id: 38, title: 'Toán 2', classCode: 'TOAN_TOAN_2_WEEKLY' },
    ]);

    const outcome = await service.resolve(
      1,
      {},
      'chuyển lớp Toán 2 sang loại lớp theo tuần cho tôi',
    );

    expect(coursesService.searchClasses).toHaveBeenCalledWith(1, 'Toán 2');
    expect(outcome?.type).toBe('pending_write');
    if (outcome?.type === 'pending_write') {
      expect(outcome.pending.tool_name).toBe('update_class');
      expect(outcome.pending.input).toEqual({
        classId: 38,
        classType: 'WEEKLY',
      });
      expect(outcome.pending.input).not.toHaveProperty('title');
    }
  });

  it('sửa tên lớp <X> thành lớp luyện đề -> hiểu là ĐỔI LOẠI (EXAM_PRACTICE), không rename', async () => {
    coursesService.searchClasses.mockResolvedValue([
      { id: 38, title: 'Toán 2', classCode: 'TOAN_TOAN_2_WEEKLY' },
    ]);

    const outcome = await service.resolve(
      1,
      {},
      'sửa lớp Toán 2 thành lớp luyện đề',
    );

    expect(outcome?.type).toBe('pending_write');
    if (outcome?.type === 'pending_write') {
      expect(outcome.pending.tool_name).toBe('update_class');
      expect(outcome.pending.input).toEqual({
        classId: 38,
        classType: 'EXAM_PRACTICE',
      });
    }
  });

  it('chuyển sang loại lớp luyện đề (không nêu lớp, không ngữ cảnh) -> hỏi lại tên lớp', async () => {
    const outcome = await service.resolve(
      1,
      {},
      'chuyển sang loại lớp luyện đề cho tôi',
    );

    expect(coursesService.searchClasses).not.toHaveBeenCalled();
    expect(outcome?.type).toBe('clarification');
    if (outcome?.type === 'clarification') {
      expect(outcome.intent).toBe('update_class');
      expect(outcome.missingFields).toEqual(['classId']);
    }
  });

  it('đổi tên thành <Y> khi có khóa trong ngữ cảnh -> update_course khóa ngữ cảnh (không đòi tên khóa)', async () => {
    const outcome = await service.resolve(
      1,
      {
        selected_course_id: 9,
        last_selected_course: { id: 9, label: 'Toán CC' },
      } as any,
      'đổi tên thành Toán Cơ Bản',
    );

    expect(coursesService.searchCourses).not.toHaveBeenCalled();
    expect(outcome?.type).toBe('pending_write');
    if (outcome?.type === 'pending_write') {
      expect(outcome.pending.tool_name).toBe('update_course');
      expect(outcome.pending.input).toEqual({
        courseId: 9,
        title: 'Toán Cơ Bản',
      });
    }
  });

  it('tạo lớp weekly trong khóa -> search course và trả pending create_class có sessions', async () => {
    coursesService.searchCourses.mockResolvedValue([
      { id: 1, title: 'IELTS 6.5', courseCode: 'IELTS_6_5' },
    ]);

    const outcome = await service.resolve(
      1,
      {},
      'Tạo lớp Evening A trong khóa IELTS 6.5 học thứ 2 4 6 19h-21h phòng A1 giáo viên cô Hoa',
    );

    expect(coursesService.searchCourses).toHaveBeenCalledWith(1, 'IELTS 6.5');
    expect(outcome?.type).toBe('pending_write');
    if (outcome?.type === 'pending_write') {
      expect(outcome.pending.tool_name).toBe('create_class');
      expect(outcome.pending.input).toEqual({
        courseId: 1,
        title: 'Evening A',
        type: 'WEEKLY',
        teacherName: 'cô Hoa',
        sessions: [
          {
            title: 'Buổi học thứ 2',
            dayOfWeek: 2,
            startTime: '19:00',
            endTime: '21:00',
            room: 'A1',
          },
          {
            title: 'Buổi học thứ 4',
            dayOfWeek: 4,
            startTime: '19:00',
            endTime: '21:00',
            room: 'A1',
          },
          {
            title: 'Buổi học thứ 6',
            dayOfWeek: 6,
            startTime: '19:00',
            endTime: '21:00',
            room: 'A1',
          },
        ],
      });
      expect(outcome.pending.input).not.toHaveProperty('classCode');
      expect(outcome.pending.input).not.toHaveProperty('classType');
      // classCode do backend tự sinh lúc confirm, không nhét vào preview.
      expect(outcome.pending.input).not.toHaveProperty('classCode');
      expect(outcome.pending.display_input).toEqual(
        expect.objectContaining({
          courseName: 'IELTS 6.5',
        }),
      );
    }
  });

  it('tạo lớp luyện đề -> type EXAM_PRACTICE', async () => {
    coursesService.searchCourses.mockResolvedValue([
      { id: 1, title: 'IELTS 6.5', courseCode: 'IELTS_6_5' },
    ]);

    const outcome = await service.resolve(
      1,
      {},
      'Tạo lớp luyện đề tháng 8 trong khóa IELTS 6.5',
    );

    expect(outcome?.type).toBe('pending_write');
    if (outcome?.type === 'pending_write') {
      expect(outcome.pending.input).toEqual({
        courseId: 1,
        title: 'luyện đề tháng 8',
        type: 'EXAM_PRACTICE',
        sessions: [],
      });
    }
  });

  it('"hsk1, lớp luyện đề, ngày bắt đầu là ngày hôm này..." -> tên KHÔNG dính loại, type EXAM_PRACTICE, ngày bắt đầu = hôm nay', async () => {
    coursesService.searchCourses.mockResolvedValue([
      { id: 9, title: 'Tiếng Trung', courseCode: 'TIENG_TRUNG' },
    ]);

    const pad = (n: number) => String(n).padStart(2, '0');
    const now = new Date();
    const todayIso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

    const outcome = await service.resolve(
      1,
      {},
      'tạo lớp học hsk1, lớp luyện đề, ngày bắt đầu là ngày hôm này ngày kết thúc là 21/08/2026 trong khóa Tiếng Trung',
    );

    expect(outcome?.type).toBe('pending_write');
    if (outcome?.type === 'pending_write') {
      expect(outcome.pending.input).toEqual({
        courseId: 9,
        title: 'hsk1',
        type: 'EXAM_PRACTICE',
        sessions: [],
        startDate: todayIso,
        endDate: '2026-08-21',
      });
    }
  });

  it('tạo lớp theo tuần thiếu tên -> hỏi tên NGẮN GỌN + lưu pending_class_creation', async () => {
    coursesService.searchCourses.mockResolvedValue([
      { id: 62, title: 'Tiếng Bi', courseCode: 'TIENG_BI' },
    ]);

    const outcome = await service.resolve(
      1,
      {},
      'tạo cho tôi 1 lớp học theo tuần trong khóa tiếng bi',
    );

    expect(coursesService.searchCourses).toHaveBeenCalledWith(1, 'tiếng bi');
    expect(outcome?.type).toBe('clarification');
    if (outcome?.type === 'clarification') {
      expect(outcome.message).toBe('Bạn muốn đặt tên lớp là gì?');
      expect(outcome.missingFields).toEqual(['title']);
      expect(outcome.contextPatch.pending_class_creation).toEqual(
        expect.objectContaining({
          courseId: 62,
          type: 'WEEKLY',
        }),
      );
    }
  });

  it('tạo lớp đủ khóa + tên -> preview ngay, không hỏi thêm field phụ', async () => {
    coursesService.searchCourses.mockResolvedValue([
      { id: 62, title: 'Tiếng Bi', courseCode: 'TIENG_BI' },
    ]);

    const outcome = await service.resolve(
      1,
      {},
      'Tạo lớp Lớp 1 trong khóa Tiếng Bi',
    );

    expect(outcome?.type).toBe('pending_write');
    if (outcome?.type === 'pending_write') {
      expect(outcome.pending.tool_name).toBe('create_class');
      expect(outcome.pending.input).toEqual({
        courseId: 62,
        title: 'Lớp 1',
        type: 'WEEKLY',
        sessions: [],
      });
      // Không hỏi mã lớp / ngày / giáo viên.
      expect(outcome.pending.input).not.toHaveProperty('classCode');
      expect(outcome.pending.input).not.toHaveProperty('teacherName');
      expect(outcome.pending.input).not.toHaveProperty('startDate');
    }
  });

  it('tạo khóa học (không tên) -> mở form nhập liệu create_course (không pending, không hỏi tên)', async () => {
    for (const msg of [
      'tạo khóa học mới',
      'tạo khóa học',
      'thêm khóa học mới',
    ]) {
      const outcome = await service.resolve(1, {}, msg);
      expect(outcome?.type).toBe('course_form');
      if (outcome?.type === 'course_form') {
        expect(outcome.values).toEqual({});
        expect(outcome.contextPatch.last_intent).toBe('create_course');
      }
    }
    expect(coursesService.searchCourses).not.toHaveBeenCalled();
  });

  it('tạo khóa học CÓ tên + ngày -> pending create_course, ngày bị BỎ QUA (khóa không có ngày)', async () => {
    const outcome = await service.resolve(
      1,
      {},
      'Tạo khóa học IELTS 6.5 từ 10/08/2026 đến 10/11/2026',
    );
    expect(outcome?.type).toBe('pending_write');
    if (outcome?.type === 'pending_write') {
      expect(outcome.pending.tool_name).toBe('create_course');
      expect(outcome.pending.tool_name).not.toBe('create_student');
      expect(outcome.pending.input).toEqual({ title: 'IELTS 6.5' });
    }
  });

  it('câu tạo khóa KHÔNG bao giờ thành create_student, kể cả đang ở flow tạo học viên', async () => {
    // Bug cũ: last_intent=create_student + câu có ngày -> follow-up hijack thành
    // create_student với birthDate. Câu có "khóa/course" phải luôn là create_course.
    const stateInStudentFlow = { last_intent: 'create_student' } as any;
    const outcome = await service.resolve(
      1,
      stateInStudentFlow,
      'Tạo khóa học IELTS 6.5 từ 10/08/2026 đến 10/11/2026',
    );
    expect(outcome?.type).toBe('pending_write');
    if (outcome?.type === 'pending_write') {
      expect(outcome.pending.tool_name).toBe('create_course');
    }
  });

  it('tạo khóa chỉ có tên (không ngày) -> pending create_course với title', async () => {
    const outcome = await service.resolve(1, {}, 'tạo khóa Toán 12');
    expect(outcome?.type).toBe('pending_write');
    if (outcome?.type === 'pending_write') {
      expect(outcome.pending.tool_name).toBe('create_course');
      expect(outcome.pending.input).toEqual({ title: 'Toán 12' });
    }
  });

  // ---- Cập nhật khóa học ----
  const courseCtx = {
    selected_course_id: 79,
    last_selected_course: { id: 79, label: 'Test 1' },
  } as any;

  it('update: "cấp độ 1" khi có khóa context -> pending update_course (không "chưa bật")', async () => {
    const outcome = await service.resolve(1, courseCtx, 'cấp độ 1');
    expect(outcome?.type).toBe('pending_write');
    if (outcome?.type === 'pending_write') {
      expect(outcome.pending.tool_name).toBe('update_course');
      expect(outcome.pending.input).toEqual({
        courseId: 79,
        level: 'Cấp độ 1',
      });
    }
  });

  it('update: không có khóa trong context -> hỏi lại khóa nào', async () => {
    const outcome = await service.resolve(1, {}, 'cập nhật cấp độ 1');
    expect(outcome?.type).toBe('clarification');
    if (outcome?.type === 'clarification') {
      expect(outcome.intent).toBe('update_course');
      expect(outcome.message).toContain('Bạn muốn cập nhật khóa học nào');
    }
  });

  it('update: câu chỉ có ngày KHÔNG thành update_course (khóa không có ngày)', async () => {
    const outcome = await service.resolve(
      1,
      courseCtx,
      'ngày bắt đầu 10/07/2026 ngày kết thúc 31/072026',
    );
    if (outcome?.type === 'pending_write') {
      expect(outcome.pending.tool_name).not.toBe('update_course');
    }
  });

  it('update: "cấp độ cơ bản" -> level "Cơ bản"; "đổi tên ... thành X" -> title', async () => {
    const lv = await service.resolve(1, courseCtx, 'cấp độ cơ bản');
    if (lv?.type === 'pending_write') {
      expect(lv.pending.input).toEqual({ courseId: 79, level: 'Cơ bản' });
    } else {
      throw new Error('expected pending_write');
    }

    const rename = await service.resolve(
      1,
      courseCtx,
      'đổi tên khóa này thành IELTS Foundation',
    );
    if (rename?.type === 'pending_write') {
      expect(rename.pending.input).toEqual({
        courseId: 79,
        title: 'IELTS Foundation',
      });
    } else {
      throw new Error('expected pending_write');
    }
  });

  it('update: "mô tả là ..." -> description', async () => {
    const outcome = await service.resolve(
      1,
      courseCtx,
      'mô tả là khóa học dành cho người mới bắt đầu hoặc bị mất gốc',
    );
    if (outcome?.type === 'pending_write') {
      expect(outcome.pending.input).toEqual({
        courseId: 79,
        description: 'Khóa học dành cho người mới bắt đầu hoặc bị mất gốc',
      });
    } else {
      throw new Error('expected pending_write');
    }
  });

  it('tạo lớp không nêu khóa nhưng vừa tạo khóa xong -> dùng khóa ngữ cảnh, preview ngay', async () => {
    const state = {
      selected_course_id: 87,
      last_created_course: { id: 87, label: 'Văn Cơ Bản' },
      last_selected_course: { id: 87, label: 'Văn Cơ Bản' },
    };

    const outcome = await service.resolve(
      1,
      state as any,
      'tao cho toi 1 lớp học theo tuần tên là Văn 1',
    );

    expect(coursesService.searchCourses).not.toHaveBeenCalled();
    expect(outcome?.type).toBe('pending_write');
    if (outcome?.type === 'pending_write') {
      expect(outcome.pending.tool_name).toBe('create_class');
      expect(outcome.pending.input).toEqual(
        expect.objectContaining({
          courseId: 87,
          title: 'Văn 1',
          type: 'WEEKLY',
        }),
      );
      expect(outcome.pending.display_input).toEqual(
        expect.objectContaining({ courseName: 'Văn Cơ Bản' }),
      );
    }
  });

  it('tạo lớp không nêu khóa, có khóa ngữ cảnh nhưng thiếu tên -> hỏi tên, nêu rõ khóa sẽ dùng', async () => {
    const state = {
      selected_course_id: 87,
      last_created_course: { id: 87, label: 'Văn Cơ Bản' },
      last_selected_course: { id: 87, label: 'Văn Cơ Bản' },
    };

    const outcome = await service.resolve(
      1,
      state as any,
      'tạo cho tôi 1 lớp học theo tuần',
    );

    expect(outcome?.type).toBe('clarification');
    if (outcome?.type === 'clarification') {
      expect(outcome.missingFields).toEqual(['title']);
      expect(outcome.message).toContain('Văn Cơ Bản');
      expect(outcome.contextPatch.pending_class_creation).toEqual(
        expect.objectContaining({ courseId: 87, type: 'WEEKLY' }),
      );
    }
  });

  it('tạo lớp thiếu khóa học -> clarification courseId, không tạo pending', async () => {
    const outcome = await service.resolve(
      1,
      {},
      'Tạo lớp Evening A học thứ 2 4 6',
    );

    expect(outcome).toEqual(
      expect.objectContaining({
        type: 'clarification',
        intent: 'create_class',
        missingFields: ['courseId'],
      }),
    );
    expect(coursesService.searchCourses).not.toHaveBeenCalled();
  });

  it('tạo lớp theo tuần kèm tên + ngày nhưng thiếu khóa -> hỏi khóa và NHỚ đủ bản nháp', async () => {
    const outcome = await service.resolve(
      1,
      {},
      'tạo cho tôi 1 lớp học Toán A1 loại lớp theo tuần ngày bắt đầu là 09/07/2026 ngày kết thúc là ngày 31/07/2026',
    );

    expect(outcome?.type).toBe('clarification');
    if (outcome?.type === 'clarification') {
      expect(outcome.message).toBe('Bạn muốn tạo lớp trong khóa học nào?');
      expect(outcome.contextPatch.pending_class_creation).toEqual(
        expect.objectContaining({
          courseId: 0,
          title: 'Toán A1',
          type: 'WEEKLY',
          startDate: '2026-07-09',
          endDate: '2026-07-31',
        }),
      );
    }
  });

  it('parseClassDateRange: "từ hôm nay đến ngày 30/07" -> hôm nay + năm hiện tại', () => {
    const pad = (n: number) => String(n).padStart(2, '0');
    const now = new Date();
    const todayIso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

    const range = service.parseClassDateRange('từ hôm nay đến ngày 30/07');
    expect(range.startDate).toBe(todayIso);
    expect(range.endDate).toBe(`${now.getFullYear()}-07-30`);

    // "ngày bắt đầu là hôm nay" cũng phải hiểu được.
    const range2 = service.parseClassDateRange('ngày bắt đầu là hôm nay');
    expect(range2.startDate).toBe(todayIso);

    // Lỗi gõ phổ biến "ngày hôm này" (này thay vì nay) vẫn phải nhận.
    const range3 = service.parseClassDateRange(
      'ngày bắt đầu là ngày hôm này ngày kết thúc là 21/08/2026',
    );
    expect(range3.startDate).toBe(todayIso);
    expect(range3.endDate).toBe('2026-08-21');
  });

  it('parseViDate: dd/mm thiếu năm -> năm hiện tại; dd/mm/yyyy giữ nguyên', () => {
    const year = new Date().getFullYear();
    expect(service.parseViDate('30/07')).toBe(`${year}-07-30`);
    expect(service.parseViDate('09/07/2026')).toBe('2026-07-09');
    expect(service.parseViDate('không phải ngày')).toBeUndefined();
  });

  it('resolveClassCourseReply: trả lời "trong khóa X" -> preview create_class đủ tên/loại/ngày', async () => {
    coursesService.searchCourses.mockResolvedValue([
      { id: 86, title: 'Toán Cao Cấp', courseCode: 'TOAN_CAO_CAP' },
    ]);
    const draft = {
      courseId: 0,
      title: 'Toán A1',
      type: 'WEEKLY' as const,
      startDate: '2026-07-09',
      endDate: '2026-07-31',
    };

    const outcome = await service.resolveClassCourseReply(
      1,
      draft,
      'trong khóa Toán Cao Cấp',
    );

    expect(coursesService.searchCourses).toHaveBeenCalledWith(
      1,
      'Toán Cao Cấp',
    );
    expect(outcome?.type).toBe('pending_write');
    if (outcome?.type === 'pending_write') {
      expect(outcome.pending.tool_name).toBe('create_class');
      expect(outcome.pending.input).toEqual({
        courseId: 86,
        title: 'Toán A1',
        type: 'WEEKLY',
        sessions: [],
        startDate: '2026-07-09',
        endDate: '2026-07-31',
      });
      expect(outcome.contextPatch.pending_class_creation).toBeNull();
    }
  });

  it('resolveClassCourseReply: bản nháp chưa có tên lớp -> hỏi tên, giữ draft kèm courseId', async () => {
    coursesService.searchCourses.mockResolvedValue([
      { id: 86, title: 'Toán Cao Cấp', courseCode: 'TOAN_CAO_CAP' },
    ]);

    const outcome = await service.resolveClassCourseReply(
      1,
      { courseId: 0, title: null, type: 'EXAM_PRACTICE' },
      'khóa Toán Cao Cấp',
    );

    expect(outcome?.type).toBe('clarification');
    if (outcome?.type === 'clarification') {
      expect(outcome.message).toBe('Bạn muốn đặt tên lớp là gì?');
      expect(outcome.contextPatch.pending_class_creation).toEqual(
        expect.objectContaining({
          courseId: 86,
          type: 'EXAM_PRACTICE',
        }),
      );
    }
  });

  it('tạo lớp khi nhiều khóa phù hợp -> hỏi chọn khóa, không tự chọn', async () => {
    coursesService.searchCourses.mockResolvedValue([
      { id: 1, title: 'IELTS 5.5', courseCode: 'IELTS_5_5' },
      { id: 2, title: 'IELTS 6.5', courseCode: 'IELTS_6_5' },
    ]);

    const outcome = await service.resolve(
      1,
      {},
      'Tạo lớp Evening A trong khóa IELTS',
    );

    expect(outcome?.type).toBe('clarification');
    if (outcome?.type === 'clarification') {
      expect(outcome.intent).toBe('create_class');
      expect(outcome.missingFields).toContain('courseId');
      expect(outcome.message).toContain('1. IELTS 5.5');
      expect(outcome.message).toContain('2. IELTS 6.5');
    }
  });

  // Case 3: "tìm học viên toàn" -> gọi searchStudents, KHÔNG gọi LLM.
  it('tìm học viên -> gọi searchStudents với keyword không dấu', async () => {
    usersService.searchStudents.mockResolvedValue([
      { id: 1, fullName: 'Toàn', email: 't@x.com', phone: '0900000000' },
    ]);
    const outcome = await service.resolve(1, {}, 'tìm học viên toàn');

    expect(usersService.searchStudents).toHaveBeenCalledWith(1, 'toàn');
    expect(outcome?.type).toBe('message');
    if (outcome?.type === 'message') {
      expect(outcome.message).toContain('Toàn');
      expect(outcome.contextPatch.last_intent).toBe('search_student');
    }
  });

  it('tìm lớp -> gọi searchClasses với keyword đầy đủ', async () => {
    coursesService.searchClasses.mockResolvedValue([
      { id: 5, title: 'Tiếng Bỉ 1', classCode: 'TB1', status: 'ACTIVE' },
    ]);
    const outcome = await service.resolve(1, {}, 'tìm lớp tiếng bỉ 1');

    expect(coursesService.searchClasses).toHaveBeenCalledWith(1, 'tiếng bỉ 1');
    expect(outcome?.type).toBe('message');
  });

  it('tìm khóa học -> gọi searchCourses', async () => {
    coursesService.searchCourses.mockResolvedValue([]);
    await service.resolve(1, {}, 'tìm khóa học ielts');
    expect(coursesService.searchCourses).toHaveBeenCalledWith(1, 'ielts');
  });

  it('tìm theo số điện thoại không nêu thực thể -> mặc định tìm học viên', async () => {
    usersService.searchStudents.mockResolvedValue([]);
    await service.resolve(1, {}, 'tìm 0988888888');
    expect(usersService.searchStudents).toHaveBeenCalledWith(1, '0988888888');
  });

  // Case 6: "thêm tiến vào lớp tiếng bỉ 1" -> search cả 2, tạo enrollment theo LỚP.
  it('ghi danh vào lớp: 1 học viên + 1 lớp -> pending assign_student_to_class', async () => {
    usersService.searchStudents.mockResolvedValue([
      { id: 3, fullName: 'Tiến' },
    ]);
    coursesService.searchClasses.mockResolvedValue([
      {
        id: 8,
        title: 'Tiếng Bỉ 1',
        courseId: 20,
        course: { id: 20, title: 'Tiếng Bỉ' },
      },
    ]);

    const outcome = await service.resolve(
      1,
      {},
      'thêm tiến vào lớp tiếng bỉ 1',
    );

    expect(usersService.searchStudents).toHaveBeenCalledWith(1, 'tiến');
    expect(coursesService.searchClasses).toHaveBeenCalledWith(1, 'tiếng bỉ 1');
    expect(outcome?.type).toBe('pending_write');
    if (outcome?.type === 'pending_write') {
      expect(outcome.pending.tool_name).toBe('assign_student_to_class');
      expect(outcome.pending.input).toEqual({
        userId: 3,
        classId: 8,
      });
      expect(outcome.pending.summary).toBe(
        'Thêm học viên Tiến vào lớp Tiếng Bỉ 1',
      );
      expect(outcome.contextPatch).toEqual(
        expect.objectContaining({
          selected_student_id: 3,
          selected_class_id: 8,
          selected_course_id: 20,
        }),
      );
    }
  });

  it('ghi danh vào lớp: nhiều lớp -> clarification chọn lớp + pending_enrollment_context', async () => {
    usersService.searchStudents.mockResolvedValue([
      { id: 3, fullName: 'Tiến' },
    ]);
    coursesService.searchClasses.mockResolvedValue([
      { id: 8, title: 'IELTS tối' },
      { id: 9, title: 'IELTS sáng' },
    ]);
    const outcome = await service.resolve(1, {}, 'thêm tiến vào lớp ielts');
    expect(outcome?.type).toBe('clarification');
    if (outcome?.type === 'clarification') {
      expect(outcome.missingFields).toEqual(['classId']);
      expect(outcome.intent).toBe('assign_student_to_class');
      expect(outcome.message).toContain('Bạn muốn thêm Tiến vào lớp nào?');
      // PHẢI giữ userId đã resolve để lượt trả lời "1"/tên lớp đi thẳng vào
      // preview ghi danh (handlePendingEnrollmentReply), không rơi xuống LLM.
      expect(outcome.contextPatch.pending_enrollment_context).toEqual(
        expect.objectContaining({
          userId: 3,
          candidateClasses: [
            expect.objectContaining({ id: 8 }),
            expect.objectContaining({ id: 9 }),
          ],
        }),
      );
      expect(outcome.contextPatch.last_candidates?.classes).toHaveLength(2);
    }
  });

  it('ghi danh: nhiều HỌC VIÊN trùng tên -> clarification chọn học viên + LƯU đích ghi danh vào pending_enrollment_context', async () => {
    // Tái hiện sự cố "them toan h vao lop nay" -> 4 học viên trùng tên; trước
    // đây chỉ lưu last_candidates (mất lớp đích) nên câu trả lời "1" rơi xuống
    // LLM và không tạo được bản nháp nào.
    usersService.searchStudents.mockResolvedValue([
      { id: 132, fullName: 'Toan H' },
      { id: 131, fullName: 'Toan Hoang', email: 'toanhoang12@gmail.com' },
    ]);

    const outcome = await service.resolve(
      1,
      {},
      'them toan h vao lop hehe cho toi',
    );

    expect(outcome?.type).toBe('clarification');
    if (outcome?.type === 'clarification') {
      expect(outcome.missingFields).toEqual(['userId']);
      expect(outcome.intent).toBe('assign_student_to_class');
      expect(outcome.message).toContain('Bạn muốn chọn học viên nào?');
      expect(outcome.contextPatch.pending_enrollment_context).toEqual(
        expect.objectContaining({
          userId: 0,
          candidateStudents: [
            expect.objectContaining({ id: 132 }),
            expect.objectContaining({ id: 131 }),
          ],
          targetType: 'class',
          targetKeyword: 'hehe',
        }),
      );
    }
  });

  it('ghi danh NHIỀU học viên "A và B vào lớp X": 1 bản nháp GỘP userIds, confirm 1 lần', async () => {
    usersService.searchStudents
      .mockResolvedValueOnce([{ id: 3, fullName: 'Tiến' }])
      .mockResolvedValueOnce([{ id: 132, fullName: 'Toan H' }]);
    coursesService.searchClasses.mockResolvedValue([
      {
        id: 8,
        title: 'Tiếng Bỉ 1',
        courseId: 20,
        course: { id: 20, title: 'Tiếng Bỉ' },
      },
    ]);

    const outcome = await service.resolve(
      1,
      {},
      'thêm tiến và toan h vào lớp tiếng bỉ 1',
    );

    expect(usersService.searchStudents).toHaveBeenNthCalledWith(1, 1, 'tiến');
    expect(usersService.searchStudents).toHaveBeenNthCalledWith(2, 1, 'toan h');
    expect(outcome?.type).toBe('pending_write');
    if (outcome?.type === 'pending_write') {
      expect(outcome.pending.tool_name).toBe('assign_student_to_class');
      expect(outcome.pending.input).toEqual({
        userIds: [3, 132],
        classId: 8,
      });
      expect(outcome.pending.summary).toBe(
        'Thêm 2 học viên (Tiến, Toan H) vào lớp Tiếng Bỉ 1',
      );
      expect(outcome.pending.display_input?.students).toEqual([
        expect.objectContaining({ id: 3, label: 'Tiến' }),
        expect.objectContaining({ id: 132, label: 'Toan H' }),
      ]);
    }
  });

  it('ghi danh nhiều học viên: 1 tên trùng nhiều người -> hỏi lại NÊU RÕ tên đó, không hủy cả nhóm', async () => {
    usersService.searchStudents
      .mockResolvedValueOnce([{ id: 3, fullName: 'Tiến' }])
      .mockResolvedValueOnce([
        { id: 132, fullName: 'Toan H' },
        { id: 131, fullName: 'Toan Hoang', email: 'toanhoang12@gmail.com' },
      ]);

    const outcome = await service.resolve(
      1,
      {},
      'thêm tiến, toan vào lớp tiếng bỉ 1',
    );

    expect(outcome?.type).toBe('clarification');
    if (outcome?.type === 'clarification') {
      expect(outcome.intent).toBe('assign_student_to_class');
      expect(outcome.message).toContain('"toan" có nhiều người trùng tên');
      expect(outcome.message).toContain('Toan Hoang');
      expect(outcome.message).toContain('ghi rõ hơn');
    }
  });

  it('ghi danh nhiều học viên vào lớp trùng tên nhiều khóa -> hỏi chọn lớp, giữ userIds trong context', async () => {
    usersService.searchStudents
      .mockResolvedValueOnce([{ id: 3, fullName: 'Tiến' }])
      .mockResolvedValueOnce([{ id: 132, fullName: 'Toan H' }]);
    coursesService.searchClasses.mockResolvedValue([
      { id: 50, title: 'Test 1', courseId: 91 },
      { id: 40, title: 'Test 1', courseId: 89 },
    ]);

    const outcome = await service.resolve(
      1,
      {},
      'thêm tiến và toan h vào lớp test 1',
    );

    expect(outcome?.type).toBe('clarification');
    if (outcome?.type === 'clarification') {
      expect(outcome.missingFields).toEqual(['classId']);
      expect(outcome.message).toContain('Bạn muốn thêm Tiến, Toan H vào lớp nào?');
      expect(outcome.contextPatch.pending_enrollment_context).toEqual(
        expect.objectContaining({
          userId: 0,
          userIds: [3, 132],
          studentLabels: ['Tiến', 'Toan H'],
        }),
      );
    }
  });

  it('resolveEnrollStudentReply: chọn học viên xong đi tiếp đích đã lưu -> preview assign_student_to_class', async () => {
    coursesService.searchClasses.mockResolvedValue([
      {
        id: 7,
        title: 'hehe',
        courseId: 20,
        course: { id: 20, title: 'Tiếng Bỉ' },
      },
    ]);

    const outcome = await service.resolveEnrollStudentReply(
      1,
      {} as any,
      {
        userId: 0,
        courseId: 0,
        candidateClasses: [],
        candidateStudents: [{ id: 132, value: 132, label: 'Toan H' }],
        targetType: 'class',
        targetKeyword: 'hehe',
      },
      { id: 132, label: 'Toan H' },
    );

    expect(coursesService.searchClasses).toHaveBeenCalledWith(1, 'hehe');
    expect(outcome?.type).toBe('pending_write');
    if (outcome?.type === 'pending_write') {
      expect(outcome.pending.tool_name).toBe('assign_student_to_class');
      expect(outcome.pending.input).toEqual({ userId: 132, classId: 7 });
      expect(outcome.pending.summary).toBe(
        'Thêm học viên Toan H vào lớp hehe',
      );
    }
  });

  it('resolveEnrollStudentReply: chọn NHIỀU người ("1,3,5") -> bản nháp ghi danh GỘP userIds', async () => {
    coursesService.searchClasses.mockResolvedValue([
      {
        id: 50,
        title: 'Test 1',
        courseId: 91,
        course: { id: 91, title: 'Anh Văn' },
      },
    ]);

    const outcome = await service.resolveEnrollStudentReply(
      1,
      {} as any,
      {
        userId: 0,
        courseId: 0,
        candidateClasses: [],
        candidateStudents: [],
        targetType: 'class',
        targetKeyword: 'test 1',
      },
      [
        { id: 132, label: 'Toan H' },
        { id: 127, label: 'Toan Haha' },
        { id: 114, label: 'Toàn Hoàng' },
      ],
    );

    expect(outcome?.type).toBe('pending_write');
    if (outcome?.type === 'pending_write') {
      expect(outcome.pending.input).toEqual({
        userIds: [132, 127, 114],
        classId: 50,
      });
      expect(outcome.pending.summary).toBe(
        'Thêm 3 học viên (Toan H, Toan Haha, Toàn Hoàng) vào lớp Test 1',
      );
    }
  });

  it('ghi danh "vào lớp X trong khóa Y" (đuôi lịch sự KHÔNG dấu): tách tên lớp/khóa, lọc đúng lớp theo khóa', async () => {
    // Tái hiện câu thật của user: "thêm Tran Văn A vào lớp Test 1 cho tôi trong
    // khóa Test cho toi" — trước đây nguyên cụm sau chữ "lớp" bị đem đi search
    // -> "không tìm thấy" sai.
    usersService.searchStudents.mockResolvedValue([
      { id: 124, fullName: 'Tran Văn A' },
    ]);
    coursesService.searchClasses.mockResolvedValue([
      {
        id: 50,
        title: 'Test 1',
        courseId: 91,
        course: { id: 91, title: 'Anh Văn', courseCode: 'ANH_VAN' },
      },
      {
        id: 40,
        title: 'Test 1',
        courseId: 89,
        course: { id: 89, title: 'Test', courseCode: 'TEST' },
      },
    ]);

    const outcome = await service.resolve(
      1,
      {},
      'thêm Tran Văn A vào lớp Test 1 cho tôi trong khóa Test cho toi',
    );

    expect(usersService.searchStudents).toHaveBeenCalledWith(1, 'Tran Văn A');
    expect(coursesService.searchClasses).toHaveBeenCalledWith(1, 'Test 1');
    expect(outcome?.type).toBe('pending_write');
    if (outcome?.type === 'pending_write') {
      // 2 lớp cùng tên "Test 1" nhưng khóa "Test" chỉ có lớp 40.
      expect(outcome.pending.input).toEqual({ userId: 124, classId: 40 });
    }
  });

  it('ghi danh "vào lớp X trong khóa Y" nhưng khóa không khớp -> báo không tìm thấy trong khóa đó', async () => {
    usersService.searchStudents.mockResolvedValue([
      { id: 3, fullName: 'Tiến' },
    ]);
    coursesService.searchClasses.mockResolvedValue([
      {
        id: 8,
        title: 'Tiếng Bỉ 1',
        courseId: 20,
        course: { id: 20, title: 'Tiếng Bỉ', courseCode: 'TIENG_BI' },
      },
    ]);

    const outcome = await service.resolve(
      1,
      {},
      'thêm tiến vào lớp tiếng bỉ 1 trong khóa toán',
    );

    expect(outcome?.type).toBe('message');
    if (outcome?.type === 'message') {
      expect(outcome.message).toContain('trong khóa "toán"');
    }
  });

  it('đuôi lịch sự không dấu "cho toi nhe" được bỏ khỏi keyword lớp', async () => {
    usersService.searchStudents.mockResolvedValue([
      { id: 3, fullName: 'Tiến' },
    ]);
    coursesService.searchClasses.mockResolvedValue([
      {
        id: 8,
        title: 'Tiếng Bỉ 1',
        courseId: 20,
        course: { id: 20, title: 'Tiếng Bỉ' },
      },
    ]);

    const outcome = await service.resolve(
      1,
      {},
      'thêm tiến vào lớp tiếng bỉ 1 cho toi nhe',
    );

    expect(coursesService.searchClasses).toHaveBeenCalledWith(1, 'tiếng bỉ 1');
    expect(outcome?.type).toBe('pending_write');
  });

  it('ghi danh "vào KHÓA" nhiều lớp -> clarification chọn lớp + pending_enrollment_context', async () => {
    usersService.searchStudents.mockResolvedValue([
      { id: 3, fullName: 'Tiến' },
    ]);
    coursesService.searchCourses.mockResolvedValue([
      { id: 20, title: 'Tiếng Bỉ' },
    ]);
    coursesService.searchClasses.mockResolvedValue([
      { id: 8, title: 'Tiếng Bỉ tối' },
      { id: 9, title: 'Tiếng Bỉ sáng' },
    ]);
    const outcome = await service.resolve(1, {}, 'thêm tiến vào khóa tiếng bỉ');
    expect(coursesService.searchClasses).toHaveBeenCalledWith(1, '', {
      courseId: 20,
    });
    expect(outcome?.type).toBe('clarification');
    if (outcome?.type === 'clarification') {
      expect(outcome.missingFields).toEqual(['classId']);
      // Intent phải là assign_student_to_class: _to_course bị chặn trong mini
      // mode -> guard sẽ trả "chưa được bật trong bản Copilot mini".
      expect(outcome.intent).toBe('assign_student_to_class');
      expect(outcome.contextPatch.pending_enrollment_context).toEqual(
        expect.objectContaining({ userId: 3, courseId: 20 }),
      );
    }
  });

  it('ghi danh "vào KHÓA" chỉ có 1 lớp -> pending assign_student_to_class luôn', async () => {
    usersService.searchStudents.mockResolvedValue([
      { id: 3, fullName: 'Tiến' },
    ]);
    coursesService.searchCourses.mockResolvedValue([
      { id: 20, title: 'Tiếng Bỉ' },
    ]);
    coursesService.searchClasses.mockResolvedValue([
      { id: 8, title: 'Tiếng Bỉ 1' },
    ]);
    const outcome = await service.resolve(1, {}, 'thêm tiến vào khóa tiếng bỉ');
    expect(outcome?.type).toBe('pending_write');
    if (outcome?.type === 'pending_write') {
      expect(outcome.pending.tool_name).toBe('assign_student_to_class');
      expect(outcome.pending.input).toEqual({ userId: 3, classId: 8 });
    }
  });

  it('"học viên bên trên" + "lớp này" -> lấy từ ngữ cảnh, KHÔNG search theo "bên trên"', async () => {
    const state = {
      last_created_student: { id: 5, label: 'Nguyễn Văn Tuệ' },
      last_created_class: {
        id: 8,
        label: 'Tue',
        metadata: { id: 8, courseId: 20, course: { id: 20, title: 'Test' } },
      },
    };
    const outcome = await service.resolve(
      1,
      state,
      'thêm học viên bên trên vào lớp này cho tôi',
    );
    expect(usersService.searchStudents).not.toHaveBeenCalled();
    expect(coursesService.searchClasses).not.toHaveBeenCalled();
    expect(outcome?.type).toBe('pending_write');
    if (outcome?.type === 'pending_write') {
      expect(outcome.pending.tool_name).toBe('assign_student_to_class');
      expect(outcome.pending.input).toEqual({ userId: 5, classId: 8 });
      expect(outcome.pending.summary).toBe(
        'Thêm học viên Nguyễn Văn Tuệ vào lớp Tue',
      );
    }
  });

  it('"học viên vừa tạo" + "khóa này" (suy ra khóa từ lớp vừa tạo) -> pending khi khóa có 1 lớp', async () => {
    const state = {
      last_created_student: { id: 5, label: 'Nguyễn Văn Tuệ' },
      last_created_class: {
        id: 8,
        label: 'Tue',
        metadata: { id: 8, courseId: 20, course: { id: 20, title: 'Test' } },
      },
    };
    coursesService.searchClasses.mockResolvedValue([{ id: 8, title: 'Tue' }]);
    const outcome = await service.resolve(
      1,
      state,
      'thêm học viên vừa tạo vào khóa này cho tôi',
    );
    expect(usersService.searchStudents).not.toHaveBeenCalled();
    expect(coursesService.searchCourses).not.toHaveBeenCalled();
    expect(coursesService.searchClasses).toHaveBeenCalledWith(1, '', {
      courseId: 20,
    });
    expect(outcome?.type).toBe('pending_write');
    if (outcome?.type === 'pending_write') {
      expect(outcome.pending.input).toEqual({ userId: 5, classId: 8 });
    }
  });

  it('gõ thiếu "vào" thành "ào" -> vẫn hiểu là ghi danh, KHÔNG tạo học viên tên rác', async () => {
    const state = {
      last_created_student: { id: 5, label: 'Hoàng Văn Test1' },
      last_created_class: {
        id: 9,
        label: 'Test12',
        metadata: { id: 9, courseId: 20, course: { id: 20, title: 'Test' } },
      },
    };
    const outcome = await service.resolve(
      1,
      state,
      'thêm học viên ở bên trên ào lớp này cho tôi',
    );
    expect(outcome?.type).toBe('pending_write');
    if (outcome?.type === 'pending_write') {
      expect(outcome.pending.tool_name).toBe('assign_student_to_class');
      expect(outcome.pending.input).toEqual({ userId: 5, classId: 9 });
    }
  });

  it('thiếu hẳn "vào" ("thêm học viên bên trên lớp này") -> vẫn hiểu là ghi danh', async () => {
    const state = {
      last_created_student: { id: 5, label: 'Hoàng Văn Test1' },
      last_created_class: { id: 9, label: 'Test12', metadata: { id: 9 } },
    };
    const outcome = await service.resolve(
      1,
      state,
      'thêm học viên bên trên lớp này',
    );
    expect(outcome?.type).toBe('pending_write');
    if (outcome?.type === 'pending_write') {
      expect(outcome.pending.input).toEqual({ userId: 5, classId: 9 });
    }
  });

  it('"thêm học viên ào lớp Tue" (thiếu tên + typo) -> null để LLM lo, KHÔNG create_student', async () => {
    const outcome = await service.resolve(
      1,
      {},
      'thêm học viên ào lớp Tue cho tôi',
    );
    expect(outcome).toBeNull();
  });

  it('"học viên bên trên" nhưng chưa có học viên trong ngữ cảnh -> hỏi lại, không search "bên trên"', async () => {
    const outcome = await service.resolve(
      1,
      {},
      'thêm học viên bên trên vào lớp Tue',
    );
    expect(usersService.searchStudents).not.toHaveBeenCalled();
    expect(outcome?.type).toBe('clarification');
    if (outcome?.type === 'clarification') {
      expect(outcome.missingFields).toEqual(['userId']);
    }
  });

  it('"thêm học viên vào khóa X" (thiếu tên) -> không tạo tên rác', async () => {
    // Học viên rỗng -> parseEnroll bỏ qua, create bị chặn vì có "vào" -> null (LLM lo).
    const outcome = await service.resolve(
      1,
      {},
      'thêm học viên vào khóa tiếng bỉ',
    );
    expect(outcome).toBeNull();
    expect(usersService.searchStudents).not.toHaveBeenCalled();
  });

  it('câu mơ hồ -> trả null để LLM xử lý', async () => {
    const outcome = await service.resolve(1, {}, 'hôm nay thế nào');
    expect(outcome).toBeNull();
  });

  it('"xem danh sách học viên trong khóa X" -> bảng học viên của khóa', async () => {
    coursesService.searchCourses.mockResolvedValue([
      { id: 86, title: 'Toán Cao Cấp' },
    ]);
    coursesService.getCourseStudents.mockResolvedValue([
      {
        classId: 9,
        classTitle: 'Toán 3',
        classType: 'WEEKLY',
        roleInClass: 'STUDENT',
        joinedAt: '2026-07-10T00:00:00.000Z',
        student: { id: 1, fullName: 'Toàn Hoàng', email: 'toan1@gmail.com' },
      },
    ]);

    const outcome = await service.resolve(
      1,
      {},
      'cho tôi xem danh sách học viên trong khóa toán cao cấp',
    );

    expect(coursesService.searchCourses).toHaveBeenCalledWith(
      1,
      'toán cao cấp',
    );
    expect(outcome?.type).toBe('student_table');
    if (outcome?.type === 'student_table') {
      expect(outcome.scope).toBe('course');
      expect(outcome.students).toHaveLength(1);
      expect(outcome.students[0]).toEqual(
        expect.objectContaining({
          id: 1,
          fullName: 'Toàn Hoàng',
          className: 'Toán 3',
        }),
      );
      expect(outcome.contextPatch.selected_course_id).toBe(86);
    }
  });

  it('"xem danh sách học viên lớp 3" -> bảng học viên của lớp', async () => {
    coursesService.searchClasses.mockResolvedValue([{ id: 9, title: 'Toán 3' }]);
    coursesService.getClassStudents.mockResolvedValue([
      {
        roleInClass: 'STUDENT',
        joinedAt: '2026-07-10T00:00:00.000Z',
        student: { id: 2, fullName: 'Nguyễn Thị Hà Xuyên' },
      },
    ]);

    const outcome = await service.resolve(
      1,
      {},
      'cho tôi xem danh sách học viên lớp 3',
    );

    expect(outcome?.type).toBe('student_table');
    if (outcome?.type === 'student_table') {
      expect(outcome.scope).toBe('class');
      expect(outcome.students[0].fullName).toBe('Nguyễn Thị Hà Xuyên');
    }
  });

  it('"xem danh sách lớp trong khóa X" -> bảng lớp học của khóa', async () => {
    coursesService.searchCourses.mockResolvedValue([
      { id: 86, title: 'Toán Cao Cấp' },
    ]);
    coursesService.searchClasses.mockResolvedValue([
      {
        id: 44,
        title: 'Toán 3',
        classCode: 'TOAN_CAO_CAP_TOAN_3_WEEKLY',
        type: 'WEEKLY',
        teacherName: null,
        status: 'ACTIVE',
        course: { id: 86, title: 'Toán Cao Cấp' },
        _count: { enrollments: 3 },
      },
    ]);

    const outcome = await service.resolve(
      1,
      {},
      'cho tôi xem danh sách lớp trong khóa toán cao cấp',
    );

    expect(coursesService.searchClasses).toHaveBeenCalledWith(1, '', {
      courseId: 86,
    });
    expect(outcome?.type).toBe('class_table');
    if (outcome?.type === 'class_table') {
      expect(outcome.classes).toHaveLength(1);
      expect(outcome.classes[0]).toEqual(
        expect.objectContaining({
          id: 44,
          title: 'Toán 3',
          studentCount: 3,
          type: 'WEEKLY',
        }),
      );
    }
  });

  it('"ds lớp khóa này" -> lấy khóa từ ngữ cảnh, không search khóa', async () => {
    coursesService.searchClasses.mockResolvedValue([]);
    const outcome = await service.resolve(
      1,
      { last_created_course: { id: 86, label: 'Toán Cao Cấp' } },
      'ds lớp khóa này',
    );
    expect(coursesService.searchCourses).not.toHaveBeenCalled();
    expect(outcome?.type).toBe('message');
    if (outcome?.type === 'message') {
      expect(outcome.message).toContain('chưa có lớp nào');
    }
  });

  it('"xem ds học viên trong khóa này" -> lấy khóa từ ngữ cảnh, không search', async () => {
    coursesService.getCourseStudents.mockResolvedValue([]);
    const outcome = await service.resolve(
      1,
      { last_created_course: { id: 86, label: 'Toán Cao Cấp' } },
      'xem ds học viên trong khóa này',
    );
    expect(coursesService.searchCourses).not.toHaveBeenCalled();
    expect(coursesService.getCourseStudents).toHaveBeenCalledWith(1, 86);
    expect(outcome?.type).toBe('message');
    if (outcome?.type === 'message') {
      expect(outcome.message).toContain('chưa có học viên nào');
    }
  });

  it('fallbackSearch: suy ra tìm học viên khi LLM lỗi', async () => {
    usersService.searchStudents.mockResolvedValue([{ id: 1, fullName: 'Nam' }]);
    const fb = await service.fallbackSearch(1, 'tìm học viên nam');
    expect(fb).not.toBeNull();
    expect(usersService.searchStudents).toHaveBeenCalledWith(1, 'nam');
  });

  it('"tạo cho tôi 1 hv tên Minh Nguyễn , email, sđt" -> tên đúng "Minh Nguyễn" (bỏ "1 hv tên")', async () => {
    const outcome = await service.resolve(
      1,
      {},
      'tạo cho tôi 1 hv tên Minh Nguyễn , minh123@gmail.com, 0987643251',
    );
    expect(outcome?.type).toBe('pending_write');
    if (outcome?.type === 'pending_write') {
      expect(outcome.pending.input).toEqual({
        fullName: 'Minh Nguyễn',
        email: 'minh123@gmail.com',
        phone: '0987643251',
      });
    }
  });

  it('"tạo hv tên Minh Anh" -> không cắt mất "Minh" (trùng từ đệm "mình")', async () => {
    const outcome = await service.resolve(
      1,
      {},
      'tạo cho tôi 1 học viên tên Minh Anh 0987643251',
    );
    expect(outcome?.type).toBe('pending_write');
    if (outcome?.type === 'pending_write') {
      expect(outcome.pending.input).toEqual({
        fullName: 'Minh Anh',
        phone: '0987643251',
      });
    }
  });

  // ---- Update class dates ---------------------------------------------------

  const todayIso = (() => {
    const pad = (n: number) => String(n).padStart(2, '0');
    const now = new Date();
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  })();

  it('"ngày bắt đầu là hôm nay" sau khi tạo lớp -> preview update_class lớp vừa tạo (không rơi xuống LLM)', async () => {
    const outcome = await service.resolve(
      1,
      { last_created_class: { id: 53, label: 'Test 12' } },
      'ngày bắt đầu là hôm nay',
    );
    expect(coursesService.searchClasses).not.toHaveBeenCalled();
    expect(outcome?.type).toBe('pending_write');
    if (outcome?.type === 'pending_write') {
      expect(outcome.pending.tool_name).toBe('update_class');
      expect(outcome.pending.input).toEqual({
        classId: 53,
        startDate: todayIso,
      });
      expect(outcome.pending.status).toBe('waiting_confirm');
    }
  });

  it('"lớp Test 12 kết thúc 30/9/2026" -> tự tìm lớp, preview update_class với endDate', async () => {
    coursesService.searchClasses.mockResolvedValue([
      { id: 53, title: 'Test 12' },
    ]);
    const outcome = await service.resolve(
      1,
      {},
      'lớp Test 12 kết thúc 30/9/2026',
    );
    expect(coursesService.searchClasses).toHaveBeenCalledWith(1, 'Test 12');
    expect(outcome?.type).toBe('pending_write');
    if (outcome?.type === 'pending_write') {
      expect(outcome.pending.input).toEqual({
        classId: 53,
        endDate: '2026-09-30',
      });
    }
  });

  it('"cập nhật ngày bắt đầu..." có cả khóa lẫn lớp trong ngữ cảnh -> update_class (ngày thuộc lớp, không hỏi khóa)', async () => {
    const outcome = await service.resolve(
      1,
      {
        last_created_course: { id: 9, label: 'Anh Văn' },
        last_created_class: { id: 53, label: 'Test 12' },
      },
      'cập nhật ngày bắt đầu là hôm nay',
    );
    expect(outcome?.type).toBe('pending_write');
    if (outcome?.type === 'pending_write') {
      expect(outcome.pending.tool_name).toBe('update_class');
      expect(outcome.pending.input).toEqual({
        classId: 53,
        startDate: todayIso,
      });
    }
  });

  it('"ngày bắt đầu là hôm nay" khi KHÔNG có lớp trong ngữ cảnh -> hỏi lớp nào', async () => {
    const outcome = await service.resolve(1, {}, 'ngày bắt đầu là hôm nay');
    expect(outcome?.type).toBe('clarification');
    if (outcome?.type === 'clarification') {
      expect(outcome.intent).toBe('update_class');
      expect(outcome.message).toContain('lớp nào');
    }
  });

  // ---- Update student ------------------------------------------------------

  it('"cập nhật thêm sdt là 0987654123" sau khi tạo học viên -> update_student học viên vừa tạo (không hỏi khóa học)', async () => {
    const outcome = await service.resolve(
      1,
      {
        last_intent: 'create_student',
        last_created_student: { id: 7, label: 'Đặng Ngọc Linh' },
      },
      'cập nhật thêm sdt là 0987654123',
    );
    expect(outcome?.type).toBe('pending_write');
    if (outcome?.type === 'pending_write') {
      expect(outcome.pending.tool_name).toBe('update_student');
      expect(outcome.pending.input).toEqual({
        userId: 7,
        phone: '0987654123',
      });
      expect(outcome.contextPatch.last_intent).toBe('update_student');
    }
    expect(usersService.searchStudents).not.toHaveBeenCalled();
  });

  it('"sữa so dien thoai cua hv vua tao thành 09..." -> update_student học viên vừa tạo, KHÔNG phải create', async () => {
    // Tái hiện sự cố: chữ "tạo" trong cụm tham chiếu "vừa tạo" bị hiểu nhầm
    // là động từ tạo -> câu sửa bị hijack thành preview TẠO học viên tên rác
    // "sửa cua hv vua tao thành". ("sữa" là typo phổ biến của "sửa".)
    const outcome = await service.resolve(
      1,
      {
        last_intent: 'create_student',
        last_created_student: { id: 7, label: 'Đặng Ngọc Linh' },
      },
      'sữa so dien thoai cua hv vua tao thành 0978656453',
    );

    expect(outcome?.type).toBe('pending_write');
    if (outcome?.type === 'pending_write') {
      expect(outcome.pending.tool_name).toBe('update_student');
      expect(outcome.pending.input).toEqual({
        userId: 7,
        phone: '0978656453',
      });
    }
    expect(usersService.searchStudents).not.toHaveBeenCalled();
  });

  it('"cập nhật sđt ..." khi KHÔNG có học viên trong ngữ cảnh -> hỏi học viên nào (không hỏi khóa học)', async () => {
    const outcome = await service.resolve(
      1,
      {},
      'cập nhật sđt là 0987654123',
    );
    expect(outcome?.type).toBe('clarification');
    if (outcome?.type === 'clarification') {
      expect(outcome.intent).toBe('update_student');
      expect(outcome.message).toContain('học viên nào');
    }
  });

  it('"cập nhật" trống sau khi tạo học viên -> hỏi field cần đổi cho đúng học viên vừa tạo', async () => {
    const outcome = await service.resolve(
      1,
      {
        last_intent: 'create_student',
        last_created_student: { id: 7, label: 'Đặng Ngọc Linh' },
      },
      'cập nhật',
    );
    expect(outcome?.type).toBe('clarification');
    if (outcome?.type === 'clarification') {
      expect(outcome.intent).toBe('update_student');
      expect(outcome.message).toContain('Đặng Ngọc Linh');
    }
  });

  it('"sửa email học viên An thành ..." -> tự tìm học viên An, preview update_student với email mới', async () => {
    usersService.searchStudents.mockResolvedValue([
      { id: 12, fullName: 'Nguyễn Văn An' },
    ]);
    const outcome = await service.resolve(
      1,
      {},
      'sửa email học viên An thành an2@gmail.com',
    );
    expect(usersService.searchStudents).toHaveBeenCalledWith(1, 'An');
    expect(outcome?.type).toBe('pending_write');
    if (outcome?.type === 'pending_write') {
      expect(outcome.pending.tool_name).toBe('update_student');
      expect(outcome.pending.input).toEqual({
        userId: 12,
        email: 'an2@gmail.com',
      });
    }
  });

  it('"đổi tên học viên A thành B" -> tách tên cần tìm và tên mới', async () => {
    usersService.searchStudents.mockResolvedValue([
      { id: 15, fullName: 'Trần Văn A' },
    ]);
    const outcome = await service.resolve(
      1,
      {},
      'đổi tên học viên Trần Văn A thành Trần Văn B',
    );
    expect(usersService.searchStudents).toHaveBeenCalledWith(1, 'Trần Văn A');
    expect(outcome?.type).toBe('pending_write');
    if (outcome?.type === 'pending_write') {
      expect(outcome.pending.input).toEqual({
        userId: 15,
        fullName: 'Trần Văn B',
      });
    }
  });

  it('"cập nhật tên thành ..." khi vừa tạo học viên -> đổi tên học viên ngữ cảnh', async () => {
    const outcome = await service.resolve(
      1,
      {
        last_intent: 'create_student',
        last_created_student: { id: 7, label: 'Đặng Ngọc Linh' },
      },
      'cập nhật tên thành Đặng Ngọc Lan',
    );
    expect(outcome?.type).toBe('pending_write');
    if (outcome?.type === 'pending_write') {
      expect(outcome.pending.tool_name).toBe('update_student');
      expect(outcome.pending.input).toEqual({
        userId: 7,
        fullName: 'Đặng Ngọc Lan',
      });
    }
  });

  it('"cập nhật ngày sinh 12/03/2000, địa chỉ Hà Nội" -> bóc đủ field, chuẩn ISO ngày', async () => {
    const outcome = await service.resolve(
      1,
      { last_created_student: { id: 7, label: 'Đặng Ngọc Linh' } },
      'cập nhật ngày sinh 12/03/2000, địa chỉ Hà Nội',
    );
    expect(outcome?.type).toBe('pending_write');
    if (outcome?.type === 'pending_write') {
      expect(outcome.pending.input).toEqual({
        userId: 7,
        birthDate: '2000-03-12',
        address: 'Hà Nội',
      });
    }
  });

  it('keyword học viên không dính từ nối: "học viên Minh Nguyễn CÓ ngày sinh..." -> tìm "Minh Nguyễn"', async () => {
    usersService.searchStudents.mockResolvedValue([
      { id: 21, fullName: 'Minh Nguyễn' },
    ]);
    const outcome = await service.resolve(
      1,
      {},
      'đổi cho tôi học viên Minh Nguyễn có ngày sinh là 1/3/2003',
    );
    expect(usersService.searchStudents).toHaveBeenCalledWith(1, 'Minh Nguyễn');
    expect(outcome?.type).toBe('pending_write');
    if (outcome?.type === 'pending_write') {
      expect(outcome.pending.input).toEqual({
        userId: 21,
        birthDate: '2003-03-01',
      });
    }
  });

  it('nhiều học viên trùng tên -> hỏi chọn, LƯU field đã parse vào pending_student_update', async () => {
    usersService.searchStudents.mockResolvedValue([
      { id: 20, fullName: 'Minh Nguyễn Hoàng' },
      { id: 21, fullName: 'Minh Nguyễn' },
    ]);
    const outcome = await service.resolve(
      1,
      {},
      'đổi cho tôi học viên Minh Nguyễn ngày sinh là 1/3/2003',
    );
    expect(outcome?.type).toBe('clarification');
    if (outcome?.type === 'clarification') {
      expect(outcome.intent).toBe('update_student');
      expect(outcome.contextPatch.pending_student_update).toEqual({
        fields: { birthDate: '2003-03-01' },
      });
      expect(outcome.contextPatch.last_candidates?.students).toHaveLength(2);
    }
  });

  it('trả lời "2" sau danh sách trùng tên -> update đúng học viên thứ 2 với field đã lưu', async () => {
    const state = {
      last_intent: 'update_student',
      pending_student_update: { fields: { birthDate: '2003-03-01' } },
      last_candidates: {
        students: [
          { id: 20, value: 20, label: 'Minh Nguyễn Hoàng' },
          { id: 21, value: 21, label: 'Minh Nguyễn' },
        ],
      },
    };
    const outcome = await service.resolve(1, state as any, '2');
    expect(outcome?.type).toBe('pending_write');
    if (outcome?.type === 'pending_write') {
      expect(outcome.pending.tool_name).toBe('update_student');
      expect(outcome.pending.input).toEqual({
        userId: 21,
        birthDate: '2003-03-01',
      });
      expect(outcome.contextPatch.pending_student_update).toBeNull();
    }
  });

  it('trả lời bằng TÊN sau danh sách trùng -> khớp chính xác, không dính tên dài hơn', async () => {
    const state = {
      pending_student_update: { fields: { phone: '0987643251' } },
      last_candidates: {
        students: [
          { id: 20, value: 20, label: 'Minh Nguyễn Hoàng' },
          { id: 21, value: 21, label: 'Minh Nguyễn' },
        ],
      },
    };
    const outcome = await service.resolve(1, state as any, 'Minh Nguyễn');
    expect(outcome?.type).toBe('pending_write');
    if (outcome?.type === 'pending_write') {
      expect(outcome.pending.input).toEqual({
        userId: 21,
        phone: '0987643251',
      });
    }
  });

  it('trả lời "hủy" khi đang chọn học viên -> dừng thao tác, xóa context', async () => {
    const state = {
      pending_student_update: { fields: { birthDate: '2003-03-01' } },
      last_candidates: {
        students: [{ id: 20, value: 20, label: 'Minh Nguyễn Hoàng' }],
      },
    };
    const outcome = await service.resolve(1, state as any, 'hủy');
    expect(outcome?.type).toBe('message');
    if (outcome?.type === 'message') {
      expect(outcome.message).toContain('Đã hủy');
      expect(outcome.contextPatch.pending_student_update).toBeNull();
    }
  });

  it('đã chốt học viên, trả lời field cần đổi ("sđt 0987...") -> preview luôn', async () => {
    const state = {
      pending_student_update: {
        fields: {},
        student_id: 7,
        student_label: 'Đặng Ngọc Linh',
      },
    };
    const outcome = await service.resolve(1, state as any, 'sđt 0987654123');
    expect(outcome?.type).toBe('pending_write');
    if (outcome?.type === 'pending_write') {
      expect(outcome.pending.input).toEqual({
        userId: 7,
        phone: '0987654123',
      });
    }
  });

  it('đang hỏi tên học viên, trả lời tên mới -> tìm tiếp và preview với field đã lưu', async () => {
    usersService.searchStudents.mockResolvedValue([
      { id: 33, fullName: 'Trần Thị Hoa' },
    ]);
    const state = {
      pending_student_update: { fields: { phone: '0987654123' } },
    };
    const outcome = await service.resolve(1, state as any, 'Trần Thị Hoa');
    expect(usersService.searchStudents).toHaveBeenCalledWith(
      1,
      'Trần Thị Hoa',
    );
    expect(outcome?.type).toBe('pending_write');
    if (outcome?.type === 'pending_write') {
      expect(outcome.pending.input).toEqual({
        userId: 33,
        phone: '0987654123',
      });
    }
  });

  it('đang chọn học viên nhưng user đổi ý gõ intent khác -> không hijack', async () => {
    const state = {
      pending_student_update: { fields: { phone: '0987654123' } },
      last_candidates: {
        students: [{ id: 20, value: 20, label: 'Minh Nguyễn Hoàng' }],
      },
    };
    const outcome = await service.resolve(
      1,
      state as any,
      'tạo học viên Lê Minh Tuấn',
    );
    expect(outcome?.type).toBe('pending_write');
    if (outcome?.type === 'pending_write') {
      expect(outcome.pending.tool_name).toBe('create_student');
    }
  });

  it('"tạo học viên Nguyễn Văn An sđt 0988888888" vẫn là create, không bị hiểu thành update', async () => {
    const outcome = await service.resolve(
      1,
      { last_created_student: { id: 7, label: 'Đặng Ngọc Linh' } },
      'tạo học viên Nguyễn Văn An số điện thoại 0988888888',
    );
    expect(outcome?.type).toBe('pending_write');
    if (outcome?.type === 'pending_write') {
      expect(outcome.pending.tool_name).toBe('create_student');
    }
  });
});
