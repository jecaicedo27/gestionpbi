const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const ex = await prisma.rpaExecution.findMany({
    where: { 
      observations: { contains: 'CEREZA-260407-0953' }
    }
  });
  ex.forEach(e => {
    console.log(`ID: ${e.id}, Qty: ${e.quantity}, NoteCode: ${e.siigoNoteCode}, AssNoteId: ${e.assemblyNoteId}, Obs: ${e.observations}, Type: ${e.executionType}`);
  });
}
main().catch(e => console.error(e)).finally(() => prisma.$disconnect());
