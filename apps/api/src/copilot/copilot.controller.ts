import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import {
  ActorPayload,
  GetActor,
} from '../common/decorators/get-actor.decorator';
import { CopilotService } from './copilot.service';
import { CreateCopilotSessionDto } from './dto/create-session.dto';
import { CreateCopilotMessageDto } from './dto/create-message.dto';
import { UpdateSessionStateDto } from './dto/update-session-state.dto';
import { UpdateCopilotSessionDto } from './dto/update-session.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('copilot')
export class CopilotController {
  constructor(private readonly copilotService: CopilotService) {}

  @Post('sessions')
  createSession(
    @GetActor() actor: ActorPayload,
    @Body() dto: CreateCopilotSessionDto,
  ) {
    return this.copilotService.createSession(actor.tenantId, actor.userId, dto);
  }

  @Get('sessions')
  findSessions(
    @GetActor() actor: ActorPayload,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    // Service tự clamp limit/offset (mặc định 10, tối đa 50).
    return this.copilotService.findSessions(actor.tenantId, actor.userId, {
      limit: limit !== undefined ? Number(limit) : undefined,
      offset: offset !== undefined ? Number(offset) : undefined,
    });
  }

  @Get('sessions/current')
  getCurrentSession(@GetActor() actor: ActorPayload) {
    return this.copilotService.getOrCreateCurrentSession(
      actor.tenantId,
      actor.userId,
    );
  }

  @Get('sessions/:id')
  findSession(
    @GetActor() actor: ActorPayload,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.copilotService.findSession(actor.tenantId, actor.userId, id);
  }

  @Get('sessions/:id/messages')
  findMessages(
    @GetActor() actor: ActorPayload,
    @Param('id', ParseIntPipe) id: number,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    // Service tự clamp limit/before (mặc định 50 tin mới nhất, tối đa 200).
    return this.copilotService.findMessages(actor.tenantId, actor.userId, id, {
      limit: limit !== undefined ? Number(limit) : undefined,
      before: before !== undefined ? Number(before) : undefined,
    });
  }

  @Post('sessions/:id/messages')
  createMessage(
    @GetActor() actor: ActorPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateCopilotMessageDto,
  ) {
    return this.copilotService.createMessage(
      actor.tenantId,
      actor.userId,
      id,
      dto,
    );
  }

  @Post('sessions/:id/turns')
  createTurn(
    @GetActor() actor: ActorPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateCopilotMessageDto,
  ) {
    return this.copilotService.createTurn(actor, id, dto.content, dto.action);
  }

  @Post('sessions/:id/confirm')
  confirm(
    @GetActor() actor: ActorPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body()
    body?: {
      input?: Record<string, unknown>;
      inputOverride?: Record<string, unknown>;
      idempotencyKey?: string;
    },
  ) {
    return this.copilotService.confirm(
      actor,
      id,
      body?.inputOverride || body?.input,
      body?.idempotencyKey,
    );
  }

  @Post('sessions/:id/cancel')
  cancel(
    @GetActor() actor: ActorPayload,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.copilotService.cancel(actor, id);
  }

  @Patch('sessions/:id/pending-action')
  updatePendingAction(
    @GetActor() actor: ActorPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body()
    body?: {
      inputPatch?: Record<string, unknown>;
      input?: Record<string, unknown>;
    },
  ) {
    return this.copilotService.updatePendingAction(actor, id, body || {});
  }

  @Patch('sessions/:id/state')
  updateState(
    @GetActor() actor: ActorPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateSessionStateDto,
  ) {
    return this.copilotService.mergeSessionState(
      actor.tenantId,
      actor.userId,
      id,
      dto.patch,
    );
  }

  @Patch('sessions/:id/title')
  renameSession(
    @GetActor() actor: ActorPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCopilotSessionDto,
  ) {
    return this.copilotService.renameSession(
      actor.tenantId,
      actor.userId,
      id,
      dto.title,
    );
  }

  @Patch('sessions/:id/close')
  closeSession(
    @GetActor() actor: ActorPayload,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.copilotService.closeSession(actor.tenantId, actor.userId, id);
  }

  @Patch('sessions/:id/reopen')
  reopenSession(
    @GetActor() actor: ActorPayload,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.copilotService.reopenSession(actor.tenantId, actor.userId, id);
  }

  @Delete('sessions/:id')
  deleteSession(
    @GetActor() actor: ActorPayload,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.copilotService.deleteSession(actor.tenantId, actor.userId, id);
  }

  @Get('actions')
  findActions(@GetActor() actor: ActorPayload) {
    return this.copilotService.findActions(actor.tenantId);
  }

  @Get('audit-logs')
  findAuditLogs(@GetActor() actor: ActorPayload) {
    return this.copilotService.findAuditLogs(actor.tenantId);
  }
}
