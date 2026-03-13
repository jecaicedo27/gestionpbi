const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkSchedule() {
    try {
        const batches = await prisma.productionBatch.findMany({
            where: {
                status: {
                    in: ['PENDING', 'STAGE_1_BASE', 'STAGE_2_JARABE', 'STAGE_3_ESFERIFICACION', 'STAGE_4_PRODUCTO_FINAL', 'LABELING']
                }
            },
            include: {
                outputTargets: {
                    include: { product: true }
                }
            }
        });

        console.log(`Found ${batches.length} batches.`);

        if (batches.length > 0) {
            const b = batches[0];
            console.log('Sample Batch:', JSON.stringify(b, null, 2));

            const mix = b.outputTargets.map(t => ({
                id: t.productId,
                name: t.product.name,
                plannedUnits: t.plannedUnits
            }));
            console.log('Mapped Mix:', mix);
        }

    } catch (error) {
        console.error(error);
    } finally {
        await prisma.$disconnect();
    }
}

checkSchedule();
