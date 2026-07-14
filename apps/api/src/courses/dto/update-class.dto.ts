import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
} from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateClassDto {
  /** Đổi khóa học cha cho lớp; phải thuộc cùng tenant. */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Khóa học không hợp lệ' })
  courseId?: number;

  @IsOptional()
  @IsString()
  classCode?: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsIn(['WEEKLY', 'EXAM_PRACTICE'], {
    message: 'Loại lớp chỉ được là WEEKLY hoặc EXAM_PRACTICE',
  })
  type?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  teacherName?: string;

  @IsOptional()
  @IsDateString({}, { message: 'Ngày bắt đầu không đúng định dạng' })
  startDate?: string;

  @IsOptional()
  @IsDateString({}, { message: 'Ngày kết thúc không đúng định dạng' })
  endDate?: string;

  @IsOptional()
  @IsString()
  status?: string;
}
