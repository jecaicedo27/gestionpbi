const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function run() {
    const rpa = await prisma.rpaExecution.findFirst({
        orderBy: { startedAt: 'desc' }
    });
    console.log(rpa.errorMessage);
    console.log('-------');
    console.log(rpa.logs);
}
run().catch(console.error).finally(()=> prisma.$disconnect());
