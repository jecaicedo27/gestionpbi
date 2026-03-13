const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
    // 1. Ensure EMPAQUE process type exists
    let empaquePt = await p.processType.findFirst({ where: { code: 'EMPAQUE' } });
    if (!empaquePt) {
        empaquePt = await p.processType.create({
            data: { code: 'EMPAQUE', name: 'Empaque y Control de Calidad', category: 'SPECIAL', icon: '📦', color: '#8B5CF6' }
        });
        console.log('✅ EMPAQUE ProcessType created:', empaquePt.id);
    } else {
        console.log('✅ EMPAQUE ProcessType exists:', empaquePt.id);
    }

    const template = await p.assemblyTemplate.findFirst({
        where: { name: { contains: 'MASTER-FRESA' } },
        select: { id: true, name: true }
    });
    console.log('Template:', template.name);

    const stages = await p.assemblyTemplateStage.findMany({
        where: { templateId: template.id },
        select: { id: true, stageOrder: true, stageName: true },
        orderBy: { stageOrder: 'asc' }
    });
    stages.forEach(s => console.log('  S' + s.stageOrder + ':', s.stageName));

    console.log('\nEMPAQUE PT id:', empaquePt.id);
    console.log('Template id:', template.id);
    await p.$disconnect();
}

main().catch(e => { console.error(e.message); return p.$disconnect(); });
