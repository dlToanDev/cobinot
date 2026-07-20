import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { ActorPayload } from '../common/decorators/get-actor.decorator';
import { CoursesService } from '../courses/courses.service';
import { EnrollmentsService } from '../enrollments/enrollments.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { AiToolName } from './decision.types';
import {
  assertToolAllowedInCurrentMode,
  isWriteTool,
} from './tool-definitions';

@Injectable()
export class ToolRegistryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly coursesService: CoursesService,
    private readonly enrollmentsService: EnrollmentsService,
  ) {}

  async execute(
    sessionId: number,
    actor: ActorPayload,
    toolName: AiToolName,
    input: Record<string, unknown>,
  ) {
    if (!isWriteTool(toolName)) {
      throw new BadRequestException(
        'Chỉ WRITE tool mới được thực thi qua confirm',
      );
    }

    assertToolAllowedInCurrentMode(toolName);

    // Lớp bảo vệ backend: không cho update_student chạy khi user đang ở luồng
    // TẠO học viên mới (tránh AI tự sửa học viên cũ khi email/SĐT trùng).
    if (toolName === 'update_student') {
      const sessionState = await this.getSessionStateIfAvailable(sessionId);
      if (
        sessionState?.last_intent === 'create_student' ||
        sessionState?.duplicate_student_context?.intended_action === 'create'
      ) {
        throw new BadRequestException({
          code: 'UPDATE_STUDENT_BLOCKED_FOR_CREATE_INTENT',
          message:
            'User đang muốn tạo học viên mới, không được tự cập nhật học viên cũ.',
        });
      }
    }

    const action = await this.prisma.aiAgentAction.create({
      data: {
        sessionId,
        actorUserId: actor.userId,
        actionName: toolName,
        status: 'PENDING',
        inputJson: this.toJson(input),
        startedAt: new Date(),
      },
    });

    try {
      const output = await this.executeWriteTool(
        actor.tenantId,
        toolName,
        input,
      );
      const safeOutput = this.toJson(output);

      await this.prisma.aiAgentAction.update({
        where: { id: action.id },
        data: {
          status: 'SUCCESS',
          outputJson: safeOutput,
          finishedAt: new Date(),
        },
      });

      await this.writeAuditLog(actor, toolName, safeOutput);
      return output;
    } catch (error: any) {
      await this.prisma.aiAgentAction.update({
        where: { id: action.id },
        data: {
          status: 'FAILED',
          errorMessage: error?.message || 'Tool execution failed',
          finishedAt: new Date(),
        },
      });

      throw error;
    }
  }

  private async getSessionStateIfAvailable(
    sessionId: number,
  ): Promise<any | null> {
    try {
      const session = await this.prisma.aiAgentSession.findUnique({
        where: { id: sessionId },
        select: { state: true },
      });
      return (session?.state as any) ?? null;
    } catch {
      return null;
    }
  }

  findActions(tenantId: number) {
    return this.prisma.aiAgentAction.findMany({
      where: {
        session: {
          tenantId,
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  findAuditLogs(tenantId: number) {
    return this.prisma.aiAgentAuditLog.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  findEnrollmentByStudentAndCourse(
    tenantId: number,
    studentId: number,
    courseId: number,
  ) {
    return this.enrollmentsService.findByStudentAndCourse(
      tenantId,
      studentId,
      courseId,
    );
  }

  findEnrollmentByStudentAndClass(
    tenantId: number,
    studentId: number,
    classId: number,
  ) {
    return this.coursesService.findEnrollmentByStudentAndClass(
      tenantId,
      studentId,
      classId,
    );
  }

  findStudentCourseClassEnrollments(
    tenantId: number,
    studentId: number,
    courseId: number,
  ) {
    return this.coursesService.findStudentCourseClassEnrollments(
      tenantId,
      courseId,
      studentId,
    );
  }

  private async executeWriteTool(
    tenantId: number,
    toolName: AiToolName,
    input: Record<string, unknown>,
  ) {
    switch (toolName) {
      case 'create_student':
        return this.usersService.createStudent(tenantId, {
          fullName: this.requireString(input.fullName, 'fullName'),
          email: this.optionalString(input.email),
          phone: this.optionalString(input.phone),
          address: this.optionalString(input.address),
          birthDate: this.optionalDateString(input.birthDate),
        });
      case 'update_student':
        return this.usersService.updateStudent(
          tenantId,
          this.requireNumber(input.userId, 'userId'),
          {
            fullName: this.optionalString(input.fullName),
            email: this.optionalString(input.email),
            phone: this.optionalString(input.phone),
            address: this.optionalString(input.address),
            birthDate: this.optionalDateString(input.birthDate),
          },
        );
      case 'delete_students':
        return this.usersService.deleteStudents(tenantId, {
          ids: this.optionalNumberArray(input.ids),
          all: input.all === true,
        });
      case 'create_course': {
        const title =
          this.optionalString(input.title) ?? this.optionalString(input.name);
        if (!title) {
          throw new BadRequestException('Thiếu tên khóa học');
        }
        return this.coursesService.createCourse(tenantId, {
          title,
          courseCode:
            this.optionalString(input.courseCode) ??
            this.optionalString(input.code),
          description: this.optionalString(input.description),
          level:
            this.optionalString(input.level) ?? this.optionalString(input.type),
          status: this.optionalString(input.status),
          // Khóa học không có ngày bắt đầu/kết thúc — ngày chỉ thuộc lớp học.
        });
      }
      case 'update_course':
        // optionalString/optionalDateString trả undefined cho chuỗi rỗng ->
        // service bỏ qua field undefined, KHÔNG ghi đè giá trị cũ.
        return this.coursesService.updateCourse(
          tenantId,
          this.requireNumber(input.courseId, 'courseId'),
          {
            title: this.optionalString(input.title),
            courseCode: this.optionalString(input.courseCode),
            description: this.optionalString(input.description),
            level: this.optionalString(input.level),
            status: this.optionalString(input.status),
          },
        );
      case 'delete_courses':
        return this.coursesService.deleteCourses(tenantId, {
          ids: this.optionalNumberArray(input.ids),
          all: input.all === true,
        });
      case 'create_class':
        return this.coursesService.createClass(tenantId, {
          courseId: this.requireNumber(input.courseId, 'courseId'),
          title: this.requireString(input.title, 'title'),
          type: this.optionalString(input.type) ?? 'WEEKLY',
          description: this.optionalString(input.description),
          teacherName: this.optionalString(input.teacherName),
          startDate: this.optionalDateString(input.startDate),
          endDate: this.optionalDateString(input.endDate),
          sessions: this.normalizeSessions(input.sessions),
        });
      case 'update_class':
        return this.coursesService.updateClass(
          tenantId,
          this.requireNumber(input.classId, 'classId'),
          {
            title: this.optionalString(input.title),
            classCode: this.optionalString(input.classCode),
            type: this.optionalString(input.classType),
            description: this.optionalString(input.description),
            teacherName: this.optionalString(input.teacherName),
            startDate: this.optionalDateString(input.startDate),
            endDate: this.optionalDateString(input.endDate),
            status: this.optionalString(input.status),
          },
        );
      case 'close_class':
        return this.coursesService.changeClassStatus(
          tenantId,
          this.requireNumber(input.classId, 'classId'),
          'CLOSED',
          this.optionalString(input.expectedStatus),
        );
      case 'assign_student_to_class':
        // Bản gộp: userIds[] -> thêm từng người, partial success (người lỗi
        // không làm hỏng người khác), trả kết quả theo từng dòng.
        if (Array.isArray(input.userIds) && input.userIds.length > 0) {
          return this.assignStudentsToClass(tenantId, input);
        }
        return this.coursesService.addStudentToClass(
          tenantId,
          this.requireNumber(input.classId, 'classId'),
          {
            userId: this.requireNumber(input.userId, 'userId'),
            roleInClass: this.optionalString(input.roleInClass) || 'STUDENT',
            joinedAt: this.optionalDateString(input.joinedAt),
          },
        );
      case 'assign_student_to_course':
        return this.assignStudentToCourse(tenantId, input);
      case 'remove_student_from_class':
        return this.coursesService.removeStudentFromClass(
          tenantId,
          this.requireNumber(input.classId, 'classId'),
          this.requireNumber(input.userId, 'userId'),
        );
      case 'remove_student_from_course_classes':
        return this.coursesService.removeStudentFromCourseClasses(
          tenantId,
          this.requireNumber(input.courseId, 'courseId'),
          this.requireNumber(input.userId, 'userId'),
        );
      default:
        throw new BadRequestException('WRITE tool không được hỗ trợ');
    }
  }

  /**
   * Ghi danh GỘP nhiều học viên vào 1 lớp: validate lớp 1 lần rồi thêm từng
   * người. Partial success — người trùng/lỗi chỉ fail dòng đó, người còn lại
   * vẫn được ghi. Trả kết quả từng dòng để FE hiển thị ✓/⚠/✗.
   */
  private async assignStudentsToClass(
    tenantId: number,
    input: Record<string, unknown>,
  ) {
    const classId = this.requireNumber(input.classId, 'classId');
    const roleInClass = this.optionalString(input.roleInClass) || 'STUDENT';
    const joinedAt = this.optionalDateString(input.joinedAt);
    // Validate lớp TRƯỚC vòng lặp: lớp sai/đóng thì fail cả batch ngay, không
    // tạo ra kết quả nửa vời khó hiểu.
    const courseClass: any = await this.coursesService.findOneClass(
      tenantId,
      classId,
    );

    const userIds = (input.userIds as unknown[])
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0);

    const items: Array<{
      userId: number;
      studentName: string | null;
      status: 'SUCCESS' | 'ALREADY_IN_CLASS' | 'ERROR';
      message: string | null;
    }> = [];

    for (const userId of userIds) {
      try {
        const enrollment: any = await this.coursesService.addStudentToClass(
          tenantId,
          classId,
          { userId, roleInClass, joinedAt },
        );
        items.push({
          userId,
          studentName: enrollment?.user?.fullName || null,
          status: 'SUCCESS',
          message: null,
        });
      } catch (error: any) {
        const message =
          error?.response?.message || error?.message || 'Lỗi không xác định';
        items.push({
          userId,
          studentName: null,
          status:
            error instanceof ConflictException ? 'ALREADY_IN_CLASS' : 'ERROR',
          message: String(message),
        });
      }
    }

    return {
      bulk: true,
      classId,
      className: courseClass?.title || courseClass?.classCode || null,
      courseId: courseClass?.courseId ?? courseClass?.course?.id ?? null,
      courseName: courseClass?.course?.title || null,
      total: items.length,
      successCount: items.filter((item) => item.status === 'SUCCESS').length,
      items,
    };
  }

  /**
   * Ghi danh học viên vào KHÓA (contract ngoài cho Agent/FE). Bên trong map sang
   * class vì DB ghi danh theo class:
   * validate học viên -> validate khóa -> check trùng ghi danh khóa ->
   * tìm class ACTIVE của khóa -> 1 class thì ghi danh; nhiều/không có class thì
   * trả lỗi có code rõ ràng cho CopilotService xử lý.
   */
  private async assignStudentToCourse(
    tenantId: number,
    input: Record<string, unknown>,
  ) {
    const userId = this.requireNumber(input.userId, 'userId');
    const courseId = this.requireNumber(input.courseId, 'courseId');
    const explicitClassId = this.optionalNumber(input.classId);
    const joinedAt = this.optionalDateString(input.joinedAt);
    const roleInClass = this.optionalString(input.roleInClass) || 'STUDENT';
    const expireDate = this.optionalDateString(input.expireDate);
    const allowLatePayment = this.optionalBoolean(input.allowLatePayment);
    const note = this.optionalString(input.note);

    // 1. Validate học viên
    try {
      await this.usersService.findOneStudent(tenantId, userId);
    } catch {
      throw new BadRequestException({
        code: 'STUDENT_NOT_FOUND',
        message: 'Không tìm thấy học viên cần ghi danh.',
      });
    }

    // 2. Validate khóa
    try {
      await this.coursesService.findOneCourse(tenantId, courseId);
    } catch {
      throw new BadRequestException({
        code: 'COURSE_NOT_FOUND',
        message: 'Không tìm thấy khóa học cần ghi danh.',
      });
    }

    // 3. Check học viên đã ghi danh khóa này chưa
    const existingEnrollment = await this.findEnrollmentByStudentAndCourse(
      tenantId,
      userId,
      courseId,
    );
    if (existingEnrollment) {
      throw new ConflictException({
        code: 'STUDENT_ALREADY_ASSIGNED_TO_COURSE',
        message: 'Học viên này đã được ghi danh vào khóa học.',
        studentId: userId,
        courseId,
      });
    }

    // 4. Xác định class đích trong khóa
    let targetClassId = explicitClassId;
    if (!targetClassId) {
      const classes = await this.coursesService.findClassesForCourse(
        tenantId,
        courseId,
      );
      // Chỉ lớp ACTIVE mới ghi danh được — phải khớp guard trong
      // CoursesService.addStudentToClass, nếu không sẽ chọn được lớp
      // ở đây rồi fail lúc ghi.
      const activeClasses = classes.filter(
        (c: any) => String(c.status) === 'ACTIVE',
      );

      if (activeClasses.length === 0) {
        throw new BadRequestException({
          code: 'COURSE_HAS_NO_ACTIVE_CLASS',
          message:
            'Khóa học này chưa có lớp đang hoạt động nên chưa thể ghi danh học viên.',
          courseId,
        });
      }

      if (activeClasses.length > 1) {
        throw new BadRequestException({
          code: 'COURSE_HAS_MULTIPLE_CLASSES',
          message:
            'Khóa học này có nhiều lớp. Vui lòng chọn lớp cụ thể để ghi danh.',
          courseId,
          classes: activeClasses.map((c: any) => this.toSafeClassOption(c)),
        });
      }

      targetClassId = activeClasses[0].id;
    }

    // 5. Ghi danh vào class (dùng service nghiệp vụ, không gọi Prisma trực tiếp)
    const enrollment = await this.coursesService.addStudentToClass(
      tenantId,
      targetClassId,
      {
        userId,
        roleInClass,
        joinedAt,
        expireDate,
        allowLatePayment,
        note,
      },
    );

    return {
      id: enrollment.id,
      enrollmentId: enrollment.id,
      studentId: userId,
      userId,
      courseId,
      classId: targetClassId,
      roleInClass: enrollment.roleInClass,
      joinedAt: enrollment.joinedAt,
      // Trả giá trị ĐÃ LƯU trong ClassEnrollment (không phải input echo).
      expireDate: (enrollment as any).expireDate ?? null,
      allowLatePayment: (enrollment as any).allowLatePayment ?? null,
      note: (enrollment as any).note ?? null,
      user: enrollment.user,
      course: (enrollment as any).courseClass?.course,
      courseClass: (enrollment as any).courseClass,
    };
  }

  private toSafeClassOption(c: any) {
    return {
      id: Number(c.id),
      value: Number(c.id),
      label: String(c.title || c.classCode || `#${c.id}`),
      classCode: c.classCode ?? null,
      status: c.status ?? null,
      courseId: c.courseId ?? null,
    };
  }

  private async writeAuditLog(
    actor: ActorPayload,
    toolName: AiToolName,
    output: any,
  ) {
    const auditMap: Partial<
      Record<
        AiToolName,
        { eventType: string; entityType: string; oldData?: boolean }
      >
    > = {
      create_student: { eventType: 'CREATE', entityType: 'STUDENT' },
      update_student: { eventType: 'UPDATE', entityType: 'STUDENT' },
      delete_students: {
        eventType: 'DELETE',
        entityType: 'STUDENT',
        oldData: true,
      },
      create_course: { eventType: 'CREATE', entityType: 'COURSE' },
      update_course: { eventType: 'UPDATE', entityType: 'COURSE' },
      delete_courses: {
        eventType: 'DELETE',
        entityType: 'COURSE',
        oldData: true,
      },
      create_class: { eventType: 'CREATE', entityType: 'COURSE_CLASS' },
      update_class: { eventType: 'UPDATE', entityType: 'COURSE_CLASS' },
      close_class: { eventType: 'CLOSE', entityType: 'COURSE_CLASS' },
      assign_student_to_class: {
        eventType: 'ASSIGN',
        entityType: 'CLASS_ENROLLMENT',
      },
      assign_student_to_course: {
        eventType: 'ASSIGN',
        entityType: 'CLASS_ENROLLMENT',
      },
      remove_student_from_class: {
        eventType: 'REMOVE',
        entityType: 'CLASS_ENROLLMENT',
        oldData: true,
      },
      remove_student_from_course_classes: {
        eventType: 'REMOVE',
        entityType: 'CLASS_ENROLLMENT',
        oldData: true,
      },
    };

    const audit = auditMap[toolName];
    if (!audit) return;

    await this.prisma.aiAgentAuditLog.create({
      data: {
        tenantId: actor.tenantId,
        userId: actor.userId,
        eventType: audit.eventType,
        entityType: audit.entityType,
        entityId: typeof output?.id === 'number' ? output.id : null,
        oldDataJson: audit.oldData ? this.toJson(output) : undefined,
        newDataJson: audit.oldData ? undefined : this.toJson(output),
      },
    });
  }

  private optionalString(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed || undefined;
  }

  private requireString(value: unknown, field: string): string {
    const text = this.optionalString(value);
    if (!text) {
      throw new BadRequestException(`Thiếu ${field}`);
    }
    return text;
  }

  private optionalDateString(value: unknown): string | undefined {
    const str = this.optionalString(value);
    if (!str) return undefined;
    return isNaN(new Date(str).getTime()) ? undefined : str;
  }

  private optionalNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
  }

  private requireNumber(value: unknown, field: string): number {
    const parsed = this.optionalNumber(value);
    if (!parsed) {
      throw new BadRequestException(`Thiếu ${field}`);
    }
    return parsed;
  }

  private optionalBoolean(value: unknown): boolean | undefined {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const text = value.trim().toLowerCase();
      if (['true', '1', 'yes', 'co'].includes(text)) return true;
      if (['false', '0', 'no', 'khong'].includes(text)) return false;
    }
    return undefined;
  }

  private optionalNumberArray(value: unknown): number[] | undefined {
    if (!Array.isArray(value)) return undefined;
    return value
      .map((item) => this.optionalNumber(item))
      .filter((item): item is number => typeof item === 'number' && item > 0);
  }

  private normalizeSessions(value: unknown): Array<{
    title?: string;
    dayOfWeek?: number;
    startTime?: string;
    endTime?: string;
    sessionDate?: string;
    room?: string;
    note?: string;
  }> {
    if (!Array.isArray(value)) return [];

    const sessions: Array<{
      title?: string;
      dayOfWeek?: number;
      startTime?: string;
      endTime?: string;
      sessionDate?: string;
      room?: string;
      note?: string;
    }> = [];

    for (const item of value) {
      if (!item || typeof item !== 'object') continue;

      const row = item as Record<string, unknown>;
      sessions.push({
        title: this.optionalString(row.title),
        dayOfWeek: this.optionalNumber(row.dayOfWeek),
        startTime: this.optionalString(row.startTime),
        endTime: this.optionalString(row.endTime),
        sessionDate: this.optionalDateString(row.sessionDate),
        room: this.optionalString(row.room),
        note: this.optionalString(row.note),
      });
    }

    return sessions;
  }

  private toJson(value: unknown) {
    return JSON.parse(JSON.stringify(value ?? null));
  }
}
