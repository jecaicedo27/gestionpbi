const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function track() {
    const LOT = 'MANGO-BICHE-260328-1342';
    
    console.log(`\n=== Rastreando lote: ${LOT} ===\n`);
    
    // 1. Todos los registros FinishedLotStock de este lote
    const stocks = await prisma.finishedLotStock.findMany({
        where: { lotNumber: { contains: LOT } },
        include: { product: { select: { name: true, sku: true } } }
    });
    
    console.log(">> FinishedLotStock:");
    if (stocks.length === 0) console.log("   (ninguno)");
    stocks.forEach(s => {
        console.log(`   SKU: ${s.product?.sku} | Qty inicial: ${s.initialQuantity} | Qty actual: ${s.currentQuantity} | Zona: ${s.zone} | Status: ${s.status}`);
    });
    
    // 2. Transferencias del acta ENT-260408-001
    const handoff = await prisma.productHandoff.findFirst({
        where: { actaNumber: 'ENT-260408-001' },
        include: {
            items: { include: { product: { select: { name: true, sku: true } } } }
        }
    });
    
    console.log("\n>> Acta ENT-260408-001:");
    if (!handoff) {
        console.log("   (acta no encontrada)");
    } else {
        console.log(`   Status: ${handoff.status} | Recibida: ${handoff.receivedAt}`);
        handoff.items.forEach(i => {
            console.log(`   Item: ${i.product?.sku} | ${i.product?.name} | Qty: ${i.quantity} | LotNumber: ${i.lotNumber}`);
        });
    }
    
    // 3. Buscar movimientos de LIQA10
    const product = await prisma.product.findFirst({ where: { sku: 'LIQA10' }, select: { id: true, name: true } });
    console.log(`\n>> Producto LIQA10: ${product?.name}`);
    
    if (product) {
        const allStocks = await prisma.finishedLotStock.findMany({
            where: { productId: product.id },
            orderBy: { createdAt: 'desc' }
        });
        console.log("   Todos los registros de stock LIQA10:");
        allStocks.forEach(s => {
            console.log(`   Lote: ${s.lotNumber} | IniQty: ${s.initialQuantity} | CurQty: ${s.currentQuantity} | Zona: ${s.zone} | Status: ${s.status}`);
        });
        
        // Transferencias
        const transfers = await prisma.finishedLotTransfer.findMany({
            where: { stock: { productId: product.id } },
            include: { stock: true },
            orderBy: { createdAt: 'desc' },
            take: 10
        });
        console.log("\n   Transferencias recientes LIQA10:");
        transfers.forEach(t => {
            console.log(`   Qty: ${t.quantity} | De: ${t.fromZone} -> A: ${t.toZone} | Motivo: ${t.reason} | Fecha: ${t.createdAt}`);
        });
    }
}

track().catch(console.error).finally(() => prisma.$disconnect());
