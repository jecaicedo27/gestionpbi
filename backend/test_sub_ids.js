const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
    const t1 = await prisma.assemblyTemplate.findUnique({ where: { id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' } });
    const t2 = await prisma.assemblyTemplate.findUnique({ where: { id: 'b1b2c3d4-e5f6-7890-abcd-ef1234567890' } });
    console.log("Sub 4:", t1?.templateCode);
    console.log("Sub 5:", t2?.templateCode);
}
main().finally(() => prisma.$disconnect());
