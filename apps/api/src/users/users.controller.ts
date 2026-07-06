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
import { UsersService } from './users.service';
import { CreateStudentDto } from './dto/create-student.dto';
import { UpdateStudentDto } from './dto/update-student.dto';
import { UpdateStudentStatusDto } from './dto/update-student-status.dto';
import { BulkDeleteStudentsDto } from './dto/bulk-delete-students.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import {
  GetActor,
  ActorPayload,
} from '../common/decorators/get-actor.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('students')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  async findAll(
    @GetActor() actor: ActorPayload,
    @Query('keyword') keyword?: string,
    @Query('status') status?: string,
  ) {
    return this.usersService.findAllStudents(actor.tenantId, {
      keyword,
      status,
    });
  }

  @Get(':id')
  async findOne(
    @GetActor() actor: ActorPayload,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.usersService.findOneStudent(actor.tenantId, id);
  }

  @Post()
  async create(@GetActor() actor: ActorPayload, @Body() dto: CreateStudentDto) {
    return this.usersService.createStudent(actor.tenantId, dto);
  }

  @Patch(':id')
  async update(
    @GetActor() actor: ActorPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateStudentDto,
  ) {
    return this.usersService.updateStudent(actor.tenantId, id, dto);
  }

  @Patch(':id/status')
  async updateStatus(
    @GetActor() actor: ActorPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateStudentStatusDto,
  ) {
    return this.usersService.updateStudentStatus(
      actor.tenantId,
      id,
      dto.status,
    );
  }

  @Delete('bulk')
  async bulkRemove(
    @GetActor() actor: ActorPayload,
    @Body() dto: BulkDeleteStudentsDto,
  ) {
    return this.usersService.deleteStudents(actor.tenantId, dto);
  }

  @Delete(':id')
  async remove(
    @GetActor() actor: ActorPayload,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.usersService.deleteStudent(actor.tenantId, id);
  }

  @Get(':id/courses')
  async findCourses(
    @GetActor() actor: ActorPayload,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.usersService.getStudentCourses(actor.tenantId, id);
  }

  @Delete(':studentId/courses/:courseId')
  async removeCourse(
    @GetActor() actor: ActorPayload,
    @Param('studentId', ParseIntPipe) studentId: number,
    @Param('courseId', ParseIntPipe) courseId: number,
  ) {
    return this.usersService.removeStudentCourse(
      actor.tenantId,
      studentId,
      courseId,
    );
  }
}
