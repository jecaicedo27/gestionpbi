const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const s = await prisma.supplier.findUnique({ where: { id: '09006008-e583-49d9-a67f-4b3cb7c0f9cb' } });
    console.log(s);
}
main().finally(() => prisma.$disconnect());
