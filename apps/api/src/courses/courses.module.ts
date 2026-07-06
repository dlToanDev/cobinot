import { Module } from '@nestjs/common';
import { CoursesController } from './courses.controller';
import { CoursesService } from './courses.service';
import { ClassesController } from './classes.controller';

@Module({
  controllers: [CoursesController, ClassesController],
  providers: [CoursesService],
  exports: [CoursesService],
})
export class CoursesModule {}
