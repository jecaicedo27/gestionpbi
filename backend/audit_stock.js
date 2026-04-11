const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    // 1. Find products
    const base = await prisma.product.findFirst({
        where: { name: { contains: 'BASE SIROPE CLASICA', mode: 'insensitive' } },
        select: { id: true, name: true, currentStock: true }
    });
    const color = await prisma.product.findFirst({
        where: { name: { contains: 'COLOR EN POLVO AMARILLO LIMON', mode: 'insensitive' } },
        select: { id: true, name: true, currentStock: true }
    });

    console.log('=== CURRENT STOCK ===');
    console.log(`BASE: ${base?.name} → ${base?.currentStock}g (${(base?.currentStock/1000).toFixed(1)}kg)`);
    console.log(`COLOR: ${color?.name} → ${color?.currentStock}g`);

    // 2. Check MaterialLot balances
    for (const prod of [base, color]) {
        if (!prod) continue;
        const lots = await prisma.materialLot.findMany({
            where: { productId: prod.id, status: 'AVAILABLE', currentQuantity: { gt: 0 } },
            select: { lotNumber: true, currentQuantity: true, zone: true }
        });
        const total = lots.reduce((s, l) => s + l.currentQuantity, 0);
        console.log(`\n${prod.name} — MaterialLot total: ${total}g (${(total/1000).toFixed(1)}kg)`);
        lots.forEach(l => console.log(`  Lot ${l.lotNumber}: ${l.currentQuantity}g, zone=${l.zone}`));
    }

    // 3. Recent consumption (last 24h) from InventoryTransaction
    const since = new Date();
    since.setHours(since.getHours() - 24);

    for (const prod of [base, color]) {
        if (!prod) continue;
        const txns = await prisma.inventoryTransaction.findMany({
            where: {
                productId: prod.id,
                createdAt: { gte: since }
            },
            orderBy: { createdAt: 'desc' },
            take: 20,
            select: { id: true, type: true, quantity: true, reference: true, createdAt: true, lotNumber: true }
        });
        console.log(`\n=== TRANSACTIONS (24h) for ${prod.name} ===`);
        if (txns.length === 0) console.log('  No transactions');
        let totalConsumed = 0;
        let totalProduced = 0;
        for (const tx of txns) {
            const dir = tx.type === 'PRODUCTION_CONSUMPTION' || tx.type === 'ASSEMBLY_CONSUMPTION' ? 'OUT' : 'IN';
            if (dir === 'OUT') totalConsumed += Math.abs(tx.quantity);
            else totalProduced += tx.quantity;
            console.log(`  ${tx.createdAt.toISOString().slice(0,19)} | ${tx.type} | ${dir} ${Math.abs(tx.quantity)}g | ref: ${(tx.reference || '').slice(0, 60)} | lot: ${tx.lotNumber || '-'}`);
        }
        console.log(`  TOTAL consumed: ${totalConsumed}g (${(totalConsumed/1000).toFixed(1)}kg), produced: ${totalProduced}g`);
    }

    // 4. Check note that's blocked (602573c6...)
    const blockedNote = await prisma.assemblyNote.findUnique({
        where: { id: '602573c6-ddb1-450e-9917-ff8c932c43aa' },
        include: {
            items: { include: { component: { select: { name: true } } } },
            productionBatch: { select: { batchNumber: true } },
            processType: { select: { code: true } }
        }
    });
    if (blockedNote) {
        console.log(`\n=== BLOCKED NOTE ===`);
        console.log(`Batch: ${blockedNote.productionBatch?.batchNumber}, Stage: ${blockedNote.processType?.code}`);
        console.log(`Items requiring stock:`);
        for (const item of blockedNote.items) {
            console.log(`  ${item.component?.name}: needs ${item.plannedQuantity}g (${item.unit})`);
        }
    }
}
main().finally(() => prisma.$disconnect());
