import { IsDateString, IsIn, IsInt, IsOptional, Min } from 'class-validator';

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
}
