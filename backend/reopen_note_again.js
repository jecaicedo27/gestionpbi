const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  await p.assemblyNote.update({
    where: { id: 'a1f583ea-fd02-4ac3-bf9e-86533028d53a' },
    data: { status: 'EXECUTING', completedAt: null }
  });
  console.log("Note reopened again!");
  process.exit(0);
})();
