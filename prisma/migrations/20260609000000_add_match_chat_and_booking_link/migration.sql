CREATE TYPE "CommunityChatRole" AS ENUM ('owner', 'member');

ALTER TYPE "CommunityMatchStatus" ADD VALUE 'expired';

ALTER TABLE "community_matches" ADD COLUMN "booking_id" UUID;

CREATE TABLE "community_chat_rooms" (
  "id" UUID NOT NULL,
  "match_id" UUID NOT NULL,
  "title" VARCHAR(150) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "community_chat_rooms_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "community_chat_members" (
  "room_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "role" "CommunityChatRole" NOT NULL DEFAULT 'member',
  "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "community_chat_members_pkey" PRIMARY KEY ("room_id", "user_id")
);

CREATE TABLE "community_chat_messages" (
  "id" UUID NOT NULL,
  "room_id" UUID NOT NULL,
  "sender_id" UUID NOT NULL,
  "body" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "community_chat_messages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "community_matches_booking_id_key" ON "community_matches"("booking_id");
CREATE INDEX "idx_community_matches_booking" ON "community_matches"("booking_id");
CREATE UNIQUE INDEX "community_chat_rooms_match_id_key" ON "community_chat_rooms"("match_id");
CREATE INDEX "idx_community_chat_members_user" ON "community_chat_members"("user_id");
CREATE INDEX "idx_community_chat_messages_room" ON "community_chat_messages"("room_id", "created_at");

ALTER TABLE "community_matches" ADD CONSTRAINT "community_matches_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "community_chat_rooms" ADD CONSTRAINT "community_chat_rooms_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "community_matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "community_chat_members" ADD CONSTRAINT "community_chat_members_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "community_chat_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "community_chat_members" ADD CONSTRAINT "community_chat_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "community_chat_messages" ADD CONSTRAINT "community_chat_messages_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "community_chat_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "community_chat_messages" ADD CONSTRAINT "community_chat_messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
