import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStudentDto } from './dto/create-student.dto';
import { UpdateStudentDto } from './dto/update-student.dto';
import { BulkDeleteStudentsDto } from './dto/bulk-delete-students.dto';
import {
  normalizeEmail,
  normalizePhone,
  normalizeTitleCase,
  normalizeLocation,
  matchesSearchKeyword,
} from '../common/normalization';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findAllStudents(
    tenantId: number,
    filters: { keyword?: string; status?: string },
  ) {
    const whereClause: any = {
      tenantId,
      role: 'STUDENT',
    };

    if (filters.status) {
      whereClause.status = filters.status;
    }

    const students = await this.prisma.user.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
    });

    const keyword = filters.keyword?.trim();
    if (!keyword) return students;

    // Lọc không phân biệt hoa thường VÀ có/không dấu (Prisma "insensitive" không
    // bỏ dấu tiếng Việt nên "toan" sẽ không match "Toàn" nếu chỉ dùng DB).
    return students.filter((student) =>
      matchesSearchKeyword(
        [student.fullName, student.email, student.phone, student.address],
        keyword,
      ),
    );
  }

  /**
   * Tìm học viên thuần backend/database, KHÔNG phụ thuộc AI/LLM. Không phân biệt
   * hoa thường, hỗ trợ tiếng Việt có dấu và không dấu, giới hạn 20 bản ghi.
   */
  async searchStudents(tenantId: number, keyword: string) {
    const students = await this.findAllStudents(tenantId, { keyword });
    return students.slice(0, 20);
  }

  async findOneStudent(tenantId: number, id: number) {
    const student = await this.prisma.user.findFirst({
      where: {
        id,
        tenantId,
        role: 'STUDENT',
      },
    });

    if (!student) {
      throw new NotFoundException(
        'Học viên không tồn tại hoặc không thuộc trung tâm này',
      );
    }

    return student;
  }

  async getStudentDetail(tenantId: number, id: number) {
    const student = await this.findOneStudent(tenantId, id);
    const enrollments = await this.prisma.classEnrollment.findMany({
      where: {
        userId: id,
        courseClass: {
          tenantId,
        },
      },
      include: {
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

    const activeEnrollments = enrollments.filter(
      (item) => item.status === 'ACTIVE',
    );

    return {
      ...student,
      studentId: student.id,
      studentName: student.fullName,
      classes: enrollments.map((item) => ({
        enrollmentId: item.id,
        classId: item.courseClass.id,
        className: item.courseClass.title,
        classCode: item.courseClass.classCode,
        classType: item.courseClass.type,
        classStatus: item.courseClass.status,
        roleInClass: item.roleInClass,
        joinedAt: item.joinedAt,
        endedAt: item.endedAt,
        enrollmentStatus: item.status,
        courseId: item.courseClass.course.id,
        courseName: item.courseClass.course.title,
        courseCode: item.courseClass.course.courseCode,
      })),
      courses: Array.from(
        new Map(
          enrollments.map((item) => [
            item.courseClass.course.id,
            {
              id: item.courseClass.course.id,
              title: item.courseClass.course.title,
              courseCode: item.courseClass.course.courseCode,
              level: item.courseClass.course.level,
              status: item.courseClass.course.status,
            },
          ]),
        ).values(),
      ),
      counts: {
        classes: enrollments.length,
        activeClasses: activeEnrollments.length,
        courses: new Set(enrollments.map((item) => item.courseClass.courseId))
          .size,
      },
    };
  }

  /**
   * Tìm học viên trùng theo email HOẶC số điện thoại trong cùng tenant.
   * - Email được normalize (trim + lowercase), phone được normalize (bỏ khoảng
   *   trắng, chỉ giữ số).
   * - Chỉ match role STUDENT, không match teacher/admin.
   * - Nếu cả email và phone đều thiếu thì trả null.
   */
  async findDuplicateStudentByEmailOrPhone(
    tenantId: number,
    input: { email?: string | null; phone?: string | null },
  ) {
    const email = input.email ? normalizeEmail(input.email) : null;
    const phone = input.phone ? normalizePhone(input.phone) : null;

    const orConditions = [
      email ? { email } : null,
      phone ? { phone } : null,
    ].filter((condition): condition is { email: string } | { phone: string } =>
      Boolean(condition),
    );

    if (orConditions.length === 0) return null;

    return this.prisma.user.findFirst({
      where: {
        tenantId,
        role: 'STUDENT',
        OR: orConditions,
      },
    });
  }

  /** Payload an toàn để trả ra ngoài (không lộ password/hash/token). */
  private toSafeStudentPayload(student: any) {
    if (!student) return null;
    return {
      id: student.id,
      fullName: student.fullName,
      email: student.email ?? null,
      phone: student.phone ?? null,
    };
  }

  async createStudent(tenantId: number, dto: CreateStudentDto) {
    const email = dto.email ? normalizeEmail(dto.email) : null;
    const phone = dto.phone ? normalizePhone(dto.phone) : null;

    // Lớp bảo vệ cuối cùng: chặn tạo trùng email/SĐT ở service layer, tránh
    // bất kỳ API nào (kể cả AI Agent) tạo học viên trùng.
    const duplicate = await this.findDuplicateStudentByEmailOrPhone(tenantId, {
      email,
      phone,
    });
    if (duplicate) {
      throw new ConflictException({
        code: 'STUDENT_DUPLICATE',
        message: 'Email hoặc số điện thoại đã tồn tại.',
        existingStudent: this.toSafeStudentPayload(duplicate),
      });
    }

    return this.prisma.user.create({
      data: {
        tenantId,
        fullName: normalizeTitleCase(dto.fullName),
        email: email || null,
        phone: phone || null,
        address: dto.address ? normalizeLocation(dto.address) : null,
        birthDate: dto.birthDate ? new Date(dto.birthDate) : null,
        role: 'STUDENT',
        status: 'ACTIVE',
      },
    });
  }

  async updateStudent(tenantId: number, id: number, dto: UpdateStudentDto) {
    const student = await this.findOneStudent(tenantId, id);

    const email =
      dto.email !== undefined
        ? dto.email
          ? normalizeEmail(dto.email)
          : null
        : undefined;
    const phone =
      dto.phone !== undefined
        ? dto.phone
          ? normalizePhone(dto.phone)
          : null
        : undefined;

    // Check email uniqueness if modified
    if (email !== undefined && email !== student.email) {
      if (email) {
        const existingEmail = await this.prisma.user.findFirst({
          where: {
            tenantId,
            email,
            id: { not: id },
          },
        });
        if (existingEmail) {
          throw new ConflictException(
            'Email đã được sử dụng trong trung tâm này',
          );
        }
      }
    }

    // Check phone uniqueness if modified
    if (phone !== undefined && phone !== student.phone) {
      if (phone) {
        const existingPhone = await this.prisma.user.findFirst({
          where: {
            tenantId,
            phone,
            id: { not: id },
          },
        });
        if (existingPhone) {
          throw new ConflictException(
            'Số điện thoại đã được sử dụng trong trung tâm này',
          );
        }
      }
    }

    return this.prisma.user.update({
      where: { id },
      data: {
        fullName:
          dto.fullName !== undefined
            ? normalizeTitleCase(dto.fullName)
            : undefined,
        email,
        phone,
        address:
          dto.address !== undefined
            ? dto.address
              ? normalizeLocation(dto.address)
              : null
            : undefined,
        birthDate:
          dto.birthDate !== undefined
            ? dto.birthDate
              ? new Date(dto.birthDate)
              : null
            : undefined,
      },
    });
  }

  async updateStudentStatus(tenantId: number, id: number, status: string) {
    await this.findOneStudent(tenantId, id);

    return this.prisma.user.update({
      where: { id },
      data: { status },
    });
  }

  async deleteStudent(tenantId: number, id: number) {
    await this.findOneStudent(tenantId, id);

    // Clean up course/class enrollments and submissions to avoid foreign key errors
    await this.prisma.$transaction([
      this.prisma.assignmentSubmission.deleteMany({
        where: { userId: id },
      }),
      this.prisma.classEnrollment.deleteMany({
        where: { userId: id },
      }),
      this.prisma.userCourse.deleteMany({
        where: { userId: id },
      }),
    ]);

    return this.prisma.user.delete({
      where: { id },
    });
  }

  async deleteStudents(tenantId: number, dto: BulkDeleteStudentsDto) {
    const ids = dto.ids?.filter((id) => Number.isInteger(id) && id > 0) || [];
    const deleteAll = dto.all === true;

    if (deleteAll && ids.length > 0) {
      throw new BadRequestException(
        'Chỉ được chọn xóa tất cả hoặc xóa theo danh sách học viên',
      );
    }

    if (!deleteAll && ids.length === 0) {
      throw new BadRequestException('Bạn cần chọn ít nhất một học viên để xóa');
    }

    const studentWhere = deleteAll
      ? { tenantId, role: 'STUDENT' }
      : { tenantId, role: 'STUDENT', id: { in: ids } };

    const existingCount = await this.prisma.user.count({
      where: studentWhere,
    });

    if (existingCount === 0) {
      throw new NotFoundException('Không tìm thấy học viên nào để xóa');
    }

    const [submissions, classEnrollments, legacyEnrollments, students] =
      await this.prisma.$transaction([
        this.prisma.assignmentSubmission.deleteMany({
          where: {
            user: studentWhere,
          },
        }),
        this.prisma.classEnrollment.deleteMany({
          where: {
            user: studentWhere,
          },
        }),
        this.prisma.userCourse.deleteMany({
          where: {
            user: studentWhere,
          },
        }),
        this.prisma.user.deleteMany({
          where: studentWhere,
        }),
      ]);

    return {
      deletedCount: students.count,
      enrollmentDeletedCount: classEnrollments.count + legacyEnrollments.count,
      requestedCount: deleteAll ? undefined : ids.length,
      all: deleteAll,
    };
  }

  async getStudentCourses(tenantId: number, id: number) {
    await this.findOneStudent(tenantId, id);

    const enrollments = await this.prisma.classEnrollment.findMany({
      where: {
        userId: id,
        courseClass: {
          tenantId,
        },
      },
      include: {
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
      enrollmentId: e.id,
      roleInCourse: e.roleInClass,
      enrolledAt: e.createdAt,
      joinedAt: e.joinedAt,
      endedAt: e.endedAt,
      course: e.courseClass.course,
      courseClass: e.courseClass,
    }));
  }

  async removeStudentCourse(
    tenantId: number,
    studentId: number,
    courseId: number,
  ) {
    await this.findOneStudent(tenantId, studentId);

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
        'Học viên chưa đăng ký tham gia khóa học này',
      );
    }

    return this.prisma.classEnrollment.delete({
      where: { id: enrollment.id },
    });
  }
}
