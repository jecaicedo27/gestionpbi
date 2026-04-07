require('dotenv').config();
const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();
(async()=>{
  const prod=await p.product.findFirst({where:{sku:'PROCEGENIALITY06'},select:{id:true,name:true,currentStock:true}});
  console.log('Producto:',prod.name,'| Siigo:',prod.currentStock);

  const lots=await p.materialLot.findMany({where:{productId:prod.id},orderBy:{receivedAt:'desc'},
    select:{id:true,lotNumber:true,zone:true,initialQuantity:true,currentQuantity:true,receivedAt:true,status:true}});
  console.log('\nTodos los MaterialLots ('+lots.length+'):');
  for(const l of lots) {
    const con=await p.lotConsumption.aggregate({_sum:{quantityUsed:true},_count:true,where:{materialLotId:l.id}});
    const consumedTotal=con._sum.quantityUsed||0;
    const expected=l.initialQuantity-consumedTotal;
    console.log(' ['+l.status+'] '+l.lotNumber+' ['+l.zone+'] ini='+l.initialQuantity.toLocaleString()+' act='+l.currentQuantity.toLocaleString()+' consumido='+consumedTotal.toLocaleString()+' (esperado_act='+expected.toLocaleString()+')');
  }

  console.log('\nNotas que usan MARACUYA:');
  const noteItems=await p.assemblyNoteItem.findMany({
    where:{componentId:prod.id},
    include:{assemblyNote:{select:{id:true,status:true,stageName:true,completedAt:true,productionBatch:{select:{batchNumber:true}}}}}
  });
  for(const ni of noteItems.filter(n=>n.assemblyNote?.status==='COMPLETED').slice(0,10)){
    const batch=ni.assemblyNote?.productionBatch?.batchNumber||'?';
    const stage=ni.assemblyNote?.stageName||'?';
    const date=ni.assemblyNote?.completedAt?new Date(ni.assemblyNote.completedAt).toLocaleDateString('es-CO'):'?';
    console.log(' Batch:'+batch+' | '+stage+' | planned='+ni.plannedQuantity+' actual='+ni.actualQuantity+' | '+date);
  }

  await p.$disconnect();
})().catch(e=>{console.error(e.message);p.$disconnect();});
