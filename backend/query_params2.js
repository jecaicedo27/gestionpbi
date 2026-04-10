const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()
async function run() {
  const n = await prisma.assemblyNote.findFirst({
    where: { 
      processType: { code: 'EMPAQUE' },
      productionBatch: { batchNumber: 'MANGO-BICHE-260406-1621' },
      productId: { not: null }
    }
  });
  console.log("assembly_on_complete:", n?.processParameters?.assembly_on_complete)
}
run().catch(console.error).finally(()=>prisma.$disconnect())
