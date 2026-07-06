import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  ActorPayload,
  GetActor,
} from '../common/decorators/get-actor.decorator';
import { CoursesService } from './courses.service';
import { UpdateClassDto } from './dto/update-class.dto';
import { AddStudentToClassDto } from './dto/add-student-to-class.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('classes')
export class ClassesController {
  constructor(private readonly coursesService: CoursesService) {}

  @Get(':id')
  async findOne(
    @GetActor() actor: ActorPayload,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.coursesService.findOneClass(actor.tenantId, id);
  }

  @Patch(':id')
  async update(
    @GetActor() actor: ActorPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateClassDto,
  ) {
    return this.coursesService.updateClass(actor.tenantId, id, dto);
  }

  @Delete(':id')
  async remove(
    @GetActor() actor: ActorPayload,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.coursesService.deleteClass(actor.tenantId, id);
  }

  @Get(':id/students')
  async findStudents(
    @GetActor() actor: ActorPayload,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.coursesService.getClassStudents(actor.tenantId, id);
  }

  @Post(':id/students')
  async addStudent(
    @GetActor() actor: ActorPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AddStudentToClassDto,
  ) {
    return this.coursesService.addStudentToClass(actor.tenantId, id, dto);
  }

  @Delete(':id/students/:studentId')
  async removeStudent(
    @GetActor() actor: ActorPayload,
    @Param('id', ParseIntPipe) id: number,
    @Param('studentId', ParseIntPipe) studentId: number,
  ) {
    return this.coursesService.removeStudentFromClass(
      actor.tenantId,
      id,
      studentId,
    );
  }
}
