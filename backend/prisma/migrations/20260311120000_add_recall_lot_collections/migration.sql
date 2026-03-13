CREATE TABLE "recall_lot_collections" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "lot_number" TEXT NOT NULL,
    "collected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recall_lot_collections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "recall_lot_collections_user_id_lot_number_key" ON "recall_lot_collections"("user_id", "lot_number");
CREATE INDEX "recall_lot_collections_lot_number_idx" ON "recall_lot_collections"("lot_number");

ALTER TABLE "recall_lot_collections"
ADD CONSTRAINT "recall_lot_collections_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
