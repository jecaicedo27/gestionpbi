-- AlterTable
ALTER TABLE "products" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "price" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "taxClassification" TEXT,
ADD COLUMN     "taxIncluded" BOOLEAN,
ADD COLUMN     "taxes" JSONB,
ADD COLUMN     "warehouses" JSONB;
