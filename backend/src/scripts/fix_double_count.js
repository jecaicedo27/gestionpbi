/**
 * fix_double_count.js
 * Zerear FinishedLotStock en zona PRODUCCION para todos los productos PRODUCTO_EN_PROCESO
 * que ya tienen un MaterialLot activo (doble conteo en reconciliación).
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
    // 1. Find all PRODUCTO_EN_PROCESO products that have FLS in PRODUCCION zone
    const intermediates = await p.product.findMany({
        where: { classification: 'PRODUCTO_EN_PROCESO', active: true },
        select: { id: true, sku: true, name: true }
    });
    console.log(`\nProductos PRODUCTO_EN_PROCESO: ${intermediates.length}`);

    let totalFixed = 0;
    for (const prod of intermediates) {
        // Check if there's an active FinishedLotStock in PRODUCCION
        const fls = await p.finishedLotStock.findMany({
            where: { productId: prod.id, zone: 'PRODUCCION', currentQuantity: { gt: 0 } },
            select: { id: true, lotNumber: true, currentQuantity: true }
        });
        if (fls.length === 0) continue;

        // Check if there's also a MaterialLot (which is the real source of truth)
        const ml = await p.materialLot.findFirst({
            where: { productId: prod.id, currentQuantity: { gt: 0 } }
        });

        const totalFLS = fls.reduce((s, f) => s + f.currentQuantity, 0);
        console.log(`\n${prod.sku} — ${prod.name}`);
        console.log(`  FinishedLotStock PRODUCCION: ${fls.length} lotes, total=${totalFLS.toLocaleString()}`);
        if (ml) {
            console.log(`  MaterialLot activo existe: ${ml.lotNumber} (${ml.currentQuantity.toLocaleString()})`);
        } else {
            console.log(`  MaterialLot activo: NINGUNO — saltando`);
            continue;
        }

        // Zero out the FinishedLotStock records
        const result = await p.finishedLotStock.updateMany({
            where: { productId: prod.id, zone: 'PRODUCCION', currentQuantity: { gt: 0 } },
            data: { currentQuantity: 0, status: 'DEPLETED' }
        });
        console.log(`  ✅ Zereados ${result.count} FinishedLotStock PRODUCCION (${totalFLS.toLocaleString()} unidades)`);
        totalFixed += result.count;
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`TOTAL registros corregidos: ${totalFixed}`);
    await p.$disconnect();
}

main().catch(e => { console.error(e.message); p.$disconnect(); });
