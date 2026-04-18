const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
    const handoffs = await prisma.shiftHandoff.findMany({
        where: { outgoingShift: 'MANANA' }
    });
    console.log(handoffs);
}
main().finally(() => prisma.$disconnect());
