const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const sugar = await prisma.product.findFirst({ where: { name: { contains: 'AZUCAR', mode: 'insensitive' } } });
  
  const allSugarAssemblyItems = await prisma.assemblyNoteItem.findMany({
    where: {
      componentId: sugar.id,
      actualQuantity: { gt: 0 },
      assemblyNote: {
        status: 'COMPLETED',
        rpaExecutions: { none: {} }
      }
    },
    include: {
      assemblyNote: true
    }
  });

  console.log(`There are ${allSugarAssemblyItems.length} assembly note items consuming sugar with NO rpa executions.`);
  const sum = allSugarAssemblyItems.reduce((acc, item) => acc + item.actualQuantity, 0);
  console.log(`Total sugar: ${sum} g`);
  
  // Also check how many ARE pending in RPA
  const badExecutions = await prisma.rpaExecution.findMany({
    where: { executionType: 'SIIGO_ASSEMBLY', status: { not: 'COMPLETED' } },
    include: {
      assemblyNote: {
        include: { items: { where: { componentId: sugar.id } } }
      }
    }
  });
  
  let rpaSugar = 0;
  for (const exec of badExecutions) {
    if (exec.assemblyNote && exec.assemblyNote.items) {
       for (const item of exec.assemblyNote.items) {
           rpaSugar += item.actualQuantity || 0;
       }
    }
  }
  console.log(`Total sugar in FAILED/PENDING RPA: ${rpaSugar} g`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
