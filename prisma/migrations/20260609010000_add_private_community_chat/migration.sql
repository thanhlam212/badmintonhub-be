CREATE TYPE "CommunityChatRoomType" AS ENUM ('match', 'private');

ALTER TABLE "community_chat_rooms"
  ADD COLUMN "type" "CommunityChatRoomType" NOT NULL DEFAULT 'match',
  ADD COLUMN "direct_key" VARCHAR(80);

ALTER TABLE "community_chat_rooms"
  ALTER COLUMN "match_id" DROP NOT NULL;

CREATE UNIQUE INDEX "community_chat_rooms_direct_key_key" ON "community_chat_rooms"("direct_key");
