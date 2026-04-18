const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    console.log("MOCK_TIME =", process.env.MOCK_TIME);
    
    const now = process.env.MOCK_TIME ? new Date(process.env.MOCK_TIME) : new Date();
    const colombiaMs = now.getTime() + (-5 * 60 * 60 * 1000) - (now.getTimezoneOffset() * 60 * 1000);
    const today = new Date(new Date(colombiaMs).getFullYear(), new Date(colombiaMs).getMonth(), new Date(colombiaMs).getDate());
    
    console.log("Today =", today);
    
    const day = today.getDay();
    const diff = today.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(today);
    monday.setDate(diff);
    monday.setHours(0, 0, 0, 0);

    console.log("Monday =", monday);

    const week = await prisma.shiftWeek.findUnique({
        where: { weekStart: monday },
        include: { assignments: { include: { employee: { include: { user: true } } } } }
    });

    if (!week) {
        console.log("No week found for this monday.");
        return;
    }

    console.log(`Assignments for MANANA shift:`);
    const manana = week.assignments.filter(a => a.shift === 'MANANA');
    for (const a of manana) {
        console.log(` - ${a.employee?.name} (user_id: ${a.employee?.user?.id}) -> Area: ${a.employee?.area}`);
    }
}
main().finally(() => prisma.$disconnect());
