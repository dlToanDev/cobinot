import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCourseDto } from './dto/create-course.dto';
import { UpdateCourseDto } from './dto/update-course.dto';
import { BulkDeleteCoursesDto } from './dto/bulk-delete-courses.dto';
import { CreateClassDto } from './dto/create-class.dto';
import { UpdateClassDto } from './dto/update-class.dto';
import { AddStudentToClassDto } from './dto/add-student-to-class.dto';
import { normalizeTitleCase } from '../common/normalization';
import {
  generateClassCode,
  generateCourseCode,
  normalizeGeneratedCode,
} from '@hxstu/shared';

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

    if (filters.keyword) {
      whereClause.OR = [
        { title: { contains: filters.keyword, mode: 'insensitive' } },
        { courseCode: { contains: filters.keyword, mode: 'insensitive' } },
      ];
    }

    return this.prisma.course.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { classes: true } },
      },
    });
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

    return this.prisma.course.create({
      data: {
        tenantId,
        title,
        courseCode,
        description: dto.description || null,
        level: dto.level || null,
        status: 'ACTIVE',
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

    return this.prisma.course.update({
      where: { id },
      data: {
        title: dto.title !== undefined ? (dto.title ? normalizeTitleCase(dto.title) : '') : undefined,
        courseCode,
        description:
          dto.description !== undefined ? dto.description || null : undefined,
        level: dto.level !== undefined ? dto.level || null : undefined,
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

    return this.prisma.courseClass.findMany({
      where: {
        tenantId,
        ...(filters.courseId ? { courseId: filters.courseId } : {}),
        ...(filters.type ? { type: filters.type } : {}),
        ...(filters.status ? { status: filters.status } : {}),
        ...(keyword
          ? {
              OR: [
                { title: { contains: keyword, mode: 'insensitive' } },
                { classCode: { contains: keyword, mode: 'insensitive' } },
                {
                  teacherName: { contains: keyword, mode: 'insensitive' },
                },
                {
                  course: {
                    OR: [
                      { title: { contains: keyword, mode: 'insensitive' } },
                      {
                        courseCode: {
                          contains: keyword,
                          mode: 'insensitive',
                        },
                      },
                    ],
                  },
                },
              ],
            }
          : {}),
      },
      include: {
        course: true,
        _count: {
          select: { enrollments: true, sessions: true, assignments: true },
        },
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });
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

  async createClass(tenantId: number, courseId: number, dto: CreateClassDto & { enrollStudentId?: number }) {
    const course = await this.findOneCourse(tenantId, courseId);
    const normalizedTitle = dto.title ? normalizeTitleCase(dto.title) : dto.title;
    const uniqueTitle = await this.generateUniqueClassTitle(tenantId, courseId, normalizedTitle);
    const baseClassCode =
      normalizeGeneratedCode(dto.classCode || '') ||
      generateClassCode({
        courseCode: course.courseCode,
        courseTitle: course.title,
        classTitle: uniqueTitle,
        classType: dto.type,
        includeClassType: Boolean(dto.type),
        keepLopPrefix: this.shouldKeepLopPrefixInClassCode(),
      });
    const uniqueClassCode = await this.generateUniqueClassCode(
      tenantId,
      baseClassCode,
    );
    this.validateClassDates(dto.startDate, dto.endDate);

    const courseClass = await this.prisma.courseClass.create({
      data: {
        tenantId,
        courseId,
        classCode: uniqueClassCode,
        title: uniqueTitle,
        type: dto.type || 'WEEKLY',
        description: dto.description || null,
        teacherName: dto.teacherName ? normalizeTitleCase(dto.teacherName) : null,
        startDate: dto.startDate ? new Date(dto.startDate) : null,
        endDate: dto.endDate ? new Date(dto.endDate) : null,
        status: 'ACTIVE',
      },
      include: { course: true },
    });

    if (dto.enrollStudentId) {
      await this.prisma.classEnrollment.create({
        data: {
          classId: courseClass.id,
          userId: dto.enrollStudentId,
          roleInClass: 'STUDENT',
          status: 'ACTIVE',
        },
      });
    }

    return courseClass;
  }

  async updateClass(tenantId: number, id: number, dto: UpdateClassDto) {
    const courseClass = await this.findOneClass(tenantId, id);
    const classCode =
      dto.classCode !== undefined
        ? normalizeGeneratedCode(dto.classCode || '')
        : undefined;

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
        classCode,
        title: dto.title !== undefined ? (dto.title ? normalizeTitleCase(dto.title) : '') : undefined,
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

    return {
      ...courseClass,
      students,
      enrollments: students,
      studentCount: students.length,
      totalMembers: students.length,
      _count: {
        ...(courseClass._count || {}),
        students: students.length,
        enrollments: students.length,
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
      },
      include: {
        user: true,
        courseClass: { include: { course: true } },
      },
    });
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
    // Strip trailing _N suffix to get the real base
    const normalizedBase = normalizeGeneratedCode(baseCode);
    const stripped = normalizedBase.replace(/_\d+$/, '');

    if (!stripped) {
      throw new BadRequestException('Không thể sinh mã lớp học từ tên này');
    }

    // Find all existing codes that start with this base in the same tenant
    const existing = await this.prisma.courseClass.findMany({
      where: {
        tenantId,
        classCode: { startsWith: stripped },
      },
      select: { classCode: true },
    });

    return this.nextUniqueCode(
      stripped,
      normalizedBase,
      existing.map((courseClass) => courseClass.classCode),
    );
  }

  private nextUniqueCode(baseCode: string, preferredCode: string, codes: string[]) {
    const existingCodes = new Set(codes.map((code) => normalizeGeneratedCode(code)));

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
      const m = t.match(new RegExp(`^${baseNameLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+(\\d+)$`));
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
