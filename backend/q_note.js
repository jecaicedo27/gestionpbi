const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    const noteCode = 'MANGO-BICHE-260410-1746-S5';
    // Find note
    const note = await prisma.assemblyNote.findFirst({
        where: { noteNumber: noteCode },
        include: {
            lotConsumptions: {
                include: {
                    materialLot: { select: { lotNumber: true, productId: true, product: { select: { name: true } } } }
                }
            }
        }
    });

    if (!note) {
        console.log('Not found');
        return process.exit(0);
    }
    
    // Filter consumptions for BASE LIQUIPOPS 
    const baseConsumptions = note.lotConsumptions.filter(c => c.materialLot.product.name === 'BASE LIQUIPOPS');
    
    console.log(JSON.stringify(baseConsumptions, null, 2));
    process.exit(0);
}
run();
