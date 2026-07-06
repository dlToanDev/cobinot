import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { CoursesService } from './courses.service';
import { CreateCourseDto } from './dto/create-course.dto';
import { UpdateCourseDto } from './dto/update-course.dto';
import { UpdateCourseStatusDto } from './dto/update-course-status.dto';
import { BulkDeleteCoursesDto } from './dto/bulk-delete-courses.dto';
import { CreateClassDto } from './dto/create-class.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import {
  GetActor,
  ActorPayload,
} from '../common/decorators/get-actor.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('courses')
export class CoursesController {
  constructor(private readonly coursesService: CoursesService) {}

  @Get()
  async findAll(
    @GetActor() actor: ActorPayload,
    @Query('keyword') keyword?: string,
    @Query('status') status?: string,
  ) {
    return this.coursesService.findAllCourses(actor.tenantId, {
      keyword,
      status,
    });
  }

  @Get(':id')
  async findOne(
    @GetActor() actor: ActorPayload,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.coursesService.findOneCourse(actor.tenantId, id);
  }

  @Post()
  async create(@GetActor() actor: ActorPayload, @Body() dto: CreateCourseDto) {
    return this.coursesService.createCourse(actor.tenantId, dto);
  }

  @Get(':courseId/classes')
  async findClasses(
    @GetActor() actor: ActorPayload,
    @Param('courseId', ParseIntPipe) courseId: number,
    @Query('type') type?: string,
    @Query('status') status?: string,
  ) {
    return this.coursesService.findClassesForCourse(actor.tenantId, courseId, {
      type,
      status,
    });
  }

  @Post(':courseId/classes')
  async createClass(
    @GetActor() actor: ActorPayload,
    @Param('courseId', ParseIntPipe) courseId: number,
    @Body() dto: CreateClassDto,
  ) {
    return this.coursesService.createClass(actor.tenantId, courseId, dto);
  }

  @Patch(':id')
  async update(
    @GetActor() actor: ActorPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCourseDto,
  ) {
    return this.coursesService.updateCourse(actor.tenantId, id, dto);
  }

  @Patch(':id/status')
  async updateStatus(
    @GetActor() actor: ActorPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCourseStatusDto,
  ) {
    return this.coursesService.updateCourseStatus(
      actor.tenantId,
      id,
      dto.status,
    );
  }

  @Delete('bulk')
  async bulkRemove(
    @GetActor() actor: ActorPayload,
    @Body() dto: BulkDeleteCoursesDto,
  ) {
    return this.coursesService.deleteCourses(actor.tenantId, dto);
  }

  @Delete(':id')
  async remove(
    @GetActor() actor: ActorPayload,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.coursesService.deleteCourse(actor.tenantId, id);
  }

  @Get(':id/students')
  async findStudents(
    @GetActor() actor: ActorPayload,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.coursesService.getCourseStudents(actor.tenantId, id);
  }
}
