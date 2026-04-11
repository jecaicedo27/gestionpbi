const { ProductionBatch, AssemblyNote, ProcessType } = require('./backend/src/models');
async function run() {
  const batch = await ProductionBatch.findOne({
    where: { batchNumber: 'COCO-260410-0843' },
    include: [{
      model: AssemblyNote,
      as: 'notes',
      include: [{ model: ProcessType, as: 'processType' }]
    }],
    order: [['notes', 'stageOrder', 'ASC']]
  });
  console.log(`BATCH: ${batch.batchNumber} ${batch.status} ${batch.stageOrder}`);
  console.log('NOTES:');
  batch.notes.forEach((n) => {
    console.log(`[${n.stageOrder}] ${n.processType?.code} ${n.status} ${n.stageName} ${n.productId} [${n.childBatchIds || ''}]`);
  });
}
run();
