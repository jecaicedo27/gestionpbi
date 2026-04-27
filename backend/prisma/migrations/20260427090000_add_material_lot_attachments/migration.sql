CREATE TABLE "material_lot_attachments" (
    "id" TEXT NOT NULL,
    "material_lot_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "stored_name" TEXT NOT NULL,
    "mime_type" TEXT,
    "size_bytes" INTEGER,
    "url" TEXT NOT NULL,
    "uploaded_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "material_lot_attachments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "material_lot_attachments_material_lot_id_idx" ON "material_lot_attachments"("material_lot_id");
CREATE INDEX "material_lot_attachments_material_lot_id_type_idx" ON "material_lot_attachments"("material_lot_id", "type");
CREATE INDEX "material_lot_attachments_uploaded_by_id_idx" ON "material_lot_attachments"("uploaded_by_id");

ALTER TABLE "material_lot_attachments"
ADD CONSTRAINT "material_lot_attachments_material_lot_id_fkey"
FOREIGN KEY ("material_lot_id") REFERENCES "material_lots"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "material_lot_attachments"
ADD CONSTRAINT "material_lot_attachments_uploaded_by_id_fkey"
FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
