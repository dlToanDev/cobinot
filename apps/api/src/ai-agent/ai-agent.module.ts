import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { CoursesModule } from '../courses/courses.module';
import { EnrollmentsModule } from '../enrollments/enrollments.module';
import { UsersModule } from '../users/users.module';
import { AgentContextBuilderService } from './agent-context-builder.service';
import { AgentRunnerService } from './agent-runner.service';
import { DeterministicIntentService } from './deterministic-intent.service';
import { ToolExecutorService } from './tool-executor.service';
import { ToolRegistryService } from './tool-registry.service';

@Module({
  imports: [AiModule, UsersModule, CoursesModule, EnrollmentsModule],
  providers: [
    AgentContextBuilderService,
    AgentRunnerService,
    DeterministicIntentService,
    ToolExecutorService,
    ToolRegistryService,
  ],
  exports: [
    AgentRunnerService,
    ToolRegistryService,
    DeterministicIntentService,
  ],
})
export class AiAgentModule {}
