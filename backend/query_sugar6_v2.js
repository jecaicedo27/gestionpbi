const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const sugar = await prisma.product.findFirst({ where: { name: { contains: 'AZUCAR', mode: 'insensitive' } } });
  
  // Total sugar used locally in ALL assembly notes
  const localUsageItems = await prisma.assemblyNoteItem.findMany({
      where: { componentId: sugar.id, actualQuantity: { gt: 0 } }
  });
  const totalLocal = localUsageItems.reduce((acc, i) => acc + i.actualQuantity, 0);

  // Find all SUCCESS RPAs
  const successExecutions = await prisma.rpaExecution.findMany({
    where: { executionType: 'SIIGO_ASSEMBLY', status: 'SUCCESS' }
  });
  
  let totalSimulatedConsumption = 0;
  
  for (const exec of successExecutions) {
      if (!exec.productName) continue;
      
      let product = await prisma.product.findFirst({
        where: { name: { equals: exec.productName, mode: 'insensitive' } }
      });
      if (!product) {
         product = await prisma.product.findFirst({
           where: { sku: { equals: exec.productName, mode: 'insensitive' } }
         });
      }
      if (!product) continue;
      
      const formula = await prisma.formula.findFirst({
         where: { productId: product.id, isActive: true },
         include: { items: true }
      });
      if (!formula) continue;
      
      const sugarItem = formula.items.find(i => i.ingredientId === sugar.id);
      if (sugarItem) {
          const qtyPerUnit = sugarItem.quantity / formula.baseQuantity;
          totalSimulatedConsumption += exec.quantity * qtyPerUnit;
      }
  }
  
  console.log(`Azúcar consumido físicamente en toda la historia local: ${(totalLocal/1000).toFixed(2)} kg`);
  console.log(`Azúcar teórico que el RPA le reportó hasta ahora a Siigo: ${(totalSimulatedConsumption/1000).toFixed(2)} kg`);
  console.log(`Diferencia histórica acumulada: ${((totalLocal - totalSimulatedConsumption)/1000).toFixed(2)} kg`);
  
}

main().catch(console.error).finally(() => prisma.$disconnect());
