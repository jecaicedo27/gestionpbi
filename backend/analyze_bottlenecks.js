const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    console.log('--- Analizando Cuellos de Botella en Producción ---');

    // Fetch last 100 completed batches to get recent relevant data
    const batches = await prisma.productionBatch.findMany({
        where: {
            status: 'COMPLETED'
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: {
            assemblyNotes: {
                orderBy: { stageOrder: 'asc' },
                include: {
                    processType: true
                }
            }
        }
    });

    console.log(`Analizando ${batches.length} lotes de producción completados recientemente...\n`);

    const stageDurations = {};
    const transitionTimes = {};

    let totalBatchesValids = 0;

    for (const batch of batches) {
        if (!batch.assemblyNotes || batch.assemblyNotes.length < 2) continue;

        let isValid = true;
        for (const note of batch.assemblyNotes) {
            if (!note.startedAt || !note.completedAt || note.status !== 'COMPLETED') {
                isValid = false;
                break;
            }
        }

        if (!isValid) continue;
        totalBatchesValids++;

        // Calculate durations
        for (let i = 0; i < batch.assemblyNotes.length; i++) {
            const note = batch.assemblyNotes[i];
            const pCode = note.processType ? note.processType.code : 'UNKNOWN';
            const durationMs = note.completedAt.getTime() - note.startedAt.getTime();

            if (!stageDurations[pCode]) {
                stageDurations[pCode] = { totalMs: 0, count: 0 };
            }
            stageDurations[pCode].totalMs += durationMs;
            stageDurations[pCode].count++;

            // Calculate transition times
            if (i < batch.assemblyNotes.length - 1) {
                const nextNote = batch.assemblyNotes[i + 1];
                const nextCode = nextNote.processType ? nextNote.processType.code : 'UNKNOWN';
                const transitionKey = `${pCode} -> ${nextCode}`;
                const idleMs = nextNote.startedAt.getTime() - note.completedAt.getTime();

                // Some idle times might be negative if they started out of order, ignore those
                if (idleMs >= 0) {
                    if (!transitionTimes[transitionKey]) {
                        transitionTimes[transitionKey] = { totalMs: 0, count: 0 };
                    }
                    transitionTimes[transitionKey].totalMs += idleMs;
                    transitionTimes[transitionKey].count++;
                }
            }
        }
    }

    console.log(`Lotes válidos con tiempos completos: ${totalBatchesValids}\n`);

    const fmtTime = (ms) => {
        const totalMin = Math.round(ms / 60000);
        const hrs = Math.floor(totalMin / 60);
        const mins = totalMin % 60;
        if (hrs > 0) return `${hrs}h ${mins}m`;
        return `${mins}m`;
    };

    console.log('--- DURACIÓN PROMEDIO POR ETAPA (Tiempo Activo) ---');
    const sortedDurations = Object.entries(stageDurations).map(([code, data]) => {
        return { code, avgMs: data.totalMs / data.count, count: data.count };
    }).sort((a, b) => b.avgMs - a.avgMs);

    for (const d of sortedDurations) {
        console.log(`${d.code.padEnd(20)} : ${fmtTime(d.avgMs).padStart(10)} (Basado en ${d.count} registros)`);
    }

    console.log('\n--- TIEMPO MUERTO PROMEDIO ENTRE ETAPAS (Tiempos de Espera) ---');
    const sortedTransitions = Object.entries(transitionTimes).map(([key, data]) => {
        return { key, avgMs: data.totalMs / data.count, count: data.count };
    }).sort((a, b) => b.avgMs - a.avgMs);

    for (const t of sortedTransitions) {
        console.log(`${t.key.padEnd(25)} : ${fmtTime(t.avgMs).padStart(10)} (Basado en ${t.count} transiciones)`);
    }

    // Identificar cuellos de botella claros
    console.log('\n--- CONCLUSIONES PRELIMINARES ---');
    if (sortedDurations.length > 0) {
        console.log(`🚨 Peor etapa (más activa): ${sortedDurations[0].code} toma en promedio ${fmtTime(sortedDurations[0].avgMs)}.`);
    }
    if (sortedTransitions.length > 0) {
        console.log(`🐢 Peor transición (más espera): ${sortedTransitions[0].key} tiene un tiempo muerto promedio de ${fmtTime(sortedTransitions[0].avgMs)}.`);
    }

}

run().catch(console.error).finally(() => prisma.$disconnect());
