import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import type { Course } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCourseDto } from './dto/create-course.dto';
import { UpdateCourseDto } from './dto/update-course.dto';
import { BulkDeleteCoursesDto } from './dto/bulk-delete-courses.dto';
import { CreateClassDto, CreateClassSessionDto } from './dto/create-class.dto';
import { UpdateClassDto } from './dto/update-class.dto';
import { AddStudentToClassDto } from './dto/add-student-to-class.dto';
import {
  normalizeTitleCase,
  matchesSearchKeyword,
  toSearchKey,
} from '../common/normalization';
import { generateCourseCode, normalizeGeneratedCode } from '@hxstu/shared';

export interface CreateClassInput extends CreateClassDto {
  courseId: number;
  sessions?: CreateClassSessionDto[];
}

@Injectable()
export class CoursesService {
  constructor(private prisma: PrismaService) {}

  async findAllCourses(
    tenantId: number,
    filters: { keyword?: string; status?: string },
  ) {
    const whereClause: any = {
      tenantId,
    };

    if (filters.status) {
      whereClause.status = filters.status;
    }

    const courses = await this.prisma.course.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { classes: true } },
      },
    });

    const keyword = filters.keyword?.trim();
    if (!keyword) return courses;

    // Không phân biệt hoa thường + có/không dấu (xem findAllStudents).
    return courses.filter((course) =>
      matchesSearchKeyword([course.title, course.courseCode], keyword),
    );
  }

  /**
   * Tìm khóa học thuần backend/database, không phụ thuộc AI/LLM. Không phân biệt
   * hoa thường, hỗ trợ tiếng Việt có/không dấu, giới hạn 20 bản ghi.
   */
  async searchCourses(tenantId: number, keyword: string) {
    const courses = await this.findAllCourses(tenantId, { keyword });
    return courses.slice(0, 20);
  }

  async findOneCourse(tenantId: number, id: number) {
    const course = await this.prisma.course.findFirst({
      where: {
        id,
        tenantId,
      },
    });

    if (!course) {
      throw new NotFoundException(
        'Khóa học không tồn tại hoặc không thuộc trung tâm này',
      );
    }

    return course;
  }

  async createCourse(tenantId: number, dto: CreateCourseDto) {
    const title = dto.title ? normalizeTitleCase(dto.title) : dto.title;
    const baseCourseCode =
      normalizeGeneratedCode(dto.courseCode || '') || generateCourseCode(title);

    if (!baseCourseCode) {
      throw new BadRequestException('Không thể sinh mã khóa học từ tên này');
    }

    const courseCode = await this.generateUniqueCourseCode(
      tenantId,
      baseCourseCode,
    );

    // Khóa học không có ngày bắt đầu/kết thúc — ngày chỉ thuộc lớp học.
    return this.prisma.course.create({
      data: {
        tenantId,
        title,
        courseCode,
        description: dto.description || null,
        level: dto.level || null,
        status: dto.status || 'ACTIVE',
      },
    });
  }

  async updateCourse(tenantId: number, id: number, dto: UpdateCourseDto) {
    const course = await this.findOneCourse(tenantId, id);
    const courseCode =
      dto.courseCode !== undefined
        ? normalizeGeneratedCode(dto.courseCode || '')
        : undefined;

    // Check duplicate courseCode if updated
    if (courseCode && courseCode !== course.courseCode) {
      const existingCode = await this.prisma.course.findFirst({
        where: {
          tenantId,
          courseCode,
          id: { not: id },
        },
      });
      if (existingCode) {
        throw new ConflictException(
          'Mã khóa học đã được sử dụng trong trung tâm này',
        );
      }
    }

    // Khóa học không có ngày bắt đầu/kết thúc — ngày chỉ thuộc lớp học.
    return this.prisma.course.update({
      where: { id },
      data: {
        title:
          dto.title !== undefined
            ? dto.title
              ? normalizeTitleCase(dto.title)
              : ''
            : undefined,
        courseCode,
        description:
          dto.description !== undefined ? dto.description || null : undefined,
        level: dto.level !== undefined ? dto.level || null : undefined,
        status: dto.status !== undefined ? dto.status || undefined : undefined,
      },
    });
  }

  private validateClassDates(
    startDate?: string | null,
    endDate?: string | null,
  ) {
    if (!startDate || !endDate) {
      return;
    }

    if (new Date(startDate) > new Date(endDate)) {
      throw new BadRequestException(
        'Ngày bắt đầu không được lớn hơn ngày kết thúc',
      );
    }
  }

  async updateCourseStatus(tenantId: number, id: number, status: string) {
    await this.findOneCourse(tenantId, id);

    return this.prisma.course.update({
      where: { id },
      data: { status },
    });
  }

  async deleteCourse(tenantId: number, id: number) {
    await this.findOneCourse(tenantId, id);

    const [classEnrollments, legacyEnrollments, course] =
      await this.prisma.$transaction([
        this.prisma.classEnrollment.deleteMany({
          where: { courseClass: { courseId: id, tenantId } },
        }),
        this.prisma.userCourse.deleteMany({
          where: { courseId: id },
        }),
        this.prisma.course.delete({
          where: { id },
        }),
      ]);

    return {
      ...course,
      enrollmentDeletedCount: classEnrollments.count + legacyEnrollments.count,
    };
  }

  async deleteCourses(tenantId: number, dto: BulkDeleteCoursesDto) {
    const ids = dto.ids?.filter((id) => Number.isInteger(id) && id > 0) || [];
    const deleteAll = dto.all === true;

    if (deleteAll && ids.length > 0) {
      throw new BadRequestException(
        'Chỉ được chọn xóa tất cả hoặc xóa theo danh sách khóa học',
      );
    }

    if (!deleteAll && ids.length === 0) {
      throw new BadRequestException('Bạn cần chọn ít nhất một khóa học để xóa');
    }

    const courseWhere = deleteAll
      ? { tenantId }
      : { tenantId, id: { in: ids } };
    const classEnrollmentWhere = deleteAll
      ? { courseClass: { tenantId } }
      : { courseClass: { tenantId, courseId: { in: ids } } };

    const existingCount = await this.prisma.course.count({
      where: courseWhere,
    });

    if (existingCount === 0) {
      throw new NotFoundException('Không tìm thấy khóa học nào để xóa');
    }

    const [classEnrollments, legacyEnrollments, courses] =
      await this.prisma.$transaction([
        this.prisma.classEnrollment.deleteMany({
          where: classEnrollmentWhere,
        }),
        this.prisma.userCourse.deleteMany({
          where: {
            course: courseWhere,
          },
        }),
        this.prisma.course.deleteMany({
          where: courseWhere,
        }),
      ]);

    return {
      deletedCount: courses.count,
      enrollmentDeletedCount: classEnrollments.count + legacyEnrollments.count,
      requestedCount: deleteAll ? undefined : ids.length,
      all: deleteAll,
    };
  }

  async getCourseStudents(tenantId: number, id: number) {
    await this.findOneCourse(tenantId, id);

    const classEnrollments = await this.prisma.classEnrollment.findMany({
      where: {
        courseClass: {
          courseId: id,
          tenantId,
        },
      },
      include: {
        user: true,
        courseClass: true,
      },
    });

    return classEnrollments.map((enrollment) => ({
      enrollmentId: enrollment.id,
      classId: enrollment.classId,
      classTitle: enrollment.courseClass.title,
      classType: enrollment.courseClass.type,
      roleInClass: enrollment.roleInClass,
      enrolledAt: enrollment.createdAt,
      joinedAt: enrollment.joinedAt,
      endedAt: enrollment.endedAt,
      student: this.studentSummary(enrollment.user),
    }));
  }

  async getCourseDetail(tenantId: number, id: number) {
    const course = await this.prisma.course.findFirst({
      where: { id, tenantId },
      include: {
        classes: {
          include: {
            _count: {
              select: { enrollments: true, sessions: true, assignments: true },
            },
          },
          orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        },
      },
    });

    if (!course) {
      throw new NotFoundException(
        'Khóa học không tồn tại hoặc không thuộc trung tâm này',
      );
    }

    const enrollments = await this.prisma.classEnrollment.findMany({
      where: {
        courseClass: {
          tenantId,
          courseId: id,
        },
      },
      select: { userId: true },
    });
    const studentCount = new Set(enrollments.map((item) => item.userId)).size;

    return {
      ...course,
      classCount: course.classes.length,
      studentCount,
      totalMembers: enrollments.length,
      _count: {
        classes: course.classes.length,
        students: studentCount,
        enrollments: enrollments.length,
      },
    };
  }

  async findClassesForCourse(
    tenantId: number,
    courseId: number,
    filters: { type?: string; status?: string } = {},
  ) {
    await this.findOneCourse(tenantId, courseId);

    return this.prisma.courseClass.findMany({
      where: {
        tenantId,
        courseId,
        ...(filters.type ? { type: filters.type } : {}),
        ...(filters.status ? { status: filters.status } : {}),
      },
      include: {
        course: true,
        _count: {
          select: { enrollments: true, sessions: true, assignments: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findAllClasses(
    tenantId: number,
    filters: {
      keyword?: string;
      courseId?: number;
      type?: string;
      status?: string;
    } = {},
  ) {
    const keyword = filters.keyword?.trim();

    const classes = await this.prisma.courseClass.findMany({
      where: {
        tenantId,
        ...(filters.courseId ? { courseId: filters.courseId } : {}),
        ...(filters.type ? { type: filters.type } : {}),
        ...(filters.status ? { status: filters.status } : {}),
      },
      include: {
        course: true,
        _count: {
          select: { enrollments: true, sessions: true, assignments: true },
        },
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });

    if (!keyword) return classes;

    // Không phân biệt hoa thường + có/không dấu, khớp cả tên khóa cha.
    return classes.filter((courseClass) =>
      matchesSearchKeyword(
        [
          courseClass.title,
          courseClass.classCode,
          courseClass.teacherName,
          courseClass.course?.title,
          courseClass.course?.courseCode,
        ],
        keyword,
      ),
    );
  }

  /**
   * Tìm lớp học thuần backend/database, không phụ thuộc AI/LLM. Không phân biệt
   * hoa thường, hỗ trợ tiếng Việt có/không dấu, giới hạn 20 bản ghi.
   */
  async searchClasses(
    tenantId: number,
    keyword: string,
    filters: { courseId?: number; type?: string; status?: string } = {},
  ) {
    const classes = await this.findAllClasses(tenantId, {
      ...filters,
      keyword,
    });
    return classes.slice(0, 20);
  }

  async findOneClass(tenantId: number, id: number) {
    const courseClass = await this.prisma.courseClass.findFirst({
      where: { id, tenantId },
      include: {
        course: true,
        _count: {
          select: { enrollments: true, sessions: true, assignments: true },
        },
      },
    });

    if (!courseClass) {
      throw new NotFoundException(
        'Lớp học không tồn tại hoặc không thuộc trung tâm này',
      );
    }

    return courseClass;
  }

  async createClass(
    tenantId: number,
    inputOrCourseId: CreateClassInput | number,
    dto?: CreateClassDto,
  ) {
    const input: CreateClassInput =
      typeof inputOrCourseId === 'number'
        ? ({ ...(dto || {}), courseId: inputOrCourseId } as CreateClassInput)
        : inputOrCourseId;

    if (!input.courseId) {
      throw new BadRequestException('Thiếu courseId');
    }
    if (!input.title?.trim()) {
      throw new BadRequestException('Thiếu title');
    }

    const course = await this.prisma.course.findFirst({
      where: {
        id: input.courseId,
        tenantId,
      },
    });

    if (!course) {
      throw new NotFoundException('Không tìm thấy khóa học phù hợp.');
    }

    const type = input.type || 'WEEKLY';
    if (!['WEEKLY', 'EXAM_PRACTICE'].includes(type)) {
      throw new BadRequestException('Loại lớp không hợp lệ.');
    }

    const title = normalizeTitleCase(input.title);
    // Cùng khóa + cùng loại lớp thì KHÔNG được trùng tên (Toán 3 WEEKLY và
    // Toán 3 EXAM_PRACTICE được phép; 2 lớp Toán 3 WEEKLY thì không).
    await this.ensureUniqueClassTitle(tenantId, input.courseId, title, type);

    const baseClassCode = this.buildClassCode(course, title, type);
    const classCode = await this.generateUniqueClassCode(
      tenantId,
      baseClassCode,
    );

    this.validateClassDates(input.startDate, input.endDate);

    return this.prisma.$transaction(async (tx) => {
      const courseClass = await tx.courseClass.create({
        data: {
          tenantId,
          courseId: input.courseId,
          classCode,
          title,
          type,
          description: input.description || null,
          teacherName: input.teacherName
            ? normalizeTitleCase(input.teacherName)
            : null,
          startDate: input.startDate && !isNaN(new Date(input.startDate).getTime()) ? new Date(input.startDate) : null,
          endDate: input.endDate && !isNaN(new Date(input.endDate).getTime()) ? new Date(input.endDate) : null,
          status: 'ACTIVE',
        },
        include: { course: true },
      });

      const sessions = input.sessions || [];
      if (sessions.length) {
        await tx.classSession.createMany({
          data: sessions.map((session) => ({
            classId: courseClass.id,
            title: session.title || null,
            dayOfWeek: session.dayOfWeek ?? null,
            startTime: session.startTime || null,
            endTime: session.endTime || null,
            sessionDate: session.sessionDate
              ? new Date(session.sessionDate)
              : null,
            room: session.room || null,
            note: session.note || null,
            status: 'SCHEDULED',
          })),
        });
      }

      // Ghi danh theo KHÓA: học viên đã có trong khóa được TỰ ĐỘNG thêm vào
      // lớp mới mở (không phải ghi danh bổ sung thủ công từng lớp).
      const existingEnrollments = await tx.classEnrollment.findMany({
        where: {
          roleInClass: 'STUDENT',
          courseClass: { tenantId, courseId: input.courseId },
        },
        select: { userId: true },
      });
      const courseStudentIds = [
        ...new Set(existingEnrollments.map((item) => item.userId)),
      ];
      if (courseStudentIds.length) {
        await tx.classEnrollment.createMany({
          data: courseStudentIds.map((userId) => ({
            userId,
            classId: courseClass.id,
            roleInClass: 'STUDENT',
          })),
          skipDuplicates: true,
        });
      }

      return {
        ...courseClass,
        course: courseClass.course || course,
        sessions,
        // Số học viên của khóa được tự thêm vào lớp mới (hiện trong message).
        autoEnrolledCount: courseStudentIds.length,
        studentCount: courseStudentIds.length,
      };
    });
  }

  async updateClass(tenantId: number, id: number, dto: UpdateClassDto) {
    const courseClass = await this.findOneClass(tenantId, id);
    let classCode =
      dto.classCode !== undefined
        ? normalizeGeneratedCode(dto.classCode || '')
        : undefined;

    if (dto.type && !['WEEKLY', 'EXAM_PRACTICE'].includes(dto.type)) {
      throw new BadRequestException('Loại lớp không hợp lệ.');
    }

    // Đổi khóa cha: khóa mới phải thuộc cùng tenant. Enrollment gắn theo
    // classId nên học viên trong lớp giữ nguyên khi chuyển khóa.
    let nextCourseId: number | undefined;
    let nextCourse: Course = courseClass.course;
    if (dto.courseId !== undefined) {
      const courseId = Number(dto.courseId);
      if (!Number.isInteger(courseId) || courseId <= 0) {
        throw new BadRequestException('Khóa học không hợp lệ');
      }
      if (courseId !== courseClass.courseId) {
        nextCourse = await this.findOneCourse(tenantId, courseId);
        nextCourseId = courseId;
      }
    }

    const nextType = dto.type || courseClass.type;
    const nextTitle =
      dto.title !== undefined && dto.title
        ? normalizeTitleCase(dto.title)
        : courseClass.title;

    // Cùng khóa + cùng loại lớp thì KHÔNG được trùng tên.
    if (dto.type !== undefined || dto.title !== undefined || nextCourseId) {
      await this.ensureUniqueClassTitle(
        tenantId,
        nextCourseId ?? courseClass.courseId,
        nextTitle,
        nextType,
        id,
      );
    }

    // Đổi LOẠI lớp mà không tự đặt mã mới -> mã sinh tự động phải đổi theo loại
    // (..._TOAN_3_WEEKLY -> ..._TOAN_3_EXAM_PRACTICE). Mã do user tự đặt (không
    // chứa segment loại) thì giữ nguyên.
    const codeUntouched =
      classCode === undefined || classCode === courseClass.classCode;
    if (
      dto.type &&
      dto.type !== courseClass.type &&
      codeUntouched &&
      /(^|_)(WEEKLY|EXAM_PRACTICE)(_|$)/.test(courseClass.classCode)
    ) {
      classCode = await this.generateUniqueClassCode(
        tenantId,
        this.buildClassCode(nextCourse, nextTitle, dto.type),
      );
    }

    if (classCode && classCode !== courseClass.classCode) {
      await this.ensureUniqueClassCode(tenantId, classCode, id);
    }

    this.validateClassDates(
      dto.startDate !== undefined
        ? dto.startDate
        : courseClass.startDate?.toISOString(),
      dto.endDate !== undefined
        ? dto.endDate
        : courseClass.endDate?.toISOString(),
    );

    return this.prisma.courseClass.update({
      where: { id },
      data: {
        courseId: nextCourseId,
        classCode,
        title:
          dto.title !== undefined
            ? dto.title
              ? normalizeTitleCase(dto.title)
              : ''
            : undefined,
        type: dto.type,
        description:
          dto.description !== undefined ? dto.description || null : undefined,
        teacherName:
          dto.teacherName !== undefined
            ? dto.teacherName
              ? normalizeTitleCase(dto.teacherName)
              : null
            : undefined,
        startDate:
          dto.startDate !== undefined
            ? dto.startDate
              ? new Date(dto.startDate)
              : null
            : undefined,
        endDate:
          dto.endDate !== undefined
            ? dto.endDate
              ? new Date(dto.endDate)
              : null
            : undefined,
        status: dto.status,
      },
      include: { course: true },
    });
  }

  async deleteClass(tenantId: number, id: number) {
    await this.findOneClass(tenantId, id);

    const [enrollments, courseClass] = await this.prisma.$transaction([
      this.prisma.classEnrollment.deleteMany({
        where: { classId: id },
      }),
      this.prisma.courseClass.delete({
        where: { id },
      }),
    ]);

    return {
      ...courseClass,
      enrollmentDeletedCount: enrollments.count,
    };
  }

  async deleteClasses(tenantId: number, ids: number[]) {
    const uniqueIds = [...new Set(ids)].filter(
      (id) => Number.isInteger(id) && id > 0,
    );
    if (uniqueIds.length === 0) {
      throw new BadRequestException('Bạn cần chọn ít nhất một lớp để xóa');
    }

    const classes = await this.prisma.courseClass.findMany({
      where: { tenantId, id: { in: uniqueIds } },
      include: {
        _count: {
          select: { enrollments: true, sessions: true, assignments: true },
        },
      },
    });
    if (classes.length === 0) {
      throw new NotFoundException('Không tìm thấy lớp học nào để xóa');
    }

    const [enrollments, deleted] = await this.prisma.$transaction([
      this.prisma.classEnrollment.deleteMany({
        where: { classId: { in: classes.map((item) => item.id) } },
      }),
      this.prisma.courseClass.deleteMany({
        where: {
          tenantId,
          id: { in: classes.map((item) => item.id) },
        },
      }),
    ]);

    return {
      deletedCount: deleted.count,
      enrollmentDeletedCount: enrollments.count,
      classes,
    };
  }

  async changeClassStatus(
    tenantId: number,
    classId: number,
    status: 'ACTIVE' | 'CLOSED',
    expectedStatus?: string,
  ) {
    const courseClass = await this.findOneClass(tenantId, classId);
    if (expectedStatus && courseClass.status !== expectedStatus) {
      throw new ConflictException(
        `Trạng thái lớp đã thay đổi từ ${expectedStatus} sang ${courseClass.status}. Vui lòng kiểm tra lại trước khi xác nhận.`,
      );
    }

    if (courseClass.status === status) {
      return courseClass;
    }

    return this.prisma.courseClass.update({
      where: { id: classId },
      data: { status },
      include: {
        course: true,
        _count: {
          select: { enrollments: true, sessions: true, assignments: true },
        },
      },
    });
  }

  async getClassStudents(tenantId: number, classId: number) {
    await this.findOneClass(tenantId, classId);

    const enrollments = await this.prisma.classEnrollment.findMany({
      where: { classId },
      include: { user: true },
      orderBy: { createdAt: 'desc' },
    });

    return enrollments.map((enrollment) => ({
      enrollmentId: enrollment.id,
      roleInClass: enrollment.roleInClass,
      enrolledAt: enrollment.createdAt,
      joinedAt: enrollment.joinedAt,
      endedAt: enrollment.endedAt,
      student: this.studentSummary(enrollment.user),
    }));
  }

  async getClassDetail(tenantId: number, classId: number) {
    const courseClass = await this.findOneClass(tenantId, classId);
    const students = await this.getClassStudents(tenantId, classId);
    // Lịch học kèm giờ/phòng để card chi tiết hiển thị đầy đủ thông số.
    const sessions = await this.prisma.classSession.findMany({
      where: { classId },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    });

    return {
      ...courseClass,
      students,
      enrollments: students,
      sessions,
      studentCount: students.length,
      totalMembers: students.length,
      _count: {
        ...(courseClass._count || {}),
        students: students.length,
        enrollments: students.length,
        sessions: sessions.length,
      },
    };
  }

  async addStudentToClass(
    tenantId: number,
    classId: number,
    dto: AddStudentToClassDto,
  ) {
    const courseClass = await this.findOneClass(tenantId, classId);
    if (courseClass.status !== 'ACTIVE') {
      throw new BadRequestException(
        'Không thể thêm học viên vào lớp đã đóng hoặc ngừng hoạt động',
      );
    }
    const roleInClass = dto.roleInClass || 'STUDENT';

    const user = await this.prisma.user.findFirst({
      where: {
        id: dto.userId,
        tenantId,
        ...(roleInClass === 'STUDENT' ? { role: 'STUDENT' } : {}),
      },
    });

    if (!user) {
      throw new NotFoundException(
        roleInClass === 'STUDENT'
          ? 'Học viên không tồn tại hoặc không thuộc trung tâm này'
          : 'Người dùng không tồn tại hoặc không thuộc trung tâm này',
      );
    }

    const existing = await this.prisma.classEnrollment.findFirst({
      where: {
        userId: dto.userId,
        classId,
      },
    });

    if (existing) {
      throw new ConflictException('Người dùng đã có trong lớp này');
    }

    return this.prisma.classEnrollment.create({
      data: {
        userId: dto.userId,
        classId,
        roleInClass,
        joinedAt: dto.joinedAt ? new Date(dto.joinedAt) : undefined,
        endedAt: dto.endedAt ? new Date(dto.endedAt) : undefined,
        expireDate: dto.expireDate ? new Date(dto.expireDate) : undefined,
        allowLatePayment: dto.allowLatePayment,
        note: dto.note,
      },
      include: {
        user: true,
        courseClass: { include: { course: true } },
      },
    });
  }

  /**
   * Gán giáo viên phụ trách CẢ KHÓA = set teacherName cho TẤT CẢ lớp ACTIVE
   * của khóa (lớp CLOSED giữ nguyên giáo viên cũ làm lịch sử). Muốn đổi giáo
   * viên MỘT lớp cụ thể thì dùng updateClass với teacherName như bình thường.
   */
  async assignTeacherToCourseClasses(
    tenantId: number,
    courseId: number,
    teacherName: string,
  ) {
    const course = await this.findOneCourse(tenantId, courseId);
    const name = normalizeTitleCase(teacherName.trim());
    if (!name) {
      throw new BadRequestException('Thiếu tên giáo viên');
    }

    const activeClasses = await this.prisma.courseClass.findMany({
      where: { tenantId, courseId, status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
    });
    if (activeClasses.length === 0) {
      throw new BadRequestException({
        code: 'COURSE_HAS_NO_ACTIVE_CLASS',
        message:
          'Khóa học này chưa có lớp đang hoạt động nên chưa thể gán giáo viên.',
        courseId,
      });
    }

    await this.prisma.courseClass.updateMany({
      where: { id: { in: activeClasses.map((cls) => cls.id) } },
      data: { teacherName: name },
    });

    return {
      id: course.id,
      courseId: course.id,
      course,
      teacherName: name,
      totalActiveClasses: activeClasses.length,
      updated: activeClasses.map((cls) => ({
        classId: cls.id,
        classTitle: cls.title || cls.classCode || `#${cls.id}`,
        classCode: cls.classCode ?? null,
        previousTeacherName: cls.teacherName ?? null,
      })),
    };
  }

  /**
   * Ghi danh 1 học viên vào TẤT CẢ lớp ACTIVE của khóa — hàm dùng chung cho
   * REST POST /enrollments và tool assign_student_to_course của Copilot.
   * - 0 lớp ACTIVE -> COURSE_HAS_NO_ACTIVE_CLASS (không auto-tạo lớp default).
   * - Đã có mặt ở TẤT CẢ lớp ACTIVE -> STUDENT_ALREADY_ASSIGNED_TO_COURSE.
   * - Lớp đã có sẵn -> skippedExisting, lớp còn lại vẫn được ghi.
   * "Tất cả lớp" = lớp ACTIVE tại thời điểm gọi; chiều ngược lại createClass
   * tự thêm học viên của khóa vào lớp mới nên 2 chiều luôn đồng bộ.
   */
  async enrollStudentToAllActiveClasses(
    tenantId: number,
    courseId: number,
    userId: number,
    options: {
      roleInClass?: string;
      joinedAt?: string;
      endedAt?: string;
      expireDate?: string;
      allowLatePayment?: boolean;
      note?: string;
    } = {},
  ) {
    const course = await this.findOneCourse(tenantId, courseId);
    if (course.status !== 'ACTIVE') {
      throw new BadRequestException({
        code: 'COURSE_NOT_ACTIVE',
        message: 'Không thể ghi danh vào khóa học đã đóng/bảo lưu.',
        courseId,
      });
    }

    const roleInClass = options.roleInClass || 'STUDENT';
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
    });
    if (!user) {
      throw new NotFoundException(
        'Học viên không tồn tại hoặc không thuộc trung tâm này',
      );
    }
    if (roleInClass === 'STUDENT' && user.role !== 'STUDENT') {
      throw new BadRequestException('Thành viên này không phải là học viên');
    }

    const activeClasses = await this.prisma.courseClass.findMany({
      where: { tenantId, courseId, status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
    });
    if (activeClasses.length === 0) {
      throw new BadRequestException({
        code: 'COURSE_HAS_NO_ACTIVE_CLASS',
        message:
          'Khóa học này chưa có lớp đang hoạt động nên chưa thể ghi danh học viên.',
        courseId,
      });
    }

    const existing = await this.prisma.classEnrollment.findMany({
      where: {
        userId,
        classId: { in: activeClasses.map((cls) => cls.id) },
      },
    });
    const existingClassIds = new Set(existing.map((item) => item.classId));
    if (existingClassIds.size === activeClasses.length) {
      throw new ConflictException({
        code: 'STUDENT_ALREADY_ASSIGNED_TO_COURSE',
        message:
          'Học viên đã có mặt trong tất cả lớp đang hoạt động của khóa học này.',
        studentId: userId,
        courseId,
      });
    }

    const classSummary = (cls: any) => ({
      classId: Number(cls.id),
      classTitle: cls.title || cls.classCode || `#${cls.id}`,
      classCode: cls.classCode ?? null,
      classType: cls.type ?? null,
    });

    const enrolled: any[] = [];
    const skippedExisting: any[] = [];
    for (const cls of activeClasses) {
      if (existingClassIds.has(cls.id)) {
        skippedExisting.push(classSummary(cls));
        continue;
      }
      const enrollment = await this.addStudentToClass(tenantId, cls.id, {
        userId,
        roleInClass,
        joinedAt: options.joinedAt,
        endedAt: options.endedAt,
        expireDate: options.expireDate,
        allowLatePayment: options.allowLatePayment,
        note: options.note,
      });
      enrolled.push({
        ...classSummary(cls),
        enrollmentId: enrollment.id,
        roleInClass: enrollment.roleInClass,
        joinedAt: enrollment.joinedAt,
        endedAt: enrollment.endedAt,
      });
    }

    return {
      // id = enrollment đầu tiên vừa tạo (phục vụ audit log entityId).
      id: enrolled[0]?.enrollmentId ?? null,
      userId,
      studentId: userId,
      courseId,
      user,
      course,
      totalActiveClasses: activeClasses.length,
      enrolled,
      skippedExisting,
    };
  }

  async removeStudentFromClass(
    tenantId: number,
    classId: number,
    userId: number,
  ) {
    await this.findOneClass(tenantId, classId);

    const enrollment = await this.prisma.classEnrollment.findFirst({
      where: {
        userId,
        classId,
        courseClass: { tenantId },
      },
    });

    if (!enrollment) {
      throw new NotFoundException('Người dùng chưa được thêm vào lớp này');
    }

    return this.prisma.classEnrollment.delete({
      where: { id: enrollment.id },
    });
  }

  async findEnrollmentByStudentAndClass(
    tenantId: number,
    userId: number,
    classId: number,
  ) {
    return this.prisma.classEnrollment.findFirst({
      where: {
        userId,
        classId,
        courseClass: { tenantId },
      },
      include: {
        user: true,
        courseClass: { include: { course: true } },
      },
    });
  }

  async updateStudentClassRole(
    tenantId: number,
    classId: number,
    userId: number,
    roleInClass: string,
  ) {
    if (!['STUDENT', 'TEACHER'].includes(roleInClass)) {
      throw new BadRequestException(
        'Vai trò trong lớp chỉ được là STUDENT hoặc TEACHER',
      );
    }

    const enrollment = await this.findEnrollmentByStudentAndClass(
      tenantId,
      userId,
      classId,
    );
    if (!enrollment) {
      throw new NotFoundException('Người dùng chưa được thêm vào lớp này');
    }

    return this.prisma.classEnrollment.update({
      where: { id: enrollment.id },
      data: { roleInClass },
      include: {
        user: true,
        courseClass: { include: { course: true } },
      },
    });
  }

  async removeStudentFromCourseClasses(
    tenantId: number,
    courseId: number,
    userId: number,
  ) {
    await this.findOneCourse(tenantId, courseId);
    const enrollments = await this.prisma.classEnrollment.findMany({
      where: {
        userId,
        courseClass: { tenantId, courseId },
      },
      include: {
        user: true,
        courseClass: { include: { course: true } },
      },
    });

    if (enrollments.length === 0) {
      throw new NotFoundException(
        'Học viên không tham gia lớp nào trong khóa học này',
      );
    }

    const deleted = await this.prisma.classEnrollment.deleteMany({
      where: { id: { in: enrollments.map((item) => item.id) } },
    });

    return {
      deletedCount: deleted.count,
      user: enrollments[0].user,
      course: enrollments[0].courseClass.course,
      classes: enrollments.map((item) => item.courseClass),
    };
  }

  async findStudentCourseClassEnrollments(
    tenantId: number,
    courseId: number,
    userId: number,
  ) {
    await this.findOneCourse(tenantId, courseId);
    return this.prisma.classEnrollment.findMany({
      where: {
        userId,
        courseClass: { tenantId, courseId },
      },
      include: {
        user: true,
        courseClass: { include: { course: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async ensureUniqueClassCode(
    tenantId: number,
    classCode: string,
    excludeId?: number,
  ) {
    const existingClass = await this.prisma.courseClass.findFirst({
      where: {
        tenantId,
        classCode,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });

    if (existingClass) {
      throw new ConflictException('Mã lớp đã được sử dụng trong trung tâm này');
    }
  }

  /**
   * Trong CÙNG khóa học + CÙNG loại lớp, tên lớp không được trùng (so khớp
   * không dấu, không phân biệt hoa thường). Khác loại thì được phép trùng tên.
   */
  private async ensureUniqueClassTitle(
    tenantId: number,
    courseId: number,
    title: string,
    type: string,
    excludeId?: number,
  ) {
    const titleKey = toSearchKey(title);
    if (!titleKey) return;

    const siblings =
      (await this.prisma.courseClass.findMany({
        where: {
          tenantId,
          courseId,
          type,
          ...(excludeId ? { id: { not: excludeId } } : {}),
        },
        select: { id: true, title: true },
      })) || [];

    const duplicate = siblings.find(
      (sibling) => toSearchKey(sibling.title) === titleKey,
    );
    if (duplicate) {
      const typeLabel =
        type === 'EXAM_PRACTICE' ? 'luyện đề' : 'học theo tuần';
      throw new ConflictException(
        `Khóa học này đã có lớp "${title}" thuộc loại ${typeLabel}. ` +
          'Cùng một loại lớp không được trùng tên — bạn đổi tên lớp hoặc chọn loại lớp khác nhé.',
      );
    }
  }

  private async generateUniqueCourseCode(
    tenantId: number,
    baseCode: string,
  ): Promise<string> {
    const normalizedBase = normalizeGeneratedCode(baseCode);
    if (!normalizedBase) {
      throw new BadRequestException('Không thể sinh mã khóa học từ tên này');
    }

    const existing = await this.prisma.course.findMany({
      where: {
        tenantId,
        courseCode: { startsWith: normalizedBase },
      },
      select: { courseCode: true },
    });

    return this.nextUniqueCode(
      normalizedBase,
      normalizedBase,
      existing.map((course) => course.courseCode),
    );
  }

  /**
   * Auto-increment numeric suffix to generate a unique classCode.
   * E.g. IELTS_CLASS → IELTS_CLASS (if available)
   *      IELTS_CLASS → IELTS_CLASS_2 (if IELTS_CLASS exists)
   *      IELTS_CLASS → IELTS_CLASS_3 (if _2 also exists)
   */
  private async generateUniqueClassCode(
    tenantId: number,
    baseCode: string,
  ): Promise<string> {
    const normalizedBase = normalizeGeneratedCode(baseCode);
    if (!normalizedBase) {
      throw new BadRequestException('Không thể sinh mã lớp học từ tên này');
    }

    let code = normalizedBase;
    let index = 2;

    while (
      await this.prisma.courseClass.findFirst({
        where: {
          tenantId,
          classCode: code,
        },
        select: { id: true },
      })
    ) {
      code = `${normalizedBase}_${index}`;
      index += 1;
    }

    return code;
  }

  private normalizeClassCodePart(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/_+/g, '_');
  }

  private buildClassCode(course: Course, title: string, type: string): string {
    const coursePart = this.normalizeClassCodePart(
      course.courseCode || course.title,
    );
    const classPart = this.normalizeClassCodePart(title);
    const typePart = this.normalizeClassCodePart(type);

    return `${coursePart}_${classPart}_${typePart}`;
  }

  private nextUniqueCode(
    baseCode: string,
    preferredCode: string,
    codes: string[],
  ) {
    const existingCodes = new Set(
      codes.map((code) => normalizeGeneratedCode(code)),
    );

    if (!existingCodes.has(preferredCode)) {
      return preferredCode;
    }

    let maxSuffix = 1;
    const escapedBase = baseCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const code of existingCodes) {
      const match = code.match(new RegExp(`^${escapedBase}_(\\d+)$`));
      if (match) {
        maxSuffix = Math.max(maxSuffix, parseInt(match[1], 10));
      } else if (code === baseCode) {
        maxSuffix = Math.max(maxSuffix, 1);
      }
    }

    return `${baseCode}_${maxSuffix + 1}`;
  }

  private shouldKeepLopPrefixInClassCode() {
    return process.env.CLASS_CODE_KEEP_LOP_PREFIX === 'true';
  }

  /**
   * Auto-increment numeric suffix in class title when duplicate exists.
   * E.g. "Ielts 1" → "Ielts 1" (if available)
   *      "Ielts 1" → "Ielts 2" (if "Ielts 1" exists in same course)
   *      "Ielts 1" → "Ielts 3" (if 1 and 2 both exist)
   */
  private async generateUniqueClassTitle(
    tenantId: number,
    courseId: number,
    title: string,
  ): Promise<string> {
    if (!title) return title;

    // Extract base name and trailing number: "Ielts 1" → base="Ielts", num=1
    const match = title.match(/^(.+?)\s+(\d+)$/);
    const baseName = match ? match[1].trim() : title;

    // Find all existing titles in the same course that start with the base name
    const existing = await this.prisma.courseClass.findMany({
      where: {
        tenantId,
        courseId,
        title: { startsWith: baseName, mode: 'insensitive' },
      },
      select: { title: true },
    });

    const existingTitles = new Set(
      existing.map((c) => (c.title || '').toLowerCase()),
    );

    // If the original title is not taken, use it as-is
    if (!existingTitles.has(title.toLowerCase())) {
      return title;
    }

    // Find the highest existing suffix number
    let maxNum = 0;
    const baseNameLower = baseName.toLowerCase();
    for (const t of existingTitles) {
      const m = t.match(
        new RegExp(
          `^${baseNameLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+(\\d+)$`,
        ),
      );
      if (m) {
        maxNum = Math.max(maxNum, parseInt(m[1], 10));
      } else if (t === baseNameLower) {
        maxNum = Math.max(maxNum, 1);
      }
    }

    return `${baseName} ${maxNum + 1}`;
  }

  private studentSummary(user: any) {
    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      status: user.status,
      birthDate: user.birthDate,
      address: user.address,
    };
  }
}
