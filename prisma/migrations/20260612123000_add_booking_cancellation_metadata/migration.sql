ALTER TABLE "bookings"
ADD COLUMN "cancellation_reason" TEXT,
ADD COLUMN "cancelled_at" TIMESTAMP(3),
ADD COLUMN "cancelled_by_name" VARCHAR(100),
ADD COLUMN "cancelled_by_role" VARCHAR(30);
