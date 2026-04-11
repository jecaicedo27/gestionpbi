const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const pesajeType = await prisma.processType.findFirst({ where: { code: 'PESAJE' } });
  const ensambleType = await prisma.processType.findFirst({ where: { code: 'ENSAMBLE' } });

  // Update specific batch manually
  const b = await prisma.productionBatch.findUnique({
    where: { batchNumber: "COCO-260410-0800" },
    include: { assemblyNotes: true }
  });

  if (b) {
    const note5 = b.assemblyNotes.find(n => n.stageOrder === 5);
    const note6 = b.assemblyNotes.find(n => n.stageOrder === 6);

    if (note5) {
      await prisma.assemblyNote.update({
        where: { id: note5.id },
        data: {
          processTypeId: pesajeType.id,
          stageName: "Pesaje de COMPUESTO COCO"
        }
      });
      console.log(`Fixed note 5 in batch COCO-260410-0800 to PESAJE`);
    }

    if (note6) {
      await prisma.assemblyNote.update({
        where: { id: note6.id },
        data: {
          processTypeId: ensambleType.id,
          stageName: "Ensamble Siigo de COMPUESTO COCO"
        }
      });
      console.log(`Fixed note 6 in batch COCO-260410-0800 to ENSAMBLE`);
    }
  } else {
     console.log("Batch not found!");
  }
}

main()
  .then(() => console.log("Done!"))
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
