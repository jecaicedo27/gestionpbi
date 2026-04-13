const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const sessions = await prisma.inventoryCountSession.findMany({
        where: { status: 'IN_PROGRESS' },
        orderBy: { createdAt: 'desc' },
        include: {
            lines: {
                where: {
                    product: {
                        name: {
                            contains: 'mango'
                        }
                    }
                },
                include: { product: true }
            }
        }
    });

    console.log(`Found ${sessions.length} active sessions:`);
    sessions.forEach(s => {
        console.log(`\n===========================================`);
        console.log(`Session: ${s.id}`);
        console.log(`Name: ${s.sessionCode} (Warehouse: ${s.warehouseName})`);
        console.log(`Type: ${s.type} | Month: ${s.month}`);
        
        const mangoLines = s.lines.filter(l => l.product.name.toLowerCase().includes('sirop') || l.product.name.toLowerCase().includes('syrup'));
        
        console.log(`Found ${mangoLines.length} Mango Sirope lines in this session.`);
        mangoLines.forEach(l => {
            console.log(`  - ${l.product.name} (Lot: ${l.lotNumber}) -> PhysQty: ${l.physicalQty}`);
        });
    });
}

main().catch(console.error).finally(() => prisma.$disconnect());
