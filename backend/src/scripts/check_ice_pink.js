const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    try {
        console.log("Connected to DB");

        const recentBatches = await prisma.productionBatch.findMany({
            where: { status: 'COMPLETED' },
            orderBy: { completedAt: 'desc' },
            take: 3,
            include: { product: true }
        });
        
        console.log("\n=== RECENT COMPLETED BATCHES ===");
        for (const b of recentBatches) {
            console.log(`- Batch: ${b.batchNumber} | Product: ${b.product?.name || b.flavor} | Qty: ${b.expectedOutput} | Date: ${b.completedAt}`);
        }

        const icePinkLots = await prisma.materialLot.findMany({
            where: { siigoProductName: { contains: 'ICE PINK' } },
            orderBy: { receivedAt: 'desc' },
            take: 5
        });

        console.log("\n=== RECENT ICE PINK MATERIAL LOTS ===");
        for (const l of icePinkLots) {
            console.log(`- Lot: ${l.lotNumber} | Product: ${l.siigoProductName} | Qty: ${l.initialQuantity} | Curr: ${l.currentQuantity} | Date: ${l.receivedAt}`);
        }

        const prodStock = await prisma.finishedLotStock.findMany({
            where: { product: { name: { contains: 'ICE PINK' } }, zone: 'PRODUCCION' },
            orderBy: { updatedAt: 'desc' },
            take: 3,
            include: { product: true }
        });

        console.log("\n=== FINISHED LOT STOCK (PRODUCCION) FOR ICE PINK ===");
        for (const s of prodStock) {
            console.log(`- Stock: ${s.lotNumber} | ${s.product?.name} | Qty: ${s.currentQuantity} | Updated: ${s.updatedAt}`);
        }

    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}
run();
