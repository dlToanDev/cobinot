import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  Min,
} from 'class-validator';

export class BulkDeleteStudentsDto {
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  ids?: number[];

  @IsOptional()
  @IsBoolean()
  all?: boolean;
}
