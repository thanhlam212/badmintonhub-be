import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { PrismaService } from 'src/prisma/prisma.service';
import { CommunityService } from './community.service';

type ChatSocket = Socket & {
  data: {
    user?: {
      id: string;
      username: string;
      role: string;
    };
  };
};

@Injectable()
@WebSocketGateway({
  namespace: '/community-chat',
  cors: {
    origin: [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:3002',
      'https://badmintonhub-fe.vercel.app',
      'https://www.badmintonhub.tech',
      'https://badmintonhub.tech',
    ],
    credentials: true,
  },
})
export class CommunityChatGateway
  implements OnGatewayConnection<ChatSocket>, OnGatewayDisconnect<ChatSocket>
{
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly communityService: CommunityService,
  ) {}

  async handleConnection(client: ChatSocket) {
    try {
      const token = this.extractToken(client);
      if (!token) throw new UnauthorizedException('Missing token');

      const payload = await this.jwtService.verifyAsync<{
        sub: string;
        username: string;
        role: string;
      }>(token);

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: {
          id: true,
          username: true,
          role: true,
        },
      });

      if (!user) throw new UnauthorizedException('Invalid token');
      client.data.user = user;
    } catch {
      client.emit('chat:error', { message: 'Unauthorized socket connection' });
      client.disconnect(true);
    }
  }

  handleDisconnect(_client: ChatSocket) {}

  @SubscribeMessage('chat:join_room')
  async handleJoinRoom(
    @ConnectedSocket() client: ChatSocket,
    @MessageBody() body: { roomId?: string },
  ) {
    const user = this.getSocketUser(client);
    const roomId = String(body?.roomId || '');
    if (!roomId) throw new ForbiddenException('Missing room id');

    await this.communityService.assertChatMember(user.id, roomId);
    await client.join(roomId);

    const { messages } = await this.communityService.getChatMessages(user.id, roomId, {
      limit: 100,
    });

    return { ok: true, roomId, messages };
  }

  @SubscribeMessage('chat:leave_room')
  async handleLeaveRoom(
    @ConnectedSocket() client: ChatSocket,
    @MessageBody() body: { roomId?: string },
  ) {
    const roomId = String(body?.roomId || '');
    if (roomId) {
      await client.leave(roomId);
    }
    return { ok: true, roomId };
  }

  @SubscribeMessage('chat:send_message')
  async handleSendMessage(
    @ConnectedSocket() client: ChatSocket,
    @MessageBody() body: { roomId?: string; message?: string },
  ) {
    const user = this.getSocketUser(client);
    const roomId = String(body?.roomId || '');
    const messageBody = String(body?.message || '').trim();

    if (!roomId || !messageBody) {
      throw new ForbiddenException('Missing room id or message');
    }

    await this.communityService.assertChatMember(user.id, roomId);
    const result = await this.communityService.sendChatMessage(user.id, roomId, {
      body: messageBody,
    });

    this.server.to(roomId).emit('chat:new_message', {
      roomId,
      message: result.message,
    });

    return { ok: true, message: result.message };
  }

  private extractToken(client: ChatSocket) {
    const authToken = client.handshake.auth?.token;
    if (typeof authToken === 'string' && authToken.trim()) {
      return authToken.trim();
    }

    const authHeader = client.handshake.headers.authorization;
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      return authHeader.slice(7).trim();
    }

    return '';
  }

  private getSocketUser(client: ChatSocket) {
    const user = client.data.user;
    if (!user) throw new UnauthorizedException('Socket user missing');
    return user;
  }
}
