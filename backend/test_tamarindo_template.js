const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
    const batch = await prisma.productionBatch.findUnique({
        where: { batchNumber: 'TAMARINDO-260410-0645' },
        include: { assemblyNotes: { select: { template: { select: { templateCode: true } } } } }
    });
    console.log("Template Codes used by batch notes:");
    batch.assemblyNotes.forEach(n => console.log(n.template?.templateCode));
}
main().finally(() => prisma.$disconnect());
