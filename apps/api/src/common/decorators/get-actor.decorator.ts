import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export class ActorPayload {
  userId: number;
  tenantId: number;
  role: string;
}

export const GetActor = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): ActorPayload => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
