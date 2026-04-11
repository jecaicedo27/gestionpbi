const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
    const today = new Date();
    today.setHours(0,0,0,0);
    const fls = await prisma.finishedLotStock.findMany({
        where: { createdAt: { gte: today } },
        include: { product: true }
    });
    console.log('FinishedLotStocks today:');
    for(const f of fls) {
        console.log(`- ${f.lotNumber} | ${f.product?.name} | init: ${f.initialQuantity}`);
    }
}
main().catch(console.error).finally(()=>prisma.$disconnect());
