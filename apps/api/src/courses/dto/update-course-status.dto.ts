import { IsIn, IsNotEmpty } from 'class-validator';

export class UpdateCourseStatusDto {
  @IsNotEmpty({ message: 'Trạng thái không được để trống' })
  @IsIn(['ACTIVE', 'INACTIVE', 'CLOSED'], {
    message: 'Trạng thái phải là ACTIVE, INACTIVE hoặc CLOSED',
  })
  status: string;
}
