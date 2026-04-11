const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const batch = await prisma.productionBatch.findFirst({
        where: { batchNumber: 'COCO-260410-0800' },
        include: {
            processNotes: {
                include: { product: true }
            }
        }
    });

    for (const note of batch.processNotes) {
         if (note.product) {
              console.log(note.product.name);
         }
    }
}
main().catch(console.error).finally(() => prisma.$disconnect());
