const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function fixOrder() {
    try {
        const order = await prisma.order.findUnique({
            where: { orderNumber: 'ORD-BURBUJAS-EXPLOS-11042026-5' },
            include: { items: true }
        });
        
        if (!order) {
            console.log('Order not found');
            return;
        }

        await prisma.$transaction(async (tx) => {
            await tx.order.update({
                where: { id: order.id },
                data: {
                    status: 'READY',
                    readyAt: new Date(),
                    approvedAt: new Date(),
                    completionPercent: 100
                }
            });

            for (const item of order.items) {
                await tx.orderItem.update({
                    where: { id: item.id },
                    data: {
                        pendingQty: 0,
                        allocatedQty: item.requestedQty
                    }
                });
            }
        });

        console.log('Order ORD-BURBUJAS-EXPLOS-11042026-5 successfully upgraded to READY');
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}
fixOrder();
