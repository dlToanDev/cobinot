import { Module } from '@nestjs/common';
import { CoursesModule } from '../courses/courses.module';
import { EnrollmentsModule } from '../enrollments/enrollments.module';
import { UsersModule } from '../users/users.module';
import { AgentContextBuilderService } from './agent-context-builder.service';
import { AgentRunnerService } from './agent-runner.service';
import { AiModelService } from './ai-model.service';
import { ToolExecutorService } from './tool-executor.service';
import { ToolRegistryService } from './tool-registry.service';

@Module({
  imports: [UsersModule, CoursesModule, EnrollmentsModule],
  providers: [
    AiModelService,
    AgentContextBuilderService,
    AgentRunnerService,
    ToolExecutorService,
    ToolRegistryService,
  ],
  exports: [AgentRunnerService, ToolRegistryService],
})
export class AiAgentModule {}
