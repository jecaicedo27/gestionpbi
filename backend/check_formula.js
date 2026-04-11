const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const t = await prisma.assemblyTemplate.findFirst({
    where: { name: { contains: "COCO" } },
    include: {
      steps: {
        include: { processType: true, product: true },
        orderBy: { order: 'asc' }
      }
    }
  });

  if (t) {
    console.log("Template:", t.name);
    t.steps.forEach(s => console.log(`Step ${s.order}: ${s.processType?.code} - ${s.name} (Product: ${s.product?.name})`));
  } else {
    console.log("No template");
  }
}

main().finally(() => prisma.$disconnect());
