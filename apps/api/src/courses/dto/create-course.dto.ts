import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateCourseDto {
  @IsNotEmpty({ message: 'Tên khóa học không được để trống' })
  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  courseCode?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  level?: string;
}
