-- AlterTable: agregar flag isCleaningOnly al modelo User
ALTER TABLE "users" ADD COLUMN "isCleaningOnly" BOOLEAN NOT NULL DEFAULT false;
