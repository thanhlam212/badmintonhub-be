import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BookingStatus,
  CommunityDistrict,
  CommunityLevel,
  CommunityMatchParticipationStatus,
  CommunityMatchStatus,
  CommunityNotificationKind,
  CommunityPostKind,
  Prisma,
} from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  CommunityFeedQueryDto,
  CommunityMatchesQueryDto,
  CreateCommunityCommentDto,
  CreateCommunityMatchDto,
  CreateCommunityPostDto,
} from './dto/community.dto';

type CurrentUser = { id: string; username: string; role?: string };

const DISTRICT_LABEL_TO_ENUM: Record<string, CommunityDistrict> = {
  'Cầu Giấy': CommunityDistrict.cau_giay,
  'Thanh Xuân': CommunityDistrict.thanh_xuan,
  'Long Biên': CommunityDistrict.long_bien,
};

const DISTRICT_ENUM_TO_LABEL: Record<CommunityDistrict, string> = {
  [CommunityDistrict.cau_giay]: 'Cầu Giấy',
  [CommunityDistrict.thanh_xuan]: 'Thanh Xuân',
  [CommunityDistrict.long_bien]: 'Long Biên',
};

const LEVEL_LABEL_TO_ENUM: Record<string, CommunityLevel> = {
  'Mới chơi': CommunityLevel.beginner,
  'Trung bình': CommunityLevel.intermediate,
  'Khá': CommunityLevel.advanced,
  'Nâng cao': CommunityLevel.expert,
};

const LEVEL_ENUM_TO_LABEL: Record<CommunityLevel, string> = {
  [CommunityLevel.beginner]: 'Mới chơi',
  [CommunityLevel.intermediate]: 'Trung bình',
  [CommunityLevel.advanced]: 'Khá',
  [CommunityLevel.expert]: 'Nâng cao',
};

const POST_KIND_LABEL_TO_ENUM: Record<string, CommunityPostKind> = {
  'Chia sẻ': CommunityPostKind.share,
  'Tìm đội': CommunityPostKind.find_team,
  'Check-in': CommunityPostKind.check_in,
  'Review sân': CommunityPostKind.court_review,
  'Mẹo chơi': CommunityPostKind.tip,
};

const POST_KIND_ENUM_TO_LABEL: Record<CommunityPostKind, string> = {
  [CommunityPostKind.share]: 'Chia sẻ',
  [CommunityPostKind.find_team]: 'Tìm đội',
  [CommunityPostKind.check_in]: 'Check-in',
  [CommunityPostKind.court_review]: 'Review sân',
  [CommunityPostKind.tip]: 'Mẹo chơi',
};

const NOTIFICATION_KIND_TO_LINK: Record<CommunityNotificationKind, string> = {
  [CommunityNotificationKind.like]: '/community/feed',
  [CommunityNotificationKind.comment]: '/community/feed',
  [CommunityNotificationKind.follow]: '/community',
  [CommunityNotificationKind.match]: '/community/matches',
  [CommunityNotificationKind.reminder]: '/my-bookings',
};

@Injectable()
export class CommunityService {
  constructor(private readonly prisma: PrismaService) {}

  async getLanding() {
    const [featuredPlayers, featuredPosts, activeMatches] = await Promise.all([
      this.prisma.communityProfile.findMany({
        take: 3,
        orderBy: [{ followersCount: 'desc' }, { updatedAt: 'desc' }],
        include: { user: true },
      }),
      this.prisma.communityPost.findMany({
        take: 2,
        orderBy: { createdAt: 'desc' },
        include: this.buildPostInclude(2),
      }),
      this.prisma.communityMatch.findMany({
        take: 3,
        where: { status: { in: [CommunityMatchStatus.open, CommunityMatchStatus.full] } },
        orderBy: [{ date: 'asc' }, { createdAt: 'desc' }],
        include: this.buildMatchInclude(),
      }),
    ]);

    return {
      featuredPlayers: featuredPlayers.map((profile) => this.mapPlayer(profile.user, profile)),
      featuredPosts: featuredPosts.map((post) => this.mapPost(post)),
      activeMatches: activeMatches.map((match) => this.mapMatch(match)),
    };
  }

  async getFeed(query: CommunityFeedQueryDto) {
    const where: Prisma.CommunityPostWhereInput = {};
    if (query.kind && query.kind !== 'Tất cả') {
      where.kind = POST_KIND_LABEL_TO_ENUM[query.kind];
    }

    const [posts, trendingTags, suggestedProfiles, upcomingMatches] = await Promise.all([
      this.prisma.communityPost.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: this.buildPostInclude(3),
      }),
      this.prisma.communityHashtag.findMany({
        include: { _count: { select: { posts: true } } },
        orderBy: { posts: { _count: 'desc' } },
        take: 6,
      }),
      this.prisma.communityProfile.findMany({
        take: 3,
        orderBy: [{ followersCount: 'desc' }, { updatedAt: 'desc' }],
        include: { user: true },
      }),
      this.prisma.communityMatch.findMany({
        where: { status: CommunityMatchStatus.open },
        take: 3,
        orderBy: [{ date: 'asc' }, { createdAt: 'desc' }],
        include: this.buildMatchInclude(),
      }),
    ]);

    return {
      posts: posts.map((post) => this.mapPost(post)),
      trendingTags: trendingTags.map((tag) => ({
        tag: tag.slug,
        count: `${tag._count.posts} bài`,
      })),
      suggestedPlayers: suggestedProfiles.map((profile) =>
        this.mapPlayer(profile.user, profile),
      ),
      upcomingSessions: upcomingMatches.map((match) => ({
        court: match.court?.name || match.branch?.name || DISTRICT_ENUM_TO_LABEL[match.district],
        time: `${this.formatMatchDate(match.date)} · ${match.slotStart}`,
        label: `${Math.max(match.neededPlayers - match.currentPlayers, 0)} slot còn trống`,
      })),
    };
  }

  async getProfile(username: string) {
    const user = await this.prisma.user.findUnique({
      where: { username },
      include: {
        communityProfile: true,
        communityPosts: {
          orderBy: { createdAt: 'desc' },
          include: this.buildPostInclude(2),
        },
        communityMatchesHosted: {
          orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
          include: this.buildMatchInclude(),
        },
      },
    });

    if (!user) throw new NotFoundException('Không tìm thấy người chơi');

    const posts = user.communityPosts.map((post) => this.mapPost(post));
    return {
      player: this.mapPlayer(user, user.communityProfile),
      posts,
      checkins: posts.filter((post) => post.kind === 'Check-in'),
      hostedMatches: user.communityMatchesHosted.map((match) => this.mapMatch(match)),
      savedPosts: [],
    };
  }

  async getPostDetail(id: string) {
    const post = await this.prisma.communityPost.findUnique({
      where: { id },
      include: this.buildPostInclude(undefined),
    });
    if (!post) throw new NotFoundException('Không tìm thấy bài viết');

    const related = await this.prisma.communityPost.findMany({
      where: { id: { not: id } },
      take: 2,
      orderBy: { createdAt: 'desc' },
      include: this.buildPostInclude(2),
    });

    return {
      post: this.mapPost(post),
      relatedPosts: related.map((item) => this.mapPost(item)),
    };
  }

  async getMatches(query: CommunityMatchesQueryDto, currentUserId?: string) {
    const where: Prisma.CommunityMatchWhereInput = {
      status: { in: [CommunityMatchStatus.open, CommunityMatchStatus.full] },
    };

    if (query.district && query.district !== 'Tất cả') {
      where.district = DISTRICT_LABEL_TO_ENUM[query.district];
    }
    if (query.level && query.level !== 'Mọi trình') {
      where.level = LEVEL_LABEL_TO_ENUM[query.level];
    }

    const matches = await this.prisma.communityMatch.findMany({
      where,
      orderBy: [{ date: 'asc' }, { createdAt: 'desc' }],
      include: this.buildMatchInclude(currentUserId),
    });

    const filtered = matches.filter((match) => {
      if (!query.slot || query.slot === 'Mọi giờ') return true;
      const hour = Number(match.slotStart.split(':')[0] || 0);
      const band = hour < 12 ? 'Sáng' : hour < 17 ? 'Chiều' : 'Tối';
      return band === query.slot;
    });

    return {
      matches: filtered.map((match) => this.mapMatch(match, currentUserId)),
    };
  }

  async getNotifications(userId: string) {
    await this.ensureProfile(userId);

    const [notifications, user, upcomingBookings] = await Promise.all([
      this.prisma.communityNotification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: {
          actor: { include: { communityProfile: true } },
        },
      }),
      this.prisma.user.findUnique({
        where: { id: userId },
        include: { communityProfile: true },
      }),
      this.prisma.booking.findMany({
        where: {
          userId,
          bookingDate: { gte: new Date() },
          status: { in: ['pending', 'deposited', 'confirmed', 'playing'] },
        },
        orderBy: [{ bookingDate: 'asc' }, { timeStart: 'asc' }],
        take: 2,
        include: {
          court: true,
          branch: true,
        },
      }),
    ]);

    if (!user) throw new NotFoundException('Không tìm thấy người dùng');

    const reminderItems = upcomingBookings.map((booking) => ({
      id: `booking-${booking.id}`,
      kind: CommunityNotificationKind.reminder,
      text: `Nhắc lịch: bạn có trận tại ${booking.branch.name} lúc ${booking.timeStart} ngày ${this.formatDateOnly(booking.bookingDate)}.`,
      time: this.formatRelativeTime(booking.createdAt),
      unread: false,
      link: '/my-bookings',
      actor: this.mapPlayer(user, user.communityProfile),
    }));

    return {
      notifications: [
        ...notifications.map((item) => ({
          id: item.id,
          kind: item.kind,
          text: item.text,
          time: this.formatRelativeTime(item.createdAt),
          unread: !item.isRead,
          link:
            item.kind === CommunityNotificationKind.follow && item.actor
              ? `/community/profile/${item.actor.username}`
              : item.targetType === 'post' && item.targetId
                ? `/community/post/${item.targetId}`
                : item.targetType === 'match' && item.targetId
                  ? '/community/matches'
                  : NOTIFICATION_KIND_TO_LINK[item.kind],
          actor: item.actor
            ? this.mapPlayer(item.actor, item.actor.communityProfile)
            : null,
        })),
        ...reminderItems,
      ],
    };
  }

  async markAllNotificationsRead(userId: string) {
    await this.prisma.communityNotification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
    return { message: 'Đã đánh dấu tất cả là đã đọc' };
  }

  async markNotificationRead(userId: string, id: string) {
    const notification = await this.prisma.communityNotification.findFirst({
      where: { id, userId },
    });
    if (!notification) throw new NotFoundException('Không tìm thấy thông báo');

    await this.prisma.communityNotification.update({
      where: { id },
      data: { isRead: true },
    });
    return { message: 'Đã cập nhật thông báo' };
  }

  async createPost(userId: string, dto: CreateCommunityPostDto) {
    await this.ensureProfile(userId);
    const court = dto.court_id
      ? await this.prisma.court.findUnique({
          where: { id: dto.court_id },
          include: { branch: true },
        })
      : null;
    if (dto.court_id && !court) throw new NotFoundException('Không tìm thấy sân');

    const branchId = dto.branch_id ?? court?.branchId ?? null;
    if (dto.branch_id) {
      const branch = await this.prisma.branch.findUnique({ where: { id: dto.branch_id } });
      if (!branch) throw new NotFoundException('Không tìm thấy chi nhánh');
    }

    const post = await this.prisma.$transaction(async (tx) => {
      const created = await tx.communityPost.create({
        data: {
          authorId: userId,
          kind: POST_KIND_LABEL_TO_ENUM[dto.kind],
          body: dto.body.trim(),
          district: dto.district ? DISTRICT_LABEL_TO_ENUM[dto.district] : null,
          level: dto.level ? LEVEL_LABEL_TO_ENUM[dto.level] : null,
          branchId,
          courtId: dto.court_id ?? null,
          media: dto.image_urls?.length
            ? {
                create: dto.image_urls.map((url, index) => ({
                  url,
                  sortOrder: index,
                })),
              }
            : undefined,
        },
        include: this.buildPostInclude(undefined),
      });

      await this.syncPostTags(tx, created.id, dto.tags ?? []);

      if (POST_KIND_LABEL_TO_ENUM[dto.kind] === CommunityPostKind.check_in) {
        await tx.communityProfile.update({
          where: { userId },
          data: { checkinsCount: { increment: 1 } },
        });
      }

      return tx.communityPost.findUniqueOrThrow({
        where: { id: created.id },
        include: this.buildPostInclude(undefined),
      });
    });

    return this.mapPost(post);
  }

  async togglePostLike(userId: string, postId: string) {
    const post = await this.prisma.communityPost.findUnique({
      where: { id: postId },
      select: { id: true, authorId: true },
    });
    if (!post) throw new NotFoundException('Không tìm thấy bài viết');

    const existing = await this.prisma.communityPostLike.findUnique({
      where: { postId_userId: { postId, userId } },
    });

    if (existing) {
      await this.prisma.communityPostLike.delete({
        where: { postId_userId: { postId, userId } },
      });
    } else {
      await this.prisma.$transaction(async (tx) => {
        await tx.communityPostLike.create({ data: { postId, userId } });
        if (post.authorId !== userId) {
          await this.createNotification(tx, {
            userId: post.authorId,
            actorId: userId,
            kind: CommunityNotificationKind.like,
            text: 'đã thích bài viết của bạn.',
            targetType: 'post',
            targetId: postId,
          });
        }
      });
    }

    const likes = await this.prisma.communityPostLike.count({ where: { postId } });
    return { liked: !existing, likes };
  }

  async togglePostSave(userId: string, postId: string) {
    const post = await this.prisma.communityPost.findUnique({ where: { id: postId } });
    if (!post) throw new NotFoundException('Không tìm thấy bài viết');

    const existing = await this.prisma.communityPostSave.findUnique({
      where: { postId_userId: { postId, userId } },
    });

    if (existing) {
      await this.prisma.communityPostSave.delete({
        where: { postId_userId: { postId, userId } },
      });
    } else {
      await this.prisma.communityPostSave.create({ data: { postId, userId } });
    }

    const saves = await this.prisma.communityPostSave.count({ where: { postId } });
    return { saved: !existing, saves };
  }

  async addComment(userId: string, postId: string, dto: CreateCommunityCommentDto) {
    await this.ensureProfile(userId);
    const post = await this.prisma.communityPost.findUnique({
      where: { id: postId },
      select: { id: true, authorId: true },
    });
    if (!post) throw new NotFoundException('Không tìm thấy bài viết');

    if (dto.parent_id) {
      const parent = await this.prisma.communityComment.findUnique({
        where: { id: dto.parent_id },
      });
      if (!parent || parent.postId !== postId) {
        throw new BadRequestException('Bình luận cha không hợp lệ');
      }
    }

    const comment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.communityComment.create({
        data: {
          postId,
          authorId: userId,
          body: dto.body.trim(),
          parentId: dto.parent_id ?? null,
        },
        include: {
          author: { include: { communityProfile: true } },
          likes: true,
        },
      });

      if (post.authorId !== userId) {
        await this.createNotification(tx, {
          userId: post.authorId,
          actorId: userId,
          kind: CommunityNotificationKind.comment,
          text: `đã bình luận: "${dto.body.trim().slice(0, 60)}${dto.body.trim().length > 60 ? '…' : ''}"`,
          targetType: 'post',
          targetId: postId,
        });
      }

      return created;
    });

    const commentsCount = await this.prisma.communityComment.count({
      where: { postId, parentId: null },
    });

    return {
      comment: this.mapComment(comment),
      commentsCount,
    };
  }

  async toggleCommentLike(userId: string, commentId: string) {
    const comment = await this.prisma.communityComment.findUnique({
      where: { id: commentId },
      select: { id: true, authorId: true, postId: true },
    });
    if (!comment) throw new NotFoundException('Không tìm thấy bình luận');

    const existing = await this.prisma.communityCommentLike.findUnique({
      where: { commentId_userId: { commentId, userId } },
    });

    if (existing) {
      await this.prisma.communityCommentLike.delete({
        where: { commentId_userId: { commentId, userId } },
      });
    } else {
      await this.prisma.$transaction(async (tx) => {
        await tx.communityCommentLike.create({ data: { commentId, userId } });
        if (comment.authorId !== userId) {
          await this.createNotification(tx, {
            userId: comment.authorId,
            actorId: userId,
            kind: CommunityNotificationKind.like,
            text: 'đã thích bình luận của bạn.',
            targetType: 'post',
            targetId: comment.postId,
          });
        }
      });
    }

    const likes = await this.prisma.communityCommentLike.count({
      where: { commentId },
    });
    return { liked: !existing, likes };
  }

  async toggleFollow(userId: string, username: string) {
    const target = await this.prisma.user.findUnique({
      where: { username },
      include: { communityProfile: true },
    });
    if (!target) throw new NotFoundException('Không tìm thấy người chơi');
    if (target.id === userId) throw new BadRequestException('Không thể tự theo dõi chính mình');

    await this.ensureProfile(userId);
    await this.ensureProfile(target.id);

    const existing = await this.prisma.communityFollow.findUnique({
      where: { followerId_followingId: { followerId: userId, followingId: target.id } },
    });

    await this.prisma.$transaction(async (tx) => {
      if (existing) {
        await tx.communityFollow.delete({
          where: { followerId_followingId: { followerId: userId, followingId: target.id } },
        });
        await tx.communityProfile.update({
          where: { userId },
          data: { followingCount: { decrement: 1 } },
        });
        await tx.communityProfile.update({
          where: { userId: target.id },
          data: { followersCount: { decrement: 1 } },
        });
      } else {
        await tx.communityFollow.create({
          data: { followerId: userId, followingId: target.id },
        });
        await tx.communityProfile.update({
          where: { userId },
          data: { followingCount: { increment: 1 } },
        });
        await tx.communityProfile.update({
          where: { userId: target.id },
          data: { followersCount: { increment: 1 } },
        });
        await this.createNotification(tx, {
          userId: target.id,
          actorId: userId,
          kind: CommunityNotificationKind.follow,
          text: 'đã bắt đầu theo dõi bạn.',
          targetType: 'profile',
          targetId: target.username,
        });
      }
    });

    const profile = await this.prisma.communityProfile.findUnique({
      where: { userId: target.id },
    });

    return {
      following: !existing,
      followers: profile?.followersCount ?? 0,
    };
  }

  async createMatch(userId: string, dto: CreateCommunityMatchDto) {
    await this.ensureProfile(userId);

    const booking = await this.prisma.booking.findFirst({
      where: {
        id: dto.booking_id,
        userId,
      },
      include: {
        branch: true,
        court: true,
      },
    });
    if (!booking) {
      throw new NotFoundException('Khong tim thay booking san cua ban');
    }

    const allowedBookingStatuses: BookingStatus[] = [
      BookingStatus.pending,
      BookingStatus.deposited,
      BookingStatus.confirmed,
      BookingStatus.playing,
    ];
    if (!allowedBookingStatuses.includes(booking.status)) {
      throw new BadRequestException('Booking nay khong con hop le de tao keo');
    }

    const bookingDate = new Date(booking.bookingDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (bookingDate < today) {
      throw new BadRequestException('Khong the tao keo tu booking da qua');
    }

    const district = this.inferDistrictFromBranch(booking.branch);
    if (!district) {
      throw new BadRequestException('Chi nhanh cua booking chua duoc cau hinh khu vuc cong dong');
    }

    const existingMatch = await this.prisma.communityMatch.findFirst({
      where: {
        hostId: userId,
        branchId: booking.branchId,
        courtId: booking.courtId,
        date: bookingDate,
        slotStart: booking.timeStart,
        slotEnd: booking.timeEnd ?? booking.timeStart,
        status: {
          in: [CommunityMatchStatus.open, CommunityMatchStatus.full],
        },
      },
    });
    if (existingMatch) {
      throw new BadRequestException('Ban da tao keo cho booking san nay roi');
    }

    const match = await this.prisma.$transaction(async (tx) => {
      const created = await tx.communityMatch.create({
        data: {
          hostId: userId,
          title: dto.title.trim(),
          district,
          level: LEVEL_LABEL_TO_ENUM[dto.level],
          date: bookingDate,
          slotStart: booking.timeStart,
          slotEnd: booking.timeEnd ?? booking.timeStart,
          neededPlayers: dto.needed_players,
          currentPlayers: 1,
          pricePerPerson: new Prisma.Decimal(dto.price_per_person),
          note: dto.note?.trim() || null,
          branchId: booking.branchId,
          courtId: booking.courtId,
        },
        include: this.buildMatchInclude(),
      });

      await tx.communityProfile.update({
        where: { userId },
        data: { matchesCount: { increment: 1 } },
      });

      return created;
    });

    return this.mapMatch(match, userId);
  }

  async joinMatch(userId: string, matchId: string) {

    await this.ensureProfile(userId);
    const match = await this.prisma.communityMatch.findUnique({
      where: { id: matchId },
      include: this.buildMatchInclude(userId),
    });
    if (!match) throw new NotFoundException('Không tìm thấy kèo đấu');
    if (match.hostId === userId) {
      throw new BadRequestException('Bạn đã là chủ kèo này');
    }
    if (match.status === CommunityMatchStatus.closed || match.status === CommunityMatchStatus.cancelled) {
      throw new ForbiddenException('Kèo đấu không còn mở');
    }

    const existing = await this.prisma.communityMatchParticipant.findUnique({
      where: { matchId_userId: { matchId, userId } },
    });

    if (!existing) {
      await this.prisma.$transaction(async (tx) => {
        await tx.communityMatchParticipant.create({
          data: {
            matchId,
            userId,
            status: CommunityMatchParticipationStatus.joined,
          },
        });

        const updated = await tx.communityMatch.update({
          where: { id: matchId },
          data: {
            currentPlayers: { increment: 1 },
          },
          select: { currentPlayers: true, neededPlayers: true, hostId: true },
        });

        if (updated.currentPlayers >= updated.neededPlayers) {
          await tx.communityMatch.update({
            where: { id: matchId },
            data: { status: CommunityMatchStatus.full },
          });
        }

        await this.createNotification(tx, {
          userId: updated.hostId,
          actorId: userId,
          kind: CommunityNotificationKind.match,
          text: `đã xin tham gia kèo "${match.title}" của bạn.`,
          targetType: 'match',
          targetId: matchId,
        });
      });
    }

    const fresh = await this.prisma.communityMatch.findUniqueOrThrow({
      where: { id: matchId },
      include: this.buildMatchInclude(userId),
    });

    return {
      joined: true,
      match: this.mapMatch(fresh, userId),
    };
  }

  private async ensureProfile(userId: string) {
    const existing = await this.prisma.communityProfile.findUnique({
      where: { userId },
    });
    if (existing) return existing;

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Không tìm thấy người dùng');

    return this.prisma.communityProfile.create({
      data: {
        userId,
        bio: `${user.fullName} đang tham gia cộng đồng cầu lông BadmintonHub.`,
        level: CommunityLevel.intermediate,
        avatar: null,
        coverImage: '/community/hero.png',
      },
    });
  }

  private buildPostInclude(commentLimit?: number) {
    return {
      author: { include: { communityProfile: true } },
      branch: true,
      court: true,
      media: { orderBy: { sortOrder: 'asc' as const } },
      hashtags: { include: { hashtag: true } },
      likes: true,
      saves: true,
      comments: {
        where: { parentId: null },
        orderBy: { createdAt: 'desc' as const },
        ...(typeof commentLimit === 'number' ? { take: commentLimit } : {}),
        include: {
          author: { include: { communityProfile: true } },
          likes: true,
        },
      },
    };
  }

  private buildMatchInclude(currentUserId?: string) {
    return {
      host: { include: { communityProfile: true } },
      branch: true,
      court: true,
      participants: {
        include: {
          user: { include: { communityProfile: true } },
        },
      },
      ...(currentUserId
        ? {
            participants: {
              include: { user: { include: { communityProfile: true } } },
              where: {},
            },
          }
        : {}),
    };
  }

  private async syncPostTags(tx: Prisma.TransactionClient, postId: string, tags: string[]) {
    const normalizedTags = Array.from(
      new Set(
        tags
          .map((tag) => this.slugify(tag))
          .filter(Boolean)
          .slice(0, 10),
      ),
    );

    await tx.communityPostHashtag.deleteMany({ where: { postId } });
    if (!normalizedTags.length) return;

    const hashtagIds: number[] = [];
    for (const slug of normalizedTags) {
      const hashtag = await tx.communityHashtag.upsert({
        where: { slug },
        update: { label: slug },
        create: { slug, label: slug },
      });
      hashtagIds.push(hashtag.id);
    }

    await tx.communityPostHashtag.createMany({
      data: hashtagIds.map((hashtagId) => ({ postId, hashtagId })),
      skipDuplicates: true,
    });
  }

  private async createNotification(
    tx: Prisma.TransactionClient,
    input: {
      userId: string;
      actorId?: string | null;
      kind: CommunityNotificationKind;
      text: string;
      targetType?: string | null;
      targetId?: string | null;
    },
  ) {
    return tx.communityNotification.create({
      data: {
        userId: input.userId,
        actorId: input.actorId ?? null,
        kind: input.kind,
        text: input.text,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
      },
    });
  }

  private mapPlayer(user: any, profile?: any) {
    return {
      username: user.username,
      name: user.fullName,
      avatar: profile?.avatar || '',
      level: profile?.level ? LEVEL_ENUM_TO_LABEL[profile.level] : 'Trung bình',
      district: profile?.district ? DISTRICT_ENUM_TO_LABEL[profile.district] : '',
      bio: profile?.bio || '',
      followers: profile?.followersCount ?? 0,
      following: profile?.followingCount ?? 0,
      matches: profile?.matchesCount ?? 0,
      checkins: profile?.checkinsCount ?? 0,
      postsCount: undefined,
      cover: profile?.coverImage || '/community/hero.png',
    };
  }

  private mapComment(comment: any) {
    return {
      id: comment.id,
      body: comment.body,
      time: this.formatRelativeTime(comment.createdAt),
      likes: comment.likes?.length ?? 0,
      author: this.mapPlayer(comment.author, comment.author?.communityProfile),
    };
  }

  private mapPost(post: any) {
    return {
      id: post.id,
      kind: POST_KIND_ENUM_TO_LABEL[post.kind],
      body: post.body,
      time: this.formatRelativeTime(post.createdAt),
      createdAt: post.createdAt,
      images: (post.media || []).map((item: any) => item.url),
      tags: (post.hashtags || []).map((item: any) => item.hashtag.slug),
      court: this.buildCourtLabel(post.court, post.branch),
      district: post.district ? DISTRICT_ENUM_TO_LABEL[post.district] : '',
      level: post.level ? LEVEL_ENUM_TO_LABEL[post.level] : '',
      likes: post.likes?.length ?? 0,
      saves: post.saves?.length ?? 0,
      commentsCount: post.comments?.length ?? 0,
      comments: (post.comments || []).map((comment: any) => this.mapComment(comment)),
      author: this.mapPlayer(post.author, post.author?.communityProfile),
    };
  }

  private mapMatch(match: any, currentUserId?: string) {
    const joined = !!match.participants?.some(
      (participant: any) =>
        participant.userId === currentUserId &&
        participant.status === CommunityMatchParticipationStatus.joined,
    );

    return {
      id: match.id,
      title: match.title,
      district: DISTRICT_ENUM_TO_LABEL[match.district],
      court: this.buildCourtLabel(match.court, match.branch) || DISTRICT_ENUM_TO_LABEL[match.district],
      level: LEVEL_ENUM_TO_LABEL[match.level],
      date: this.formatMatchDate(match.date),
      slot: `${match.slotStart} - ${match.slotEnd}`,
      filled: match.currentPlayers,
      needed: match.neededPlayers,
      price: `${this.formatMoney(Number(match.pricePerPerson))} / người`,
      note: match.note || '',
      joined,
      host: this.mapPlayer(match.host, match.host?.communityProfile),
    };
  }

  private buildCourtLabel(court?: any, branch?: any) {
    if (court?.name && branch?.name) return `${court.name} · ${branch.name}`;
    if (court?.name) return court.name;
    if (branch?.name) return branch.name;
    return '';
  }

  private formatRelativeTime(value: Date | string) {
    const date = new Date(value);
    const diffMs = Date.now() - date.getTime();
    const diffMinutes = Math.max(1, Math.floor(diffMs / 60000));
    if (diffMinutes < 60) return `${diffMinutes} phút trước`;
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours} giờ trước`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays} ngày trước`;
    return this.formatDateOnly(date);
  }

  private formatDateOnly(value: Date | string) {
    const date = new Date(value);
    return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
  }

  private formatMatchDate(value: Date | string) {
    const date = new Date(value);
    const days = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
    return `${days[date.getDay()]}, ${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  private formatMoney(amount: number) {
    if (amount >= 1000 && amount % 1000 === 0) return `${amount / 1000}k`;
    return `${new Intl.NumberFormat('vi-VN').format(amount)}đ`;
  }


  private inferDistrictFromBranch(branch?: { name?: string | null; address?: string | null }) {
    const normalized = this.normalizeText(`${branch?.name || ''} ${branch?.address || ''}`);
    if (normalized.includes('cau giay')) return CommunityDistrict.cau_giay;
    if (normalized.includes('thanh xuan')) return CommunityDistrict.thanh_xuan;
    if (normalized.includes('long bien')) return CommunityDistrict.long_bien;
    return null;
  }

  private normalizeText(input: string) {
    return input
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\u0111/g, 'd')
      .replace(/\u0110/g, 'D')
      .toLowerCase();
  }

  private slugify(input: string) {
    return input
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '')
      .trim();
  }
}
