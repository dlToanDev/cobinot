import { DeterministicIntentService } from './deterministic-intent.service';

describe('DeterministicIntentService', () => {
  const usersService = {
    searchStudents: jest.fn(),
  };
  const coursesService = {
    searchCourses: jest.fn(),
    searchClasses: jest.fn(),
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
    const outcome = await service.resolve(
      1,
      stateWithSearch as any,
      'tạo học viên',
    );
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
    for (const msg of ['tạo khóa học mới', 'tạo khóa học', 'thêm khóa học mới']) {
      const outcome = await service.resolve(1, {}, msg);
      expect(outcome?.type).toBe('course_form');
      if (outcome?.type === 'course_form') {
        expect(outcome.values).toEqual({});
        expect(outcome.contextPatch.last_intent).toBe('create_course');
      }
    }
    expect(coursesService.searchCourses).not.toHaveBeenCalled();
  });

  it('tạo khóa học CÓ tên/chi tiết -> để LLM xử lý (deterministic trả null)', async () => {
    const outcome = await service.resolve(
      1,
      {},
      'tạo khóa IELTS 6.5 từ 10/07/2026 đến 10/09/2026',
    );
    expect(outcome).toBeNull();
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
      expect(outcome.pending.input).toEqual({ courseId: 79, level: 'Cấp độ 1' });
    }
  });

  it('update: không có khóa trong context -> hỏi lại khóa nào', async () => {
    const outcome = await service.resolve(1, {} as any, 'cập nhật cấp độ 1');
    expect(outcome?.type).toBe('clarification');
    if (outcome?.type === 'clarification') {
      expect(outcome.intent).toBe('update_course');
      expect(outcome.message).toContain('Bạn muốn cập nhật khóa học nào');
    }
  });

  it('update: parse ngày bắt đầu/kết thúc kể cả 31/072026', async () => {
    const outcome = await service.resolve(
      1,
      courseCtx,
      'ngày bắt đầu 10/07/2026 ngày kết thúc 31/072026',
    );
    expect(outcome?.type).toBe('pending_write');
    if (outcome?.type === 'pending_write') {
      expect(outcome.pending.input).toEqual({
        courseId: 79,
        startDate: '2026-07-10',
        expireDate: '2026-07-31',
      });
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

  // Case 6: "thêm tiến vào lớp tiếng bỉ 1" -> search cả 2, tạo enrollment.
  it('ghi danh vào lớp: 1 học viên + 1 lớp -> pending assign_student_to_course', async () => {
    usersService.searchStudents.mockResolvedValue([
      { id: 3, fullName: 'Tiến' },
    ]);
    coursesService.searchClasses.mockResolvedValue([
      { id: 8, title: 'Tiếng Bỉ 1', courseId: 20, course: { id: 20, title: 'Tiếng Bỉ' } },
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
      expect(outcome.pending.tool_name).toBe('assign_student_to_course');
      expect(outcome.pending.input).toEqual({
        userId: 3,
        courseId: 20,
        classId: 8,
      });
    }
  });

  it('ghi danh: nhiều học viên -> clarification chọn học viên', async () => {
    usersService.searchStudents.mockResolvedValue([
      { id: 3, fullName: 'Tiến A' },
      { id: 4, fullName: 'Tiến B' },
    ]);
    const outcome = await service.resolve(
      1,
      {},
      'thêm tiến vào khóa tiếng bỉ',
    );
    expect(outcome?.type).toBe('clarification');
    // Không tìm khóa khi học viên còn mơ hồ.
    expect(coursesService.searchCourses).not.toHaveBeenCalled();
  });

  it('ghi danh vào khóa: 1 học viên + 1 khóa -> pending không kèm classId', async () => {
    usersService.searchStudents.mockResolvedValue([{ id: 3, fullName: 'An' }]);
    coursesService.searchCourses.mockResolvedValue([
      { id: 20, title: 'IELTS 6.5' },
    ]);
    const outcome = await service.resolve(1, {}, 'ghi danh an vào khóa ielts');
    expect(outcome?.type).toBe('pending_write');
    if (outcome?.type === 'pending_write') {
      expect(outcome.pending.input).toEqual({ userId: 3, courseId: 20 });
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

  it('fallbackSearch: suy ra tìm học viên khi LLM lỗi', async () => {
    usersService.searchStudents.mockResolvedValue([{ id: 1, fullName: 'Nam' }]);
    const fb = await service.fallbackSearch(1, 'tìm học viên nam');
    expect(fb).not.toBeNull();
    expect(usersService.searchStudents).toHaveBeenCalledWith(1, 'nam');
  });
});
