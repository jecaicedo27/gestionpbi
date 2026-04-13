const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const today = new Date();
    // UTC-5 adjustment
    const colombiaMs = today.getTime() + (-5 * 60 * 60 * 1000) - (today.getTimezoneOffset() * 60 * 1000);
    const splitDate = new Date(colombiaMs).toISOString().split('T')[0] + 'T00:00:00.000Z';
    const cleanDate = new Date(splitDate);

    const week = await prisma.shiftWeek.findFirst({
        orderBy: { weekStart: 'desc' },
        include: { assignments: { include: { employee: true } } }
    });

    if (!week) return console.log('No week found');

    const productionAreas = ['PRODUCCION', 'SIROPES', 'EMPAQUE'];
    const operators = week.assignments
        .filter(a => a.shift === 'MANANA' && productionAreas.includes(a.employee?.area));

    for (const op of operators) {
        const existing = await prisma.shiftHandoff.findFirst({
            where: { weekId: week.id, date: cleanDate, outgoingShift: 'MANANA', deliveredById: op.employee.userId }
        });

        if (!existing && op.employee.userId) {
            await prisma.shiftHandoff.create({
                data: {
                    weekId: week.id,
                    date: cleanDate,
                    outgoingShift: 'MANANA',
                    deliveredById: op.employee.userId,
                    status: 'APPROVED',
                    checklist: [{ label: 'Generado automáticamente por sistema', value: true, type: 'boolean' }]
                }
            });
            console.log('Created bypass for', op.employee.userId);
        }
    }
}

main().catch(console.error).finally(() => prisma.$disconnect());
