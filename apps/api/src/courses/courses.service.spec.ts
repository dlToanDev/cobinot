import { BadRequestException } from '@nestjs/common';
import { CoursesService } from './courses.service';

describe('CoursesService', () => {
  let service: CoursesService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      course: {
        count: jest.fn(),
        create: jest.fn(),
        deleteMany: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
      },
      courseClass: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        delete: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      classSession: {
        createMany: jest.fn(),
      },
      classEnrollment: {
        deleteMany: jest.fn(),
        create: jest.fn(),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      user: {
        findFirst: jest.fn(),
      },
      userCourse: {
        deleteMany: jest.fn(),
      },
      $transaction: jest.fn((arg) =>
        typeof arg === 'function' ? arg(prisma) : Promise.all(arg),
      ),
    };
    service = new CoursesService(prisma);
  });

  it('should reject bulk delete without ids or all flag', async () => {
    await expect(service.deleteCourses(10, {})).rejects.toThrow(
      BadRequestException,
    );
  });

  it('should delete selected courses and their enrollments inside tenant', async () => {
    prisma.course.count.mockResolvedValue(2);
    prisma.classEnrollment.deleteMany.mockResolvedValue({ count: 4 });
    prisma.userCourse.deleteMany.mockResolvedValue({ count: 1 });
    prisma.course.deleteMany.mockResolvedValue({ count: 2 });

    const result = await service.deleteCourses(10, { ids: [3, 4] });

    expect(prisma.course.count).toHaveBeenCalledWith({
      where: { tenantId: 10, id: { in: [3, 4] } },
    });
    expect(prisma.classEnrollment.deleteMany).toHaveBeenCalledWith({
      where: {
        courseClass: { tenantId: 10, courseId: { in: [3, 4] } },
      },
    });
    expect(prisma.userCourse.deleteMany).toHaveBeenCalledWith({
      where: {
        course: { tenantId: 10, id: { in: [3, 4] } },
      },
    });
    expect(prisma.course.deleteMany).toHaveBeenCalledWith({
      where: { tenantId: 10, id: { in: [3, 4] } },
    });
    expect(result).toEqual({
      deletedCount: 2,
      enrollmentDeletedCount: 5,
      requestedCount: 2,
      all: false,
    });
  });

  describe('createCourse', () => {
    it('should generate courseCode from Vietnamese course title when omitted', async () => {
      prisma.course.findMany.mockResolvedValue([]);
      prisma.course.create.mockResolvedValue({
        id: 1,
        tenantId: 10,
        title: 'Toán 12',
        courseCode: 'TOAN_12',
      });

      const result = await service.createCourse(10, { title: 'Toán 12' });

      expect(prisma.course.findMany).toHaveBeenCalledWith({
        where: {
          tenantId: 10,
          courseCode: { startsWith: 'TOAN_12' },
        },
        select: { courseCode: true },
      });
      expect(prisma.course.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: 10,
          title: 'Toán 12',
          courseCode: 'TOAN_12',
        }),
      });
      expect(result.courseCode).toBe('TOAN_12');
    });

    it('should keep grade number when generating duplicate courseCode', async () => {
      prisma.course.findMany.mockResolvedValue([{ courseCode: 'TOAN_12' }]);
      prisma.course.create.mockResolvedValue({
        id: 2,
        tenantId: 10,
        title: 'Toán 12',
        courseCode: 'TOAN_12_2',
      });

      await service.createCourse(10, { title: 'Toán 12' });

      expect(prisma.course.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          courseCode: 'TOAN_12_2',
        }),
      });
    });

    it('should not store any start/expire dates (dates belong to classes)', async () => {
      prisma.course.findMany.mockResolvedValue([]);
      prisma.course.create.mockResolvedValue({ id: 1 });

      await service.createCourse(10, { title: 'Toán 12' });

      const data = prisma.course.create.mock.calls[0][0].data;
      expect(data).not.toHaveProperty('startDate');
      expect(data).not.toHaveProperty('expireDate');
    });
  });

  describe('createClass', () => {
    const courseMock = {
      id: 1,
      tenantId: 10,
      title: 'IELTS 6.5',
      courseCode: 'IELTS_6_5',
    };
    const classMock = {
      id: 5,
      tenantId: 10,
      courseId: 1,
      classCode: 'IELTS_6_5_EVENING_A_WEEKLY',
      title: 'Evening A',
      type: 'WEEKLY',
      course: courseMock,
    };

    it('should create class and auto-generate classCode without sessions', async () => {
      prisma.course.findFirst.mockResolvedValue(courseMock);
      prisma.courseClass.findFirst.mockResolvedValue(null);
      prisma.courseClass.create.mockResolvedValue(classMock);

      const result = await service.createClass(10, {
        courseId: 1,
        title: 'Evening A',
        type: 'WEEKLY',
      });

      expect(prisma.course.findFirst).toHaveBeenCalledWith({
        where: { id: 1, tenantId: 10 },
      });
      expect(prisma.courseClass.findFirst).toHaveBeenCalledWith({
        where: {
          tenantId: 10,
          classCode: 'IELTS_6_5_EVENING_A_WEEKLY',
        },
        select: { id: true },
      });
      expect(prisma.courseClass.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            classCode: 'IELTS_6_5_EVENING_A_WEEKLY',
            title: 'Evening A',
            type: 'WEEKLY',
          }),
        }),
      );
      expect(prisma.classSession.createMany).not.toHaveBeenCalled();
      expect(prisma.classEnrollment.create).not.toHaveBeenCalled();
      // Khóa chưa có học viên -> không auto-enroll ai.
      expect(prisma.classEnrollment.createMany).not.toHaveBeenCalled();
      expect(result).toEqual(
        expect.objectContaining({ sessions: [], autoEnrolledCount: 0 }),
      );
    });

    it('không ghi ngày bắt đầu -> mặc định là HÔM NAY (ngày tạo lớp)', async () => {
      prisma.course.findFirst.mockResolvedValue(courseMock);
      prisma.courseClass.findFirst.mockResolvedValue(null);
      prisma.courseClass.create.mockResolvedValue(classMock);

      await service.createClass(10, {
        courseId: 1,
        title: 'Evening A',
        type: 'WEEKLY',
      });

      const createArg = prisma.courseClass.create.mock.calls[0][0];
      expect(createArg.data.startDate).toBeInstanceOf(Date);
      const today = new Date();
      expect(createArg.data.startDate.toDateString()).toBe(
        today.toDateString(),
      );
      expect(createArg.data.endDate).toBeNull();
    });

    it('ghi rõ ngày bắt đầu -> dùng đúng ngày đó, không bị đè bằng hôm nay', async () => {
      prisma.course.findFirst.mockResolvedValue(courseMock);
      prisma.courseClass.findFirst.mockResolvedValue(null);
      prisma.courseClass.create.mockResolvedValue(classMock);

      await service.createClass(10, {
        courseId: 1,
        title: 'Evening A',
        type: 'WEEKLY',
        startDate: '2026-08-01',
        endDate: '2026-10-01',
      });

      const createArg = prisma.courseClass.create.mock.calls[0][0];
      expect(createArg.data.startDate).toEqual(new Date('2026-08-01'));
      expect(createArg.data.endDate).toEqual(new Date('2026-10-01'));
    });

    it('không ghi ngày bắt đầu nhưng ngày kết thúc TRƯỚC hôm nay -> báo lỗi', async () => {
      prisma.course.findFirst.mockResolvedValue(courseMock);
      prisma.courseClass.findFirst.mockResolvedValue(null);

      await expect(
        service.createClass(10, {
          courseId: 1,
          title: 'Evening A',
          type: 'WEEKLY',
          endDate: '2020-01-01',
        }),
      ).rejects.toThrow('Ngày kết thúc không được trước ngày bắt đầu');
      expect(prisma.courseClass.create).not.toHaveBeenCalled();
    });

    it('tạo lớp mới -> TỰ ĐỘNG thêm học viên đang có trong khóa vào lớp (khử trùng userId)', async () => {
      prisma.course.findFirst.mockResolvedValue(courseMock);
      prisma.courseClass.findFirst.mockResolvedValue(null);
      prisma.courseClass.create.mockResolvedValue(classMock);
      // Học viên #3 học 2 lớp trong khóa -> chỉ được thêm 1 lần vào lớp mới.
      prisma.classEnrollment.findMany.mockResolvedValue([
        { userId: 3 },
        { userId: 3 },
        { userId: 7 },
      ]);
      prisma.classEnrollment.createMany.mockResolvedValue({ count: 2 });

      const result = await service.createClass(10, {
        courseId: 1,
        title: 'Evening A',
        type: 'WEEKLY',
      });

      expect(prisma.classEnrollment.findMany).toHaveBeenCalledWith({
        where: {
          roleInClass: 'STUDENT',
          courseClass: { tenantId: 10, courseId: 1 },
        },
        select: { userId: true },
      });
      expect(prisma.classEnrollment.createMany).toHaveBeenCalledWith({
        data: [
          { userId: 3, classId: classMock.id, roleInClass: 'STUDENT' },
          { userId: 7, classId: classMock.id, roleInClass: 'STUDENT' },
        ],
        skipDuplicates: true,
      });
      expect(result).toEqual(
        expect.objectContaining({ autoEnrolledCount: 2, studentCount: 2 }),
      );
    });

    it('should create class sessions when provided', async () => {
      prisma.course.findFirst.mockResolvedValue(courseMock);
      prisma.courseClass.findFirst.mockResolvedValue(null);
      prisma.courseClass.create.mockResolvedValue(classMock);
      prisma.classSession.createMany.mockResolvedValue({ count: 3 });

      const sessions = [
        {
          title: 'Buổi học thứ 2',
          dayOfWeek: 2,
          startTime: '19:00',
          endTime: '21:00',
          room: 'A1',
        },
      ];

      const result = await service.createClass(10, {
        courseId: 1,
        title: 'Evening A',
        type: 'WEEKLY',
        sessions,
      });

      expect(prisma.classSession.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            classId: classMock.id,
            title: 'Buổi học thứ 2',
            dayOfWeek: 2,
            startTime: '19:00',
            endTime: '21:00',
            room: 'A1',
            status: 'SCHEDULED',
          }),
        ],
      });
      expect(result).toEqual(expect.objectContaining({ sessions }));
    });

    it('should generate EXAM_PRACTICE classCode from title and type', async () => {
      prisma.course.findFirst.mockResolvedValue(courseMock);
      prisma.courseClass.findFirst.mockResolvedValue(null);
      prisma.courseClass.create.mockResolvedValue({
        ...classMock,
        classCode: 'IELTS_6_5_LUYEN_DE_THANG_8_EXAM_PRACTICE',
        title: 'Luyện Đề Tháng 8',
        type: 'EXAM_PRACTICE',
      });

      await service.createClass(10, {
        courseId: 1,
        title: 'luyện đề tháng 8',
        type: 'EXAM_PRACTICE',
      });

      expect(prisma.courseClass.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            classCode: 'IELTS_6_5_LUYEN_DE_THANG_8_EXAM_PRACTICE',
            type: 'EXAM_PRACTICE',
          }),
        }),
      );
    });

    it('should append suffix when generated classCode already exists', async () => {
      prisma.course.findFirst.mockResolvedValue(courseMock);
      prisma.courseClass.findFirst
        .mockResolvedValueOnce({ id: 99 })
        .mockResolvedValueOnce(null);
      prisma.courseClass.create.mockResolvedValue({
        ...classMock,
        classCode: 'IELTS_6_5_EVENING_A_WEEKLY_2',
      });

      await service.createClass(10, {
        courseId: 1,
        title: 'Evening A',
        type: 'WEEKLY',
      });

      expect(prisma.courseClass.findFirst).toHaveBeenNthCalledWith(2, {
        where: {
          tenantId: 10,
          classCode: 'IELTS_6_5_EVENING_A_WEEKLY_2',
        },
        select: { id: true },
      });
      expect(prisma.courseClass.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            classCode: 'IELTS_6_5_EVENING_A_WEEKLY_2',
          }),
        }),
      );
    });

    it('should reject invalid class type', async () => {
      prisma.course.findFirst.mockResolvedValue(courseMock);

      await expect(
        service.createClass(10, {
          courseId: 1,
          title: 'Evening A',
          type: 'PRACTICE',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.courseClass.create).not.toHaveBeenCalled();
      expect(prisma.classSession.createMany).not.toHaveBeenCalled();
    });

    it('chặn 2 lớp trùng tên trong CÙNG khóa + CÙNG loại (không dấu, hoa thường)', async () => {
      prisma.course.findFirst.mockResolvedValue(courseMock);
      prisma.courseClass.findMany.mockResolvedValue([
        { id: 7, title: 'Toán 3' },
      ]);

      await expect(
        service.createClass(10, {
          courseId: 1,
          title: 'toan 3',
          type: 'WEEKLY',
        }),
      ).rejects.toThrow('không được trùng tên');
      expect(prisma.courseClass.create).not.toHaveBeenCalled();
    });

    it('cho phép trùng tên khi KHÁC loại lớp (query lọc theo type)', async () => {
      prisma.course.findFirst.mockResolvedValue(courseMock);
      // Lớp "Toán 3" WEEKLY đã tồn tại nhưng query lọc type=EXAM_PRACTICE nên
      // không trả về -> vẫn tạo được lớp luyện đề cùng tên.
      prisma.courseClass.findMany.mockResolvedValue([]);
      prisma.courseClass.findFirst.mockResolvedValue(null);
      prisma.courseClass.create.mockResolvedValue(classMock);

      await service.createClass(10, {
        courseId: 1,
        title: 'Toán 3',
        type: 'EXAM_PRACTICE',
      });

      expect(prisma.courseClass.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            courseId: 1,
            type: 'EXAM_PRACTICE',
          }),
        }),
      );
      expect(prisma.courseClass.create).toHaveBeenCalled();
    });

    it('should keep backward compatible controller signature', async () => {
      prisma.course.findFirst.mockResolvedValue(courseMock);
      prisma.courseClass.findFirst.mockResolvedValue(null);
      prisma.courseClass.create.mockResolvedValue(classMock);

      await service.createClass(10, 1, {
        title: 'Evening A',
        type: 'WEEKLY',
      });

      expect(prisma.courseClass.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            courseId: 1,
          }),
        }),
      );
    });
  });

  describe('updateClass', () => {
    const classMock = {
      id: 5,
      tenantId: 10,
      courseId: 1,
      classCode: 'IELTS_6_5_EVENING_A_WEEKLY',
      title: 'Evening A',
      type: 'WEEKLY',
      startDate: null,
      endDate: null,
      course: { id: 1, tenantId: 10, title: 'IELTS 6.5' },
    };

    beforeEach(() => {
      prisma.courseClass.update = jest.fn();
    });

    it('should move class to another course inside the same tenant', async () => {
      prisma.courseClass.findFirst.mockResolvedValue(classMock);
      prisma.course.findFirst.mockResolvedValue({ id: 2, tenantId: 10 });
      prisma.courseClass.update.mockResolvedValue({
        ...classMock,
        courseId: 2,
      });

      await service.updateClass(10, 5, { courseId: 2 });

      expect(prisma.course.findFirst).toHaveBeenCalledWith({
        where: { id: 2, tenantId: 10 },
      });
      expect(prisma.courseClass.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ courseId: 2 }),
        }),
      );
    });

    it('should reject moving class to a course of another tenant', async () => {
      prisma.courseClass.findFirst.mockResolvedValue(classMock);
      prisma.course.findFirst.mockResolvedValue(null);

      await expect(
        service.updateClass(10, 5, { courseId: 99 }),
      ).rejects.toThrow(
        'Khóa học không tồn tại hoặc không thuộc trung tâm này',
      );
      expect(prisma.courseClass.update).not.toHaveBeenCalled();
    });

    it('should not touch courseId when unchanged', async () => {
      prisma.courseClass.findFirst.mockResolvedValue(classMock);
      prisma.courseClass.update.mockResolvedValue(classMock);

      await service.updateClass(10, 5, { courseId: 1, title: 'Evening B' });

      expect(prisma.course.findFirst).not.toHaveBeenCalled();
      expect(prisma.courseClass.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ courseId: undefined }),
        }),
      );
    });

    it('đổi loại lớp -> tự sinh lại classCode theo loại mới', async () => {
      prisma.courseClass.findFirst
        .mockResolvedValueOnce(classMock) // findOneClass
        .mockResolvedValue(null); // generateUniqueClassCode + ensureUniqueClassCode
      prisma.courseClass.findMany.mockResolvedValue([]);
      prisma.courseClass.update.mockResolvedValue({
        ...classMock,
        type: 'EXAM_PRACTICE',
      });

      await service.updateClass(10, 5, { type: 'EXAM_PRACTICE' });

      expect(prisma.courseClass.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'EXAM_PRACTICE',
            classCode: 'IELTS_6_5_EVENING_A_EXAM_PRACTICE',
          }),
        }),
      );
    });

    it('đổi loại kèm classCode CŨ gửi lại nguyên vẹn (form) -> vẫn tự sinh mã mới theo loại', async () => {
      prisma.courseClass.findFirst
        .mockResolvedValueOnce(classMock)
        .mockResolvedValue(null);
      prisma.courseClass.findMany.mockResolvedValue([]);
      prisma.courseClass.update.mockResolvedValue({
        ...classMock,
        type: 'EXAM_PRACTICE',
      });

      await service.updateClass(10, 5, {
        type: 'EXAM_PRACTICE',
        classCode: 'IELTS_6_5_EVENING_A_WEEKLY',
      });

      expect(prisma.courseClass.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            classCode: 'IELTS_6_5_EVENING_A_EXAM_PRACTICE',
          }),
        }),
      );
    });

    it('đổi tên lớp trùng với lớp khác cùng khóa + cùng loại -> ConflictException', async () => {
      prisma.courseClass.findFirst.mockResolvedValue(classMock);
      prisma.courseClass.findMany.mockResolvedValue([
        { id: 9, title: 'Evening B' },
      ]);

      await expect(
        service.updateClass(10, 5, { title: 'evening b' }),
      ).rejects.toThrow('không được trùng tên');
      expect(prisma.courseClass.update).not.toHaveBeenCalled();
    });
  });

  describe('assignTeacherToCourseClasses (GV cầm cả khóa)', () => {
    beforeEach(() => {
      prisma.course.findFirst.mockResolvedValue({
        id: 10,
        title: 'IELTS',
        status: 'ACTIVE',
      });
    });

    it('set teacherName cho TẤT CẢ lớp ACTIVE của khóa (chuẩn hóa tên)', async () => {
      prisma.courseClass.findMany.mockResolvedValue([
        { id: 5, title: 'Lớp A', teacherName: null },
        { id: 6, title: 'Lớp B', teacherName: 'Cũ Nào Đó' },
      ]);
      prisma.courseClass.updateMany.mockResolvedValue({ count: 2 });

      const result = await service.assignTeacherToCourseClasses(
        10,
        10,
        'hoàng anh tuấn',
      );

      expect(prisma.courseClass.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: 10, courseId: 10, status: 'ACTIVE' },
        }),
      );
      expect(prisma.courseClass.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [5, 6] } },
        data: { teacherName: 'Hoàng Anh Tuấn' },
      });
      expect(result.teacherName).toBe('Hoàng Anh Tuấn');
      expect(result.updated).toEqual([
        expect.objectContaining({ classId: 5, previousTeacherName: null }),
        expect.objectContaining({
          classId: 6,
          previousTeacherName: 'Cũ Nào Đó',
        }),
      ]);
    });

    it('khóa 0 lớp ACTIVE -> COURSE_HAS_NO_ACTIVE_CLASS, không update gì', async () => {
      prisma.courseClass.findMany.mockResolvedValue([]);

      await expect(
        service.assignTeacherToCourseClasses(10, 10, 'Hoàng Anh'),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'COURSE_HAS_NO_ACTIVE_CLASS',
        }),
      });
      expect(prisma.courseClass.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('enrollStudentToAllActiveClasses (ghi danh cả khóa)', () => {
    const activeCourse = {
      id: 10,
      title: 'IELTS',
      courseCode: 'IELTS',
      status: 'ACTIVE',
    };
    const student = { id: 1, tenantId: 10, role: 'STUDENT', fullName: 'An' };

    beforeEach(() => {
      prisma.classEnrollment.findMany = jest.fn();
      prisma.course.findFirst.mockResolvedValue(activeCourse);
      prisma.user.findFirst.mockResolvedValue(student);
    });

    it('ghi đủ N lớp ACTIVE (chỉ query lớp ACTIVE của khóa)', async () => {
      prisma.courseClass.findMany.mockResolvedValue([
        { id: 5, title: 'Lớp A', classCode: 'A', type: 'WEEKLY' },
        { id: 6, title: 'Lớp B', classCode: 'B', type: 'WEEKLY' },
      ]);
      prisma.classEnrollment.findMany.mockResolvedValue([]);
      // addStudentToClass nội bộ: findOneClass + check trùng + create.
      prisma.courseClass.findFirst
        .mockResolvedValueOnce({ id: 5, status: 'ACTIVE', title: 'Lớp A' })
        .mockResolvedValueOnce({ id: 6, status: 'ACTIVE', title: 'Lớp B' });
      prisma.classEnrollment.findFirst.mockResolvedValue(null);
      prisma.classEnrollment.create
        .mockResolvedValueOnce({ id: 100, roleInClass: 'STUDENT' })
        .mockResolvedValueOnce({ id: 101, roleInClass: 'STUDENT' });

      const result = await service.enrollStudentToAllActiveClasses(10, 10, 1);

      expect(prisma.courseClass.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: 10, courseId: 10, status: 'ACTIVE' },
        }),
      );
      expect(prisma.classEnrollment.create).toHaveBeenCalledTimes(2);
      expect(result.enrolled).toHaveLength(2);
      expect(result.skippedExisting).toHaveLength(0);
      expect(result.totalActiveClasses).toBe(2);
      expect(result.id).toBe(100);
    });

    it('skip lớp học viên đã có sẵn, vẫn ghi lớp còn lại', async () => {
      prisma.courseClass.findMany.mockResolvedValue([
        { id: 5, title: 'Lớp A' },
        { id: 6, title: 'Lớp B' },
      ]);
      // Đã có mặt ở lớp 5.
      prisma.classEnrollment.findMany.mockResolvedValue([{ classId: 5 }]);
      prisma.courseClass.findFirst.mockResolvedValue({
        id: 6,
        status: 'ACTIVE',
        title: 'Lớp B',
      });
      prisma.classEnrollment.findFirst.mockResolvedValue(null);
      prisma.classEnrollment.create.mockResolvedValue({
        id: 101,
        roleInClass: 'STUDENT',
      });

      const result = await service.enrollStudentToAllActiveClasses(10, 10, 1);

      expect(prisma.classEnrollment.create).toHaveBeenCalledTimes(1);
      expect(result.enrolled.map((cls: any) => cls.classId)).toEqual([6]);
      expect(result.skippedExisting.map((cls: any) => cls.classId)).toEqual([
        5,
      ]);
    });

    it('đã có mặt ở TẤT CẢ lớp ACTIVE -> STUDENT_ALREADY_ASSIGNED_TO_COURSE', async () => {
      prisma.courseClass.findMany.mockResolvedValue([
        { id: 5, title: 'Lớp A' },
        { id: 6, title: 'Lớp B' },
      ]);
      prisma.classEnrollment.findMany.mockResolvedValue([
        { classId: 5 },
        { classId: 6 },
      ]);

      await expect(
        service.enrollStudentToAllActiveClasses(10, 10, 1),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'STUDENT_ALREADY_ASSIGNED_TO_COURSE',
        }),
      });
      expect(prisma.classEnrollment.create).not.toHaveBeenCalled();
    });

    it('khóa 0 lớp ACTIVE -> COURSE_HAS_NO_ACTIVE_CLASS (không auto-tạo lớp default)', async () => {
      prisma.courseClass.findMany.mockResolvedValue([]);

      await expect(
        service.enrollStudentToAllActiveClasses(10, 10, 1),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'COURSE_HAS_NO_ACTIVE_CLASS',
        }),
      });
      expect(prisma.courseClass.create).not.toHaveBeenCalled();
    });

    it('khóa không ACTIVE -> COURSE_NOT_ACTIVE', async () => {
      prisma.course.findFirst.mockResolvedValue({
        ...activeCourse,
        status: 'CLOSED',
      });

      await expect(
        service.enrollStudentToAllActiveClasses(10, 10, 1),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'COURSE_NOT_ACTIVE' }),
      });
    });

    it('user không phải học viên (roleInClass STUDENT) -> BadRequest', async () => {
      prisma.user.findFirst.mockResolvedValue({
        ...student,
        role: 'TEACHER',
      });

      await expect(
        service.enrollStudentToAllActiveClasses(10, 10, 1),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
