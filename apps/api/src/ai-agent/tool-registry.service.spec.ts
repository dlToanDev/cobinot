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
      findClassesForCourse: jest.fn(),
      createClass: jest.fn(),
      addStudentToClass: jest.fn(),
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

  it('chặn khi học viên đã ghi danh khóa (STUDENT_ALREADY_ASSIGNED_TO_COURSE)', async () => {
    enrollmentsService.findByStudentAndCourse.mockResolvedValue({ id: 99 });

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

    expect(coursesService.addStudentToClass).not.toHaveBeenCalled();
  });

  it('khóa có đúng 1 lớp ACTIVE thì gọi addStudentToClass với classId đó', async () => {
    coursesService.findClassesForCourse.mockResolvedValue([
      { id: 5, status: 'ACTIVE', title: 'IELTS tối' },
    ]);
    coursesService.addStudentToClass.mockResolvedValue({
      id: 55,
      roleInClass: 'STUDENT',
      user: { id: 1, fullName: 'A' },
      courseClass: { id: 5, course: { id: 10 } },
    });

    const result = await service.execute(1, actor, 'assign_student_to_course', {
      userId: 1,
      courseId: 10,
    });

    expect(coursesService.addStudentToClass).toHaveBeenCalledWith(
      10,
      5,
      expect.objectContaining({ userId: 1 }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        studentId: 1,
        courseId: 10,
        classId: 5,
        enrollmentId: 55,
      }),
    );
  });

  it('assign_student_to_course truyền expireDate/allowLatePayment/note xuống ClassEnrollment', async () => {
    coursesService.findClassesForCourse.mockResolvedValue([
      { id: 5, status: 'ACTIVE', title: 'IELTS tối' },
    ]);
    coursesService.addStudentToClass.mockResolvedValue({
      id: 56,
      roleInClass: 'STUDENT',
      expireDate: new Date('2026-12-31'),
      allowLatePayment: true,
      note: 'Học viên chuyển từ lớp cũ',
      user: { id: 1, fullName: 'A' },
      courseClass: { id: 5, course: { id: 10 } },
    });

    const result = await service.execute(1, actor, 'assign_student_to_course', {
      userId: 1,
      courseId: 10,
      expireDate: '2026-12-31',
      allowLatePayment: true,
      note: 'Học viên chuyển từ lớp cũ',
    });

    expect(coursesService.addStudentToClass).toHaveBeenCalledWith(
      10,
      5,
      expect.objectContaining({
        userId: 1,
        expireDate: '2026-12-31',
        allowLatePayment: true,
        note: 'Học viên chuyển từ lớp cũ',
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        expireDate: new Date('2026-12-31'),
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

  it('khóa có nhiều lớp ACTIVE thì báo COURSE_HAS_MULTIPLE_CLASSES', async () => {
    coursesService.findClassesForCourse.mockResolvedValue([
      { id: 5, status: 'ACTIVE', title: 'IELTS tối' },
      { id: 6, status: 'ACTIVE', title: 'IELTS cuối tuần' },
    ]);

    await expect(
      service.execute(1, actor, 'assign_student_to_course', {
        userId: 1,
        courseId: 10,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'COURSE_HAS_MULTIPLE_CLASSES',
      }),
    });

    expect(coursesService.addStudentToClass).not.toHaveBeenCalled();
  });

  it('khóa không có lớp ACTIVE thì báo COURSE_HAS_NO_ACTIVE_CLASS', async () => {
    coursesService.findClassesForCourse.mockResolvedValue([
      { id: 5, status: 'CLOSED', title: 'IELTS cũ' },
    ]);

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

  it('có classId cụ thể thì ghi danh thẳng lớp đó, không cần tìm lớp', async () => {
    coursesService.addStudentToClass.mockResolvedValue({
      id: 77,
      roleInClass: 'STUDENT',
      user: { id: 1 },
      courseClass: { id: 6, course: { id: 10 } },
    });

    const result = await service.execute(1, actor, 'assign_student_to_course', {
      userId: 1,
      courseId: 10,
      classId: 6,
    });

    expect(coursesService.findClassesForCourse).not.toHaveBeenCalled();
    expect(coursesService.addStudentToClass).toHaveBeenCalledWith(
      10,
      6,
      expect.objectContaining({ userId: 1 }),
    );
    expect(result).toEqual(expect.objectContaining({ classId: 6 }));
  });
});
