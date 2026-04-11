const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const rawNote = await prisma.$queryRaw`SELECT * FROM AssemblyNote WHERE id = '9bb6fbdd-a24a-4dcc-a2c3-705a2b20c445'`;
    if (!rawNote || rawNote.length === 0) return console.log('No Note');
    
    const batchId = rawNote[0].productionBatchId;
    console.log("Batch ID:", batchId);

    const related = await prisma.$queryRaw`SELECT id, stageName, status, processParameters, processTypeId FROM AssemblyNote WHERE productionBatchId = ${batchId}`;
    
    const procTypes = await prisma.$queryRaw`SELECT id, code FROM AssemblyProcessType`;
    const typeMap = {};
    for (const t of procTypes) typeMap[t.id] = t.code;

    for (const r of related) {
        console.log(`\nNote: ${r.id} | Code: ${typeMap[r.processTypeId]}`);
        let params = {};
        if (r.processParameters) {
            try { params = typeof r.processParameters === 'string' ? JSON.parse(r.processParameters) : r.processParameters; } catch(e) {}
        }
        if (params.carriots) {
            console.log(`Carriots count: ${params.carriots.length}`);
            if (params.carriots.length > 0) {
                 console.log(JSON.stringify(params.carriots, null, 2));
            }
        }
        if (params.conteo) {
            console.log(`Conteo map keys: ${Object.keys(params.conteo)}`);
            for (const key of Object.keys(params.conteo)) {
                console.log(`  - ${key}: productId = ${params.conteo[key].productId}`);
            }
        }
    }
}
main().finally(() => prisma.$disconnect());
