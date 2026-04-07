require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function consumeDiff(sku, qty) {
    const product = await prisma.product.findFirst({ where: { sku }, select: { id: true, name: true } });
    if (!product) { console.error('❌ Product not found:', sku); return; }

    // Get lots with currentQuantity > 0, FIFO order (oldest first)
    const lots = await prisma.finishedLotStock.findMany({
        where: { productId: product.id, currentQuantity: { gt: 0 } },
        orderBy: { createdAt: 'asc' }
    });

    console.log(`\n📦 ${sku} — ${product.name}`);
    console.log(`   Lots with stock: ${lots.length}, Total to consume: ${qty}`);

    let remaining = qty;
    for (const lot of lots) {
        if (remaining <= 0) break;
        const toDeduct = Math.min(lot.currentQuantity, remaining);
        const newQty = lot.currentQuantity - toDeduct;
        await prisma.finishedLotStock.update({
            where: { id: lot.id },
            data: { currentQuantity: newQty }
        });
        console.log(`   ✅ Lot ${lot.lotNumber} (zone: ${lot.zone}): ${lot.currentQuantity} → ${newQty} (deducted ${toDeduct})`);
        remaining -= toDeduct;
    }

    if (remaining > 0) {
        console.warn(`   ⚠️  Could not consume all units — ${remaining} remaining (insufficient stock in lots)`);
    } else {
        console.log(`   ✅ All ${qty} units consumed successfully`);
    }
}

async function main() {
    await consumeDiff('LIQA02', 41);
    await consumeDiff('LIQO02', 101);
}

main().then(() => prisma.$disconnect()).catch(e => { console.error(e); prisma.$disconnect(); });
