const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
    const weeks = await prisma.shiftWeek.findMany({
        orderBy: { weekStart: 'desc' },
        take: 3
    });
    console.log(weeks);
}
main().finally(() => prisma.$disconnect());
