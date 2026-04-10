const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()
async function run() {
  const b = await prisma.productionBatch.findUnique({
    where: { batchNumber: 'MANGO-BICHE-260406-1621' },
    include: {
      outputTargets: { include: { product: true } },
      assemblyNotes: { 
        where: { processType: { code: 'EMPAQUE' } }
      }
    }
  })
  if (b) {
    b.outputTargets.forEach(t => {
       console.log(`Target ${t.product.name}: actual=${t.actualUnits}, approved=${t.approvedUnits}`)
    })
    b.assemblyNotes.forEach(n => {
       console.log(`Note ${n.productId}: params=${JSON.stringify(n.processParameters?.empaque || {})}`)
       console.log(`Note ${n.productId}: empaqueData=${JSON.stringify(n.empaqueData || {})}`)
    })
  }
}
run().catch(console.error).finally(()=>prisma.$disconnect())
