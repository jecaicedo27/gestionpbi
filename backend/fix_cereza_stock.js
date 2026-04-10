const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const LOT = 'CEREZA-260407-0953';
const ADMIN_ID = '83aba310-80ef-483b-b116-008ed37e968f';

async function fix() {
    // El stock está en 270 por doble ingest — corregir a 135
    const geni02 = await prisma.product.findFirst({ where: { sku: 'GENI02' }, select: { id: true } });
    
    const stock = await prisma.finishedLotStock.findUnique({
        where: {
            productId_lotNumber_zone: {
                productId: geni02.id,
                lotNumber: LOT,
                zone: 'PRODUCCION'
            }
        }
    });
    
    console.log(`Stock actual: ${stock?.currentQuantity} uds`);
    
    if (stock && stock.currentQuantity === 270) {
        // Corregir a 135 (cantidad real del EMPAQUE)
        await prisma.finishedLotStock.update({
            where: { id: stock.id },
            data: { initialQuantity: 135, currentQuantity: 135, status: 'AVAILABLE' }
        });
        
        // Crear audit log correcto
        await prisma.finishedLotTransfer.create({
            data: {
                finishedLotStockId: stock.id,
                productId: geni02.id,
                lotNumber: LOT,
                fromZone: 'PRODUCCION',
                toZone: 'PRODUCCION',
                quantity: 135,
                reason: 'Recuperacion manual — EMPAQUE CEREZA 1000ml completado sin ingest por carriots',
                transferredById: ADMIN_ID
            }
        });
        
        console.log('✅ Corregido a 135 uds — GENI02 listo en zona PRODUCCION');
    } else if (stock && stock.currentQuantity === 135) {
        // Ya está correcto, solo agregar el audit log si falta
        console.log('✅ Ya correcto: 135 uds en PRODUCCION');
    } else {
        console.log(`⚠️ Cantidad inesperada: ${stock?.currentQuantity} — revisar manualmente`);
    }

    // Verificar resultado
    const final = await prisma.finishedLotStock.findMany({
        where: { lotNumber: LOT },
        include: { product: { select: { sku: true, name: true } } }
    });
    console.log('\n=== Estado final FinishedLotStock ===');
    final.forEach(s => {
        console.log(`  ${s.product?.sku} | [${s.zone}] | ${s.currentQuantity} uds | ${s.status}`);
    });
}

fix().catch(console.error).finally(() => prisma.$disconnect());
