import { ToolRegistryService } from './tool-registry.service';

describe('ToolRegistryService - assign_student_to_course', () => {
  const originalMiniMode = process.env.AGENT_MINI_MODE;
  const actor = { tenantId: 10, userId: 20, role: 'ADMIN' } as any;
  let prisma: any;
  let usersService: any;
  let coursesService: any;
  let enrollmentsService: any;
  let service: ToolRegistryService;

  beforeEach(() => {
    // Suite này test cả các tool full-mode (assign_student_to_course, update_course...).
    // afterEach sẽ restore lại giá trị env gốc.
    process.env.AGENT_MINI_MODE = 'false';
    prisma = {
      aiAgentAction: {
        create: jest.fn().mockResolvedValue({ id: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      aiAgentAuditLog: {
        create: jest.fn().mockResolvedValue({}),
      },
      aiAgentSession: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };
    usersService = {
      findOneStudent: jest.fn().mockResolvedValue({ id: 1, fullName: 'A' }),
    };
    coursesService = {
      findOneCourse: jest.fn().mockResolvedValue({ id: 10, title: 'IELTS' }),
      enrollStudentToAllActiveClasses: jest.fn(),
      assignTeacherToCourseClasses: jest.fn(),
      createClass: jest.fn(),
      updateCourse: jest.fn().mockResolvedValue({
        id: 79,
        title: 'Test 1',
        courseCode: 'TEST_1',
        level: 'Cấp độ 1',
      }),
    };
    enrollmentsService = {
      findByStudentAndCourse: jest.fn().mockResolvedValue(null),
    };
    service = new ToolRegistryService(
      prisma,
      usersService,
      coursesService,
      enrollmentsService,
    );
  });

  afterEach(() => {
    if (originalMiniMode === undefined) {
      delete process.env.AGENT_MINI_MODE;
    } else {
      process.env.AGENT_MINI_MODE = originalMiniMode;
    }
  });

  it('chặn khi học viên đã có mặt ở TẤT CẢ lớp ACTIVE (STUDENT_ALREADY_ASSIGNED_TO_COURSE)', async () => {
    const conflict: any = new Error('already');
    conflict.response = { code: 'STUDENT_ALREADY_ASSIGNED_TO_COURSE' };
    coursesService.enrollStudentToAllActiveClasses.mockRejectedValue(conflict);

    await expect(
      service.execute(1, actor, 'assign_student_to_course', {
        userId: 1,
        courseId: 10,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'STUDENT_ALREADY_ASSIGNED_TO_COURSE',
      }),
    });
  });

  it('ghi danh cả khóa qua hàm dùng chung, trả kết quả per-class', async () => {
    coursesService.enrollStudentToAllActiveClasses.mockResolvedValue({
      id: 55,
      userId: 1,
      studentId: 1,
      courseId: 10,
      user: { id: 1, fullName: 'A' },
      course: { id: 10, title: 'IELTS' },
      totalActiveClasses: 2,
      enrolled: [
        { classId: 5, classTitle: 'IELTS tối', enrollmentId: 55 },
        { classId: 6, classTitle: 'IELTS cuối tuần', enrollmentId: 56 },
      ],
      skippedExisting: [],
    });

    const result = await service.execute(1, actor, 'assign_student_to_course', {
      userId: 1,
      courseId: 10,
    });

    expect(
      coursesService.enrollStudentToAllActiveClasses,
    ).toHaveBeenCalledWith(10, 10, 1, expect.objectContaining({
      roleInClass: 'STUDENT',
    }));
    expect(result).toEqual(
      expect.objectContaining({
        studentId: 1,
        courseId: 10,
        totalActiveClasses: 2,
        enrolled: [
          expect.objectContaining({ classId: 5 }),
          expect.objectContaining({ classId: 6 }),
        ],
        skippedExisting: [],
      }),
    );
  });

  it('assign_student_to_course truyền expireDate/allowLatePayment/note xuống hàm ghi danh', async () => {
    coursesService.enrollStudentToAllActiveClasses.mockResolvedValue({
      id: 56,
      userId: 1,
      courseId: 10,
      enrolled: [],
      skippedExisting: [],
    });

    await service.execute(1, actor, 'assign_student_to_course', {
      userId: 1,
      courseId: 10,
      expireDate: '2026-12-31',
      allowLatePayment: true,
      note: 'Học viên chuyển từ lớp cũ',
    });

    expect(
      coursesService.enrollStudentToAllActiveClasses,
    ).toHaveBeenCalledWith(
      10,
      10,
      1,
      expect.objectContaining({
        expireDate: '2026-12-31',
        allowLatePayment: true,
        note: 'Học viên chuyển từ lớp cũ',
      }),
    );
  });

  it('create_class gọi CoursesService.createClass với schema đúng và bỏ field cấm', async () => {
    process.env.AGENT_MINI_MODE = 'false';
    coursesService.createClass.mockResolvedValue({
      id: 7,
      title: 'Evening A',
      classCode: 'IELTS_6_5_EVENING_A_WEEKLY',
    });

    await service.execute(1, actor, 'create_class', {
      courseId: 10,
      title: 'Evening A',
      type: 'WEEKLY',
      classCode: 'USER_CODE',
      classType: 'PRACTICE',
      capacity: 20,
      teacherId: 99,
      room: 'A1',
      sessions: [
        {
          dayOfWeek: 2,
          startTime: '19:00',
          endTime: '21:00',
          room: 'A1',
        },
      ],
    });

    expect(coursesService.createClass).toHaveBeenCalledWith(10, {
      courseId: 10,
      title: 'Evening A',
      type: 'WEEKLY',
      description: undefined,
      teacherName: undefined,
      startDate: undefined,
      endDate: undefined,
      sessions: [
        {
          title: undefined,
          dayOfWeek: 2,
          startTime: '19:00',
          endTime: '21:00',
          sessionDate: undefined,
          room: 'A1',
          note: undefined,
        },
      ],
    });
  });

  it('update_course map status, bỏ field rỗng và BỎ QUA ngày (khóa không có ngày)', async () => {
    process.env.AGENT_MINI_MODE = 'false';
    const result = await service.execute(1, actor, 'update_course', {
      courseId: 79,
      level: 'Cấp độ 1',
      title: '', // rỗng -> không truyền xuống service
      startDate: '2026-07-10', // khóa học không có ngày -> bị bỏ qua
      endDate: '2026-07-31',
      status: 'ACTIVE',
    });

    expect(coursesService.updateCourse).toHaveBeenCalledWith(10, 79, {
      title: undefined,
      courseCode: undefined,
      description: undefined,
      level: 'Cấp độ 1',
      status: 'ACTIVE',
    });
    expect(result).toEqual(expect.objectContaining({ id: 79 }));
  });

  it('assign_teacher_to_course gọi service gán GV cho cả khóa', async () => {
    coursesService.assignTeacherToCourseClasses.mockResolvedValue({
      id: 10,
      courseId: 10,
      teacherName: 'Hoàng Anh Tuấn',
      totalActiveClasses: 2,
      updated: [
        { classId: 5, classTitle: 'IELTS tối' },
        { classId: 6, classTitle: 'IELTS cuối tuần' },
      ],
    });

    const result: any = await service.execute(
      1,
      actor,
      'assign_teacher_to_course',
      { courseId: 10, teacherName: 'Hoàng Anh Tuấn' },
    );

    expect(coursesService.assignTeacherToCourseClasses).toHaveBeenCalledWith(
      10,
      10,
      'Hoàng Anh Tuấn',
    );
    expect(result.updated).toHaveLength(2);
  });

  it('khóa không có lớp ACTIVE thì báo COURSE_HAS_NO_ACTIVE_CLASS', async () => {
    const noClass: any = new Error('no active class');
    noClass.response = { code: 'COURSE_HAS_NO_ACTIVE_CLASS' };
    coursesService.enrollStudentToAllActiveClasses.mockRejectedValue(noClass);

    await expect(
      service.execute(1, actor, 'assign_student_to_course', {
        userId: 1,
        courseId: 10,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'COURSE_HAS_NO_ACTIVE_CLASS',
      }),
    });
  });

  it('bulk userIds: ghi danh từng người vào cả khóa, partial success', async () => {
    coursesService.enrollStudentToAllActiveClasses
      .mockResolvedValueOnce({
        id: 55,
        userId: 1,
        courseId: 10,
        user: { id: 1, fullName: 'A' },
        enrolled: [{ classId: 5, classTitle: 'IELTS tối', enrollmentId: 55 }],
        skippedExisting: [],
      })
      .mockRejectedValueOnce(
        Object.assign(new Error('already'), {
          response: { code: 'STUDENT_ALREADY_ASSIGNED_TO_COURSE' },
        }),
      );

    const result: any = await service.execute(
      1,
      actor,
      'assign_student_to_course',
      { userIds: [1, 2], courseId: 10 },
    );

    expect(
      coursesService.enrollStudentToAllActiveClasses,
    ).toHaveBeenCalledTimes(2);
    expect(result.bulk).toBe(true);
    expect(result.total).toBe(2);
    expect(result.successCount).toBe(1);
    expect(result.items[0]).toEqual(
      expect.objectContaining({ userId: 1, status: 'SUCCESS' }),
    );
    // Lỗi conflict từ hàm ghi danh không phải ConflictException instance ->
    // vẫn ERROR dòng đó, không làm hỏng người khác.
    expect(result.items[1].userId).toBe(2);
    expect(['ALREADY_IN_COURSE', 'ERROR']).toContain(result.items[1].status);
  });
});
