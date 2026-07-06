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
      },
      classEnrollment: {
        deleteMany: jest.fn(),
        create: jest.fn(),
      },
      userCourse: {
        deleteMany: jest.fn(),
      },
      $transaction: jest.fn((queries) => Promise.all(queries)),
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
  });

  describe('createClass', () => {
    const courseMock = {
      id: 1,
      tenantId: 10,
      title: 'Toán 12',
      courseCode: 'TOAN_12',
    };
    const classMock = {
      id: 5,
      tenantId: 10,
      courseId: 1,
      classCode: 'CLASS01',
      title: 'Lớp 1',
    };

    it('should create class successfully without student enrollment', async () => {
      prisma.course.findFirst.mockResolvedValue(courseMock);
      prisma.courseClass.findFirst.mockResolvedValue(null);
      prisma.courseClass.findMany.mockResolvedValue([]);
      prisma.courseClass.create.mockResolvedValue(classMock);

      const result = await service.createClass(10, 1, {
        classCode: 'CLASS01',
        title: 'Lớp 1',
      });

      expect(prisma.course.findFirst).toHaveBeenCalledWith({
        where: { id: 1, tenantId: 10 },
      });
      expect(prisma.courseClass.findMany).toHaveBeenCalledWith({
        where: {
          tenantId: 10,
          courseId: 1,
          title: { startsWith: 'Lớp', mode: 'insensitive' },
        },
        select: { title: true },
      });
      expect(prisma.courseClass.findMany).toHaveBeenCalledWith({
        where: { tenantId: 10, classCode: { startsWith: 'CLASS01' } },
        select: { classCode: true },
      });
      expect(prisma.courseClass.create).toHaveBeenCalled();
      expect(prisma.classEnrollment.create).not.toHaveBeenCalled();
      expect(result).toEqual(classMock);
    });

    it('should create class and immediately enroll a student if enrollStudentId is provided', async () => {
      prisma.course.findFirst.mockResolvedValue(courseMock);
      prisma.courseClass.findFirst.mockResolvedValue(null);
      prisma.courseClass.findMany.mockResolvedValue([]);
      prisma.courseClass.create.mockResolvedValue(classMock);

      const result = await service.createClass(10, 1, {
        classCode: 'CLASS01',
        title: 'Lớp 1',
        enrollStudentId: 42,
      });

      expect(prisma.courseClass.create).toHaveBeenCalled();
      expect(prisma.classEnrollment.create).toHaveBeenCalledWith({
        data: {
          classId: classMock.id,
          userId: 42,
          roleInClass: 'STUDENT',
          status: 'ACTIVE',
        },
      });
      expect(result).toEqual(classMock);
    });

    it('should generate classCode from course code, class title and class type when omitted', async () => {
      prisma.course.findFirst.mockResolvedValue(courseMock);
      prisma.courseClass.findFirst.mockResolvedValue(null);
      prisma.courseClass.findMany.mockResolvedValue([]);
      prisma.courseClass.create.mockResolvedValue({
        ...classMock,
        classCode: 'TOAN_12_MINH_WEEKLY',
        title: 'Minh',
        type: 'WEEKLY',
      });

      await service.createClass(10, 1, {
        title: 'Minh',
        type: 'WEEKLY',
      });

      expect(prisma.courseClass.findMany).toHaveBeenCalledWith({
        where: {
          tenantId: 10,
          classCode: { startsWith: 'TOAN_12_MINH_WEEKLY' },
        },
        select: { classCode: true },
      });
      expect(prisma.courseClass.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            classCode: 'TOAN_12_MINH_WEEKLY',
            title: 'Minh',
            type: 'WEEKLY',
          }),
        }),
      );
    });
  });
});
