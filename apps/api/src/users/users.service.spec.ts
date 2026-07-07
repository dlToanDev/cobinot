import { BadRequestException, ConflictException } from '@nestjs/common';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      user: {
        count: jest.fn(),
        deleteMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      userCourse: {
        deleteMany: jest.fn(),
      },
      classEnrollment: {
        deleteMany: jest.fn(),
      },
      assignmentSubmission: {
        deleteMany: jest.fn(),
      },
      $transaction: jest.fn((queries) => Promise.all(queries)),
    };
    service = new UsersService(prisma);
  });

  it('findDuplicateStudentByEmailOrPhone trả null khi thiếu cả email và phone', async () => {
    const result = await service.findDuplicateStudentByEmailOrPhone(10, {});

    expect(result).toBeNull();
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it('findDuplicateStudentByEmailOrPhone query theo tenant + role STUDENT với email normalize', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 5 });

    const result = await service.findDuplicateStudentByEmailOrPhone(10, {
      email: '  OLD@Test.com ',
      phone: '098 765 4321',
    });

    expect(result).toEqual({ id: 5 });
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: {
        tenantId: 10,
        role: 'STUDENT',
        OR: [{ email: 'old@test.com' }, { phone: '0987654321' }],
      },
    });
  });

  it('createStudent throw ConflictException code STUDENT_DUPLICATE khi trùng', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 5,
      fullName: 'Nguyễn Văn A',
      email: 'old@test.com',
      phone: '0987654321',
    });

    await expect(
      service.createStudent(10, {
        fullName: 'Nguyễn Văn B',
        email: 'old@test.com',
      } as any),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'STUDENT_DUPLICATE',
      }),
    });

    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('createStudent tạo mới khi không trùng', async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ id: 9, fullName: 'Nguyễn Văn B' });

    const result = await service.createStudent(10, {
      fullName: 'Nguyễn Văn B',
      email: 'new@test.com',
    });

    expect(result).toEqual({ id: 9, fullName: 'Nguyễn Văn B' });
    expect(prisma.user.create).toHaveBeenCalled();
  });

  it('should reject bulk delete without ids or all flag', async () => {
    await expect(service.deleteStudents(10, {})).rejects.toThrow(
      BadRequestException,
    );
  });

  it('should delete selected students and their enrollments inside tenant', async () => {
    prisma.user.count.mockResolvedValue(2);
    prisma.assignmentSubmission.deleteMany.mockResolvedValue({ count: 0 });
    prisma.classEnrollment.deleteMany.mockResolvedValue({ count: 1 });
    prisma.userCourse.deleteMany.mockResolvedValue({ count: 2 });
    prisma.user.deleteMany.mockResolvedValue({ count: 2 });

    const result = await service.deleteStudents(10, { ids: [1, 2] });

    expect(prisma.user.count).toHaveBeenCalledWith({
      where: { tenantId: 10, role: 'STUDENT', id: { in: [1, 2] } },
    });
    expect(prisma.assignmentSubmission.deleteMany).toHaveBeenCalledWith({
      where: {
        user: { tenantId: 10, role: 'STUDENT', id: { in: [1, 2] } },
      },
    });
    expect(prisma.classEnrollment.deleteMany).toHaveBeenCalledWith({
      where: {
        user: { tenantId: 10, role: 'STUDENT', id: { in: [1, 2] } },
      },
    });
    expect(prisma.userCourse.deleteMany).toHaveBeenCalledWith({
      where: {
        user: { tenantId: 10, role: 'STUDENT', id: { in: [1, 2] } },
      },
    });
    expect(prisma.user.deleteMany).toHaveBeenCalledWith({
      where: { tenantId: 10, role: 'STUDENT', id: { in: [1, 2] } },
    });
    expect(result).toEqual({
      deletedCount: 2,
      enrollmentDeletedCount: 3,
      requestedCount: 2,
      all: false,
    });
  });
});
