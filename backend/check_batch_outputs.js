const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const lot = 'TAMARINDO-260410-0645';
    const batch = await prisma.productionBatch.findUnique({
        where: { batchNumber: lot },
        include: { assemblyNotes: true }
    });
    
    if(!batch) process.exit(1);
    const noteIds = batch.assemblyNotes.map(n => n.id);
    
    const outputs = await prisma.assemblyOutput.findMany({
        where: { assemblyNoteId: { in: noteIds } },
        include: { product: true }
    });
    
    console.log(`Outputs found in batch ${lot}:`);
    for (const out of outputs) {
        console.log(`- NotaID: ${out.assemblyNoteId} | Producto: ${out.product?.name} | Cant: ${out.quantity} | Foto: ${out.productionPhotoUrl} | LabelInfo: ${out.labeledAt ? 'YES' : 'NO'}`);
    }

}
main().finally(() => prisma.$disconnect());
