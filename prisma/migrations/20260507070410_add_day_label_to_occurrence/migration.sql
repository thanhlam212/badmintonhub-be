/*
  Warnings:

  - Added the required column `day_label` to the `fixed_schedule_occurrences` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "idx_fixed_occurrence_court_date";

-- AlterTable
ALTER TABLE "fixed_schedule_occurrences" ADD COLUMN     "day_label" VARCHAR(10) NOT NULL;
