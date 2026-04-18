const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const NOTE_ID = 'f3d1a0b0-7563-4a3e-a523-05ddea67d906';

prisma.assemblyNote.findUnique({
    where: { id: NOTE_ID },
    select: { processParameters: true }
}).then(async (n) => {
    const params = n.processParameters || {};
    const carriots = params.carriots || [];

    // Find max existing carritoNum
    const maxNum = carriots.reduce((m, c) => Math.max(m, c.carritoNum || 0), 0);
    console.log('Max carritoNum:', maxNum);

    // Fix all carriots with null/undefined carritoNum
    let next = maxNum + 1;
    const fixed = carriots.map((c) => {
        if (!c.carritoNum) {
            console.log('Fixing carrito', c.id, '-> carritoNum', next);
            const updated = Object.assign({}, c, { carritoNum: next });
            next++;
            return updated;
        }
        return c;
    });

    await prisma.assemblyNote.update({
        where: { id: NOTE_ID },
        data: { processParameters: Object.assign({}, params, { carriots: fixed }) }
    });

    console.log('Done. Carriots after fix:');
    fixed.forEach((c) => console.log(' #' + c.carritoNum, '-', c.qty, 'uds', c.id));
    await prisma.$disconnect();
});
