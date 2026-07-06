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
import { EnrollmentsService } from './enrollments.service';
import { CreateEnrollmentDto } from './dto/create-enrollment.dto';
import { UpdateEnrollmentDto } from './dto/update-enrollment.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import {
  GetActor,
  ActorPayload,
} from '../common/decorators/get-actor.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('enrollments')
export class EnrollmentsController {
  constructor(private readonly enrollmentsService: EnrollmentsService) {}

  @Get()
  async findAll(
    @GetActor() actor: ActorPayload,
    @Query('keyword') keyword?: string,
    @Query('courseId') courseId?: string,
  ) {
    const parsedCourseId = courseId ? parseInt(courseId, 10) : NaN;
    return this.enrollmentsService.findAll(actor.tenantId, {
      keyword,
      courseId: isNaN(parsedCourseId) ? undefined : parsedCourseId,
    });
  }

  @Post()
  async create(
    @GetActor() actor: ActorPayload,
    @Body() dto: CreateEnrollmentDto,
  ) {
    return this.enrollmentsService.create(actor.tenantId, dto);
  }

  @Delete(':id')
  async remove(
    @GetActor() actor: ActorPayload,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.enrollmentsService.remove(actor.tenantId, id);
  }

  @Patch(':id')
  async update(
    @GetActor() actor: ActorPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateEnrollmentDto,
  ) {
    return this.enrollmentsService.update(actor.tenantId, id, dto);
  }
}
