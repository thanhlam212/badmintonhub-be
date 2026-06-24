import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpStatus,
} from '@nestjs/common'
import { ThrottlerException } from '@nestjs/throttler'
import { Response } from 'express'

/**
 * Bắt ThrottlerException (429 Too Many Requests) và trả về message tiếng Việt
 * theo format chuẩn { success: false, message: string }
 */
@Catch(ThrottlerException)
export class ThrottleExceptionFilter implements ExceptionFilter {
  catch(_exception: ThrottlerException, host: ArgumentsHost) {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse<Response>()

    response.status(HttpStatus.TOO_MANY_REQUESTS).json({
      success: false,
      message: 'Bạn gửi yêu cầu quá nhanh. Vui lòng thử lại sau.',
    })
  }
}
