/*
  Warnings:

  - The values [IN_PROGRESS] on the enum `OrderStatus` will be removed. If these variants are still used in the database, this will fail.

*/
-- CreateEnum
CREATE TYPE "ProductClassification" AS ENUM ('PRODUCTO_TERMINADO', 'MATERIA_PRIMA', 'PRODUCTO_EN_PROCESO');

-- AlterEnum
BEGIN;
CREATE TYPE "OrderStatus_new" AS ENUM ('PENDING', 'APPROVED', 'IN_PICKING', 'READY', 'INVOICED', 'DISPATCHED', 'DELIVERED', 'CANCELLED', 'REJECTED');
ALTER TABLE "orders" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "orders" ALTER COLUMN "status" TYPE "OrderStatus_new" USING ("status"::text::"OrderStatus_new");
ALTER TYPE "OrderStatus" RENAME TO "OrderStatus_old";
ALTER TYPE "OrderStatus_new" RENAME TO "OrderStatus";
DROP TYPE "OrderStatus_old";
ALTER TABLE "orders" ALTER COLUMN "status" SET DEFAULT 'PENDING';
COMMIT;

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "UserRole" ADD VALUE 'DIRECTOR_LOGISTICA';
ALTER TYPE "UserRole" ADD VALUE 'OPERARIO_PICKING';
ALTER TYPE "UserRole" ADD VALUE 'PRODUCCION';
ALTER TYPE "UserRole" ADD VALUE 'DIRECTOR_OPERACIONES';
ALTER TYPE "UserRole" ADD VALUE 'LIDER_TURNO';
ALTER TYPE "UserRole" ADD VALUE 'EMPACADOR';
ALTER TYPE "UserRole" ADD VALUE 'ING_QUIMICO';
ALTER TYPE "UserRole" ADD VALUE 'FACTURADOR';

-- DropForeignKey
ALTER TABLE "production_batches" DROP CONSTRAINT "production_batches_productId_fkey";

-- DropForeignKey
ALTER TABLE "production_batches" DROP CONSTRAINT "production_batches_productionOrderId_fkey";

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedBy" TEXT,
ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "pickingProgress" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pickingStartedAt" TIMESTAMP(3),
ADD COLUMN     "pickingStartedBy" TEXT,
ADD COLUMN     "rejectedReason" TEXT;

-- AlterTable
ALTER TABLE "production_batches" ADD COLUMN     "baseWeight" DOUBLE PRECISION,
ADD COLUMN     "flavor" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "projectedTotalWeight" DOUBLE PRECISION,
ADD COLUMN     "scheduledEnd" TIMESTAMP(3),
ADD COLUMN     "scheduledStart" TIMESTAMP(3),
ALTER COLUMN "productionOrderId" DROP NOT NULL,
ALTER COLUMN "productId" DROP NOT NULL,
ALTER COLUMN "lotNumbers" DROP NOT NULL,
ALTER COLUMN "expectedOutput" DROP NOT NULL;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "classification" "ProductClassification";

-- CreateTable
CREATE TABLE "order_picking_items" (
    "id" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "productCode" TEXT NOT NULL,
    "barcode" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "unitsPerBox" INTEGER NOT NULL,
    "lotNumber" TEXT NOT NULL,
    "expirationDate" TIMESTAMP(3) NOT NULL,
    "scannedQty" INTEGER NOT NULL DEFAULT 0,
    "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scannedBy" TEXT NOT NULL,

    CONSTRAINT "order_picking_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batch_output_targets" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "plannedUnits" INTEGER NOT NULL DEFAULT 0,
    "plannedWeightKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "batch_output_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "process_types" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "icon" TEXT,
    "color" TEXT,
    "parameters_schema" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "process_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assembly_templates" (
    "id" TEXT NOT NULL,
    "template_code" TEXT NOT NULL,
    "template_name" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "parent_template_id" TEXT,
    "description" TEXT,
    "total_stages" INTEGER NOT NULL,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assembly_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assembly_template_stages" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "stage_order" INTEGER NOT NULL,
    "stage_name" TEXT NOT NULL,
    "process_type_id" TEXT NOT NULL,
    "process_parameters" JSONB,
    "output_product_id" TEXT,
    "output_classification" TEXT,
    "special_instructions" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assembly_template_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assembly_template_stage_inputs" (
    "id" TEXT NOT NULL,
    "stage_id" TEXT NOT NULL,
    "input_type" TEXT NOT NULL,
    "product_id" TEXT,
    "from_stage_order" INTEGER,
    "quantity_per_unit" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "display_order" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assembly_template_stage_inputs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "formulas" (
    "id" TEXT NOT NULL,
    "formula_code" TEXT NOT NULL,
    "formula_name" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "parent_formula_id" TEXT,
    "base_unit" TEXT NOT NULL,
    "base_quantity" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "expected_yield_percentage" DOUBLE PRECISION NOT NULL DEFAULT 100.0,
    "description" TEXT,
    "notes" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "formulas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "formula_items" (
    "id" TEXT NOT NULL,
    "formula_id" TEXT NOT NULL,
    "ingredient_id" TEXT NOT NULL,
    "ingredient_type" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "percentage" DOUBLE PRECISION,
    "addition_order" INTEGER,
    "min_quantity" DOUBLE PRECISION,
    "max_quantity" DOUBLE PRECISION,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "formula_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "formula_costs" (
    "id" TEXT NOT NULL,
    "formula_id" TEXT NOT NULL,
    "material_cost" DOUBLE PRECISION NOT NULL,
    "labor_cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "overhead_cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total_cost" DOUBLE PRECISION NOT NULL,
    "cost_per_unit" DOUBLE PRECISION NOT NULL,
    "calculated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "formula_costs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assembly_notes" (
    "id" TEXT NOT NULL,
    "note_number" TEXT NOT NULL,
    "production_batch_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "template_id" TEXT,
    "stage_id" TEXT,
    "stage_order" INTEGER NOT NULL,
    "stage_name" TEXT NOT NULL,
    "target_quantity" DOUBLE PRECISION NOT NULL,
    "actual_quantity" DOUBLE PRECISION,
    "unit" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "process_type_id" TEXT,
    "process_parameters" JSONB,
    "actual_parameters" JSONB,
    "batch_code" TEXT,
    "notes" TEXT,
    "observations" TEXT,
    "created_by" TEXT,
    "executed_by" TEXT,
    "completed_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assembly_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assembly_note_items" (
    "id" TEXT NOT NULL,
    "assembly_note_id" TEXT NOT NULL,
    "component_id" TEXT NOT NULL,
    "component_type" TEXT NOT NULL,
    "planned_quantity" DOUBLE PRECISION NOT NULL,
    "actual_quantity" DOUBLE PRECISION,
    "unit" TEXT NOT NULL,
    "lot_number" TEXT,
    "consumed" BOOLEAN NOT NULL DEFAULT false,
    "consumed_at" TIMESTAMP(3),
    "consumed_by" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assembly_note_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assembly_process_variables" (
    "id" TEXT NOT NULL,
    "assembly_note_id" TEXT NOT NULL,
    "variable_name" TEXT NOT NULL,
    "variable_value" TEXT NOT NULL,
    "variable_unit" TEXT,
    "expected_min" DOUBLE PRECISION,
    "expected_max" DOUBLE PRECISION,
    "is_within_range" BOOLEAN NOT NULL DEFAULT true,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "captured_by" TEXT,

    CONSTRAINT "assembly_process_variables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assembly_quality_checks" (
    "id" TEXT NOT NULL,
    "assembly_note_id" TEXT NOT NULL,
    "check_type" TEXT NOT NULL,
    "check_name" TEXT NOT NULL,
    "result_value" TEXT,
    "expected_value" TEXT,
    "passed" BOOLEAN NOT NULL,
    "notes" TEXT,
    "photo_urls" TEXT[],
    "checked_by" TEXT,
    "checked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assembly_quality_checks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_picking_items_orderItemId_idx" ON "order_picking_items"("orderItemId");

-- CreateIndex
CREATE INDEX "order_picking_items_scannedBy_idx" ON "order_picking_items"("scannedBy");

-- CreateIndex
CREATE INDEX "batch_output_targets_batchId_idx" ON "batch_output_targets"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "system_settings_key_key" ON "system_settings"("key");

-- CreateIndex
CREATE UNIQUE INDEX "process_types_code_key" ON "process_types"("code");

-- CreateIndex
CREATE UNIQUE INDEX "assembly_templates_template_code_key" ON "assembly_templates"("template_code");

-- CreateIndex
CREATE INDEX "assembly_templates_product_id_idx" ON "assembly_templates"("product_id");

-- CreateIndex
CREATE INDEX "assembly_templates_is_active_idx" ON "assembly_templates"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "assembly_templates_product_id_version_key" ON "assembly_templates"("product_id", "version");

-- CreateIndex
CREATE INDEX "assembly_template_stages_template_id_idx" ON "assembly_template_stages"("template_id");

-- CreateIndex
CREATE UNIQUE INDEX "assembly_template_stages_template_id_stage_order_key" ON "assembly_template_stages"("template_id", "stage_order");

-- CreateIndex
CREATE INDEX "assembly_template_stage_inputs_stage_id_idx" ON "assembly_template_stage_inputs"("stage_id");

-- CreateIndex
CREATE UNIQUE INDEX "formulas_formula_code_key" ON "formulas"("formula_code");

-- CreateIndex
CREATE INDEX "formulas_product_id_idx" ON "formulas"("product_id");

-- CreateIndex
CREATE INDEX "formulas_is_active_idx" ON "formulas"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "formulas_product_id_version_key" ON "formulas"("product_id", "version");

-- CreateIndex
CREATE INDEX "formula_items_formula_id_idx" ON "formula_items"("formula_id");

-- CreateIndex
CREATE INDEX "formula_items_ingredient_id_idx" ON "formula_items"("ingredient_id");

-- CreateIndex
CREATE UNIQUE INDEX "formula_costs_formula_id_key" ON "formula_costs"("formula_id");

-- CreateIndex
CREATE UNIQUE INDEX "assembly_notes_note_number_key" ON "assembly_notes"("note_number");

-- CreateIndex
CREATE INDEX "assembly_notes_production_batch_id_idx" ON "assembly_notes"("production_batch_id");

-- CreateIndex
CREATE INDEX "assembly_notes_product_id_idx" ON "assembly_notes"("product_id");

-- CreateIndex
CREATE INDEX "assembly_notes_status_idx" ON "assembly_notes"("status");

-- CreateIndex
CREATE INDEX "assembly_note_items_assembly_note_id_idx" ON "assembly_note_items"("assembly_note_id");

-- CreateIndex
CREATE INDEX "assembly_note_items_component_id_idx" ON "assembly_note_items"("component_id");

-- CreateIndex
CREATE INDEX "assembly_process_variables_assembly_note_id_idx" ON "assembly_process_variables"("assembly_note_id");

-- CreateIndex
CREATE INDEX "assembly_quality_checks_assembly_note_id_idx" ON "assembly_quality_checks"("assembly_note_id");

-- CreateIndex
CREATE INDEX "orders_approvedBy_idx" ON "orders"("approvedBy");

-- CreateIndex
CREATE INDEX "production_batches_flavor_idx" ON "production_batches"("flavor");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_pickingStartedBy_fkey" FOREIGN KEY ("pickingStartedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_picking_items" ADD CONSTRAINT "order_picking_items_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_picking_items" ADD CONSTRAINT "order_picking_items_scannedBy_fkey" FOREIGN KEY ("scannedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_batches" ADD CONSTRAINT "production_batches_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "production_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_batches" ADD CONSTRAINT "production_batches_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_output_targets" ADD CONSTRAINT "batch_output_targets_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "production_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_output_targets" ADD CONSTRAINT "batch_output_targets_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assembly_templates" ADD CONSTRAINT "assembly_templates_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assembly_templates" ADD CONSTRAINT "assembly_templates_parent_template_id_fkey" FOREIGN KEY ("parent_template_id") REFERENCES "assembly_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assembly_templates" ADD CONSTRAINT "assembly_templates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assembly_templates" ADD CONSTRAINT "assembly_templates_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assembly_template_stages" ADD CONSTRAINT "assembly_template_stages_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "assembly_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assembly_template_stages" ADD CONSTRAINT "assembly_template_stages_process_type_id_fkey" FOREIGN KEY ("process_type_id") REFERENCES "process_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assembly_template_stages" ADD CONSTRAINT "assembly_template_stages_output_product_id_fkey" FOREIGN KEY ("output_product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assembly_template_stage_inputs" ADD CONSTRAINT "assembly_template_stage_inputs_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "assembly_template_stages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assembly_template_stage_inputs" ADD CONSTRAINT "assembly_template_stage_inputs_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formulas" ADD CONSTRAINT "formulas_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formulas" ADD CONSTRAINT "formulas_parent_formula_id_fkey" FOREIGN KEY ("parent_formula_id") REFERENCES "formulas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formulas" ADD CONSTRAINT "formulas_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formulas" ADD CONSTRAINT "formulas_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formulas" ADD CONSTRAINT "formulas_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formula_items" ADD CONSTRAINT "formula_items_formula_id_fkey" FOREIGN KEY ("formula_id") REFERENCES "formulas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formula_items" ADD CONSTRAINT "formula_items_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formula_costs" ADD CONSTRAINT "formula_costs_formula_id_fkey" FOREIGN KEY ("formula_id") REFERENCES "formulas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assembly_notes" ADD CONSTRAINT "assembly_notes_production_batch_id_fkey" FOREIGN KEY ("production_batch_id") REFERENCES "production_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assembly_notes" ADD CONSTRAINT "assembly_notes_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assembly_notes" ADD CONSTRAINT "assembly_notes_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "assembly_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assembly_notes" ADD CONSTRAINT "assembly_notes_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "assembly_template_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assembly_notes" ADD CONSTRAINT "assembly_notes_process_type_id_fkey" FOREIGN KEY ("process_type_id") REFERENCES "process_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assembly_notes" ADD CONSTRAINT "assembly_notes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assembly_notes" ADD CONSTRAINT "assembly_notes_executed_by_fkey" FOREIGN KEY ("executed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assembly_notes" ADD CONSTRAINT "assembly_notes_completed_by_fkey" FOREIGN KEY ("completed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assembly_note_items" ADD CONSTRAINT "assembly_note_items_assembly_note_id_fkey" FOREIGN KEY ("assembly_note_id") REFERENCES "assembly_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assembly_note_items" ADD CONSTRAINT "assembly_note_items_component_id_fkey" FOREIGN KEY ("component_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assembly_note_items" ADD CONSTRAINT "assembly_note_items_consumed_by_fkey" FOREIGN KEY ("consumed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assembly_process_variables" ADD CONSTRAINT "assembly_process_variables_assembly_note_id_fkey" FOREIGN KEY ("assembly_note_id") REFERENCES "assembly_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assembly_process_variables" ADD CONSTRAINT "assembly_process_variables_captured_by_fkey" FOREIGN KEY ("captured_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assembly_quality_checks" ADD CONSTRAINT "assembly_quality_checks_assembly_note_id_fkey" FOREIGN KEY ("assembly_note_id") REFERENCES "assembly_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assembly_quality_checks" ADD CONSTRAINT "assembly_quality_checks_checked_by_fkey" FOREIGN KEY ("checked_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
