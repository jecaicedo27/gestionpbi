const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function fix() {
    const lines = await prisma.inventoryCountLine.findMany({
        where: { lotId: null }
    });
    
    // Group by sessionId + productId
    const grouped = {};
    for (const ln of lines) {
         const key = `${ln.sessionId}_${ln.productId}`;
         if (!grouped[key]) grouped[key] = [];
         grouped[key].push(ln);
    }
    
    for (const key in grouped) {
         const group = grouped[key];
         if (group.length > 1) {
             console.log(`Found ${group.length} duplicates for ${key}`);
             // Keep the last one, delete the rest
             const toKeep = group[group.length - 1];
             for (let i = 0; i < group.length - 1; i++) {
                 await prisma.inventoryCountLine.delete({ where: { id: group[i].id } });
             }
         }
    }
    console.log("Done fixing DB.");
}
fix();
