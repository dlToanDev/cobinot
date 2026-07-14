import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

// Khóa học không có ngày bắt đầu/kết thúc — ngày chỉ thuộc lớp học (CourseClass).
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

  @IsOptional()
  @IsString()
  status?: string;
}
