ALTER TABLE "micro_sampling_points"
    ADD COLUMN "zone_code" TEXT;

WITH normalized_points AS (
    SELECT
        msp."id",
        CONCAT(
            'ZMU-',
            COALESCE(
                NULLIF(
                    TRIM(BOTH '-' FROM REGEXP_REPLACE(UPPER(COALESCE(msp."code", msp."name", msp."processArea", 'PUNTO')), '[^A-Z0-9]+', '-', 'g')),
                    ''
                ),
                'PUNTO'
            )
        ) AS base_zone_code,
        ROW_NUMBER() OVER (
            PARTITION BY CONCAT(
                'ZMU-',
                COALESCE(
                    NULLIF(
                        TRIM(BOTH '-' FROM REGEXP_REPLACE(UPPER(COALESCE(msp."code", msp."name", msp."processArea", 'PUNTO')), '[^A-Z0-9]+', '-', 'g')),
                        ''
                    ),
                    'PUNTO'
                )
            )
            ORDER BY msp."createdAt", msp."id"
        ) AS sequence_number
    FROM "micro_sampling_points" msp
)
UPDATE "micro_sampling_points" AS target
SET "zone_code" = CASE
    WHEN source.sequence_number = 1 THEN source.base_zone_code
    ELSE CONCAT(source.base_zone_code, '-', LPAD(source.sequence_number::text, 2, '0'))
END
FROM normalized_points AS source
WHERE source."id" = target."id";

ALTER TABLE "micro_sampling_points"
    ALTER COLUMN "zone_code" SET NOT NULL;

CREATE UNIQUE INDEX "micro_sampling_points_zone_code_key"
    ON "micro_sampling_points"("zone_code");
