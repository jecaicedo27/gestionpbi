const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    const activeOrders = await prisma.order.findMany({
        where: { status: { in: ['APPROVED', 'IN_PICKING', 'READY'] } },
        include: {
            distributor: { select: { id: true, name: true } },
            items: {
                include: {
                    pickingItems: true
                }
            }
        }
    });
    console.log(`Found ${activeOrders.length} active orders.`);
    
    // just map first one to show no crash
    if (activeOrders.length > 0) {
       console.log('Distributor:', activeOrders[0].distributor);
    }
}
run().catch(console.error).finally(()=> prisma.$disconnect());
