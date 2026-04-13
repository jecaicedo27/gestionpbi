const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    // Get week 19-25 abril
    const w2 = await prisma.shiftWeek.findUnique({
        where: { weekStart: new Date('2026-04-20T05:00:00.000Z') },
        include: { assignments: { include: { employee: true } } }
    });

    if (!w2) { console.log('Semana 19-25 no encontrada'); return; }

    const employees = await prisma.shiftEmployee.findMany();
    const findEmp = (search) => employees.find(e => e.name.toLowerCase().includes(search.toLowerCase()));

    // Basándose en la semana 12-18, la rotación correcta M→T, T→N, N→M debería ser:
    //
    // PRODUCCIÓN:
    //   12-18 MANANA: Dubier, Gabriel(L), Francisco  → 19-25 TARDE
    //   12-18 TARDE:  Jhoan, Yonathan(L), Luis Fernando, Claudia  → 19-25 NOCHE
    //   12-18 NOCHE:  Kelvin, Drilly, Jesús Canchila(L)  → 19-25 MANANA
    //
    // SIROPES:
    //   12-18 MANANA: Alberto  → 19-25 TARDE
    //   12-18 TARDE:  Juan Carlos  → 19-25 NOCHE
    //   12-18 NOCHE:  Andrés Melgizo  → 19-25 MANANA
    //
    // EMPAQUE:
    //   12-18 MANANA: David  → 19-25 TARDE  ✓ (ya correcto)
    //   12-18 TARDE:  Karen  → 19-25 NOCHE  ✓ (ya correcto)
    //   12-18 NOCHE:  Ximena → 19-25 MANANA ✓ (ya correcto)
    //
    // LOGISTICA y ASEO: DIURNO fijo (no rotan) ✓

    const correctAssignments = [
        // Producción - MANANA (eran NOCHE en sem anterior)
        { search: 'Kelvin', shift: 'MANANA' },
        { search: 'Drilly', shift: 'MANANA' },
        { search: 'Canchila', shift: 'MANANA' },
        // Producción - TARDE (eran MANANA en sem anterior)
        { search: 'Dubier', shift: 'TARDE' },
        { search: 'Gabriel', shift: 'TARDE' },
        { search: 'Francisco', shift: 'TARDE' },
        // Producción - NOCHE (eran TARDE en sem anterior)
        { search: 'Jhoan', shift: 'NOCHE' },
        { search: 'Yonathan', shift: 'NOCHE' },
        { search: 'Luis Fernando', shift: 'NOCHE' },
        { search: 'Claudia', shift: 'NOCHE' },
        // Siropes - 1 por turno
        { search: 'Melgizo', shift: 'MANANA' },    // era NOCHE → MANANA
        { search: 'Alberto', shift: 'TARDE' },      // era MANANA → TARDE
        { search: 'Carlos Mu', shift: 'NOCHE' },    // era TARDE → NOCHE
        // Empaque (ya estaban bien, pero los re-seteo para consistencia)
        { search: 'Ximena', shift: 'MANANA' },
        { search: 'David', shift: 'TARDE' },
        { search: 'Karen', shift: 'NOCHE' },
        // Fijos
        { search: 'Hugo', shift: 'DIURNO' },
        { search: 'Ledy', shift: 'DIURNO' }
    ];

    // Clear and recreate
    await prisma.shiftAssignment.deleteMany({ where: { weekId: w2.id } });

    for (const a of correctAssignments) {
        const emp = findEmp(a.search);
        if (emp) {
            await prisma.shiftAssignment.create({
                data: { weekId: w2.id, employeeId: emp.id, area: emp.area, shift: a.shift }
            });
            console.log(`✅ ${emp.name.padEnd(25)} → ${a.shift}`);
        } else {
            console.log(`❌ No encontrado: ${a.search}`);
        }
    }

    // Verify
    console.log('\n=== VERIFICACIÓN ===');
    const result = await prisma.shiftAssignment.findMany({
        where: { weekId: w2.id },
        include: { employee: true },
        orderBy: [{ area: 'asc' }, { shift: 'asc' }]
    });
    for (const a of result) {
        console.log(`  ${a.employee.area.padEnd(12)} | ${a.shift.padEnd(7)} | ${a.employee.name}`);
    }
}

main().catch(console.error).finally(() => prisma.$disconnect());
