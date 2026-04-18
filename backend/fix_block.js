const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const today = new Date();
    const colombiaMs = today.getTime() + (-5 * 60 * 60 * 1000) - (today.getTimezoneOffset() * 60 * 1000);
    const splitDate = new Date(colombiaMs).toISOString().split('T')[0] + 'T00:00:00.000Z';
    const cleanDate = new Date(splitDate);

    // Approve the existing PENDING handoffs for today's MANANA shift
    const updated = await prisma.shiftHandoff.updateMany({
        where: { date: cleanDate, outgoingShift: 'MANANA', status: 'PENDING' },
        data: { status: 'APPROVED', notes: 'Bypass de emergencia' }
    });
    console.log("Approved existing pending handoffs:", updated.count);

    // Let's drop duplicate handoffs just in case, or rather just see what IDs the operators have 
    const handoffs = await prisma.shiftHandoff.findMany({
        where: { date: cleanDate, outgoingShift: 'MANANA' }
    });
    console.log("Handoff deliveredByIds:", handoffs.map(h => h.deliveredById));

}
main().finally(() => prisma.$disconnect());
