-- AlterTable: thêm cột weekly_slots và default cho cycle
ALTER TABLE "fixed_schedules" ADD COLUMN "weekly_slots" JSONB;
ALTER TABLE "fixed_schedules" ALTER COLUMN "cycle" SET DEFAULT 'weekly';
