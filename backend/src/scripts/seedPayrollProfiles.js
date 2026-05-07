/**
 * Carga perfiles de nómina para los empleados del PDF que tengan match en shift_employees.
 * Idempotente: si ya existe, actualiza salario / fecha / aux. transporte.
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Lista oficial 2026-05-06 (POPPING BOBA INTERNATIONAL S.A.S.)
// Formato: [cédula, salario, fechaIngreso ISO]
const PDF = [
    ['45563900',   1750905, '2026-04-27'],
    ['65793540',   1750905, '2026-04-23'],
    ['5701860',    1750905, '2026-04-13'],
    ['19604162',   1750905, '2026-04-13'],
    ['1013457188', 1750905, '2026-01-29'],
    ['1068813101', 1750905, '2026-01-19'],
    ['1037468811', 1750905, '2026-01-19'],
    ['1017128565', 1750905, '2026-01-19'],
    ['1020441400', 1750905, '2026-01-19'],
    ['1048015967', 1750905, '2026-01-05'],
    ['1152693016', 1750905, '2025-11-24'],
    ['1018346677', 1750905, '2025-11-13'],
    ['1041532723', 1750905, '2025-10-22'],
    ['1017192814', 1750905, '2025-09-01'],
    ['1001014396', 1947728, '2025-08-28'],
    ['1000634765', 1750905, '2025-07-10'],
    ['1111206028', 1750905, '2025-07-10'],
    ['1100083996', 1873423, '2025-06-12'],
    ['1214715645', 1947728, '2025-06-03'],
    ['59856269',   2756405, '2025-02-01'],
    ['87060428',   2333728, '2025-02-01'],
    ['1102805277', 1750905, '2025-02-01'],
    ['1082746343', 1873423, '2025-02-01'],
    ['33354829',   2430228, '2025-02-01'],
    ['1233163',    2651213, '2025-02-01'],
    ['66931179',   1750905, '2025-02-01'],
];

// 2 SMMLV vigente 2026 (≈ $2.847.000) — bajo este umbral se paga aux. transporte.
const TRANSPORT_THRESHOLD = 2_847_000;

(async () => {
    const employees = await prisma.shiftEmployee.findMany({
        where: { active: true, cedula: { not: null } },
        select: { id: true, name: true, cedula: true },
    });
    const byCed = new Map(employees.map((e) => [String(e.cedula).trim(), e]));

    const results = { created: [], updated: [], skipped: [] };

    for (const [ced, salary, startISO] of PDF) {
        const emp = byCed.get(String(ced).trim());
        if (!emp) {
            results.skipped.push({ ced, reason: 'sin shift_employee' });
            continue;
        }
        const data = {
            employeeId: emp.id,
            salaryMonthly: salary,
            startDate: new Date(`${startISO}T12:00:00`),
            transportAllowance: salary <= TRANSPORT_THRESHOLD,
            monthlyBonus: 0,
            contractType: 'INDEFINIDO',
            active: true,
        };
        const existing = await prisma.employeePayrollProfile.findUnique({ where: { employeeId: emp.id } });
        const profile = await prisma.employeePayrollProfile.upsert({
            where: { employeeId: emp.id },
            create: data,
            update: data,
        });
        (existing ? results.updated : results.created).push({
            name: emp.name,
            ced,
            salary: Number(profile.salaryMonthly),
            aux: profile.transportAllowance ? 'sí' : 'no',
            ingreso: profile.startDate.toISOString().substring(0, 10),
        });
    }

    console.log(`✅ Creados: ${results.created.length}`);
    console.log(`✅ Actualizados: ${results.updated.length}`);
    console.log(`⏭  Omitidos: ${results.skipped.length}`);
    if (results.skipped.length) console.table(results.skipped);
    console.log('\nDetalle perfiles cargados:');
    console.table([...results.created, ...results.updated]);
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
