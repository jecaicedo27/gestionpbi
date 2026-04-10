const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const modifications = [
        { id: '7968bd40-1466-4ff0-8674-32c567c63abd', name: 'TARRO LIQUIPOPS 1150 GR - 1000ML', zoneDiff: 15 },
        { id: '7fe60c78-cfec-4bfa-bed0-4357b98f24b0', name: 'TAPA LIQUIPOPS 1150 GR - 1000ML', zoneDiff: 4 },
        { id: 'b1b706c6-93d3-41bb-a6a9-83bcbed01d81', name: 'LINER TAPA LIQUIPOPS 1150 GR - 1000ML', zoneDiff: 4 }
    ];

    for (const mod of modifications) {
        try {
            await prisma.product.update({
                where: { id: mod.id },
                data: {
                    productionZoneStock: { increment: mod.zoneDiff },
                    currentStock: { decrement: mod.zoneDiff }
                }
            });
            console.log(`Injected ${mod.zoneDiff} to ${mod.name} in Zone.`);
        } catch (e) {
            console.log(`Failed for ${mod.name} (${mod.id}): ${e.message}`);
        }
    }
    
    console.log("Stock adjustment complete.");
}

main().catch(console.error).finally(() => prisma.$disconnect());
