const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  const tmpl = await p.assemblyTemplate.findFirst({
    where: { templateCode: 'TMPL064' },
    include: {
      stages: {
        include: {
          inputs: { include: { product: { select: { id: true, name: true } } } },
          processType: true
        },
        orderBy: { stageOrder: 'asc' }
      }
    }
  });
  const pesaje = tmpl.stages.find(s => s.processType?.code === 'PESAJE');
  console.log('Stage ID:', pesaje.id);
  console.log('Current inputs:', pesaje.inputs.length);
  pesaje.inputs.forEach(i => console.log('  ' + i.product?.name + ' qpu=' + i.quantityPerUnit + ' order=' + i.displayOrder));

  const azucar = await p.product.findFirst({ where: { name: { equals: 'AZUCAR', mode: 'insensitive' } }, select: { id: true, name: true } });
  const anti = await p.product.findFirst({ where: { name: { contains: 'ANTIESPUMANTE TECNAS', mode: 'insensitive' } }, select: { id: true, name: true } });
  console.log('\nAZUCAR:', azucar?.id, azucar?.name);
  console.log('ANTIESPUMANTE:', anti?.id, anti?.name);

  const maxOrder = Math.max(...pesaje.inputs.map(i => i.displayOrder || 0));

  const hasAzucar5k = pesaje.inputs.find(i => i.product?.name === 'AZUCAR' && Math.abs(i.quantityPerUnit - 5000) < 1);
  const hasAnti = pesaje.inputs.find(i => i.product?.name?.includes('ANTIESPUMANTE'));
  console.log('Has AZUCAR 5000?', !!hasAzucar5k, 'Has ANTIESPUMANTE?', !!hasAnti);

  if (!hasAzucar5k && azucar) {
    await p.templateStageInput.create({
      data: {
        stageId: pesaje.id,
        productId: azucar.id,
        inputType: 'RAW_MATERIAL',
        quantityPerUnit: 5000,
        unit: 'gramo',
        aggregateOnRepeat: true,
        displayOrder: maxOrder + 1
      }
    });
    console.log('Added AZUCAR 5000g');
  }

  if (!hasAnti && anti) {
    await p.templateStageInput.create({
      data: {
        stageId: pesaje.id,
        productId: anti.id,
        inputType: 'RAW_MATERIAL',
        quantityPerUnit: 14,
        unit: 'gramo',
        aggregateOnRepeat: true,
        displayOrder: maxOrder + 2
      }
    });
    console.log('Added ANTIESPUMANTE TECNAS 14g');
  }

  // Verify
  const updated = await p.assemblyTemplate.findFirst({
    where: { templateCode: 'TMPL064' },
    include: {
      stages: {
        include: {
          inputs: { include: { product: { select: { name: true } } } },
          processType: true
        },
        orderBy: { stageOrder: 'asc' }
      }
    }
  });
  const pesaje2 = updated.stages.find(s => s.processType?.code === 'PESAJE');
  console.log('\nUpdated inputs:', pesaje2.inputs.length);
  let total = 0;
  pesaje2.inputs.forEach(i => { total += i.quantityPerUnit; console.log('  ' + i.product?.name + ' = ' + i.quantityPerUnit + 'g'); });
  console.log('Total x1 =', total, 'g → x7 =', total * 7, 'g');
  await p.$disconnect();
})();
