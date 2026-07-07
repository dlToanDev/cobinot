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
      },
      classSession: {
        createMany: jest.fn(),
      },
      classEnrollment: {
        deleteMany: jest.fn(),
        create: jest.fn(),
        findFirst: jest.fn(),
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

    it('should store startDate/expireDate as Date objects', async () => {
      prisma.course.findMany.mockResolvedValue([]);
      prisma.course.create.mockResolvedValue({
        id: 1,
        tenantId: 10,
        title: 'Ielts 6.5',
        courseCode: 'IELTS_6_5',
      });

      await service.createCourse(10, {
        title: 'IELTS 6.5',
        startDate: '2026-07-10',
        expireDate: '2026-09-10',
      });

      expect(prisma.course.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          startDate: new Date('2026-07-10'),
          expireDate: new Date('2026-09-10'),
        }),
      });
    });

    it('should store null dates when not provided', async () => {
      prisma.course.findMany.mockResolvedValue([]);
      prisma.course.create.mockResolvedValue({ id: 1 });

      await service.createCourse(10, { title: 'Toán 12' });

      expect(prisma.course.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          startDate: null,
          expireDate: null,
        }),
      });
    });

    it('should throw COURSE_INVALID_DATE_RANGE when expireDate before startDate', async () => {
      prisma.course.findMany.mockResolvedValue([]);

      await expect(
        service.createCourse(10, {
          title: 'IELTS 6.5',
          startDate: '2026-09-10',
          expireDate: '2026-07-10',
        }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'COURSE_INVALID_DATE_RANGE',
        }),
      });

      expect(prisma.course.create).not.toHaveBeenCalled();
    });

    it('should throw COURSE_INVALID_DATE for unparseable date', async () => {
      prisma.course.findMany.mockResolvedValue([]);

      await expect(
        service.createCourse(10, {
          title: 'IELTS 6.5',
          startDate: 'abc',
        }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'COURSE_INVALID_DATE',
        }),
      });

      expect(prisma.course.create).not.toHaveBeenCalled();
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
      expect(result).toEqual(expect.objectContaining({ sessions: [] }));
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
});
