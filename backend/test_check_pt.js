const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
    const pt = await prisma.processType.findFirst({ where: { code: 'EMPAQUE' } });
    console.log(pt);
}
main().finally(() => prisma.$disconnect());
