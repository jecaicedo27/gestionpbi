const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({ log: ['query'] });

async function main() {
    const targets = await prisma.batchOutputTarget.findMany({
        where: { batchId: '251f0c2a-ab31-42d7-83ef-0d29909578b0' }
    });
    console.log(targets);
}
main().catch(console.error).finally(() => prisma.$disconnect());
