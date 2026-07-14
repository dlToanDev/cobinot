import { IsOptional, IsString } from 'class-validator';

// Khóa học không có ngày bắt đầu/kết thúc — ngày chỉ thuộc lớp học (CourseClass).
export class UpdateCourseDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  courseCode?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  level?: string;

  @IsOptional()
  @IsString()
  status?: string;
}
