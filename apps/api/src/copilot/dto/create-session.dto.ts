import { IsOptional, IsString } from 'class-validator';

export class CreateCopilotSessionDto {
  @IsOptional()
  @IsString()
  title?: string;
}
