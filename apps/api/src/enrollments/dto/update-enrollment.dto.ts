import { IsDateString, IsOptional, IsString } from 'class-validator';

export class UpdateEnrollmentDto {
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
