const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const lot = 'TAMARINDO-260410-0645';
    
    const output = await prisma.assemblyOutput.findFirst({
        where: { lotNumber: lot },
        include: { assemblyNote: true }
    });

    if (!output) {
        console.log('No se encontró AssemblyOutput con ese lote.');
        return;
    }
    const noteId = output.assemblyNoteId;
    console.log(`Nota encontrada: ${noteId}, Stage: ${output.assemblyNote.currentStage}`);
    
    // Check geniality carts
    if (prisma.genialityCarrito) {
        const carts = await prisma.genialityCarrito.findMany({
            where: { assemblyNoteId: noteId }
        });
        console.log("=== CARTS ===");
        console.log(carts);
    } else {
        console.log("No existe prisma.genialityCarrito");
    }
}
main().finally(() => prisma.$disconnect());
