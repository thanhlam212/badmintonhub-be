import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';

export const COMMUNITY_POST_KIND_LABELS = [
  'Chia sẻ',
  'Tìm đội',
  'Check-in',
  'Review sân',
  'Mẹo chơi',
] as const;

export const COMMUNITY_LEVEL_LABELS = [
  'Mới chơi',
  'Trung bình',
  'Khá',
  'Nâng cao',
] as const;

export const COMMUNITY_DISTRICT_LABELS = [
  'Cầu Giấy',
  'Thanh Xuân',
  'Long Biên',
] as const;

export const MATCH_DISTRICT_FILTER_LABELS = [
  'Tất cả',
  ...COMMUNITY_DISTRICT_LABELS,
] as const;

export const MATCH_LEVEL_FILTER_LABELS = [
  'Mọi trình',
  ...COMMUNITY_LEVEL_LABELS,
] as const;

export const FEED_FILTER_LABELS = ['Tất cả', ...COMMUNITY_POST_KIND_LABELS] as const;
export const SLOT_FILTER_LABELS = ['Mọi giờ', 'Sáng', 'Chiều', 'Tối'] as const;

export class CommunityFeedQueryDto {
  @IsOptional()
  @IsIn(FEED_FILTER_LABELS)
  kind?: (typeof FEED_FILTER_LABELS)[number];
}

export class CommunityMatchesQueryDto {
  @IsOptional()
  @IsIn(MATCH_DISTRICT_FILTER_LABELS)
  district?: (typeof MATCH_DISTRICT_FILTER_LABELS)[number];

  @IsOptional()
  @IsIn(MATCH_LEVEL_FILTER_LABELS)
  level?: (typeof MATCH_LEVEL_FILTER_LABELS)[number];

  @IsOptional()
  @IsIn(SLOT_FILTER_LABELS)
  slot?: (typeof SLOT_FILTER_LABELS)[number];
}

export class CreateCommunityPostDto {
  @IsIn(COMMUNITY_POST_KIND_LABELS)
  kind: (typeof COMMUNITY_POST_KIND_LABELS)[number];

  @IsString()
  @Length(1, 5000)
  body: string;

  @IsOptional()
  @IsIn(COMMUNITY_DISTRICT_LABELS)
  district?: (typeof COMMUNITY_DISTRICT_LABELS)[number];

  @IsOptional()
  @IsIn(COMMUNITY_LEVEL_LABELS)
  level?: (typeof COMMUNITY_LEVEL_LABELS)[number];

  @IsOptional()
  @IsInt()
  @Min(1)
  branch_id?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  court_id?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  image_urls?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  tags?: string[];
}

export class CreateCommunityCommentDto {
  @IsString()
  @Length(1, 1000)
  body: string;

  @IsOptional()
  @IsString()
  parent_id?: string;
}

export class CreateCommunityMatchDto {
  @IsUUID()
  booking_id: string;

  @IsString()
  @Length(3, 150)
  title: string;

  @IsIn(COMMUNITY_LEVEL_LABELS)
  level: (typeof COMMUNITY_LEVEL_LABELS)[number];

  @IsInt()
  @Min(2)
  @Max(20)
  needed_players: number;

  @IsNumber()
  @Min(0)
  price_per_person: number;

  @IsOptional()
  @IsString()
  @Length(0, 1000)
  note?: string;
}

export class MarkNotificationReadDto {
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  ids?: string[];
}

export class SendCommunityChatMessageDto {
  @IsString()
  @Length(1, 2000)
  body: string;
}
