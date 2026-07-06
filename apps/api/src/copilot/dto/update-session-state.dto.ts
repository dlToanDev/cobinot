import { IsObject } from 'class-validator';

export class UpdateSessionStateDto {
  @IsObject()
  patch: Record<string, unknown>;
}
