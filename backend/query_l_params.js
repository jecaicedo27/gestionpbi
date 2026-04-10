const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()
async function run() {
  const n = await prisma.assemblyNote.findFirst({
    where: { 
      processType: { code: 'EMPAQUE' },
      productionBatch: { outputTargets: { some: { product: { name: { contains: 'LIQUIPOPS' } } } } }
    },
    orderBy: { createdAt: 'desc' }
  });
  console.log("Liquipops params:", JSON.stringify(n?.processParameters, null, 2))
}
run().catch(console.error).finally(()=>prisma.$disconnect())
