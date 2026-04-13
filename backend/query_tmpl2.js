const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const t = await prisma.assemblyTemplate.findUnique({
        where: { id: "a9d0d7ac-cff4-4f23-b09a-cbf45966c6a3" },
        include: {
            stages: { include: { inputs: { include: { product: { select: { name: true }} } } } }
        }
    });
    console.log(JSON.stringify(t, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
