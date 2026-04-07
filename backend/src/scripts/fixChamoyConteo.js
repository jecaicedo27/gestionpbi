const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
    // Find the CONTEO note for CHAMOY-260326-0151
    const conteoNote = await p.assemblyNote.findFirst({
        where: {
            productionBatch: { batchNumber: 'CHAMOY-260326-0151' },
            processType: { code: 'CONTEO' },
            status: 'COMPLETED'
        },
        select: { id: true, processParameters: true }
    });

    if (!conteoNote) { console.log('CONTEO note not found'); return; }

    const pp = conteoNote.processParameters || {};
    const conteoMap = pp.conteo || {};

    console.log('CONTEO map keys:', Object.keys(conteoMap));
    console.log('CONTEO map:', JSON.stringify(conteoMap, null, 2));

    // Find the entry for CHAMOY 1150g (actual = 160)
    let updated = false;
    for (const [key, entry] of Object.entries(conteoMap)) {
        console.log(`  key: ${key} | actual: ${entry?.actual} | productName: ${entry?.productName}`);
        if (entry?.actual === 160 && (
            (entry?.productName || '').toUpperCase().includes('CHAMOY') ||
            (entry?.productName || '').toUpperCase().includes('1150')
        )) {
            conteoMap[key] = { ...entry, actual: 134 };
            updated = true;
            console.log(`✅ Updated key "${key}" actual: 160 → 134`);
        }
    }

    if (!updated) {
        console.log('⚠️  No matching 1150g CHAMOY entry found with actual=160. Check map above.');
        return;
    }

    await p.assemblyNote.update({
        where: { id: conteoNote.id },
        data: { processParameters: { ...pp, conteo: conteoMap } }
    });
    console.log('✅ CONTEO note updated → empaqueData.conteo_qty will now return 134');
}

main().catch(console.error).finally(() => p.$disconnect());
