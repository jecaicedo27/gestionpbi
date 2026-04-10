const {PrismaClient}=require('@prisma/client');
const p=new PrismaClient();
async function main(){
  // Get formulas for SIROPE GENIALITY MANGO BICHE products
  const formulas = await p.formula.findMany({
    where:{
      product:{ name:{ contains:'SIROPE GENIALITY', mode:'insensitive' } },
      isActive: true
    },
    select:{
      formulaName:true,
      baseQuantity:true,
      baseUnit:true,
      product:{ select:{ name:true } },
      items:{
        select:{
          quantity:true, unit:true,
          ingredient:{ select:{ name:true } }
        }
      }
    }
  });

  for(const f of formulas){
    const prodName = f.product?.name || f.formulaName;
    console.log(`\n== ${prodName} | Base: ${f.baseQuantity} ${f.baseUnit} ==`);
    const sabItems = f.items.filter(i=>i.ingredient?.name?.toLowerCase().includes('saborizac'));
    if(sabItems.length===0){
      console.log('  (sin SABORIZACION directa, buscando todos...)')
      f.items.forEach(i=>console.log(`    ${i.ingredient?.name}: ${i.quantity} ${i.unit}`));
    } else {
      sabItems.forEach(i=>{
        console.log(`  SABORIZACION: ${i.quantity} ${i.unit} para ${f.baseQuantity} ${f.baseUnit}`);
        if(f.baseQuantity) console.log(`  → ${(i.quantity/f.baseQuantity).toFixed(0)} ${i.unit} por unidad`);
      });
    }
  }
}
main().catch(console.error).finally(()=>p.$disconnect());
