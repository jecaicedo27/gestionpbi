-- CreateTable
CREATE TABLE "employee_payroll_profiles" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "salary_monthly" DECIMAL(14,2) NOT NULL,
    "start_date" DATE NOT NULL,
    "transport_allowance" BOOLEAN NOT NULL DEFAULT true,
    "monthly_bonus" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "contract_type" TEXT NOT NULL DEFAULT 'INDEFINIDO',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_payroll_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "employee_payroll_profiles_employee_id_key" ON "employee_payroll_profiles"("employee_id");

-- CreateIndex
CREATE INDEX "employee_payroll_profiles_active_idx" ON "employee_payroll_profiles"("active");

-- AddForeignKey
ALTER TABLE "employee_payroll_profiles" ADD CONSTRAINT "employee_payroll_profiles_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "shift_employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
