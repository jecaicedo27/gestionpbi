const {PrismaClient}=require('@prisma/client');
const p=new PrismaClient();
async function main(){
  // Find formulas for SIROPE GENIALITY MANGO BICHE 1000 and 360
  const formulas = await p.formula.findMany({
    where:{ name:{ contains:'MANGO BICHE', mode:'insensitive' } },
    select:{
      id:true, name:true, targetQuantity:true, targetUnit:true,
      items:{ select:{ ingredientName:true, quantity:true, unit:true } }
    }
  });

  for(const f of formulas){
    console.log(`\n== ${f.name} | Target: ${f.targetQuantity} ${f.targetUnit} ==`);
    const sabItems = f.items.filter(i=>i.ingredientName.toLowerCase().includes('sabor'));
    if(sabItems.length===0) console.log('  (sin ingrediente saborizacion)');
    sabItems.forEach(i=>{
      const perUnit = f.targetQuantity ? (i.quantity/f.targetQuantity) : '?';
      console.log(`  ${i.ingredientName}: ${i.quantity} ${i.unit} → ${perUnit} ${i.unit}/frasco`);
    });
  }

  // Also check assemblyTemplate stages for MANGO BICHE
  const templates = await p.assemblyTemplate.findMany({
    where:{ name:{ contains:'MANGO BICHE', mode:'insensitive' } },
    select:{
      name:true, targetQuantity:true,
      stages:{
        where:{ processType:{ code:'SABORIZACION' } },
        select:{ stageName:true, inputs:{ select:{ ingredientName:true, quantity:true, unit:true } } }
      }
    }
  });
  console.log('\n== AssemblyTemplates MANGO BICHE ==');
  for(const t of templates){
    console.log(`\n${t.name} | Target: ${t.targetQuantity}`);
    for(const s of t.stages){
      console.log(`  Stage: ${s.stageName}`);
      s.inputs.forEach(i=>console.log(`    - ${i.ingredientName}: ${i.quantity} ${i.unit}`));
    }
  }
}
main().catch(console.error).finally(()=>p.$disconnect());
