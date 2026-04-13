const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const sugar = await prisma.product.findFirst({ where: { name: { contains: 'AZUCAR', mode: 'insensitive' } } });
  if (!sugar) {
    console.log("No sugar found");
    return;
  }
  
  console.log("Sugar:", sugar.name, "ID:", sugar.id);
  
  const badExecutions = await prisma.rpaExecution.findMany({
    where: { executionType: 'SIIGO_ASSEMBLY', status: { not: 'COMPLETED' } }
  });
  
  console.log(`Found ${badExecutions.length} bad RPA executions for assemblies.`);
  
  const badAssemblyNoteIds = badExecutions.map(e => e.assemblyNoteId).filter(Boolean);
  
  const badNotes = await prisma.assemblyNote.findMany({
    where: { id: { in: badAssemblyNoteIds } },
    include: {
        items: {
            where: { componentId: sugar.id }
        }
    }
  });

  let sugarLostInRpa = 0;
  for (const n of badNotes) {
      if (n.items.length > 0) {
          const qty = n.items.reduce((sum, item) => sum + item.actualQuantity, 0);
          sugarLostInRpa += qty;
          console.log(`Note ${n.noteNumber}: uses ${qty}g of sugar`);
      }
  }
  console.log(`Total sugar missing due to RPA failures: ${sugarLostInRpa}g`);
  
  // also check assemblyNotes that have NO rpaExecution at all but are completed
  const unexecutedNotes = await prisma.assemblyNote.findMany({
    where: { 
        status: 'COMPLETED',
        rpaExecutions: { none: {} }
    },
    include: {
        items: { where: { componentId: sugar.id } }
    }
  });
  
  let sugarUnexecuted = 0;
  for (const n of unexecutedNotes) {
      if (n.items.length > 0) {
          const qty = n.items.reduce((sum, item) => sum + item.actualQuantity, 0);
          sugarUnexecuted += qty;
          console.log(`Note ${n.noteNumber} (no RPA): uses ${qty}g of sugar`);
      }
  }
  console.log(`Total sugar missing due to no RPA tasks created: ${sugarUnexecuted}g`);
  
}

main().catch(console.error).finally(() => prisma.$disconnect());
