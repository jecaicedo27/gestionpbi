const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
    const lots = await prisma.productionLot.findMany({ where: { lotNumber: 'TAMARINDO-260410-0645' } });
    console.log('ProductionLots:', lots);
}
main().finally(() => prisma.$disconnect());
