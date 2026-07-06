import { IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';
import type { SuggestionAction } from '../../ai-agent/decision.types';

export class CreateCopilotMessageDto {
  @IsNotEmpty({ message: 'Nội dung tin nhắn không được để trống' })
  @IsString()
  content: string;

  @IsOptional()
  @IsString()
  role?: string;

  @IsOptional()
  @IsString()
  toolName?: string;

  @IsOptional()
  @IsObject()
  action?: SuggestionAction;
}
