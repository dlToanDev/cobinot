import { BadRequestException } from '@nestjs/common';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      user: {
        count: jest.fn(),
        deleteMany: jest.fn(),
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
