/*
  Warnings:

  - A unique constraint covering the columns `[fixed_occurrence_id]` on the table `bookings` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "FixedScheduleCycle" AS ENUM ('weekly', 'monthly');

-- CreateEnum
CREATE TYPE "FixedScheduleStatus" AS ENUM ('pending', 'deposited', 'confirmed', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "FixedOccurrenceStatus" AS ENUM ('scheduled', 'rescheduled', 'skipped', 'cancelled', 'completed');

-- CreateEnum
CREATE TYPE "FixedAdjustmentType" AS ENUM ('skip', 'reschedule', 'change_court');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('unpaid', 'deposited', 'paid', 'cancelled', 'refunded');

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "fixed_occurrence_id" UUID,
ADD COLUMN     "fixed_schedule_id" UUID;

-- CreateTable
CREATE TABLE "fixed_schedules" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "court_id" INTEGER NOT NULL,
    "cycle" "FixedScheduleCycle" NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "time_start" VARCHAR(5) NOT NULL,
    "time_end" VARCHAR(5) NOT NULL,
    "customer_name" VARCHAR(100) NOT NULL,
    "customer_phone" VARCHAR(15) NOT NULL,
    "customer_email" VARCHAR(100),
    "payment_method" VARCHAR(30) NOT NULL,
    "price_per_hour_snapshot" DECIMAL(12,0) NOT NULL,
    "total_amount_snapshot" DECIMAL(12,0) NOT NULL,
    "occurrence_count" INTEGER NOT NULL DEFAULT 0,
    "adjustment_limit" INTEGER NOT NULL DEFAULT 2,
    "adjustment_used" INTEGER NOT NULL DEFAULT 0,
    "status" "FixedScheduleStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fixed_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_schedule_occurrences" (
    "id" UUID NOT NULL,
    "fixed_schedule_id" UUID NOT NULL,
    "court_id" INTEGER NOT NULL,
    "occurrence_date" DATE NOT NULL,
    "time_start" VARCHAR(5) NOT NULL,
    "time_end" VARCHAR(5) NOT NULL,
    "price_per_hour_snapshot" DECIMAL(12,0) NOT NULL,
    "amount_snapshot" DECIMAL(12,0) NOT NULL,
    "status" "FixedOccurrenceStatus" NOT NULL DEFAULT 'scheduled',

    CONSTRAINT "fixed_schedule_occurrences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_schedule_adjustments" (
    "id" UUID NOT NULL,
    "fixed_schedule_id" UUID NOT NULL,
    "occurrence_id" UUID,
    "type" "FixedAdjustmentType" NOT NULL,
    "old_court_id" INTEGER,
    "old_date" DATE,
    "old_time_start" VARCHAR(5),
    "old_time_end" VARCHAR(5),
    "new_court_id" INTEGER,
    "new_date" DATE,
    "new_time_start" VARCHAR(5),
    "new_time_end" VARCHAR(5),
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fixed_schedule_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "booking_id" UUID,
    "order_id" UUID,
    "fixed_schedule_id" UUID,
    "customer_name" VARCHAR(100) NOT NULL,
    "customer_phone" VARCHAR(15) NOT NULL,
    "customer_email" VARCHAR(100),
    "subtotal_snapshot" DECIMAL(12,0) NOT NULL,
    "total_snapshot" DECIMAL(12,0) NOT NULL,
    "payment_method" VARCHAR(30) NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'unpaid',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_items" (
    "id" SERIAL NOT NULL,
    "invoice_id" UUID NOT NULL,
    "description" VARCHAR(255) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price_snapshot" DECIMAL(12,0) NOT NULL,
    "line_total_snapshot" DECIMAL(12,0) NOT NULL,

    CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_fixed_schedules_user" ON "fixed_schedules"("user_id");

-- CreateIndex
CREATE INDEX "idx_fixed_schedules_status" ON "fixed_schedules"("status");

-- CreateIndex
CREATE INDEX "idx_fixed_occurrence_court_date" ON "fixed_schedule_occurrences"("court_id", "occurrence_date");

-- CreateIndex
CREATE INDEX "idx_fixed_adjustments_schedule" ON "fixed_schedule_adjustments"("fixed_schedule_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_code_key" ON "invoices"("code");

-- CreateIndex
CREATE INDEX "idx_invoices_booking" ON "invoices"("booking_id");

-- CreateIndex
CREATE INDEX "idx_invoices_fixed_schedule" ON "invoices"("fixed_schedule_id");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_fixed_occurrence_id_key" ON "bookings"("fixed_occurrence_id");

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_fixed_schedule_id_fkey" FOREIGN KEY ("fixed_schedule_id") REFERENCES "fixed_schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_fixed_occurrence_id_fkey" FOREIGN KEY ("fixed_occurrence_id") REFERENCES "fixed_schedule_occurrences"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_schedules" ADD CONSTRAINT "fixed_schedules_court_id_fkey" FOREIGN KEY ("court_id") REFERENCES "courts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_schedules" ADD CONSTRAINT "fixed_schedules_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_schedule_occurrences" ADD CONSTRAINT "fixed_schedule_occurrences_court_id_fkey" FOREIGN KEY ("court_id") REFERENCES "courts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_schedule_occurrences" ADD CONSTRAINT "fixed_schedule_occurrences_fixed_schedule_id_fkey" FOREIGN KEY ("fixed_schedule_id") REFERENCES "fixed_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_schedule_adjustments" ADD CONSTRAINT "fixed_schedule_adjustments_fixed_schedule_id_fkey" FOREIGN KEY ("fixed_schedule_id") REFERENCES "fixed_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_schedule_adjustments" ADD CONSTRAINT "fixed_schedule_adjustments_occurrence_id_fkey" FOREIGN KEY ("occurrence_id") REFERENCES "fixed_schedule_occurrences"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_fixed_schedule_id_fkey" FOREIGN KEY ("fixed_schedule_id") REFERENCES "fixed_schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
