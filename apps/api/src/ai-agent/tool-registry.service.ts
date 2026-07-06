import { BadRequestException, Injectable } from '@nestjs/common';
import { ActorPayload } from '../common/decorators/get-actor.decorator';
import { CoursesService } from '../courses/courses.service';
import { EnrollmentsService } from '../enrollments/enrollments.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { AiToolName } from './decision.types';
import { isWriteTool } from './tool-definitions';

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
      case 'create_course':
        return this.coursesService.createCourse(tenantId, {
          title: this.requireString(input.title, 'title'),
          courseCode: this.optionalString(input.courseCode),
          description: this.optionalString(input.description),
          level: this.optionalString(input.level),
        });
      case 'update_course':
        return this.coursesService.updateCourse(
          tenantId,
          this.requireNumber(input.courseId, 'courseId'),
          {
            title: this.optionalString(input.title),
            courseCode: this.optionalString(input.courseCode),
            description: this.optionalString(input.description),
            level: this.optionalString(input.level),
          },
        );
      case 'delete_courses':
        return this.coursesService.deleteCourses(tenantId, {
          ids: this.optionalNumberArray(input.ids),
          all: input.all === true,
        });
      case 'create_class':
        return this.coursesService.createClass(
          tenantId,
          this.requireNumber(input.courseId, 'courseId'),
          {
            title: this.requireString(input.title, 'title'),
            classCode: this.optionalString(input.classCode),
            type: this.requireString(input.classType, 'classType'),
            description: this.optionalString(input.description),
            teacherName: this.optionalString(input.teacherName),
            startDate: this.optionalDateString(input.startDate),
            endDate: this.optionalDateString(input.endDate),
            enrollStudentId: this.optionalNumber(input.enrollStudentId),
          },
        );
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
        return this.coursesService.addStudentToClass(
          tenantId,
          this.requireNumber(input.classId, 'classId'),
          {
            userId: this.requireNumber(input.userId, 'userId'),
            roleInClass: this.optionalString(input.roleInClass) || 'STUDENT',
            joinedAt: this.optionalDateString(input.joinedAt),
          },
        );
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
    return this.optionalString(value);
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

  private optionalNumberArray(value: unknown): number[] | undefined {
    if (!Array.isArray(value)) return undefined;
    return value
      .map((item) => this.optionalNumber(item))
      .filter((item): item is number => typeof item === 'number' && item > 0);
  }

  private toJson(value: unknown) {
    return JSON.parse(JSON.stringify(value ?? null));
  }
}
