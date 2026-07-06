import { Module } from '@nestjs/common';
import { AiAgentModule } from '../ai-agent/ai-agent.module';
import { CopilotController } from './copilot.controller';
import { CopilotService } from './copilot.service';

@Module({
  imports: [AiAgentModule],
  controllers: [CopilotController],
  providers: [CopilotService],
})
export class CopilotModule {}
