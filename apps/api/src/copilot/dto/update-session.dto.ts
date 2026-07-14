import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class UpdateCopilotSessionDto {
  @IsNotEmpty({ message: 'Tên phiên chat không được để trống' })
  @IsString()
  @MaxLength(120, { message: 'Tên phiên chat tối đa 120 ký tự' })
  title: string;
}
