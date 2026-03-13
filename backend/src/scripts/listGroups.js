const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkGroups() {
    try {
        const groups = await prisma.inventoryGroup.findMany({
            select: { name: true }
        });
        console.log('Groups:', groups.map(g => g.name));
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

checkGroups();
