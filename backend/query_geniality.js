const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()
async function run() {
  const b = await prisma.productionBatch.findUnique({
    where: { batchNumber: 'MANGO-BICHE-260406-1621' },
    include: {
      assemblyNotes: { include: { processType: true }, orderBy: { stageOrder: 'asc' } }
    }
  })
  if(b) {
    console.log("Batch:", b.batchNumber);
    b.assemblyNotes.forEach(n => console.log(`Step ${n.stageOrder}: ${n.stageName} [Type: ${n.processType?.code}]`))
  }
}
run().catch(console.error).finally(()=>prisma.$disconnect())
