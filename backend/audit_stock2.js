const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const base = await prisma.product.findFirst({
        where: { name: { contains: 'BASE SIROPE CLASICA', mode: 'insensitive' } },
        select: { id: true, name: true, currentStock: true }
    });
    console.log(`BASE ID: ${base.id}`);
    console.log(`currentStock: ${base.currentStock}g (${(base.currentStock/1000).toFixed(1)}kg)\n`);

    // Recent stock movements
    const movements = await prisma.stockMovement.findMany({
        where: { productId: base.id },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: { id: true, type: true, quantity: true, reference: true, createdAt: true }
    });

    console.log(`=== LAST 30 STOCK MOVEMENTS for BASE SIROPE CLASICA ===`);
    let runningTotal = 0;
    for (const m of movements) {
        runningTotal += m.quantity;
        console.log(`${m.createdAt.toISOString().slice(0,19)} | ${m.type.padEnd(25)} | ${m.quantity >= 0 ? '+' : ''}${m.quantity}g | ref: ${(m.reference || '-').slice(0, 70)}`);
    }
    console.log(`Sum of last 30 movements: ${runningTotal}g`);

    // Count total movements
    const totalMvmt = await prisma.stockMovement.count({ where: { productId: base.id } });
    console.log(`\nTotal movements ever: ${totalMvmt}`);

    // Look for double-consumption pattern: same reference appearing multiple times
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayMvmts = await prisma.stockMovement.findMany({
        where: { productId: base.id, createdAt: { gte: today } },
        orderBy: { createdAt: 'asc' },
        select: { type: true, quantity: true, reference: true, createdAt: true }
    });

    console.log(`\n=== TODAY's MOVEMENTS ===`);
    const refCounts = {};
    for (const m of todayMvmts) {
        const ref = m.reference || '-';
        refCounts[ref] = (refCounts[ref] || 0) + 1;
        console.log(`${m.createdAt.toISOString().slice(11,19)} | ${m.type.padEnd(25)} | ${m.quantity}g | ${ref.slice(0, 80)}`);
    }

    console.log(`\n=== DUPLICATE REFERENCES (potential double-consume) ===`);
    for (const [ref, count] of Object.entries(refCounts)) {
        if (count > 1) console.log(`  [${count}x] ${ref}`);
    }

    // COLOR check
    const color = await prisma.product.findFirst({
        where: { name: { contains: 'COLOR EN POLVO AMARILLO LIMON', mode: 'insensitive' } },
        select: { id: true, name: true, currentStock: true }
    });
    const colorMvmts = await prisma.stockMovement.findMany({
        where: { productId: color.id, createdAt: { gte: today } },
        orderBy: { createdAt: 'asc' },
        select: { type: true, quantity: true, reference: true, createdAt: true }
    });
    console.log(`\n=== COLOR MOVEMENTS TODAY ===`);
    console.log(`currentStock: ${color.currentStock}g`);
    for (const m of colorMvmts) {
        console.log(`${m.createdAt.toISOString().slice(11,19)} | ${m.type.padEnd(25)} | ${m.quantity}g | ${(m.reference || '-').slice(0, 80)}`);
    }
}
main().finally(() => prisma.$disconnect());
