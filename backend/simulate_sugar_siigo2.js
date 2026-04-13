const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const sugar = await prisma.product.findFirst({ where: { name: { contains: 'AZUCAR', mode: 'insensitive' } } });
  
  // Find all assembly notes that are completed, have items with sugar, but have NO related rpaExecution for the batch?
  // Wait, the RPA is ONLY triggered on ENSAMBLE or FORMACION notes. 
  // We need to look for COMPLETED notes of type ENSAMBLE or FORMACION that have NO rpaExecutions.
  
  const skippedEnsambleNotes = await prisma.assemblyNote.findMany({
      where: {
          status: 'COMPLETED',
          processType: { code: { in: ['ENSAMBLE', 'FORMACION'] } },
          rpaExecutions: { none: {} }
      },
      include: {
          product: true,
          productionBatch: true
      }
  });
  
  console.log(`Encontradas ${skippedEnsambleNotes.length} notas de ENSAMBLE/FORMACION completadas localmente SIN ninguna tarea RPA asociada.`);
  
  let totalMissingRpaConsumption = 0;
  
  for (const note of skippedEnsambleNotes) {
      if (!note.productId) continue;
      
      const formula = await prisma.formula.findFirst({
         where: { productId: note.productId, isActive: true },
         include: { items: true }
      });
      
      if (!formula) continue;
      
      const sugarItem = formula.items.find(i => i.ingredientId === sugar.id);
      if (sugarItem) {
          const qtyPerUnit = sugarItem.quantity / formula.baseQuantity;
          const consumption = note.actualQuantity * qtyPerUnit; // ENSAMBLE note actualQuantity is the yield
          totalMissingRpaConsumption += consumption;
      }
  }
  
  console.log(`Consumo de Azúcar atrapado en ENSAMBLES que nunca mandaron RPA: ${totalMissingRpaConsumption.toFixed(2)} g`);
  
}

main().catch(console.error).finally(() => prisma.$disconnect());
