const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    // Delete all FAILED RPAs with 'RE-TRIGGER' in obs to prevent double-ingestion
    const deleted = await prisma.rpaExecution.deleteMany({
        where: {
            status: 'FAILED',
            observations: { contains: '(RE-TRIGGER)' }
        }
    });
    console.log(`Borrados ${deleted.count} rpa executions espurios que acabarían duplicando el inventario.`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
