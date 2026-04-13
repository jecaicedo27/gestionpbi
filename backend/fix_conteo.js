const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function fix() {
  const batch = await prisma.productionBatch.findFirst({
    where: { batchNumber: 'MANGO-BICHE-260410-0711' },
    include: { assemblyNotes: { where: { processType: { code: 'CONTEO' } } } }
  });

  const conteoNote = batch?.assemblyNotes[0];
  if (!conteoNote) { console.log('No CONTEO'); return; }

  const currentConteo = conteoNote.processParameters?.conteo;

  // Correct actuals based on empaque empaqueRef data (from Karen's reception confirmation)
  const corrected = {
    'LIQUIPOPS SABOR A MANGO BICHE X 3400 GR': { ...currentConteo['LIQUIPOPS SABOR A MANGO BICHE X 3400 GR'], actual: 22 },
    'LIQUIPOPS SABOR A MANGO BICHE X 1150 GR': { ...currentConteo['LIQUIPOPS SABOR A MANGO BICHE X 1150 GR'], actual: 62 },
    'LIQUIPOPS SABOR A MANGO BICHE X 350 GR':  { ...currentConteo['LIQUIPOPS SABOR A MANGO BICHE X 350 GR'],  actual: 81 },
  };

  await prisma.assemblyNote.update({
    where: { id: conteoNote.id },
    data: {
      processParameters: {
        ...conteoNote.processParameters,
        conteo: corrected,
        admin_conteo_correction: {
          correctedBy: 'ADMIN',
          correctedAt: new Date().toISOString(),
          reason: 'Operario JESUS CANCHILA completó CONTEO sin ingresar valores reales. Corregidos con datos de empaqueRef de KAREN RODRIGUEZ.'
        }
      }
    }
  });

  // Also update BatchOutputTargets to match
  for (const [name, data] of Object.entries(corrected)) {
    await prisma.batchOutputTarget.updateMany({
      where: { batchId: batch.id, productId: data.productId },
      data: { actualUnits: data.actual, plannedUnits: data.actual }
    });
    console.log(`✅ ${name}: actual → ${data.actual}`);
  }

  console.log('\n✅ CONTEO corregido con éxito');
}
fix().catch(console.error).finally(() => prisma.$disconnect());
