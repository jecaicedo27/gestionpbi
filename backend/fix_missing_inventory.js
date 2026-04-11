const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
    const products = await prisma.product.findMany({
        where: { name: { contains: "SIROPE GENIALITY" } }
    });
    
    // Some user to act as transferredBy
    const user = await prisma.user.findFirst();

    const missing = [
        { lot: "SIROPE-GENIALITY-TAMARINDO-360-260410-1947", qty: 113, prod: "SIROPE GENIALITY SABOR A TAMARINDO X 360 ML" },
        { lot: "SIROPE-GENIALITY-ESCARCHADOR-360-260410-1835", qty: 88, prod: "SIROPE GENIALITY ESCARCHADOR X 360 ML" },
        { lot: "SIROPE-GENIALITY-ESCARCHADOR-360-260410-1812", qty: 200, prod: "SIROPE GENIALITY ESCARCHADOR X 360 ML" },
        { lot: "SIROPE-GENIALITY-TAMARINDO-1000-260410-1754", qty: 23, prod: "SIROPE GENIALITY SABOR A TAMARINDO X 1000 ML" },
        { lot: "SIROPE-GENIALITY-TAMARINDO-1000-260410-1753", qty: 135, prod: "SIROPE GENIALITY SABOR A TAMARINDO X 1000 ML" },
        { lot: "SIROPE-GENIALITY-ESCARCHADOR-1000-260410-1733", qty: 24, prod: "SIROPE GENIALITY ESCARCHADOR X 1000 ML" },
        { lot: "SIROPE-GENIALITY-ESCARCHADOR-1000-260410-1604", qty: 109, prod: "SIROPE GENIALITY ESCARCHADOR X 1000 ML" },
        { lot: "SIROPE-GENIALITY-ESCARCHADOR-1000-260410-1549", qty: 88, prod: "SIROPE GENIALITY ESCARCHADOR X 1000 ML" },
        { lot: "SIROPE-GENIALITY-MANGO-BICHE-1000-260407-1459", qty: 60, prod: "SIROPE GENIALITY SABOR A MANGO BICHE X 1000 ML" }
    ];

    for (const item of missing) {
        const prod = products.find(p => p.name === item.prod);
        if (!prod) continue;
        
        let stock = await prisma.finishedLotStock.findFirst({
            where: { lotNumber: item.lot, zone: "PRODUCCION", productId: prod.id }
        });
        
        if (!stock) {
            stock = await prisma.finishedLotStock.create({
                data: {
                    productId: prod.id,
                    lotNumber: item.lot,
                    zone: "PRODUCCION",
                    initialQuantity: item.qty,
                    currentQuantity: item.qty,
                    status: "AVAILABLE",
                }
            });
            console.log(`Created ${item.lot}`);
        } else {
            console.log(`Updated ${item.lot}`);
            stock = await prisma.finishedLotStock.update({
                where: { id: stock.id },
                data: { currentQuantity: item.qty }
            });
        }
        
        // Insert transfer log
        if (user) {
            await prisma.finishedLotTransfer.create({
                data: {
                    finishedLotStockId: stock.id,
                    productId: prod.id,
                    lotNumber: item.lot,
                    fromZone: "PRODUCCION",
                    toZone: "PRODUCCION",
                    quantity: item.qty,
                    reason: "Recuperación de Lotes Erróneos vía RPA",
                    transferredById: user.id
                }
            });
        }
    }
}
main().finally(() => prisma.$disconnect());
