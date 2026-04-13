const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    // Semana 12-18 abr (weekStart = 2026-04-13 en UTC)
    const w1 = await prisma.shiftWeek.findUnique({
        where: { weekStart: new Date('2026-04-13T05:00:00.000Z') },
        include: { assignments: { include: { employee: true }, orderBy: [{ area: 'asc' }, { shift: 'asc' }] } }
    });

    // Semana 19-25 abr (weekStart = 2026-04-20 en UTC)
    const w2 = await prisma.shiftWeek.findUnique({
        where: { weekStart: new Date('2026-04-20T05:00:00.000Z') },
        include: { assignments: { include: { employee: true }, orderBy: [{ area: 'asc' }, { shift: 'asc' }] } }
    });

    console.log('=== SEMANA 12-18 ABR (BASE) ===');
    if (w1) {
        for (const a of w1.assignments) {
            console.log(`  ${a.employee.area.padEnd(12)} | ${a.shift.padEnd(7)} | ${a.employee.name} ${a.employee.role === 'LIDER' ? '(L)' : ''}`);
        }
    } else {
        console.log('  No encontrada');
    }

    console.log('\n=== SEMANA 19-25 ABR (ROTADA) ===');
    if (w2) {
        for (const a of w2.assignments) {
            console.log(`  ${a.employee.area.padEnd(12)} | ${a.shift.padEnd(7)} | ${a.employee.name} ${a.employee.role === 'LIDER' ? '(L)' : ''}`);
        }
    } else {
        console.log('  No encontrada');
    }
}

main().catch(console.error).finally(() => prisma.$disconnect());
