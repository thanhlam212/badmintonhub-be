import { IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

export class AiChatMessageDto {
  @IsString()
  role: 'user' | 'assistant';

  @IsString()
  @MaxLength(1200)
  content: string;
}

export class AiChatDto {
  @IsString()
  @MaxLength(1000)
  message: string;

  @IsOptional()
  @IsArray()
  history?: AiChatMessageDto[];
}
