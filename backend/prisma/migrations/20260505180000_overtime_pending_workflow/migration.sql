-- 1) Enum status
CREATE TYPE "OvertimeStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- 2) New columns (defaults so we can backfill before tightening)
ALTER TABLE "overtime_approvals"
  ADD COLUMN "status" "OvertimeStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "category" TEXT,
  ADD COLUMN "review_notes" TEXT;

-- 3) Pre-existing approvals were always created BY an admin → mark them APPROVED
UPDATE "overtime_approvals" SET "status" = 'APPROVED' WHERE "approved_by_id" IS NOT NULL;

-- 4) Allow approver fields to be null (PENDING records have no admin yet)
ALTER TABLE "overtime_approvals" ALTER COLUMN "approved_by_id" DROP NOT NULL;
ALTER TABLE "overtime_approvals" ALTER COLUMN "approved_at" DROP NOT NULL;
ALTER TABLE "overtime_approvals" ALTER COLUMN "approved_at" DROP DEFAULT;

-- 5) Drop the existing FK and recreate it as ON DELETE SET NULL
ALTER TABLE "overtime_approvals" DROP CONSTRAINT IF EXISTS "overtime_approvals_approved_by_id_fkey";
ALTER TABLE "overtime_approvals"
  ADD CONSTRAINT "overtime_approvals_approved_by_id_fkey"
  FOREIGN KEY ("approved_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 6) Index on status for fast PENDING queries
CREATE INDEX "overtime_approvals_status_idx" ON "overtime_approvals"("status");
