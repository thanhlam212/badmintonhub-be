import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BookingStatus,
  CommunityChatRole,
  CommunityChatRoomType,
  CommunityDistrict,
  CommunityFriendshipStatus,
  CommunityLevel,
  CommunityMatchParticipationStatus,
  CommunityMatchStatus,
  CommunityNotificationKind,
  CommunityPostKind,
  Prisma,
} from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  CommunityChatMessagesQueryDto,
  CommunityFeedQueryDto,
  CommunityMatchesQueryDto,
  CommunityPlayersQueryDto,
  CreateCommunityCommentDto,
  CreateCommunityMatchDto,
  CreateCommunityPostDto,
  SendCommunityChatMessageDto,
} from './dto/community.dto';
import {
  formatDate,
  getBusinessNowParts,
  normalizeDate,
} from 'src/bookings/booking.helpers';

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
    await this.syncExpiredMatches();

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
    await this.syncExpiredMatches();

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

  async getPlayers(query: CommunityPlayersQueryDto, currentUserId?: string) {
    const where: Prisma.UserWhereInput = {
      role: { not: 'guest' },
    };
    const profileWhere: Prisma.CommunityProfileWhereInput = {};

    if (query.q?.trim()) {
      const keyword = query.q.trim();
      where.OR = [
        { username: { contains: keyword, mode: 'insensitive' } },
        { fullName: { contains: keyword, mode: 'insensitive' } },
        { email: { contains: keyword, mode: 'insensitive' } },
      ];
    }
    if (query.district) {
      profileWhere.district = DISTRICT_LABEL_TO_ENUM[query.district];
    }
    if (query.level) {
      profileWhere.level = LEVEL_LABEL_TO_ENUM[query.level];
    }
    if (Object.keys(profileWhere).length) {
      where.communityProfile = { is: profileWhere };
    }

    const users = await this.prisma.user.findMany({
      where,
      take: 30,
      orderBy: [{ createdAt: 'desc' }],
      include: { communityProfile: true },
    });
    const friendshipMap = currentUserId
      ? await this.getFriendshipStatusMap(
          currentUserId,
          users.map((user) => user.id),
        )
      : new Map<string, string>();

    return {
      players: users.map((user) => ({
        ...this.mapPlayer(user, user.communityProfile),
        friendshipStatus:
          user.id === currentUserId
            ? 'self'
            : friendshipMap.get(user.id) || 'none',
      })),
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
    await this.syncExpiredMatches();

    const where: Prisma.CommunityMatchWhereInput = {
      status: {
        in: [
          CommunityMatchStatus.open,
          CommunityMatchStatus.full,
          CommunityMatchStatus.expired,
        ],
      },
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
    }, { timeout: 15000 });

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

  async updateProfile(
    userId: string,
    dto: { avatar_url?: string; cover_image_url?: string },
  ) {
    await this.ensureProfile(userId);

    const profile = await this.prisma.communityProfile.update({
      where: { userId },
      data: {
        ...(dto.avatar_url !== undefined
          ? { avatar: dto.avatar_url.trim() || null }
          : {}),
        ...(dto.cover_image_url !== undefined
          ? { coverImage: dto.cover_image_url.trim() || null }
          : {}),
      },
      include: {
        user: true,
      },
    });

    return {
      player: this.mapPlayer(profile.user, profile),
    };
  }

  async getFriends(userId: string) {
    const rows = await this.prisma.communityFriendship.findMany({
      where: {
        OR: [{ requesterId: userId }, { addresseeId: userId }],
      },
      orderBy: { updatedAt: 'desc' },
      include: {
        requester: { include: { communityProfile: true } },
        addressee: { include: { communityProfile: true } },
      },
    });

    const mapFriendship = (row: any) => {
      const other = row.requesterId === userId ? row.addressee : row.requester;
      return {
        id: row.id,
        status: row.status,
        direction: row.requesterId === userId ? 'outgoing' : 'incoming',
        player: this.mapPlayer(other, other.communityProfile),
      };
    };

    return {
      friends: rows
        .filter((row) => row.status === CommunityFriendshipStatus.accepted)
        .map(mapFriendship),
      incomingRequests: rows
        .filter(
          (row) =>
            row.status === CommunityFriendshipStatus.pending &&
            row.addresseeId === userId,
        )
        .map(mapFriendship),
      outgoingRequests: rows
        .filter(
          (row) =>
            row.status === CommunityFriendshipStatus.pending &&
            row.requesterId === userId,
        )
        .map(mapFriendship),
    };
  }

  async sendFriendRequest(userId: string, username: string) {
    const target = await this.findFriendTarget(userId, username);
    const existing = await this.findFriendshipBetween(userId, target.id);

    if (existing?.status === CommunityFriendshipStatus.accepted) {
      return { friendshipStatus: 'friends' };
    }
    if (
      existing?.status === CommunityFriendshipStatus.pending &&
      existing.requesterId === userId
    ) {
      return { friendshipStatus: 'outgoing' };
    }
    if (
      existing?.status === CommunityFriendshipStatus.pending &&
      existing.addresseeId === userId
    ) {
      return this.acceptFriendRequest(userId, username);
    }

    await this.prisma.$transaction(async (tx) => {
      if (existing) {
        await tx.communityFriendship.update({
          where: { id: existing.id },
          data: {
            requesterId: userId,
            addresseeId: target.id,
            status: CommunityFriendshipStatus.pending,
          },
        });
      } else {
        await tx.communityFriendship.create({
          data: {
            requesterId: userId,
            addresseeId: target.id,
            status: CommunityFriendshipStatus.pending,
          },
        });
      }

      await this.createNotification(tx, {
        userId: target.id,
        actorId: userId,
        kind: CommunityNotificationKind.follow,
        text: 'da gui loi moi ket ban.',
        targetType: 'profile',
        targetId: target.username,
      });
    });

    return { friendshipStatus: 'outgoing' };
  }

  async acceptFriendRequest(userId: string, username: string) {
    const target = await this.findFriendTarget(userId, username);
    const existing = await this.findFriendshipBetween(userId, target.id);
    if (!existing || existing.status !== CommunityFriendshipStatus.pending) {
      throw new BadRequestException('Khong co loi moi ket ban dang cho');
    }
    if (existing.addresseeId !== userId) {
      throw new ForbiddenException('Ban khong phai nguoi nhan loi moi nay');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.communityFriendship.update({
        where: { id: existing.id },
        data: { status: CommunityFriendshipStatus.accepted },
      });
      await this.createNotification(tx, {
        userId: target.id,
        actorId: userId,
        kind: CommunityNotificationKind.follow,
        text: 'da chap nhan loi moi ket ban.',
        targetType: 'profile',
        targetId: target.username,
      });
    });

    return { friendshipStatus: 'friends' };
  }

  async rejectFriendRequest(userId: string, username: string) {
    const target = await this.findFriendTarget(userId, username);
    const existing = await this.findFriendshipBetween(userId, target.id);
    if (!existing || existing.status !== CommunityFriendshipStatus.pending) {
      return { friendshipStatus: 'none' };
    }
    if (existing.addresseeId !== userId && existing.requesterId !== userId) {
      throw new ForbiddenException('Ban khong co quyen cap nhat loi moi nay');
    }

    await this.prisma.communityFriendship.update({
      where: { id: existing.id },
      data: {
        status:
          existing.requesterId === userId
            ? CommunityFriendshipStatus.cancelled
            : CommunityFriendshipStatus.rejected,
      },
    });

    return { friendshipStatus: 'none' };
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
    if (this.hasMatchElapsed(bookingDate, booking.timeEnd ?? booking.timeStart)) {
      throw new BadRequestException('Khong the tao keo tu booking da het gio choi');
    }

    const district = this.inferDistrictFromBranch(booking.branch);
    if (!district) {
      throw new BadRequestException('Chi nhanh cua booking chua duoc cau hinh khu vuc cong dong');
    }

    const existingMatch = await this.prisma.communityMatch.findFirst({
      where: {
        bookingId: booking.id,
        status: {
          in: [
            CommunityMatchStatus.open,
            CommunityMatchStatus.full,
            CommunityMatchStatus.expired,
          ],
        },
      },
    });
    if (existingMatch) {
      throw new BadRequestException('Ban da tao keo cho booking san nay roi');
    }

    const totalPlayers = Math.max(2, Number(booking.people || dto.needed_players || 2));
    const pricePerPerson = Math.round(Number(booking.amount) / totalPlayers);

    const matchId = await this.prisma.$transaction(async (tx) => {
      const created = await tx.communityMatch.create({
        data: {
          hostId: userId,
          bookingId: booking.id,
          title: dto.title.trim(),
          district,
          level: LEVEL_LABEL_TO_ENUM[dto.level],
          date: bookingDate,
          slotStart: booking.timeStart,
          slotEnd: booking.timeEnd ?? booking.timeStart,
          neededPlayers: totalPlayers,
          currentPlayers: 1,
          pricePerPerson: new Prisma.Decimal(pricePerPerson),
          note: dto.note?.trim() || null,
          branchId: booking.branchId,
          courtId: booking.courtId,
        },
      });

      await tx.communityMatchParticipant.create({
        data: {
          matchId: created.id,
          userId,
          status: CommunityMatchParticipationStatus.joined,
        },
      });

      const room = await tx.communityChatRoom.create({
        data: {
          matchId: created.id,
          title: created.title,
        },
      });

      await tx.communityChatMember.create({
        data: {
          roomId: room.id,
          userId,
          role: CommunityChatRole.owner,
        },
      });

      await tx.communityProfile.update({
        where: { userId },
        data: { matchesCount: { increment: 1 } },
      });

      return created.id;
    });

    const match = await this.prisma.communityMatch.findUniqueOrThrow({
      where: { id: matchId },
      include: this.buildMatchInclude(userId),
    });

    return this.mapMatch(match, userId);
  }

  async joinMatch(userId: string, matchId: string) {

    await this.ensureProfile(userId);
    await this.syncExpiredMatches([matchId]);
    const match = await this.prisma.communityMatch.findUnique({
      where: { id: matchId },
      include: this.buildMatchInclude(userId),
    });
    if (!match) throw new NotFoundException('Không tìm thấy kèo đấu');
    if (match.hostId === userId) {
      throw new BadRequestException('Bạn đã là chủ kèo này');
    }
    if (
      match.status !== CommunityMatchStatus.open ||
      this.hasMatchElapsed(match.date, match.slotEnd)
    ) {
      throw new ForbiddenException('Kèo đấu không còn mở');
    }

    const existing = await this.prisma.communityMatchParticipant.findUnique({
      where: { matchId_userId: { matchId, userId } },
    });

    if (existing?.status === CommunityMatchParticipationStatus.joined) {
      return {
        joined: true,
        requested: false,
        match: this.mapMatch(match, userId),
      };
    }

    if (existing?.status === CommunityMatchParticipationStatus.requested) {
      return {
        joined: false,
        requested: true,
        match: this.mapMatch(match, userId),
      };
    }

    await this.prisma.$transaction(async (tx) => {
      if (existing) {
        await tx.communityMatchParticipant.update({
          where: { matchId_userId: { matchId, userId } },
          data: { status: CommunityMatchParticipationStatus.requested },
        });
      } else {
        await tx.communityMatchParticipant.create({
          data: {
            matchId,
            userId,
            status: CommunityMatchParticipationStatus.requested,
          },
        });
      }

        await this.createNotification(tx, {
          userId: match.hostId,
          actorId: userId,
          kind: CommunityNotificationKind.match,
          text: `đã xin tham gia kèo "${match.title}" của bạn.`,
          targetType: 'match',
          targetId: matchId,
        });
      });

    const fresh = await this.prisma.communityMatch.findUniqueOrThrow({
      where: { id: matchId },
      include: this.buildMatchInclude(userId),
    });

    return {
      joined: false,
      requested: true,
      match: this.mapMatch(fresh, userId),
    };
  }

  async getMatchParticipants(hostId: string, matchId: string) {
    const match = await this.prisma.communityMatch.findUnique({
      where: { id: matchId },
      include: {
        participants: {
          orderBy: { createdAt: 'asc' },
          include: { user: { include: { communityProfile: true } } },
        },
      },
    });
    if (!match) throw new NotFoundException('Khong tim thay keo dau');
    if (match.hostId !== hostId) throw new ForbiddenException('Chi chu keo moi duoc duyet');

    return {
      participants: match.participants.map((participant) => ({
        userId: participant.userId,
        status: participant.status,
        requestedAt: participant.createdAt,
        player: this.mapPlayer(participant.user, participant.user.communityProfile),
      })),
    };
  }

  async approveMatchParticipant(hostId: string, matchId: string, participantUserId: string) {
    await this.syncExpiredMatches([matchId]);

    const match = await this.prisma.communityMatch.findUnique({
      where: { id: matchId },
      include: this.buildMatchInclude(hostId),
    });
    if (!match) throw new NotFoundException('Khong tim thay keo dau');
    if (match.hostId !== hostId) throw new ForbiddenException('Chi chu keo moi duoc duyet');
    if (
      match.status !== CommunityMatchStatus.open ||
      this.hasMatchElapsed(match.date, match.slotEnd)
    ) {
      throw new ForbiddenException('Keo nay da qua han hoac khong con nhan nguoi');
    }
    if (match.currentPlayers >= match.neededPlayers) {
      throw new BadRequestException('Keo da du nguoi');
    }

    const participant = await this.prisma.communityMatchParticipant.findUnique({
      where: { matchId_userId: { matchId, userId: participantUserId } },
    });
    if (!participant || participant.status !== CommunityMatchParticipationStatus.requested) {
      throw new BadRequestException('Nguoi choi chua gui yeu cau tham gia');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.communityMatchParticipant.update({
        where: { matchId_userId: { matchId, userId: participantUserId } },
        data: { status: CommunityMatchParticipationStatus.joined },
      });

      const nextPlayers = match.currentPlayers + 1;
      await tx.communityMatch.update({
        where: { id: matchId },
        data: {
          currentPlayers: { increment: 1 },
          status:
            nextPlayers >= match.neededPlayers
              ? CommunityMatchStatus.full
              : CommunityMatchStatus.open,
        },
      });

      const room = await tx.communityChatRoom.upsert({
        where: { matchId },
        update: {},
        create: { matchId, title: match.title },
      });

      await tx.communityChatMember.upsert({
        where: { roomId_userId: { roomId: room.id, userId: hostId } },
        update: { role: CommunityChatRole.owner },
        create: {
          roomId: room.id,
          userId: hostId,
          role: CommunityChatRole.owner,
        },
      });

      await tx.communityChatMember.upsert({
        where: { roomId_userId: { roomId: room.id, userId: participantUserId } },
        update: { role: CommunityChatRole.member },
        create: {
          roomId: room.id,
          userId: participantUserId,
          role: CommunityChatRole.member,
        },
      });

      await this.createNotification(tx, {
        userId: participantUserId,
        actorId: hostId,
        kind: CommunityNotificationKind.match,
        text: `da duyet ban vao keo "${match.title}".`,
        targetType: 'match',
        targetId: matchId,
      });
    });

    const fresh = await this.prisma.communityMatch.findUniqueOrThrow({
      where: { id: matchId },
      include: this.buildMatchInclude(hostId),
    });

    return { match: this.mapMatch(fresh, hostId) };
  }

  async rejectMatchParticipant(hostId: string, matchId: string, participantUserId: string) {
    const match = await this.prisma.communityMatch.findUnique({
      where: { id: matchId },
      select: { id: true, hostId: true, title: true },
    });
    if (!match) throw new NotFoundException('Khong tim thay keo dau');
    if (match.hostId !== hostId) throw new ForbiddenException('Chi chu keo moi duoc duyet');

    await this.prisma.$transaction(async (tx) => {
      await tx.communityMatchParticipant.update({
        where: { matchId_userId: { matchId, userId: participantUserId } },
        data: { status: CommunityMatchParticipationStatus.rejected },
      });

      await this.createNotification(tx, {
        userId: participantUserId,
        actorId: hostId,
        kind: CommunityNotificationKind.match,
        text: `da tu choi yeu cau vao keo "${match.title}".`,
        targetType: 'match',
        targetId: matchId,
      });
    });

    return { success: true };
  }

  async getChatRooms(userId: string) {
    const memberships = await this.prisma.communityChatMember.findMany({
      where: { userId },
      orderBy: { room: { updatedAt: 'desc' } },
      include: {
        room: {
          include: this.buildChatRoomInclude(),
        },
      },
    });

    return {
      rooms: memberships.map((membership) =>
        this.mapChatRoom(membership.room, userId),
      ),
    };
  }

  async startPrivateChat(userId: string, username: string) {
    await this.ensureProfile(userId);

    const target = await this.prisma.user.findUnique({
      where: { username },
      include: { communityProfile: true },
    });
    if (!target) throw new NotFoundException('Khong tim thay nguoi choi');
    if (target.id === userId) {
      throw new BadRequestException('Ban khong the chat rieng voi chinh minh');
    }
    await this.ensureProfile(target.id);

    const [firstId, secondId] = [userId, target.id].sort();
    const directKey = `${firstId}:${secondId}`;
    const room = await this.prisma.$transaction(async (tx) => {
      const created = await tx.communityChatRoom.upsert({
        where: { directKey },
        update: {},
        create: {
          type: CommunityChatRoomType.private,
          directKey,
          title: `Chat rieng`,
        },
      });

      await tx.communityChatMember.upsert({
        where: { roomId_userId: { roomId: created.id, userId } },
        update: {},
        create: { roomId: created.id, userId, role: CommunityChatRole.member },
      });
      await tx.communityChatMember.upsert({
        where: { roomId_userId: { roomId: created.id, userId: target.id } },
        update: {},
        create: {
          roomId: created.id,
          userId: target.id,
          role: CommunityChatRole.member,
        },
      });

      return created;
    });

    const fresh = await this.prisma.communityChatRoom.findUniqueOrThrow({
      where: { id: room.id },
      include: this.buildChatRoomInclude(),
    });

    return { room: this.mapChatRoom(fresh, userId) };
  }

  async getChatMessages(
    userId: string,
    roomId: string,
    query: CommunityChatMessagesQueryDto = {},
  ) {
    await this.ensureChatMember(userId, roomId);

    const take = Math.min(Math.max(query.limit ?? 50, 1), 200);
    const afterDate = query.after ? new Date(query.after) : null;
    const messages = await this.prisma.communityChatMessage.findMany({
      where: {
        roomId,
        ...(afterDate ? { createdAt: { gt: afterDate } } : {}),
      },
      orderBy: { createdAt: afterDate ? 'asc' : 'desc' },
      take,
      include: { sender: { include: { communityProfile: true } } },
    });

    const orderedMessages = afterDate ? messages : [...messages].reverse();

    return {
      messages: orderedMessages.map((message) =>
        this.mapChatMessage(message, userId),
      ),
    };
  }

  async sendChatMessage(userId: string, roomId: string, dto: SendCommunityChatMessageDto) {
    await this.ensureChatMember(userId, roomId);

    const message = await this.prisma.$transaction(async (tx) => {
      const created = await tx.communityChatMessage.create({
        data: {
          roomId,
          senderId: userId,
          body: dto.body.trim(),
        },
        include: { sender: { include: { communityProfile: true } } },
      });

      await tx.communityChatRoom.update({
        where: { id: roomId },
        data: {},
      });

      return created;
    });

    return { message: this.mapChatMessage(message, userId) };
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
        coverImage: null,
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
    void currentUserId;

    return {
      host: { include: { communityProfile: true } },
      branch: true,
      court: true,
      chatRoom: true,
      participants: {
        include: {
          user: { include: { communityProfile: true } },
        },
      },
    };
  }

  private async syncExpiredMatches(matchIds?: string[]) {
    const idFilter: Prisma.CommunityMatchWhereInput =
      matchIds && matchIds.length
        ? { id: { in: matchIds } }
        : {};
    const now = getBusinessNowParts(new Date());
    const today = normalizeDate(now.dateToken);
    const activeStatuses = [CommunityMatchStatus.open, CommunityMatchStatus.full];

    await this.prisma.communityMatch.updateMany({
      where: {
        ...idFilter,
        status: { in: activeStatuses },
        date: { lt: today },
      },
      data: { status: CommunityMatchStatus.expired },
    });

    const todayMatches = await this.prisma.communityMatch.findMany({
      where: {
        ...idFilter,
        status: { in: activeStatuses },
        date: today,
      },
      select: { id: true, slotEnd: true },
    });
    const nowMinutes = now.minutes;
    const expiredTodayIds = todayMatches
      .filter((match) => this.minutesFromTime(match.slotEnd) <= nowMinutes)
      .map((match) => match.id);

    if (expiredTodayIds.length) {
      await this.prisma.communityMatch.updateMany({
        where: { id: { in: expiredTodayIds } },
        data: { status: CommunityMatchStatus.expired },
      });
    }
  }

  private hasMatchElapsed(date: Date | string, slotEnd: string) {
    const now = getBusinessNowParts(new Date());
    const matchDate = formatDate(new Date(date));
    if (matchDate < now.dateToken) return true;
    if (matchDate > now.dateToken) return false;
    return this.minutesFromTime(slotEnd) <= now.minutes;
  }

  private minutesFromTime(value: string) {
    const [hourRaw, minuteRaw] = value.split(':');
    const hour = Number(hourRaw || 0);
    const minute = Number(minuteRaw || 0);
    return hour * 60 + minute;
  }

  private async ensureChatMember(userId: string, roomId: string) {
    const member = await this.prisma.communityChatMember.findUnique({
      where: { roomId_userId: { roomId, userId } },
    });
    if (!member) throw new ForbiddenException('Ban chua o trong nhom chat nay');
    return member;
  }

  private async findFriendTarget(userId: string, username: string) {
    const target = await this.prisma.user.findUnique({
      where: { username },
      include: { communityProfile: true },
    });
    if (!target) throw new NotFoundException('Khong tim thay nguoi choi');
    if (target.id === userId) {
      throw new BadRequestException('Khong the ket ban voi chinh minh');
    }
    await this.ensureProfile(userId);
    await this.ensureProfile(target.id);
    return target;
  }

  private findFriendshipBetween(userId: string, targetUserId: string) {
    return this.prisma.communityFriendship.findFirst({
      where: {
        OR: [
          { requesterId: userId, addresseeId: targetUserId },
          { requesterId: targetUserId, addresseeId: userId },
        ],
      },
    });
  }

  private async getFriendshipStatusMap(userId: string, targetUserIds: string[]) {
    const map = new Map<string, string>();
    const ids = targetUserIds.filter((id) => id !== userId);
    if (!ids.length) return map;

    const rows = await this.prisma.communityFriendship.findMany({
      where: {
        OR: [
          { requesterId: userId, addresseeId: { in: ids } },
          { requesterId: { in: ids }, addresseeId: userId },
        ],
      },
    });

    for (const row of rows) {
      const otherId = row.requesterId === userId ? row.addresseeId : row.requesterId;
      if (row.status === CommunityFriendshipStatus.accepted) {
        map.set(otherId, 'friends');
      } else if (row.status === CommunityFriendshipStatus.pending) {
        map.set(otherId, row.requesterId === userId ? 'outgoing' : 'incoming');
      }
    }
    return map;
  }

  private buildChatRoomInclude() {
    return {
      match: {
        include: {
          host: { include: { communityProfile: true } },
          branch: true,
          court: true,
          chatRoom: true,
          participants: {
            include: { user: { include: { communityProfile: true } } },
          },
        },
      },
      members: {
        include: { user: { include: { communityProfile: true } } },
      },
      messages: {
        take: 1,
        orderBy: { createdAt: 'desc' as const },
        include: { sender: { include: { communityProfile: true } } },
      },
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
      cover: profile?.coverImage || '',
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
    const currentParticipant = match.participants?.find(
      (participant: any) => participant.userId === currentUserId,
    );
    const joined = !!match.participants?.some(
      (participant: any) =>
        participant.userId === currentUserId &&
        participant.status === CommunityMatchParticipationStatus.joined,
    );
    const requested =
      currentParticipant?.status === CommunityMatchParticipationStatus.requested;
    const isHost = match.hostId === currentUserId;
    const expired =
      match.status === CommunityMatchStatus.expired ||
      this.hasMatchElapsed(match.date, match.slotEnd);
    const pendingParticipants = (match.participants || []).filter(
      (participant: any) =>
        participant.status === CommunityMatchParticipationStatus.requested,
    );
    const joinedParticipants = (match.participants || []).filter(
      (participant: any) =>
        participant.status === CommunityMatchParticipationStatus.joined,
    );
    const canJoin =
      !!currentUserId &&
      !isHost &&
      !joined &&
      !requested &&
      !expired &&
      match.status === CommunityMatchStatus.open;
    const status = expired ? CommunityMatchStatus.expired : match.status;
    const roomId = match.chatRoom && (isHost || joined) ? match.chatRoom.id : null;

    return {
      id: match.id,
      title: match.title,
      status,
      statusLabel: this.getMatchStatusLabel(status),
      district: DISTRICT_ENUM_TO_LABEL[match.district],
      court: this.buildCourtLabel(match.court, match.branch) || DISTRICT_ENUM_TO_LABEL[match.district],
      level: LEVEL_ENUM_TO_LABEL[match.level],
      date: this.formatMatchDate(match.date),
      slot: `${match.slotStart} - ${match.slotEnd}`,
      filled: match.currentPlayers,
      needed: match.neededPlayers,
      pricePerPerson: Number(match.pricePerPerson),
      price: `${this.formatMoney(Number(match.pricePerPerson))} / người`,
      note: match.note || '',
      joined,
      requested,
      canJoin,
      expired,
      isHost,
      roomId,
      pendingParticipants: pendingParticipants.length,
      participants: joinedParticipants.map((participant: any) => ({
        userId: participant.userId,
        status: participant.status,
        player: this.mapPlayer(participant.user, participant.user?.communityProfile),
      })),
      host: this.mapPlayer(match.host, match.host?.communityProfile),
    };
  }

  private getMatchStatusLabel(status: CommunityMatchStatus) {
    switch (status) {
      case CommunityMatchStatus.open:
        return 'Dang mo';
      case CommunityMatchStatus.full:
        return 'Da du';
      case CommunityMatchStatus.expired:
        return 'Qua han';
      case CommunityMatchStatus.completed:
        return 'Da hoan thanh';
      case CommunityMatchStatus.cancelled:
        return 'Da huy';
      default:
        return 'Da dong';
    }
  }

  private mapChatRoom(room: any, currentUserId?: string) {
    const latestMessage = room.messages?.[0];
    const otherMember = room.members?.find(
      (member: any) => member.userId !== currentUserId,
    );
    const otherPlayer = otherMember
      ? this.mapPlayer(otherMember.user, otherMember.user?.communityProfile)
      : null;
    const title =
      room.type === CommunityChatRoomType.private && otherPlayer
        ? otherPlayer.name
        : room.title;

    return {
      id: room.id,
      type: room.type,
      title,
      matchId: room.matchId,
      memberCount: room.members?.length ?? 0,
      match: room.match ? this.mapMatch(room.match, currentUserId) : null,
      otherPlayer,
      latestMessage: latestMessage ? this.mapChatMessage(latestMessage) : null,
    };
  }

  private mapChatMessage(message: any, currentUserId?: string) {
    return {
      id: message.id,
      roomId: message.roomId,
      body: message.body,
      createdAt: message.createdAt,
      time: this.formatRelativeTime(message.createdAt),
      mine: message.senderId === currentUserId,
      sender: this.mapPlayer(message.sender, message.sender?.communityProfile),
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
