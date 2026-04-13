const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
    const p1 = await prisma.product.findFirst({ where: { name: { contains: 'LIQUIPOPS SABOR A BLUEBERRY' } }, include: { group: true } });
    const p2 = await prisma.product.findFirst({ where: { name: { contains: 'SIROPE GENIALITY' } }, include: { group: true } });
    const p3 = await prisma.product.findFirst({ where: { name: { contains: 'COMPUESTO CEREZA' } }, include: { group: true } });
    console.log('Blueberry:', p1?.group?.name, '-> accountGroup ID:', p1?.accountGroup);
    console.log('Sirope:', p2?.group?.name, '-> accountGroup ID:', p2?.accountGroup);
    console.log('Compuesto:', p3?.group?.name, '-> accountGroup ID:', p3?.accountGroup);
    
    // Also list all unique groups
    const distinct = await prisma.inventoryGroup.findMany({ select: { name: true }});
    console.log('All Groups in DB:', distinct.map(d => d.name));
}
main().catch(console.error).finally(() => prisma.$disconnect());
