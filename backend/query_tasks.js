const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()
async function run() {
  const targetNote = await prisma.assemblyNote.findFirst({
    where: { 
      processType: { code: 'EMPAQUE' },
      productionBatch: { batchNumber: 'MANGO-BICHE-260406-1621' },
      status: 'COMPLETED'
    },
    orderBy: { updatedAt: 'desc' }
  });
  console.log("Found Note?", !!targetNote);
  
  const tasks = await prisma.taskQueue.findMany({
    take: 5,
    orderBy: { createdAt: 'desc' }
  })
  console.log("Recent Tasks:", JSON.stringify(tasks, null, 2))
}
run().catch(console.error).finally(()=>prisma.$disconnect())
