import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEnrollmentDto } from './dto/create-enrollment.dto';
import { UpdateEnrollmentDto } from './dto/update-enrollment.dto';

@Injectable()
export class EnrollmentsService {
  constructor(private prisma: PrismaService) {}

  async findAll(
    tenantId: number,
    query: { keyword?: string; courseId?: number },
  ) {
    const whereClause: any = {
      user: {
        tenantId,
      },
    };

    if (query.courseId) {
      whereClause.courseClass = {
        courseId: query.courseId,
      };
    }

    if (query.keyword) {
      whereClause.OR = [
        {
          user: {
            fullName: { contains: query.keyword, mode: 'insensitive' },
          },
        },
        {
          user: {
            email: { contains: query.keyword, mode: 'insensitive' },
          },
        },
        {
          user: {
            phone: { contains: query.keyword, mode: 'insensitive' },
          },
        },
        {
          courseClass: {
            course: {
              title: { contains: query.keyword, mode: 'insensitive' },
            },
          },
        },
        {
          courseClass: {
            course: {
              courseCode: { contains: query.keyword, mode: 'insensitive' },
            },
          },
        },
      ];
    }

    const enrollments = await this.prisma.classEnrollment.findMany({
      where: whereClause,
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

    return enrollments.map((e) => ({
      id: e.id,
      userId: e.userId,
      courseId: e.courseClass.courseId,
      roleInCourse: e.roleInClass,
      joinedAt: e.joinedAt,
      endedAt: e.endedAt,
      createdAt: e.createdAt,
      user: e.user,
      course: e.courseClass.course,
    }));
  }

  async create(tenantId: number, dto: CreateEnrollmentDto) {
    // Validate student exists, belongs to tenant, and role is STUDENT
    const user = await this.prisma.user.findFirst({
      where: {
        id: dto.userId,
        tenantId,
      },
    });

    if (!user) {
      throw new NotFoundException(
        'Học viên không tồn tại hoặc không thuộc trung tâm này',
      );
    }

    if (user.role !== 'STUDENT') {
      throw new BadRequestException('Thành viên này không phải là học viên');
    }

    // Validate course exists, belongs to tenant, and status is ACTIVE
    const course = await this.prisma.course.findFirst({
      where: {
        id: dto.courseId,
        tenantId,
      },
    });

    if (!course) {
      throw new NotFoundException(
        'Khóa học không tồn tại hoặc không thuộc trung tâm này',
      );
    }

    if (course.status !== 'ACTIVE') {
      throw new BadRequestException(
        'Không thể đăng ký vào khóa học đã đóng/bảo lưu',
      );
    }

    // Find or create the default class of this course
    let defaultClass = await this.prisma.courseClass.findFirst({
      where: {
        courseId: dto.courseId,
        tenantId,
        classCode: `${course.courseCode}-DEFAULT`,
      },
    });

    if (!defaultClass) {
      defaultClass = await this.prisma.courseClass.create({
        data: {
          tenantId,
          courseId: course.id,
          classCode: `${course.courseCode}-DEFAULT`,
          title: `${course.title} - Lớp mặc định`,
          type: 'WEEKLY',
          status: 'ACTIVE',
        },
      });
    }

    const joinedAt = dto.joinedAt ? new Date(dto.joinedAt) : new Date();
    const endedAt = dto.endDate ? new Date(dto.endDate) : null;

    if (endedAt && joinedAt > endedAt) {
      throw new BadRequestException(
        'Ngày tham gia không được lớn hơn ngày kết thúc',
      );
    }

    // Check duplicate in ClassEnrollment
    const existing = await this.prisma.classEnrollment.findFirst({
      where: {
        userId: dto.userId,
        classId: defaultClass.id,
      },
    });

    if (existing) {
      throw new ConflictException('Học viên đã tham gia khóa học này từ trước');
    }

    const enrollment = await this.prisma.classEnrollment.create({
      data: {
        userId: dto.userId,
        classId: defaultClass.id,
        roleInClass: dto.roleInCourse || 'STUDENT',
        joinedAt,
        endedAt,
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

    return {
      id: enrollment.id,
      userId: enrollment.userId,
      courseId: enrollment.courseClass.courseId,
      roleInCourse: enrollment.roleInClass,
      joinedAt: enrollment.joinedAt,
      endedAt: enrollment.endedAt,
      createdAt: enrollment.createdAt,
      user: enrollment.user,
      course: enrollment.courseClass.course,
    };
  }

  async remove(tenantId: number, id: number) {
    const enrollment = await this.prisma.classEnrollment.findFirst({
      where: {
        id,
        user: {
          tenantId,
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

    if (!enrollment) {
      throw new NotFoundException('Không tìm thấy thông tin đăng ký học');
    }

    const deleted = await this.prisma.classEnrollment.delete({
      where: { id },
    });

    return {
      id: deleted.id,
      userId: deleted.userId,
      courseId: enrollment.courseClass.courseId,
      roleInCourse: deleted.roleInClass,
      joinedAt: deleted.joinedAt,
      endedAt: deleted.endedAt,
      createdAt: deleted.createdAt,
      user: enrollment.user,
      course: enrollment.courseClass.course,
    };
  }

  async update(tenantId: number, id: number, dto: UpdateEnrollmentDto) {
    const enrollment = await this.prisma.classEnrollment.findFirst({
      where: {
        id,
        user: {
          tenantId,
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

    if (!enrollment) {
      throw new NotFoundException('Không tìm thấy học viên trong lớp này');
    }

    const joinedAt =
      dto.joinedAt !== undefined ? new Date(dto.joinedAt) : enrollment.joinedAt;
    const endedAt =
      dto.endDate !== undefined
        ? dto.endDate
          ? new Date(dto.endDate)
          : null
        : enrollment.endedAt;

    if (endedAt && joinedAt > endedAt) {
      throw new BadRequestException(
        'Ngày tham gia không được lớn hơn ngày kết thúc',
      );
    }

    const updated = await this.prisma.classEnrollment.update({
      where: { id },
      data: {
        roleInClass: dto.roleInCourse,
        joinedAt: dto.joinedAt !== undefined ? joinedAt : undefined,
        endedAt: dto.endDate !== undefined ? endedAt : undefined,
      },
    });

    return {
      id: updated.id,
      userId: updated.userId,
      courseId: enrollment.courseClass.courseId,
      roleInCourse: updated.roleInClass,
      joinedAt: updated.joinedAt,
      endedAt: updated.endedAt,
      createdAt: updated.createdAt,
      user: enrollment.user,
      course: enrollment.courseClass.course,
    };
  }

  async findByStudentAndCourse(
    tenantId: number,
    studentId: number,
    courseId: number,
  ) {
    const enrollment = await this.prisma.classEnrollment.findFirst({
      where: {
        userId: studentId,
        courseClass: {
          courseId,
          tenantId,
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

    if (!enrollment) return null;

    return {
      id: enrollment.id,
      userId: enrollment.userId,
      courseId: enrollment.courseClass.courseId,
      roleInCourse: enrollment.roleInClass,
      joinedAt: enrollment.joinedAt,
      endedAt: enrollment.endedAt,
      createdAt: enrollment.createdAt,
      user: enrollment.user,
      course: enrollment.courseClass.course,
    };
  }

  async updateRoleByStudentAndCourse(
    tenantId: number,
    studentId: number,
    courseId: number,
    roleInCourse: string,
  ) {
    const enrollment = await this.prisma.classEnrollment.findFirst({
      where: {
        userId: studentId,
        courseClass: {
          courseId,
          tenantId,
        },
      },
    });

    if (!enrollment) {
      throw new NotFoundException(
        'Học viên chưa có trong lớp này nên chưa thể đổi vai trò',
      );
    }

    const updated = await this.prisma.classEnrollment.update({
      where: { id: enrollment.id },
      data: { roleInClass: roleInCourse },
      include: {
        user: true,
        courseClass: {
          include: {
            course: true,
          },
        },
      },
    });

    return {
      id: updated.id,
      userId: updated.userId,
      courseId: updated.courseClass.courseId,
      roleInCourse: updated.roleInClass,
      joinedAt: updated.joinedAt,
      endedAt: updated.endedAt,
      createdAt: updated.createdAt,
      user: updated.user,
      course: updated.courseClass.course,
    };
  }

  async removeByStudentAndCourse(
    tenantId: number,
    studentId: number,
    courseId: number,
  ) {
    const enrollment = await this.prisma.classEnrollment.findFirst({
      where: {
        userId: studentId,
        courseClass: {
          courseId,
          tenantId,
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

    if (!enrollment) {
      throw new NotFoundException(
        'Học viên chưa đăng ký tham gia khóa học này',
      );
    }

    const deleted = await this.prisma.classEnrollment.delete({
      where: { id: enrollment.id },
    });

    return {
      id: deleted.id,
      userId: deleted.userId,
      courseId: enrollment.courseClass.courseId,
      roleInCourse: deleted.roleInClass,
      joinedAt: deleted.joinedAt,
      endedAt: deleted.endedAt,
      createdAt: deleted.createdAt,
      user: enrollment.user,
      course: enrollment.courseClass.course,
    };
  }
}
