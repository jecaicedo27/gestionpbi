const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    // Find the latest session
    const session = await prisma.inventoryCountSession.findFirst({
        orderBy: { createdAt: 'desc' },
        include: {
            lines: {
                include: {
                    product: true
                }
            }
        }
    });

    if (!session) {
        console.log('No physical count session found.');
        return;
    }

    console.log(`Session ID: ${session.id} - ${session.name} (Status: ${session.status}, Type: ${session.type})`);
    
    // Filter lines for mango biche sirope or sirop
    const mangoLines = session.lines.filter(l => 
        l.product.name.toLowerCase().includes('mango') && 
        (l.product.name.toLowerCase().includes('sirop') || l.product.name.toLowerCase().includes('syrup'))
    );

    if (mangoLines.length === 0) {
        console.log('No lines found for "Mango Biche Sirope".');
        return;
    }

    let totalSystem = 0;
    let totalPhysical = 0;
    mangoLines.forEach(l => {
        console.log(`- Product: ${l.product.name} | SKU: ${l.product.sku} | Lot: ${l.lotNumber || 'N/A'} (LineId: ${l.id})`);
        console.log(`  System: ${l.systemQty} | Physical Scanned: ${l.physicalQty} | Diff: ${l.diffQty}`);
        console.log(`  Updated At: ${l.updatedAt}`);
        totalSystem += (l.systemQty || 0);
        totalPhysical += (l.physicalQty || 0);
    });

    if (mangoLines.length > 0) {
        console.log(`\n============== SUMMARY ==============`);
        console.log(`TOTAL SYSTEM EXPECTED: ${totalSystem} uds`);
        console.log(`TOTAL PHYSICAL SCANNED: ${totalPhysical} uds`);
    }
}

main().catch(console.error).finally(() => prisma.$disconnect());
