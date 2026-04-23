DO $$
BEGIN
    CREATE TYPE "ShiftHandoverParticipantGroup" AS ENUM ('OUTGOING', 'INCOMING');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "shift_handover_signatures"
ADD COLUMN IF NOT EXISTS "participant_group" "ShiftHandoverParticipantGroup" NOT NULL DEFAULT 'OUTGOING';
