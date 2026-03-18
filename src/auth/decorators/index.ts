// ─────────────────────────────────────────────────────────────
// public.decorator.ts
// Dùng @Public() để bỏ qua JwtAuthGuard trên 1 route
// VD: POST /auth/login, POST /auth/register
// ─────────────────────────────────────────────────────────────
import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);


// ─────────────────────────────────────────────────────────────
// roles.decorator.ts
// Dùng @Roles('admin') hoặc @Roles('admin', 'employee')
// ─────────────────────────────────────────────────────────────
export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);


// ─────────────────────────────────────────────────────────────
// current-user.decorator.ts
// Dùng @CurrentUser() để lấy user đang đăng nhập từ request
// VD: async getProfile(@CurrentUser() user: any)
// ─────────────────────────────────────────────────────────────
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);