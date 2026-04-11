const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    const ticketNumbers = ['PQR-PBI-326', 'PQR-PBI-321', 'PQR-PBI-296', 'PQR-PBI-250'];
    
    const pqrs = await prisma.pQR.findMany({
        where: { ticketNumber: { in: ticketNumbers } }
    });
    
    console.log("Current State:");
    console.log(pqrs.map(p => ({ ticket: p.ticketNumber, status: p.status, stage: p.stage })));
    
    const res = await prisma.pQR.updateMany({
        where: { ticketNumber: { in: ticketNumbers } },
        data: {
            status: 'IN_REVIEW',
            stage: 'PENDING_BILLING',
            creditNoteUrl: null,
            accountStatementUrl: null,
            invoiceUrl: null,
            dispatchEvidenceUrl: null,
            pendingAdjustment: false,
            adjustmentDoneAt: null,
            resolvedAt: null
        }
    });
    
    console.log("Updated count:", res.count);
}

run().catch(console.error).finally(() => prisma.$disconnect());
