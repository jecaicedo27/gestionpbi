const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
require('dotenv').config();

const prisma = new PrismaClient();

async function main() {
    const email = process.env.ADMIN_USER_EMAIL || 'admin@poppingbobainternational.com';
    const password = process.env.ADMIN_USER_PASS || 'admin123';
    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.upsert({
        where: { email },
        update: {},
        create: {
            email,
            username: 'admin',
            name: 'Administrador',
            password: hashedPassword,
            role: 'ADMIN',
            active: true,
        },
    });

    console.log('Admin user created/verified:', user.email);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
