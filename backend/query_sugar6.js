const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const sugar = await prisma.product.findFirst({ where: { name: { contains: 'AZUCAR', mode: 'insensitive' } } });
  
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
  
  console.log(`Azúcar descontado mediante todos los RPA SUCCESS: ${totalSimulatedConsumption.toFixed(2)} g`);
  
  // Total sugar used locally in ALL assembly notes
  const localUsageItems = await prisma.assemblyNoteItem.findMany({
      where: { componentId: sugar.id, actualQuantity: { gt: 0 } }
  });
  
  const totalLocal = localUsageItems.reduce((acc, i) => acc + i.actualQuantity, 0);
  console.log(`Azúcar consumido localmente en la historia de GestionPBI: ${totalLocal.toFixed(2)} g`);
  
}

main().catch(console.error).finally(() => prisma.$disconnect());
