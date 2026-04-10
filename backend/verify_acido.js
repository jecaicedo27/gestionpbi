const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    // Buscar consumos a partir de hoy (2026-04-08)
    const todayStr = '2026-04-08T00:00:00';
    const today = new Date(todayStr);
    
    const lcs = await prisma.lotConsumption.findMany({
        where: { 
            usedAt: { gte: today },
            materialLot: {
                OR: [
                    { product: { name: { contains: 'ACIDO CITRICO', mode: 'insensitive' } } },
                    { siigoProductName: { contains: 'ACIDO CITRICO', mode: 'insensitive' } }
                ]
            }
        },
        include: {
            materialLot: { include: { product: { select: { name: true, unit: true } } } },
            usedBy: { select: { name: true } },
            assemblyNote: { select: { stageName: true, noteNumber: true } }
        },
        orderBy: { usedAt: 'desc' }
    });
    
    console.log(`===============================================`);
    console.log(` Consumos de ACIDO CITRICO registrados HOY `);
    console.log(`===============================================`);
    
    let totalCantidad = 0;
    
    for (const lc of lcs) {
        const name = lc.materialLot?.product?.name || lc.materialLot?.siigoProductName;
        const noteRef = lc.assemblyNote 
            ? `Nota Ensamble: ${lc.assemblyNote.noteNumber} (${lc.assemblyNote.stageName})` 
            : 'Sin trazabilidad aparente';
        const unit = lc.materialLot?.product?.unit || 'g';
        
        totalCantidad += Number(lc.quantityUsed);
        
        console.log(`- Lote Interno ID: [${lc.materialLotId.slice(0,8)}]`);
        console.log(`  Consumo: ${lc.quantityUsed} ${unit}`);
        console.log(`  Hora: ${new Date(lc.usedAt).toLocaleTimeString('es-CO')}`);
        console.log(`  Origen: ${noteRef}`);
        console.log(`  Operador: ${lc.usedBy?.name || 'Sistema RPA'}`);
        console.log(`-----------------------------------------------`);
    }
    
    console.log(`🔥 TOTAL CONSUMIDO HOY: ${totalCantidad.toFixed(2)} gramos`);
    console.log(`===============================================\n`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
