const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const pesajeType = await prisma.processType.findFirst({ where: { code: 'PESAJE' } });
  const ensambleType = await prisma.processType.findFirst({ where: { code: 'ENSAMBLE' } });

  console.log(`PESAJE ID: ${pesajeType.id}`);
  console.log(`ENSAMBLE ID: ${ensambleType.id}`);

  // FIX TEMPLATE
  const t = await prisma.assemblyTemplate.findFirst({
    where: { templateName: "Producción COMPUESTO COCO" },
    include: { stages: { orderBy: { stageOrder: 'asc' } } }
  });

  if (t) {
    const stage1 = t.stages.find(s => s.stageOrder === 1);
    const stage2 = t.stages.find(s => s.stageOrder === 2);
    
    if (stage1) {
      await prisma.assemblyTemplateStage.update({
        where: { id: stage1.id },
        data: {
          processTypeId: pesajeType.id,
          stageName: "Pesaje de COMPUESTO COCO"
        }
      });
      console.log("Updated template stage 1 to PESAJE");
    }
    
    if (stage2) {
      await prisma.assemblyTemplateStage.update({
        where: { id: stage2.id },
        data: {
          processTypeId: ensambleType.id,
          stageName: "Ensamble Siigo de COMPUESTO COCO"
        }
      });
      console.log("Updated template stage 2 to ENSAMBLE");
    }
  }

  // FIX ACTIVE BATCHES
  const batches = await prisma.productionBatch.findMany({
    where: { 
      status: { notIn: ['COMPLETED', 'CANCELLED'] },
      batchNumber: { contains: "COCO" }
    },
    include: { assemblyNotes: { orderBy: { stageOrder: 'asc' } } }
  });

  for (const b of batches) {
    const note5 = b.assemblyNotes.find(n => n.stageOrder === 5 && n.stageName.includes("COMPUESTO COCO"));
    const note6 = b.assemblyNotes.find(n => n.stageOrder === 6 && n.stageName.includes("COMPUESTO COCO"));

    if (note5) {
      await prisma.assemblyNote.update({
        where: { id: note5.id },
        data: {
          processTypeId: pesajeType.id,
          stageName: "Pesaje de COMPUESTO COCO"
        }
      });
      console.log(`Fixed note 5 in batch ${b.batchNumber} to PESAJE`);
    }

    if (note6) {
      await prisma.assemblyNote.update({
        where: { id: note6.id },
        data: {
          processTypeId: ensambleType.id,
          stageName: "Ensamble Siigo de COMPUESTO COCO"
        }
      });
      console.log(`Fixed note 6 in batch ${b.batchNumber} to ENSAMBLE`);
    }
  }
}

main()
  .then(() => console.log("Done!"))
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
