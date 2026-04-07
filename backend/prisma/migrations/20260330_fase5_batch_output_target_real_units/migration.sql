-- Phase 5: BatchOutputTarget real production counts
ALTER TABLE batch_output_targets
  ADD COLUMN IF NOT EXISTS actual_units   INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS approved_units INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS defective_units INT NOT NULL DEFAULT 0;
