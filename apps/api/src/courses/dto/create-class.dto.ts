import {
  IsArray,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateClassSessionDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsNumber()
  dayOfWeek?: number;

  @IsOptional()
  @IsString()
  startTime?: string;

  @IsOptional()
  @IsString()
  endTime?: string;

  @IsOptional()
  @IsDateString({}, { message: 'Ngày học không đúng định dạng' })
  sessionDate?: string;

  @IsOptional()
  @IsString()
  room?: string;

  @IsOptional()
  @IsString()
  note?: string;
}

export class CreateClassDto {
  @IsNotEmpty({ message: 'Tên lớp không được để trống' })
  @IsString()
  title: string;

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
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateClassSessionDto)
  sessions?: CreateClassSessionDto[];
}
