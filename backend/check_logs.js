const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const noteIds = ['c0120534-1e6d-46ec-b332-a9672f4db508'];
  const logs = await prisma.auditLog.findMany({
    where: { entityId: { in: noteIds } },
    include: { user: {select: {name: true}} },
    orderBy: { createdAt: 'desc' },
    take: 10
  });
  console.log(JSON.stringify(logs, null, 2));
}

check().finally(() => prisma.$disconnect());
