const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function getMonday(dStr) {
    let d = new Date(dStr);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d;
}

async function main() {
    const now = new Date();
    const colombiaMs = now.getTime() + (-5 * 60 * 60 * 1000) - (now.getTimezoneOffset() * 60 * 1000);
    const splitDate = new Date(colombiaMs).toISOString().split('T')[0] + 'T00:00:00.000Z';
    const today = new Date(splitDate);
    const monday = getMonday(today.toISOString());

    const week = await prisma.shiftWeek.findUnique({
        where: { weekStart: monday },
        include: { assignments: { include: { employee: true } } }
    });

    if (!week) return console.log('No week found for monday:', monday);

    const productionAreas = ['PRODUCCION', 'SIROPES', 'EMPAQUE'];
    const operators = week.assignments
        .filter(a => a.shift === 'MANANA' && productionAreas.includes(a.employee?.area));

    let created = 0;
    for (const op of operators) {
        if (!op.employee.userId) continue;
        const existing = await prisma.shiftHandoff.findFirst({
            where: { weekId: week.id, date: today, outgoingShift: 'MANANA', deliveredById: op.employee.userId }
        });

        if (!existing) {
            await prisma.shiftHandoff.create({
                data: {
                    weekId: week.id,
                    date: today,
                    area: op.employee.area,
                    outgoingShift: 'MANANA',
                    deliveredById: op.employee.userId,
                    deliveredAt: new Date(),
                    status: 'APPROVED',
                    checklist: [{ label: 'Generado automáticamente por sistema', value: true, type: 'boolean' }],
                    notes: 'Bypass manual: el turno saliente se retiró sin entregar formalmente. Se aprueba para no bloquear la producción.'
                }
            });
            created++;
            console.log('Created bypass for', op.employee.name);
        }
    }
    console.log('Total bypassed:', created);
}

main().catch(console.error).finally(() => prisma.$disconnect());
