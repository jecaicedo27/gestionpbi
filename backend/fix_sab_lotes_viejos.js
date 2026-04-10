const {PrismaClient}=require('@prisma/client');
const p=new PrismaClient();
async function main(){
  const BATCH='MANGO-BICHE-260406-1621';
  const OLD_LOTS = ['SABORIZACION-MANGO-BICHE-260324-2016', 'MANGO-BICHE-260330-1728'];

  // Get today's batch assembly note IDs (EMPAQUE only)
  const batch = await p.productionBatch.findFirst({where:{batchNumber:BATCH},select:{id:true}});
  const empaqueNotes = await p.assemblyNote.findMany({
    where:{ productionBatchId:batch.id, processType:{ code:'EMPAQUE' } },
    select:{id:true, stageName:true}
  });
  const noteIds = empaqueNotes.map(n=>n.id);
  console.log('Notas EMPAQUE del batch:', empaqueNotes.map(n=>n.stageName));

  // Find the erroneous LotConsumptions from old lots within today's EMPAQUE notes
  const oldLots = await p.materialLot.findMany({
    where:{ lotNumber:{ in: OLD_LOTS } },
    select:{ id:true, lotNumber:true, currentQuantity:true, siigoProductName:true }
  });

  for(const lot of oldLots){
    const lcs = await p.lotConsumption.findMany({
      where:{ materialLotId:lot.id, assemblyNoteId:{ in: noteIds } }
    });
    const totalWrong = lcs.reduce((s,c)=>s+c.quantityUsed,0);
    console.log(`\nLote viejo: ${lot.lotNumber}`);
    console.log(`  LotConsumptions erróneos en el batch de hoy: ${lcs.length} registros, total: ${totalWrong} g`);
    console.log(`  currentQuantity actual en DB: ${lot.currentQuantity} g`);
  }
  console.log('\n[DRY RUN - no changes made]');
}
main().catch(console.error).finally(()=>p.$disconnect());
