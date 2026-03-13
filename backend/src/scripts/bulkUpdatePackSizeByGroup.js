
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    try {
        const groupName = 'MATERIA PRIMA FABRICACION 19%';
        const targetPackSize = 25000;

        console.log(`\n🔍 Searching for Inventory Group: '${groupName}'...`);

        // 1. Find the group
        const group = await prisma.inventoryGroup.findFirst({
            where: {
                name: { contains: groupName, mode: 'insensitive' }
            }
        });

        if (!group) {
            console.log(`❌ Group '${groupName}' not found.`);
            return;
        }

        console.log(`✅ Found Group: ${group.name} (ID: ${group.id})`);

        // 2. Count products in group
        const count = await prisma.product.count({
            where: {
                groupId: group.id
            }
        });

        if (count === 0) {
            console.log(`   No products found in this group.`);
            return;
        }

        console.log(`   Found ${count} products in this group.`);

        // 3. Update products
        const result = await prisma.product.updateMany({
            where: {
                groupId: group.id
            },
            data: {
                packSize: targetPackSize
            }
        });

        console.log(`✅ Successfully updated ${result.count} products to Pack Size = ${targetPackSize}.`);

    } catch (error) {
        console.error("❌ Error:", error);
    } finally {
        await prisma.$disconnect();
    }
}

main();
