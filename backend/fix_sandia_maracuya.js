const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
    const lotM = 'MARACUYA-260410-1623';
    const lotS = 'SANDIA-260408-1410';
    const m360 = await prisma.product.findFirst({ where: { name: 'SIROPE GENIALITY SABOR A MARACUYA X 360 ML' } });
    const m1000 = await prisma.product.findFirst({ where: { name: 'SIROPE GENIALITY SABOR A MARACUYA X 1000 ML' } });
    const s360 = await prisma.product.findFirst({ where: { name: 'SIROPE GENIALITY SABOR A SANDIA X 360 ML' } });
    const s1000 = await prisma.product.findFirst({ where: { name: 'SIROPE GENIALITY SABOR A SANDIA X 1000 ML' } });
    
    const products = [
        {p: m360, lot: lotM, q: 175}, {p: m1000, lot: lotM, q: 420},
        {p: s360, lot: lotS, q: 22}, {p: s1000, lot: lotS, q: 296}
    ];

    for(const item of products){
        if(!item.p) continue;
        const exists = await prisma.materialLot.findFirst({where:{productId: item.p.id, lotNumber: item.lot}});
        if(!exists){
            await prisma.materialLot.create({
                data: {
                    productId: item.p.id,
                    lotNumber: item.lot,
                    quantity: item.q,
                    originalQuantity: item.q,
                    initialQuantity: item.q,
                    currentQuantity: item.q,
                    expirationDate: new Date(new Date().setMonth(new Date().getMonth() + 6)),
                    status: 'QUARANTINE',
                    siigoProductCode: item.p.siigoCode || item.p.sku || 'DESCONOCIDO',
                    siigoProductName: item.p.name || 'DESCONOCIDO'
                }
            });
            console.log(`Created MaterialLot for ${item.p.name} - ${item.lot}`);
        } else {
             await prisma.materialLot.update({
                 where: { id: exists.id },
                 data: { quantity: item.q, originalQuantity: item.q, initialQuantity: item.q, currentQuantity: item.q }
             });
             console.log(`Updated MaterialLot for ${item.p.name} - ${item.lot}`);
        }
    }
}
main().catch(console.error).finally(() => prisma.$disconnect());
