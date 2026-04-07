const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  // Get the G_ process type IDs
  const gPesaje = await p.processType.findUnique({ where: { code: 'G_PESAJE' } });
  const gConteo = await p.processType.findUnique({ where: { code: 'CONTEO' } }); // Keep CONTEO as-is (it's shared)

  if (!gPesaje) {
    console.log('ERROR: G_PESAJE process type not found!');
    return;
  }
  console.log('G_PESAJE id:', gPesaje.id);

  // Get the template
  const template = await p.assemblyTemplate.findFirst({
    where: { templateCode: 'BATCH-GENIALITY' },
    include: { stages: { orderBy: { stageOrder: 'asc' } } }
  });

  if (!template) {
    console.log('ERROR: BATCH-GENIALITY template not found!');
    return;
  }

  console.log('\nCurrent stages:');
  for (const s of template.stages) {
    console.log(`  Stage ${s.stageOrder}: ${s.stageName} (processTypeId: ${s.processTypeId})`);

    // Update stages that use PESAJE to use G_PESAJE instead
    if (s.processTypeId !== gPesaje.id && s.stageName !== 'Conteo de Producción por Referencia') {
      console.log(`    -> Updating to G_PESAJE (${gPesaje.id})`);
      await p.assemblyTemplateStage.update({
        where: { id: s.id },
        data: { processTypeId: gPesaje.id }
      });
    }
  }

  // Verify
  const updated = await p.assemblyTemplate.findFirst({
    where: { templateCode: 'BATCH-GENIALITY' },
    include: { stages: { include: { processType: true }, orderBy: { stageOrder: 'asc' } } }
  });
  console.log('\nUpdated stages:');
  for (const s of updated.stages) {
    console.log(`  Stage ${s.stageOrder}: ${s.stageName} -> ${s.processType.code} (${s.processType.name})`);
  }

  await p.$disconnect();
  console.log('\nDone!');
})();
