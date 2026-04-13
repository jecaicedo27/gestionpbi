const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function check() {
  const noteIds = ['c0120534-1e6d-46ec-b332-a9672f4db508'];
  const note = await prisma.assemblyNote.findUnique({
    where: { id: noteIds[0] },
    include: { items: true, executedBy: { select: { name: true } } }
  });
  console.log('Updated At:', note.updatedAt);
  console.log('Executed By:', note.executedBy ? note.executedBy.name : 'Unknown');
}
check().finally(() => prisma.$disconnect());
