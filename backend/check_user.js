const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.user.findUnique({where: {id: '09f25ad7-c65f-4a66-b2fc-f983954db097'}}).then(console.log).finally(()=>prisma.$disconnect());
