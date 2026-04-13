const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const stage = await prisma.assemblyTemplateStage.findFirst({
        where: { subTemplateId: "a9d0d7ac-cff4-4f23-b09a-cbf45966c6a3" } // The template used
    });
    console.log("Stage subtemplate mapping:", stage);
}
main().finally(() => prisma.$disconnect());
