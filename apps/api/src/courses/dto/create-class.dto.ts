import {
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateClassDto {
  @IsOptional()
  @IsString()
  classCode?: string;

  @IsNotEmpty({ message: 'Tên lớp không được để trống' })
  @IsString()
  title: string;

  @IsOptional()
  @IsIn(['WEEKLY', 'PRACTICE'], {
    message: 'Loại lớp chỉ được là WEEKLY hoặc PRACTICE',
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
}
