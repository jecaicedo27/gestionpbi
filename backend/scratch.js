const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    // Batch MARACUYA-260401-0632
    const batch = await prisma.productionBatch.findFirst({
        where: { batchNumber: 'MARACUYA-260401-0632' }
    });
    console.log('Batch multiplier:', batch?.batchMultiplier);
    console.log('Total quantity:', batch?.totalQuantity);
    console.log('Target qty:', batch?.targetQuantity);
    
    // Nota problemática
    const note = await prisma.assemblyNote.findUnique({
        where: { id: '2502f18b-0b1d-406d-860c-dd1702d4922c' }
    });
    console.log('\nNote actualQty:', note.actualQuantity);
    console.log('Note targetQty:', note.targetQuantity);
    console.log('Note plannedQty:', note.plannedQuantity);
    console.log('Note qty * 10 =', note.actualQuantity * 10, '(= RPA qty 7193123?)');
    
    // Compare the RPA quantity
    const rpa = await prisma.rpaExecution.findFirst({
        where: { assemblyNoteId: '2502f18b-0b1d-406d-860c-dd1702d4922c', siigoNoteCode: 'NE-1-13234' }
    });
    console.log('\nRPA quantity:', rpa?.quantity);
    console.log('Ratio RPA/actualQty:', rpa?.quantity / note.actualQuantity);
}
run().finally(() => prisma.$disconnect());
