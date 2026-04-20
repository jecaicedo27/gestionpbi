const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  const cn = await p.assemblyNote.findUnique({ 
    where: { id: 'a1f583ea-fd02-4ac3-bf9e-86533028d53a' } 
  });
  console.log(cn.status);
  process.exit(0);
})();
