const {PrismaClient}=require('@prisma/client');
const p=new PrismaClient();
async function main(){
  const models=Object.keys(p).filter(k=>!k.startsWith('_')&&!k.startsWith('$'));
  const gen=models.filter(m=>m.toLowerCase().includes('geniality')||m.toLowerCase().includes('formula')||m.toLowerCase().includes('template')||m.toLowerCase().includes('process'));
  console.log('Modelos relevantes:', gen);
}
main().catch(console.error).finally(()=>p.$disconnect());
