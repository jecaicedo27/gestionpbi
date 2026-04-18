const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const today = new Date();
    const colombiaMs = today.getTime() + (-5 * 60 * 60 * 1000) - (today.getTimezoneOffset() * 60 * 1000);
    const splitDate = new Date(colombiaMs).toISOString().split('T')[0] + 'T00:00:00.000Z';
    const cleanDate = new Date(splitDate);

    function getMonday(dStr) {
        let d = new Date(dStr);
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        d.setDate(diff);
        d.setHours(0, 0, 0, 0);
        return d;
    }
    const monday = getMonday(cleanDate.toISOString());

    const week = await prisma.shiftWeek.findUnique({
        where: { weekStart: monday },
        include: { assignments: { include: { employee: { include: { user: true } } } } }
    });

    const ops = week.assignments
            .filter(a => a.shift === 'MANANA')
            .map(a => ({
                name: a.employee?.name,
                empId: a.employee?.id,
                mappedUserId: a.employee?.userId,
                relUserId: a.employee?.user?.id
            }));
    console.log("Ops:", ops);
}

main().finally(() => prisma.$disconnect());
