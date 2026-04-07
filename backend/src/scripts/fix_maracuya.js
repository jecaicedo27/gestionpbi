require('dotenv').config();
const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();
(async()=>{
  const prod=await p.product.findFirst({where:{sku:'PROCEGENIALITY06'},select:{id:true,name:true,currentStock:true}});
  const siigo=prod.currentStock||0;
  const lots=await p.materialLot.findMany({
    where:{productId:prod.id,currentQuantity:{gt:0}},orderBy:{receivedAt:'asc'},
    select:{id:true,lotNumber:true,currentQuantity:true,initialQuantity:true}
  });
  const appTotal=lots.reduce((s,l)=>s+l.currentQuantity,0);
  const diff=appTotal-siigo;
  console.log('App:',appTotal.toLocaleString(),'Siigo:',siigo.toLocaleString(),'Diff a consumir:',diff.toLocaleString());
  if(diff<=0){console.log('Sin exceso. Fin.');await p.$disconnect();return;}

  let remaining=Math.round(diff);
  for(const lot of lots){
    if(remaining<=0)break;
    const consume=Math.min(remaining,Math.floor(lot.currentQuantity));
    const newQty=lot.currentQuantity-consume;
    await p.materialLot.update({
      where:{id:lot.id},
      data:{currentQuantity:newQty,status:newQty<=0?'DEPLETED':newQty<lot.initialQuantity*0.1?'LOW_STOCK':'AVAILABLE'}
    });
    await p.lotConsumption.create({
      data:{
        materialLot:{connect:{id:lot.id}},
        quantityUsed:consume,
        observations:'Reconciliacion 24/3/2026: consumos no registrados por bug actualQuantity=null en notas EMPAQUE SIROPE MARACUYA 1000ml'
      }
    });
    console.log('Consumido',consume.toLocaleString(),'de',lot.lotNumber,'| Nuevo saldo:',newQty.toLocaleString());
    remaining-=consume;
  }
  console.log('Ajuste MARACUYA completado. Faltante restante:',remaining.toLocaleString());
  await p.$disconnect();
})().catch(e=>{console.error(e.message);p.$disconnect();});
