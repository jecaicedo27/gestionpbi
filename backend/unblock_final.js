const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
    const today = new Date();
    const colombiaMs = today.getTime() + (-5 * 60 * 60 * 1000) - (today.getTimezoneOffset() * 60 * 1000);
    const splitDate = new Date(colombiaMs).toISOString().split('T')[0] + 'T00:00:00.000Z';
    const cleanDate = new Date(splitDate);

    const targetWeekId = 'b9e1a898-1535-447f-83f8-5fe550286f00'; // Target exact correct week

    // Users to bypass
    const userIds = [
        'b89fc7ce-56d3-4900-acfb-55b3e40013bd', // David
        'fd8e636b-add8-48b9-97f6-7ceecc2e6c4c', // Dubier
        '5e5d2df1-533c-4945-8fc2-59171d85bc16'  // Gabriel
    ];

    let created = 0;
    for (const uid of userIds) {
        const existing = await prisma.shiftHandoff.findFirst({
            where: {
                weekId: targetWeekId,
                date: cleanDate,
                outgoingShift: 'MANANA',
                deliveredById: uid
            }
        });
        
        if (!existing) {
             await prisma.shiftHandoff.create({
                data: {
                    weekId: targetWeekId,
                    date: cleanDate,
                    area: 'PRODUCCION',
                    outgoingShift: 'MANANA',
                    deliveredById: uid,
                    deliveredAt: new Date(),
                    status: 'APPROVED',
                    checklist: [{ label: 'Bypass del sistema', value: true, type: 'boolean' }],
                    notes: 'Bypass manual para desbloquear.'
                }
            });
            created++;
        } else {
             // force update to APPROVED
             await prisma.shiftHandoff.update({
                 where: { id: existing.id },
                 data: { status: 'APPROVED' }
             });
        }
    }
    console.log("Successfully fixed " + created + " handoffs in week " + targetWeekId);
}
main().finally(() => prisma.$disconnect());
