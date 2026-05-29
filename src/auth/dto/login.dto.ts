import { IsString, MinLength } from 'class-validator';

export class LoginDto {
  /** FE gửi `username` (cũng có thể là email) */
  @IsString()
  username: string;

  @IsString()
  @MinLength(6)
  password: string;
}
