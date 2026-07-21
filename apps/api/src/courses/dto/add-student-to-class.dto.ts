import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class AddStudentToClassDto {
  @IsInt()
  @Min(1)
  userId: number;

  @IsOptional()
  @IsIn(['STUDENT', 'TEACHER'], {
    message: 'Vai trò trong lớp chỉ được là STUDENT hoặc TEACHER',
  })
  roleInClass?: string;

  @IsOptional()
  @IsDateString({}, { message: 'Ngày tham gia không đúng định dạng' })
  joinedAt?: string;

  @IsOptional()
  @IsDateString({}, { message: 'Ngày kết thúc không đúng định dạng' })
  endedAt?: string;

  @IsOptional()
  @IsDateString({}, { message: 'Ngày hết hạn học không đúng định dạng' })
  expireDate?: string;

  @IsOptional()
  @IsBoolean()
  allowLatePayment?: boolean;

  @IsOptional()
  @IsString()
  note?: string;
}
