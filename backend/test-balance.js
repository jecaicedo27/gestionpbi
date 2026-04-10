const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    const zone = 'PRODUCTION';
    const limit = 1000;

    const consumptions = await prisma.lotConsumption.findMany({
        where: { materialLot: { siigoProductName: { contains: 'TAPA LIQUIPOPS 350' } } },
        include: { materialLot: { include: { product: true } }, usedBy: true, processInfo: { include: { productionBatch: true } } },
        orderBy: { usedAt: 'desc' },
        take: limit
    });
    
    const consumptionRows = consumptions.map(c => ({
        id: `con-${c.id}`,
        type: 'CONSUMPTION',
        date: c.usedAt,
        quantity: -c.quantityUsed,
        zone: c.materialLot?.zone || null,
        materialLot: c.materialLot
    }));

    const zoneTransfers = await prisma.zoneTransfer.findMany({
        include: { product: true },
        orderBy: { createdAt: 'desc' },
        take: limit
    });
    const transferRows = [];
    zoneTransfers.forEach(zt => {
        if (!zt.product?.name?.includes('TAPA LIQUIPOPS 350')) return;
        const fromZone = zt.direction === 'IN' ? 'WAREHOUSE' : 'PRODUCTION';
        const toZone = zt.direction === 'IN' ? 'PRODUCTION' : 'WAREHOUSE';
        const fakeLot = { siigoProductName: zt.product.name };
        transferRows.push({ id: `zt-out-${zt.id}`, type: 'TRANSFER_OUT', date: zt.createdAt, quantity: -zt.quantity, zone: fromZone, materialLot: fakeLot });
        transferRows.push({ id: `zt-in-${zt.id}`, type: 'TRANSFER_IN', date: zt.createdAt, quantity: zt.quantity, zone: toZone, materialLot: fakeLot });
    });

    let all = [...consumptionRows, ...transferRows].sort((a, b) => new Date(b.date) - new Date(a.date));
    all = all.filter(r => r.zone === zone).slice(0, limit);

    console.log("Found rows:", all.length);

    const lotSeen = {};
    const prodBalance = {};
    all.forEach(c => {
        const prodKey = c.materialLot?.siigoProductName || c.id;
        const lotKey = c.materialLot?.lotNumber || c.id;
        const k = `${prodKey}::${lotKey}`;
        if (!lotSeen[k]) {
            lotSeen[k] = true;
            prodBalance[prodKey] = (prodBalance[prodKey] || 0) + (c.materialLot?.currentQuantity ?? 0);
        }
    });

    console.log("STARTING BAL:", prodBalance);

    all.forEach(c => {
        const prodKey = c.materialLot?.siigoProductName || c.id;
        const isPositive = c.type === 'INGRESS' || c.type === 'PRODUCTION' || c.type === 'TRANSFER_IN';
        const qty = Math.abs(c.quantity || c.quantityUsed || 0);
        const balanceAfter = prodBalance[prodKey] ?? null;
        if (typeof balanceAfter === 'number') {
            prodBalance[prodKey] = isPositive ? balanceAfter - qty : balanceAfter + qty;
        }
        console.log(`TYPE: ${c.type}, QTY: ${qty}, isPos: ${isPositive}, balanceAfter(Restante): ${balanceAfter}`);
    });
}
run();
