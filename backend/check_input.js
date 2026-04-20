const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
    const input = await prisma.assemblyTemplateStageInput.findFirst({
        where: { stageId: '0e905427-daac-49ab-a6e8-6cbb3068f04d', productId: 'd4d4e32a-5d35-40a0-bbbe-e78e93ba5dca' } // AGUA
    });
    console.log(input);
}
check().catch(console.error).finally(() => prisma.$disconnect());
