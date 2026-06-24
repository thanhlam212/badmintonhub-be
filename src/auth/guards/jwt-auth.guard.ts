// ─────────────────────────────────────────────────────────────
// jwt-auth.guard.ts — Bảo vệ route cần đăng nhập
// ─────────────────────────────────────────────────────────────
import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/index';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    // Nếu route được đánh dấu @Public() → bỏ qua kiểm tra token
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      const request = context.switchToHttp().getRequest();
      const authorization = String(request.headers?.authorization || '');
      if (!authorization.toLowerCase().startsWith('bearer ')) return true;

      request.__optionalAuth = true;
      return super.canActivate(context);
    }

    return super.canActivate(context);
  }

  handleRequest(err: any, user: any, _info?: any, context?: ExecutionContext) {
    const request = context?.switchToHttp().getRequest();
    if (request?.__optionalAuth) {
      return err || !user ? null : user;
    }

    if (err || !user) {
      throw new UnauthorizedException('Bạn cần đăng nhập để thực hiện thao tác này');
    }
    return user;
  }
}
