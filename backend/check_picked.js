const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
    const activeOrders = await prisma.order.findMany({
        where: { status: { in: ['APPROVED', 'IN_PICKING', 'READY'] } },
        include: {
            distributor: { select: { id: true, name: true, comercialName: true } },
            items: {
                include: {
                    pickingItems: true
                }
            }
        }
    });

    const pickedMap = {};
    for (const order of activeOrders) {
        for (const item of order.items) {
            if (item.pickingItems && item.pickingItems.length > 0) {
                const pickedAmount = item.pickingItems.reduce((acc, p) => acc + (p.scannedQty || 0), 0);
                if (pickedAmount > 0) {
                    if (!pickedMap[item.productId]) {
                        pickedMap[item.productId] = { total: 0, orders: [] };
                    }
                    pickedMap[item.productId].total += pickedAmount;
                    
                    const distributorName = order.distributor?.comercialName || order.distributor?.name || 'Distribuidor';
                    pickedMap[item.productId].orders.push({
                        orderId: order.id,
                        orderNumber: order.orderNumber,
                        distributorName: distributorName,
                        quantity: pickedAmount
                    });
                }
            }
        }
    }

    console.log(JSON.stringify(pickedMap, null, 2));
}

check().catch(console.error).finally(() => prisma.$disconnect());
