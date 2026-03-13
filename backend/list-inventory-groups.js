const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    try {
        const groups = await prisma.inventoryGroup.findMany({
            orderBy: { name: 'asc' }
        });

        console.log("=== INVENTORY GROUPS ===");
        if (groups.length === 0) {
            console.log("No inventory groups found.");
        } else {
            console.table(groups.map(g => ({
                Name: g.name,
                Type: g.type,
                SiigoID: g.siigoId,
                Description: g.description?.substring(0, 50) || ''
            })));
        }
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
