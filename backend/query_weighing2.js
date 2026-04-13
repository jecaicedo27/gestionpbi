const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    const notes = await prisma.assemblyNote.findMany({
        where: { 
            processParameters: { not: null } 
        },
        include: { items: true }
    });
    let c = 0;
    for(const n of notes) {
        if(n.processParameters?.weighing_photos || n.processParameters?.weighing_data) {
            console.log("Note ID:", n.id, "Process:", n.processTypeId);
            console.log("weighing_photos:", n.processParameters.weighing_photos);
            console.log("weighing_data:", n.processParameters.weighing_data);
            console.log("Items:");
            n.items.forEach(i => console.log(`  ${i.id} -> compId: ${i.componentId} (${i.role})`));
            console.log("---");
            c++;
            if (c >= 5) break;
        }
    }
}
run();
