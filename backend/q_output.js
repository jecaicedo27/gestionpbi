const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function run() {
    const product = await prisma.product.findFirst({ where: { name: 'BASE LIQUIPOPS' }});
    const notes = await prisma.assemblyNote.findMany({
        where: { productId: product.id, status: 'COMPLETED' },
        include: { processType: { select: { producesOutput: true } } },
        take: 3
    });
    console.log(JSON.stringify(notes.map(n => ({ id: n.id, n: n.noteNumber, qty: n.actualQuantity, outputs: n.processType?.producesOutput })), null, 2));
    process.exit(0);
}
run();
