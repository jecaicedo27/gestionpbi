const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const sugar = await prisma.product.findFirst({ where: { name: { contains: 'AZUCAR', mode: 'insensitive' } } });
  
  const allSugarAssemblyItems = await prisma.assemblyNoteItem.findMany({
    where: {
      componentId: sugar.id,
      actualQuantity: { gt: 0 }
    },
    include: {
      assemblyNote: {
          include: { processType: true, product: true }
      }
    }
  });

  const totalsByProduct = {};
  for (const item of allSugarAssemblyItems) {
      const prodName = item.assemblyNote.product ? item.assemblyNote.product.name : 'Unknown';
      if (!totalsByProduct[prodName]) {
          totalsByProduct[prodName] = { 
              pesajeLocal: 0, 
              ensambleYield: 0, 
              formulaRatio: 0,
              productId: item.assemblyNote.productId
          };
      }
      totalsByProduct[prodName].pesajeLocal += item.actualQuantity;
  }
  
  for (const key of Object.keys(totalsByProduct)) {
      const data = totalsByProduct[key];
      const formula = await prisma.formula.findFirst({
         where: { productId: data.productId, isActive: true },
         include: { items: true }
      });
      if (formula) {
          const sugarItem = formula.items.find(i => i.ingredientId === sugar.id);
          if (sugarItem) {
              data.formulaRatio = sugarItem.quantity / formula.baseQuantity;
          }
      }
      console.log(`Product: ${key.padEnd(30)} | Azúcar Usada Localmente: ${data.pesajeLocal.toFixed(2)} g | Ratio Formula: ${data.formulaRatio}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
