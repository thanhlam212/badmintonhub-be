CREATE TYPE "CommunityFriendshipStatus" AS ENUM ('pending', 'accepted', 'rejected', 'cancelled');

CREATE TABLE "community_friendships" (
  "id" UUID NOT NULL,
  "requester_id" UUID NOT NULL,
  "addressee_id" UUID NOT NULL,
  "status" "CommunityFriendshipStatus" NOT NULL DEFAULT 'pending',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "community_friendships_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "community_friendships_requester_addressee_key" ON "community_friendships"("requester_id", "addressee_id");
CREATE INDEX "idx_community_friendships_requester" ON "community_friendships"("requester_id", "status");
CREATE INDEX "idx_community_friendships_addressee" ON "community_friendships"("addressee_id", "status");

ALTER TABLE "community_friendships" ADD CONSTRAINT "community_friendships_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "community_friendships" ADD CONSTRAINT "community_friendships_addressee_id_fkey" FOREIGN KEY ("addressee_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
