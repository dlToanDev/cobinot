import { BadRequestException, Injectable } from '@nestjs/common';
import { CoursesService } from '../courses/courses.service';
import { UsersService } from '../users/users.service';
import { AiToolName } from './decision.types';
import { isReadTool } from './tool-definitions';

@Injectable()
export class ToolExecutorService {
  constructor(
    private readonly usersService: UsersService,
    private readonly coursesService: CoursesService,
  ) {}

  async executeRead(
    tenantId: number,
    toolName: AiToolName,
    args: Record<string, unknown>,
  ) {
    if (!isReadTool(toolName)) {
      throw new BadRequestException('Tool này không phải READ tool');
    }

    switch (toolName) {
      case 'search_student':
        return this.usersService.findAllStudents(tenantId, {
          keyword: this.optionalString(args.keyword),
        });
      case 'get_student_detail':
        return this.usersService.getStudentDetail(
          tenantId,
          this.requireNumber(args.userId, 'userId'),
        );
      case 'search_course':
        return this.coursesService.findAllCourses(tenantId, {
          keyword: this.optionalString(args.keyword),
        });
      case 'get_course_detail':
        return this.coursesService.getCourseDetail(
          tenantId,
          this.requireNumber(args.courseId, 'courseId'),
        );
      case 'get_course_classes':
        return this.coursesService.findClassesForCourse(
          tenantId,
          this.requireNumber(args.courseId, 'courseId'),
        );
      case 'search_class':
        return this.coursesService.findAllClasses(tenantId, {
          keyword: this.optionalString(args.keyword),
          courseId: this.optionalNumber(args.courseId),
          type: this.optionalString(args.classType),
          status: this.optionalString(args.status),
        });
      case 'get_class_detail':
        return this.coursesService.getClassDetail(
          tenantId,
          this.requireNumber(args.classId, 'classId'),
        );
      case 'get_class_students':
        return this.coursesService.getClassStudents(
          tenantId,
          this.requireNumber(args.classId, 'classId'),
        );
      default:
        throw new BadRequestException('READ tool không được hỗ trợ');
    }
  }

  private optionalString(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed || undefined;
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
}
