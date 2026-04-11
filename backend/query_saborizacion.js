const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
    const p = await prisma.product.findFirst({ where: { name: 'SABORIZACION SANDIA' } });
    if(p) {
        const t = await prisma.assemblyTemplate.findFirst({ where: { productId: p.id }, include: { stages: true } });
        console.log(t?.templateCode, t?.stages.map(s => s.stageName));
    }
}
main().finally(() => prisma.$disconnect());
