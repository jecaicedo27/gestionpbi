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
    const today = new Date();
    const colombiaMs = today.getTime() + (-5 * 60 * 60 * 1000) - (now.getTimezoneOffset() * 60 * 1000);
    const splitDate = new Date(colombiaMs).toISOString().split('T')[0] + 'T00:00:00.000Z';
    const cleanDate = new Date(splitDate);
    const monday = getMonday(cleanDate.toISOString());

    const week = await prisma.shiftWeek.findUnique({
        where: { weekStart: monday },
        include: { assignments: { include: { employee: { include: { user: true }  } } } }
    });

    const productionAreas = ['PRODUCCION', 'SIROPES', 'EMPAQUE'];
    const outgoingOperators = week.assignments
            .filter(a => a.shift === 'MANANA' && productionAreas.includes(a.employee?.area) && a.employee?.user?.id != null)
            .map(a => ({
                userId: a.employee?.user?.id || null,
                userIdDirect: a.employee?.userId,
                name: a.employee?.name || 'Sin nombre',
                area: a.employee?.area,
            }));
            
    const handoffs = await prisma.shiftHandoff.findMany({
        where: { weekId: week.id, date: cleanDate, outgoingShift: 'MANANA' },
        orderBy: { deliveredAt: 'desc' } // we should get the latest!
    });

    console.log("Outgoing Operators:", outgoingOperators);
    console.log("Handoffs matching week date shift:", handoffs.map(h => ({id: h.id, deliveredById: h.deliveredById, status: h.status, at: h.deliveredAt})));

}
main().finally(() => prisma.$disconnect());
