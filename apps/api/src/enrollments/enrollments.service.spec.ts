import { Test, TestingModule } from '@nestjs/testing';
import { EnrollmentsService } from './enrollments.service';
import { PrismaService } from '../prisma/prisma.service';
import { CoursesService } from '../courses/courses.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('EnrollmentsService', () => {
  let service: EnrollmentsService;
  let prisma: PrismaService;

  const mockPrismaService = {
    user: {
      findFirst: jest.fn(),
    },
    course: {
      findFirst: jest.fn(),
    },
    courseClass: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    classEnrollment: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    userCourse: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };

  const mockCoursesService = {
    enrollStudentToAllActiveClasses: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EnrollmentsService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: CoursesService,
          useValue: mockCoursesService,
        },
      ],
    }).compile();

    service = module.get<EnrollmentsService>(EnrollmentsService);
    prisma = module.get<PrismaService>(PrismaService);

    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('should return all enrollments for a given tenant', async () => {
      const mockClassEnrollments = [
        {
          id: 1,
          userId: 2,
          classId: 4,
          roleInClass: 'STUDENT',
          joinedAt: new Date(),
          endedAt: null,
          createdAt: new Date(),
          user: { id: 2, tenantId: 1 },
          courseClass: {
            id: 4,
            courseId: 3,
            course: { id: 3 },
          },
        },
      ];
      mockPrismaService.classEnrollment.findMany.mockResolvedValue(
        mockClassEnrollments,
      );

      const result = await service.findAll(1, {});

      expect(prisma.classEnrollment.findMany).toHaveBeenCalledWith({
        where: {
          user: {
            tenantId: 1,
          },
        },
        include: {
          user: true,
          courseClass: {
            include: {
              course: true,
            },
          },
        },
        orderBy: {
          joinedAt: 'desc',
        },
      });
      expect(result).toEqual([
        {
          id: 1,
          userId: 2,
          courseId: 3,
          classId: 4,
          className: null,
          roleInCourse: 'STUDENT',
          joinedAt: mockClassEnrollments[0].joinedAt,
          endedAt: null,
          createdAt: mockClassEnrollments[0].createdAt,
          user: { id: 2, tenantId: 1 },
          course: { id: 3 },
        },
      ]);
    });

    it('should filter by courseId and keyword if provided', async () => {
      mockPrismaService.classEnrollment.findMany.mockResolvedValue([]);

      await service.findAll(1, { courseId: 10, keyword: 'John' });

      expect(prisma.classEnrollment.findMany).toHaveBeenCalledWith({
        where: {
          user: {
            tenantId: 1,
          },
          courseClass: {
            courseId: 10,
          },
          OR: [
            { user: { fullName: { contains: 'John', mode: 'insensitive' } } },
            { user: { email: { contains: 'John', mode: 'insensitive' } } },
            { user: { phone: { contains: 'John', mode: 'insensitive' } } },
            {
              courseClass: {
                course: { title: { contains: 'John', mode: 'insensitive' } },
              },
            },
            {
              courseClass: {
                course: {
                  courseCode: { contains: 'John', mode: 'insensitive' },
                },
              },
            },
          ],
        },
        include: {
          user: true,
          courseClass: {
            include: {
              course: true,
            },
          },
        },
        orderBy: {
          joinedAt: 'desc',
        },
      });
    });
  });

  describe('create', () => {
    const dto = {
      userId: 2,
      courseId: 3,
      roleInCourse: 'STUDENT',
      joinedAt: '2026-06-16T00:00:00.000Z',
      endDate: '2026-07-16T00:00:00.000Z',
    };

    it('ghi danh qua hàm dùng chung: vào TẤT CẢ lớp ACTIVE của khóa, response per-class', async () => {
      const perClassResult = {
        id: 100,
        userId: 2,
        studentId: 2,
        courseId: 3,
        user: { id: 2, fullName: 'An' },
        course: { id: 3, title: 'IELTS Course' },
        totalActiveClasses: 2,
        enrolled: [
          { classId: 4, classTitle: 'Lớp A', enrollmentId: 100 },
          { classId: 5, classTitle: 'Lớp B', enrollmentId: 101 },
        ],
        skippedExisting: [],
      };
      mockCoursesService.enrollStudentToAllActiveClasses.mockResolvedValue(
        perClassResult,
      );

      const result = await service.create(1, dto);

      expect(
        mockCoursesService.enrollStudentToAllActiveClasses,
      ).toHaveBeenCalledWith(1, 3, 2, {
        roleInClass: 'STUDENT',
        joinedAt: dto.joinedAt,
        endedAt: dto.endDate,
      });
      expect(result).toEqual(perClassResult);
      // KHÔNG còn auto-create "lớp default" trong EnrollmentsService.
      expect(prisma.courseClass.create).not.toHaveBeenCalled();
      expect(prisma.classEnrollment.create).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException if joinedAt is after endDate', async () => {
      await expect(
        service.create(1, {
          ...dto,
          joinedAt: '2026-08-16T00:00:00.000Z',
          endDate: '2026-07-16T00:00:00.000Z',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(
        mockCoursesService.enrollStudentToAllActiveClasses,
      ).not.toHaveBeenCalled();
    });

    it('propagate lỗi từ hàm dùng chung (vd khóa 0 lớp ACTIVE)', async () => {
      mockCoursesService.enrollStudentToAllActiveClasses.mockRejectedValue(
        new BadRequestException({
          code: 'COURSE_HAS_NO_ACTIVE_CLASS',
          message:
            'Khóa học này chưa có lớp đang hoạt động nên chưa thể ghi danh học viên.',
        }),
      );

      await expect(service.create(1, dto)).rejects.toThrow(BadRequestException);
    });
  });

  describe('remove', () => {
    it('should delete enrollment if it exists and belongs to the tenant', async () => {
      const mockEnrollment = {
        id: 5,
        userId: 2,
        classId: 4,
        roleInClass: 'STUDENT',
        joinedAt: new Date(),
        endedAt: null,
        createdAt: new Date(),
        user: { id: 2, tenantId: 1 },
        courseClass: {
          id: 4,
          courseId: 3,
          course: { id: 3 },
        },
      };
      mockPrismaService.classEnrollment.findFirst.mockResolvedValue(
        mockEnrollment,
      );
      mockPrismaService.classEnrollment.delete.mockResolvedValue(
        mockEnrollment,
      );

      const result = await service.remove(1, 5);

      expect(prisma.classEnrollment.findFirst).toHaveBeenCalledWith({
        where: {
          id: 5,
          user: {
            tenantId: 1,
          },
        },
        include: {
          user: true,
          courseClass: {
            include: {
              course: true,
            },
          },
        },
      });
      expect(prisma.classEnrollment.delete).toHaveBeenCalledWith({
        where: { id: 5 },
      });
      expect(result).toEqual({
        id: 5,
        userId: 2,
        courseId: 3,
        roleInCourse: 'STUDENT',
        joinedAt: mockEnrollment.joinedAt,
        endedAt: null,
        createdAt: mockEnrollment.createdAt,
        user: { id: 2, tenantId: 1 },
        course: { id: 3 },
      });
    });

    it('should throw NotFoundException if enrollment is not found', async () => {
      mockPrismaService.classEnrollment.findFirst.mockResolvedValue(null);

      await expect(service.remove(1, 5)).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should update enrollment role and dates if enrollment belongs to tenant', async () => {
      const existingEnrollment = {
        id: 5,
        userId: 2,
        classId: 4,
        roleInClass: 'STUDENT',
        joinedAt: new Date('2026-06-16T00:00:00.000Z'),
        endedAt: null,
        user: { id: 2, tenantId: 1 },
        courseClass: {
          id: 4,
          courseId: 3,
          course: { id: 3 },
        },
      };
      const dto = {
        roleInCourse: 'CLASS_LEADER',
        joinedAt: '2026-06-20T00:00:00.000Z',
        endDate: '2026-07-20T00:00:00.000Z',
      };
      mockPrismaService.classEnrollment.findFirst.mockResolvedValue(
        existingEnrollment,
      );
      mockPrismaService.classEnrollment.update.mockResolvedValue({
        ...existingEnrollment,
        roleInClass: dto.roleInCourse,
        joinedAt: new Date(dto.joinedAt),
        endedAt: new Date(dto.endDate),
      });

      await service.update(1, 5, dto);

      expect(prisma.classEnrollment.findFirst).toHaveBeenCalledWith({
        where: {
          id: 5,
          user: {
            tenantId: 1,
          },
        },
        include: {
          user: true,
          courseClass: {
            include: {
              course: true,
            },
          },
        },
      });
      expect(prisma.classEnrollment.update).toHaveBeenCalledWith({
        where: { id: 5 },
        data: {
          roleInClass: 'CLASS_LEADER',
          joinedAt: new Date(dto.joinedAt),
          endedAt: new Date(dto.endDate),
        },
      });
    });

    it('should throw BadRequestException if updated joinedAt is after endDate', async () => {
      mockPrismaService.classEnrollment.findFirst.mockResolvedValue({
        id: 5,
        joinedAt: new Date('2026-06-16T00:00:00.000Z'),
        endedAt: null,
      });

      await expect(
        service.update(1, 5, {
          joinedAt: '2026-08-01T00:00:00.000Z',
          endDate: '2026-07-01T00:00:00.000Z',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('removeByStudentAndCourse', () => {
    it('should delete enrollment by student ID and course ID if it exists and belongs to the tenant', async () => {
      const mockEnrollment = {
        id: 5,
        userId: 2,
        classId: 4,
        roleInClass: 'STUDENT',
        joinedAt: new Date(),
        endedAt: null,
        createdAt: new Date(),
        user: { id: 2, tenantId: 1 },
        courseClass: {
          id: 4,
          courseId: 3,
          course: { id: 3 },
        },
      };
      mockPrismaService.classEnrollment.findFirst.mockResolvedValue(
        mockEnrollment,
      );
      mockPrismaService.classEnrollment.delete.mockResolvedValue(
        mockEnrollment,
      );

      const result = await service.removeByStudentAndCourse(1, 2, 3);

      expect(prisma.classEnrollment.findFirst).toHaveBeenCalledWith({
        where: {
          userId: 2,
          courseClass: {
            courseId: 3,
            tenantId: 1,
          },
        },
        include: {
          user: true,
          courseClass: {
            include: {
              course: true,
            },
          },
        },
      });
      expect(prisma.classEnrollment.delete).toHaveBeenCalledWith({
        where: { id: 5 },
      });
      expect(result).toEqual({
        id: 5,
        userId: 2,
        courseId: 3,
        roleInCourse: 'STUDENT',
        joinedAt: mockEnrollment.joinedAt,
        endedAt: null,
        createdAt: mockEnrollment.createdAt,
        user: { id: 2, tenantId: 1 },
        course: { id: 3 },
      });
    });

    it('should throw NotFoundException if enrollment is not found', async () => {
      mockPrismaService.classEnrollment.findFirst.mockResolvedValue(null);

      await expect(service.removeByStudentAndCourse(1, 2, 3)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
