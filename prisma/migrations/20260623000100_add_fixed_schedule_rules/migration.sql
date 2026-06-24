ALTER TABLE "fixed_schedules"
  ADD COLUMN IF NOT EXISTS "booking_mode" VARCHAR(30) NOT NULL DEFAULT 'date_range',
  ADD COLUMN IF NOT EXISTS "requested_occurrence_count" INTEGER,
  ADD COLUMN IF NOT EXISTS "rules" JSONB;
