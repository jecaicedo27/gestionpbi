require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function diagnose(sku) {
    const product = await p.product.findFirst({ where: { sku }, select: { id: true, sku: true, name: true, currentStock: true } });
    if (!product) { console.log(`NOT FOUND: ${sku}`); return; }

    console.log(`\n${'='.repeat(70)}`);
    console.log(`${sku} --- ${product.name}`);
    console.log(`Siigo: ${(product.currentStock||0).toLocaleString('es-CO')}`);

    const mlots = await p.materialLot.findMany({
        where: { productId: product.id }, orderBy: { receivedAt: 'desc' },
        select: { id:true, lotNumber:true, zone:true, initialQuantity:true, currentQuantity:true, receivedAt:true }
    });
    const mlTotal = mlots.reduce((s,l) => s + (l.currentQuantity||0), 0);

    const flots = await p.finishedLotStock.findMany({
        where: { productId: product.id }, orderBy: { createdAt: 'desc' },
        select: { id:true, lotNumber:true, zone:true, initialQuantity:true, currentQuantity:true, createdAt:true }
    });
    const flTotal = flots.reduce((s,l) => s + (l.currentQuantity||0), 0);
    const totalApp = mlTotal + flTotal;
    const siigo = product.currentStock || 0;

    console.log(`MaterialLots: ${mlots.length} lotes, total=${mlTotal.toLocaleString('es-CO')}`);
    console.log(`FinishedLotStock: ${flots.length} lotes, total=${flTotal.toLocaleString('es-CO')}`);
    console.log(`Total App: ${totalApp.toLocaleString('es-CO')} | Diff: ${(siigo - totalApp).toLocaleString('es-CO')}`);

    const activeMlots = mlots.filter(l => l.currentQuantity > 0);
    const activeFlots = flots.filter(l => l.currentQuantity > 0);

    if (activeMlots.length > 0) {
        console.log(`\nMaterialLots activos (${activeMlots.length}):`);
        for (const l of activeMlots.slice(0,6)) {
            const pct = l.initialQuantity > 0 ? Math.round(l.currentQuantity/l.initialQuantity*100) : '?';
            const date = l.receivedAt ? new Date(l.receivedAt).toLocaleDateString('es-CO') : '?';
            console.log(`  ${l.lotNumber} [${l.zone}] ini=${(l.initialQuantity||0).toLocaleString()} act=${(l.currentQuantity||0).toLocaleString()} (${pct}%) | ${date}`);
        }
    }
    if (activeFlots.length > 0) {
        console.log(`\nFinishedLotStock activos (${activeFlots.length}):`);
        for (const l of activeFlots.slice(0,6)) {
            const pct = l.initialQuantity > 0 ? Math.round(l.currentQuantity/l.initialQuantity*100) : '?';
            console.log(`  ${l.lotNumber} [${l.zone}] ini=${(l.initialQuantity||0).toLocaleString()} act=${(l.currentQuantity||0).toLocaleString()} (${pct}%) | ${new Date(l.createdAt).toLocaleDateString('es-CO')}`);
        }
    }

    const mlLotIds = mlots.map(l => l.id);
    const cons = mlLotIds.length > 0 ? await p.lotConsumption.aggregate({
        _sum: { quantityUsed: true }, _count: true,
        where: { materialLotId: { in: mlLotIds } }
    }) : { _sum: { quantityUsed: 0 }, _count: 0 };

    console.log(`\nLotConsumptions: ${cons._count} registros, totalConsumido=${((cons._sum.quantityUsed)||0).toLocaleString('es-CO')}`);
    if (cons._count > 0) {
        const last = await p.lotConsumption.findFirst({
            where: { materialLotId: { in: mlLotIds } }, orderBy: { usedAt: 'desc' },
            select: { usedAt: true, quantityUsed: true }
        });
        if (last) console.log(`Ultimo consumo: ${new Date(last.usedAt).toLocaleDateString('es-CO')} --- ${last.quantityUsed.toLocaleString()}`);
    } else {
        console.log(`!! SIN consumos - stock nunca se redujo en la app`);
    }

    if (totalApp > siigo) {
        console.log(`\n>> EXCESO en App: ${(totalApp - siigo).toLocaleString('es-CO')} vs Siigo`);
    }
}

async function main() {
    for (const sku of ['PROCELIQUIPOPS26','PROCEGENIALITY01','PROCEGENIALITY11','PROCEGENIALITY06']) {
        await diagnose(sku);
    }
    await p.$disconnect();
}
main().catch(e => { console.error(e.message); p.$disconnect(); });
