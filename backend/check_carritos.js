const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const lot = 'TAMARINDO-260410-0645';
    console.log(`Buscando AssemblyNote con lote: ${lot}`);
    
    // Buscar la nota de ensamble
    const note = await prisma.assemblyNote.findFirst({
        where: { lot: lot },
        include: {
            outputs: true,
        }
    });

    if (!note) {
        console.log('No se encontró la nota.');
        return;
    }
    console.log(`Nota encontrada: ID ${note.id}, Producto: ${note.productId}, Etapa: ${note.currentStage}`);

    // Los carritos usualmente se guardan en el historial o json, pero también en Geniality, 
    // en base al código frontend 'GConteoCarritosStep', los carritos son un 'output' de tipo 'GenialityCarrito' o algo similar?
    // En `genialityAssemblyRoutes.js` (u otra ruta), ¿cómo se guardan? 
    // En el frontend se llama `onAddCarrito`. Vamos a mirar GenialityCarritoModel o JsonB.
    
    // Primero, vamos a imprimir la nota cruda.
    console.log("=== OUTPUTS ===");
    console.dir(note.outputs, { depth: null });
    
    const carts = await prisma.genialityCarrito.findMany({
        where: { assemblyNoteId: note.id }
    });
    console.log("\n=== GENIALITY CARRITOS ===");
    if(carts.length === 0) {
        console.log("No hay registros en tabla genialityCarrito (si existe tal tabla).");
    } else {
        console.dir(carts, { depth: null });
    }
}

main().catch(console.error).finally(() => prisma.$disconnect());
