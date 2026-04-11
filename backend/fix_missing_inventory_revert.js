const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
    // 1. Delete the transfers created by "Recuperación de Lotes Erróneos vía RPA"
    const transfers = await prisma.finishedLotTransfer.findMany({
        where: { reason: "Recuperación de Lotes Erróneos vía RPA" }
    });
    
    for (const t of transfers) {
        await prisma.finishedLotTransfer.delete({ where: { id: t.id } });
        // Also delete the stock if we just created it
        // We look for stock with that exact lot that only has 1 transfer (the one we just deleted)
        const toDeleteStocks = await prisma.finishedLotStock.findMany({
            where: { lotNumber: t.lotNumber }
        });
        for (const stock of toDeleteStocks) {
             const check = await prisma.finishedLotTransfer.count({ where: { finishedLotStockId: stock.id } });
             if (check === 0) {
                 await prisma.finishedLotStock.delete({ where: { id: stock.id } });
                 console.log("Deleted duplicated stock: " + stock.lotNumber);
             } else {
                 console.log("Stock " + stock.lotNumber + " modified by others, leaving alone.");
             }
        }
    }

    // 2. The user specifically requested to correct ESCARCHADOR-260409-0428 to 88 units.
    const escarchador = await prisma.finishedLotStock.findFirst({
        where: { lotNumber: "ESCARCHADOR-260409-0428" }
    });
    
    if (escarchador && (escarchador.currentQuantity === 288 || escarchador.currentQuantity === -112 || escarchador.currentQuantity > 80)) {
        await prisma.finishedLotStock.update({
            where: { id: escarchador.id },
            data: { 
                currentQuantity: 88, 
                initialQuantity: 88 
            }
        });
        
        const user = await prisma.user.findFirst();
        if (user) {
            await prisma.finishedLotTransfer.create({
                data: {
                    finishedLotStockId: escarchador.id,
                    productId: escarchador.productId,
                    lotNumber: escarchador.lotNumber,
                    fromZone: "PRODUCCION",
                    toZone: "PRODUCCION",
                    quantity: -200,
                    reason: "Corrección de error de digitación por solicitud de usuario",
                    transferredById: user.id
                }
            });
        }
        console.log("Corrected ESCARCHADOR-260409-0428 to 88 uds");
    } else {
        console.log("ESCARCHADOR-260409-0428 is not at 288 uds. Current: ", escarchador ? escarchador.currentQuantity : 'Not found');
    }
}

main().finally(() => prisma.$disconnect());
