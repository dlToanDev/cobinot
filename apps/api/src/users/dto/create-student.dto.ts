import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsDateString,
  Matches,
} from 'class-validator';

export class CreateStudentDto {
  @IsNotEmpty({ message: 'Họ và tên không được để trống' })
  @IsString()
  fullName: string;

  @IsOptional()
  @IsEmail({}, { message: 'Email không đúng định dạng' })
  email?: string;

  @IsOptional()
  @Matches(/^[0-9]{10}$/, { message: 'Số điện thoại phải có đúng 10 chữ số' })
  phone?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsDateString({}, { message: 'Ngày sinh không đúng định dạng' })
  birthDate?: string;
}
