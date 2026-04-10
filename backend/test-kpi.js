const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function test() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const karen = await prisma.user.findFirst({ where: { name: { contains: 'KAREN' } } });
    console.log("Karen ID:", karen?.id, "Role:", karen?.role);

    if (karen) {
        const completedNotes = await prisma.assemblyNote.findMany({
            where: { completedById: karen.id },
            orderBy: { completedAt: 'desc' },
            take: 5
        });
        console.log("Recently completed notes by Karen:", completedNotes.map(n => ({ id: n.id, updatedAt: n.updatedAt, completedAt: n.completedAt, status: n.status })));
        
        const pendingNotes = await prisma.assemblyNote.count({
            where: { executedById: karen.id, status: { in: ['PENDING', 'IN_PROGRESS'] } }
        });
        console.log("Pending notes assigned to Karen locally:", pendingNotes);
        
        const generalPendingNotes = await prisma.assemblyNote.count({
            where: { status: { in: ['PENDING', 'IN_PROGRESS'] } },
            include: { processType: true }
        });
        
        // Count total pending notes of empathetic processes
        const processTypes = await prisma.generalProcess.findMany({ where: { code: { in: ['EMPAQUE', 'ENSAMBLE', 'PESAJE'] } } });
        const processTypeIds = processTypes.map(p => p.id);
        
        const pendingEmpaque = await prisma.assemblyNote.count({
            where: { processTypeId: { in: processTypeIds }, status: { in: ['PENDING', 'IN_PROGRESS'] } }
        });
        
        console.log("Pending notes across process EMPAQUE/ENSAMBLE:", pendingEmpaque);
    }
}
test().catch(console.error).finally(() => prisma.$disconnect());
