import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as fs from 'fs';
import { extname, join } from 'path';
import { CurrentUser, Public } from 'src/auth/decorators';
import { CommunityService } from './community.service';
import {
  CommunityChatMessagesQueryDto,
  CommunityFeedQueryDto,
  CommunityMatchesQueryDto,
  CommunityPlayersQueryDto,
  CreateCommunityCommentDto,
  CreateCommunityMatchDto,
  CreateCommunityPostDto,
  SendCommunityChatMessageDto,
  UpdateCommunityProfileDto,
} from './dto/community.dto';

@Controller('community')
export class CommunityController {
  constructor(private readonly communityService: CommunityService) {}

  @Public()
  @Get('landing')
  getLanding() {
    return this.communityService.getLanding();
  }

  @Public()
  @Get('feed')
  getFeed(@Query() query: CommunityFeedQueryDto) {
    return this.communityService.getFeed(query);
  }

  @Public()
  @Get('players')
  getPlayers(
    @Query() query: CommunityPlayersQueryDto,
    @CurrentUser() user?: any,
  ) {
    return this.communityService.getPlayers(query, user?.id);
  }

  @Public()
  @Get('players/:username')
  getProfile(@Param('username') username: string) {
    return this.communityService.getProfile(username);
  }

  @Public()
  @Get('posts/:id')
  getPostDetail(@Param('id') id: string) {
    return this.communityService.getPostDetail(id);
  }

  @Public()
  @Get('matches')
  getMatches(
    @Query() query: CommunityMatchesQueryDto,
    @CurrentUser() user?: any,
  ) {
    return this.communityService.getMatches(query, user?.id);
  }

  @Get('notifications')
  getNotifications(@CurrentUser() user: any) {
    return this.communityService.getNotifications(user.id);
  }

  @Patch('profile')
  updateProfile(@CurrentUser() user: any, @Body() dto: UpdateCommunityProfileDto) {
    return this.communityService.updateProfile(user.id, dto);
  }

  @Patch('notifications/read-all')
  markAllNotificationsRead(@CurrentUser() user: any) {
    return this.communityService.markAllNotificationsRead(user.id);
  }

  @Patch('notifications/:id/read')
  markNotificationRead(@CurrentUser() user: any, @Param('id') id: string) {
    return this.communityService.markNotificationRead(user.id, id);
  }

  @Post('posts')
  createPost(@CurrentUser() user: any, @Body() dto: CreateCommunityPostDto) {
    return this.communityService.createPost(user.id, dto);
  }

  @Post('posts/:id/like')
  togglePostLike(@CurrentUser() user: any, @Param('id') id: string) {
    return this.communityService.togglePostLike(user.id, id);
  }

  @Post('posts/:id/save')
  togglePostSave(@CurrentUser() user: any, @Param('id') id: string) {
    return this.communityService.togglePostSave(user.id, id);
  }

  @Post('posts/:id/comments')
  addComment(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: CreateCommunityCommentDto,
  ) {
    return this.communityService.addComment(user.id, id, dto);
  }

  @Post('comments/:id/like')
  toggleCommentLike(@CurrentUser() user: any, @Param('id') id: string) {
    return this.communityService.toggleCommentLike(user.id, id);
  }

  @Post('players/:username/follow')
  toggleFollow(@CurrentUser() user: any, @Param('username') username: string) {
    return this.communityService.toggleFollow(user.id, username);
  }

  @Get('friends')
  getFriends(@CurrentUser() user: any) {
    return this.communityService.getFriends(user.id);
  }

  @Post('friends/:username/request')
  sendFriendRequest(@CurrentUser() user: any, @Param('username') username: string) {
    return this.communityService.sendFriendRequest(user.id, username);
  }

  @Patch('friends/:username/accept')
  acceptFriendRequest(@CurrentUser() user: any, @Param('username') username: string) {
    return this.communityService.acceptFriendRequest(user.id, username);
  }

  @Patch('friends/:username/reject')
  rejectFriendRequest(@CurrentUser() user: any, @Param('username') username: string) {
    return this.communityService.rejectFriendRequest(user.id, username);
  }

  @Post('matches')
  createMatch(@CurrentUser() user: any, @Body() dto: CreateCommunityMatchDto) {
    return this.communityService.createMatch(user.id, dto);
  }

  @Post('matches/:id/join')
  joinMatch(@CurrentUser() user: any, @Param('id') id: string) {
    return this.communityService.joinMatch(user.id, id);
  }

  @Get('matches/:id/participants')
  getMatchParticipants(@CurrentUser() user: any, @Param('id') id: string) {
    return this.communityService.getMatchParticipants(user.id, id);
  }

  @Patch('matches/:id/participants/:userId/approve')
  approveMatchParticipant(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ) {
    return this.communityService.approveMatchParticipant(user.id, id, userId);
  }

  @Patch('matches/:id/participants/:userId/reject')
  rejectMatchParticipant(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ) {
    return this.communityService.rejectMatchParticipant(user.id, id, userId);
  }

  @Get('chat/rooms')
  getChatRooms(@CurrentUser() user: any) {
    return this.communityService.getChatRooms(user.id);
  }

  @Post('chat/private/:username')
  startPrivateChat(@CurrentUser() user: any, @Param('username') username: string) {
    return this.communityService.startPrivateChat(user.id, username);
  }

  @Get('chat/rooms/:roomId/messages')
  getChatMessages(
    @CurrentUser() user: any,
    @Param('roomId') roomId: string,
    @Query() query: CommunityChatMessagesQueryDto,
  ) {
    return this.communityService.getChatMessages(user.id, roomId, query);
  }

  @Post('chat/rooms/:roomId/messages')
  sendChatMessage(
    @CurrentUser() user: any,
    @Param('roomId') roomId: string,
    @Body() dto: SendCommunityChatMessageDto,
  ) {
    return this.communityService.sendChatMessage(user.id, roomId, dto);
  }

  @Post('upload-image')
  @UseInterceptors(
    FileInterceptor('image', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const dir = join(process.cwd(), 'uploads', 'community');
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          cb(null, dir);
        },
        filename: (_req, file, cb) => {
          const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
          cb(null, `${unique}${extname(file.originalname)}`);
        },
      }),
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  uploadImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) return { success: false, message: 'Không có file ảnh' };
    return { url: `/uploads/community/${file.filename}` };
  }
}
