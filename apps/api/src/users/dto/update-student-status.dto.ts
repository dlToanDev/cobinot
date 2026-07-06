import { IsIn, IsNotEmpty } from 'class-validator';

export class UpdateStudentStatusDto {
  @IsNotEmpty({ message: 'Trạng thái không được để trống' })
  @IsIn(['ACTIVE', 'INACTIVE', 'LOCKED'], {
    message: 'Trạng thái phải là ACTIVE, INACTIVE hoặc LOCKED',
  })
  status: string;
}
