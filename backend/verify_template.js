const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const ts = await prisma.assemblyTemplate.findMany({
    where: { templateName: { contains: "COMPUESTO COCO" } },
    include: { stages: { include: { processType: true}, orderBy: { stageOrder: 'asc' } } }
  });
  ts.forEach(t => {
      console.log("Template:", t.templateName);
      t.stages.forEach(s => console.log(`Step ${s.stageOrder}: ${s.processType?.code} - ${s.stageName}`));
  });
}
main().finally(() => prisma.$disconnect());
