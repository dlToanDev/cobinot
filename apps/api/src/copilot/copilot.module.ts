import { Module } from '@nestjs/common';
import { AiAgentModule } from '../ai-agent/ai-agent.module';
import { UsersModule } from '../users/users.module';
import { CopilotController } from './copilot.controller';
import { CopilotService } from './copilot.service';

@Module({
  imports: [AiAgentModule, UsersModule],
  controllers: [CopilotController],
  providers: [CopilotService],
})
export class CopilotModule {}
