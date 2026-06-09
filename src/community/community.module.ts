import { Module } from '@nestjs/common';
import { CommunityController } from './community.controller';
import { CommunityService } from './community.service';
import { CommunityChatGateway } from './community-chat.gateway';
import { AuthModule } from 'src/auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [CommunityController],
  providers: [CommunityService, CommunityChatGateway],
})
export class CommunityModule {}
