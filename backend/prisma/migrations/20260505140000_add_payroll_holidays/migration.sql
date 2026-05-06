-- CreateTable
CREATE TABLE "payroll_holidays" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_holidays_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payroll_holidays_date_key" ON "payroll_holidays"("date");

-- CreateIndex
CREATE INDEX "payroll_holidays_year_idx" ON "payroll_holidays"("year");
