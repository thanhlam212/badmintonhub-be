-- AlterEnum
ALTER TYPE "BookingStatus" ADD VALUE 'deposited';

-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'refunded';

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "price_per_hour" DECIMAL(12,0) NOT NULL DEFAULT 0;
