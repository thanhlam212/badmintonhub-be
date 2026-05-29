import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common'
import { Response } from 'express'

/**
 * Global exception filter.
 * Mọi exception đều được format thành { success: false, message: string }
 * để frontend có thể đọc err.response.data.message.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name)

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse<Response>()

    let status = HttpStatus.INTERNAL_SERVER_ERROR
    let message = 'Lỗi server nội bộ'

    if (exception instanceof HttpException) {
      status = exception.getStatus()
      const res = exception.getResponse()

      if (typeof res === 'string') {
        message = res
      } else if (typeof res === 'object' && res !== null) {
        const r = res as any
        // ValidationPipe trả về { message: string[] }, các exception khác trả về { message: string }
        if (Array.isArray(r.message)) {
          message = r.message.join('; ')
        } else if (typeof r.message === 'string') {
          message = r.message
        }
      }
    } else if (exception instanceof Error) {
      this.logger.error(`Unhandled error: ${exception.message}`, exception.stack)
    }

    response.status(status).json({ success: false, message })
  }
}
