import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common'
import { Observable } from 'rxjs'
import { map } from 'rxjs/operators'

/**
 * Global response interceptor.
 * Mọi response từ controller đều được bọc trong { success: true, data: <value> }
 * trừ khi controller đã trả về object có field `success` (bọc sẵn).
 */
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, any> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      map(data => {
        // Nếu response đã có `success` field → pass-through (controller tự bọc)
        if (data !== null && data !== undefined && typeof data === 'object' && 'success' in data) {
          return data
        }
        return { success: true, data }
      }),
    )
  }
}
