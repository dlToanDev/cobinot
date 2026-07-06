import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsDateString,
} from 'class-validator';

export class CreateEnrollmentDto {
  @IsNotEmpty({ message: 'Mã học viên không được để trống' })
  @IsInt({ message: 'Mã học viên phải là số nguyên' })
  userId: number;

  @IsNotEmpty({ message: 'Mã khóa học không được để trống' })
  @IsInt({ message: 'Mã khóa học phải là số nguyên' })
  courseId: number;

  @IsOptional()
  @IsString()
  roleInCourse?: string;

  @IsOptional()
  @IsDateString({}, { message: 'Ngày tham gia không đúng định dạng' })
  joinedAt?: string;

  @IsOptional()
  @IsDateString({}, { message: 'Ngày kết thúc không đúng định dạng' })
  endDate?: string;
}
