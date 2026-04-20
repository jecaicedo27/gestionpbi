const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
    const today = new Date();
    const colombiaMs = today.getTime() + (-5 * 60 * 60 * 1000) - (today.getTimezoneOffset() * 60 * 1000);
    const splitDate = new Date(colombiaMs).toISOString().split('T')[0] + 'T00:00:00.000Z';
    const cleanDate = new Date(splitDate);
    
    console.log("Checking date:", cleanDate);
    const handoffs = await prisma.shiftHandoff.findMany({
        where: { outgoingShift: 'MANANA' }
    });
    console.log("Handoffs:", handoffs.map(h => ({ d: h.date, id: h.deliveredById, status: h.status })));
}
main().finally(() => prisma.$disconnect());
