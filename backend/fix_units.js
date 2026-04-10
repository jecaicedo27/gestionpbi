const {PrismaClient}=require('@prisma/client');
const p=new PrismaClient();
async function main(){
  // 1. Fix EMP virtual lots
  const r1 = await p.materialLot.updateMany({
    where:{ lotNumber:{ startsWith:'EMP-MANGO-BICHE' } },
    data:{ unit:'unidad' }
  });
  console.log('EMP lots → unidad:', r1.count);

  // 2. Fix real packaging lots for this batch (tarros, tapas, foil, etiquetas)
  const packagingLotIds = [
    '3227d8c3-11d7-48ba-9217-c0123a8e14c8', // TARRO CORBATIN 1000ML lot 27022026-1
    '980722e2-d132-42ae-9b45-8ac313bcbf2e', // TAPA CORBATIN 1000ML lot 140326
    '0511395360-lot-id', // placeholder
  ];

  // Find all lots used in the EMPAQUE 1000ml and 360ml notes
  const lcs = await p.lotConsumption.findMany({
    where:{ assemblyNote:{ productionBatch:{ batchNumber:'MANGO-BICHE-260406-1621' }, processType:{ code:'EMPAQUE' } } },
    include:{ materialLot:{ include:{ product:{ select:{name:true,unit:true} } } } }
  });
  for(const lc of lcs){
    const lot = lc.materialLot;
    if(!lot) continue;
    const name = lot.product?.name || '';
    const isPackaging = /(TARRO|TAPA|FOIL|ETIQUETA|CAJA|SELLO|LINER)/i.test(name);
    if(!isPackaging) continue;
    const correctUnit = lot.product?.unit || 'unidad';
    if(lot.unit !== correctUnit){
      await p.materialLot.update({ where:{id:lot.id}, data:{unit:correctUnit} });
      console.log('✅', name, ':', lot.unit, '→', correctUnit, '| lot:', lot.lotNumber);
    } else {
      console.log('OK', name, ':', lot.unit);
    }
  }
}
main().catch(console.error).finally(()=>p.$disconnect());
