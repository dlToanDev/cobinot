import { IsDateString, IsIn, IsOptional, IsString } from 'class-validator';

export class UpdateClassDto {
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
