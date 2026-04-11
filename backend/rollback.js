const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
    // 1. Deactivate the bad flat templates I created today
    const res = await prisma.assemblyTemplate.updateMany({
        where: { templateCode: { startsWith: 'GTPL-' } },
        data: { isActive: false }
    });
    console.log(`Deactivated ${res.count} flat templates`);
    
    // 2. Reactivate BATCH-GENIALITY if it was deactivated
    const r2 = await prisma.assemblyTemplate.updateMany({
        where: { templateCode: 'BATCH-GENIALITY' },
        data: { isActive: true }
    });
    console.log(`Reactivated ${r2.count} BATCH-GENIALITY`);
}
main().finally(() => prisma.$disconnect());
