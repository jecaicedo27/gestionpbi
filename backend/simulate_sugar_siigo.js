const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const sugar = await prisma.product.findFirst({ where: { name: { contains: 'AZUCAR', mode: 'insensitive' } } });
  if (!sugar) {
     console.log("Sugar not found");
     return;
  }
  
  console.log("--- SIMULACIÓN DE DESCUENTO EN SIIGO ---");
  console.log(`Azúcar local ERP: ~1,886,848 g`);
  console.log(`Azúcar actual Siigo: ~3,248,914 g`);
  console.log(`Diferencia esperada a descontar: ~1,362,066 g\n`);

  // Find all failed/pending RPAs
  const badExecutions = await prisma.rpaExecution.findMany({
    where: { executionType: 'SIIGO_ASSEMBLY', status: { notIn: ['COMPLETED', 'SUCCESS'] } }
  });

  console.log(`Encontradas ${badExecutions.length} tareas RPA de ensamble sin completar.`);
  
  let totalSimulatedConsumption = 0;
  
  for (const exec of badExecutions) {
      if (!exec.productName) continue;
      
      // Find the product by checking product.name roughly matches
      // product.sku can also be used if exec.productName is a SKU?
      // Wait, in RPA, productName is usually the name or SKU. Let's find the product.
      let product = await prisma.product.findFirst({
        where: { name: { equals: exec.productName, mode: 'insensitive' } }
      });
      if (!product) {
         product = await prisma.product.findFirst({
           where: { sku: { equals: exec.productName, mode: 'insensitive' } }
         });
      }
      
      if (!product) {
         console.log(`[!] Producto no encontrado para RPA ID ${exec.id}: ${exec.productName}`);
         continue;
      }
      
      // Find active formula for this product
      const formula = await prisma.formula.findFirst({
         where: { productId: product.id, isActive: true },
         include: { items: true }
      });
      
      if (!formula) {
         // console.log(`[!] Fórmula no encontrada para producto: ${product.name}`);
         continue;
      }
      
      // Look for sugar in formula
      const sugarItem = formula.items.find(i => i.ingredientId === sugar.id);
      if (sugarItem) {
          // Calculate proportion. 
          // qty in formula is for `formula.baseQuantity`.
          const qtyPerUnit = sugarItem.quantity / formula.baseQuantity;
          const consumption = exec.quantity * qtyPerUnit;
          
          totalSimulatedConsumption += consumption;
          console.log(`-> Producto: ${product.name} | Cantidad RPA: ${exec.quantity} | Azúcar por ud: ${qtyPerUnit.toFixed(2)}g | Consumo: ${consumption.toFixed(2)}g`);
      }
  }
  
  console.log(`\n========================================`);
  console.log(`Consumo total simulado de Azúcar en Siigo si pasaran todos los RPA: ${totalSimulatedConsumption.toFixed(2)} g`);
  console.log(`Saldo final simulado en Siigo: ${(3248914 - totalSimulatedConsumption).toFixed(2)} g`);
  
  // also what about "SUCCESS" RPAs? Wait, SUCCESS means the Siigo RPA ran. 
  // Let's check if there are any RPA with status = 'SUCCESS' but no Siigo check?
  // Wait, my initial query showed SUCCESS = 837, PENDING = 1, FAILED = 5.
  // Wait, are there only 6 RPAs not COMPLETED?
  // Let me recount the status.
}

main().catch(console.error).finally(() => prisma.$disconnect());
