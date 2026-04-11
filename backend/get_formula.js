const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const ts = await prisma.assemblyTemplate.findMany({
    where: { templateName: { contains: "COCO" } },
    include: {
      stages: {
        include: { processType: true},
        orderBy: { stageOrder: 'asc' }
      }
    }
  });

  if (ts.length > 0) {
    ts.forEach(t => {
      console.log("Template:", t.templateName);
      t.stages.forEach(s => console.log(`Step ${s.stageOrder}: ${s.processType?.code} - ${s.stageName} (Subtemplate?: ${s.subTemplateId})`));
      console.log('---');
    });
  } else {
    console.log("No template");
  }
}

main().finally(() => prisma.$disconnect());
