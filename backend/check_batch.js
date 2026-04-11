const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const lot = 'TAMARINDO-260410-0645';
    
    const batch = await prisma.productionBatch.findFirst({
        where: { generatedLotCode: lot },
        include: {
            assemblyNotes: {
                include: { product: true }
            }
        }
    });

    if (!batch) {
        console.log("No batch found.");
        return;
    }

    console.log("Found batch: ", batch.id);

    for (const note of batch.assemblyNotes) {
        console.log(`\nNote ${note.id} - Stage: ${note.currentStage} - Product: ${note.product?.name}`);
        if (note.customData) {
            console.log("customData", note.customData);
        }
        if (note.customFields) {
            console.log("customFields", note.customFields);
        }
        const outputs = await prisma.assemblyOutput.findMany({ where: { assemblyNoteId: note.id } });
        console.log("outputs", outputs);
        
        // Carts are stored in `GenialityCarrito` if it exists, or maybe inside `customData`.
    }
}
main().finally(() => prisma.$disconnect());
