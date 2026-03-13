const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const prisma = new PrismaClient();

async function main() {
    // Restore Admin
    const adminEmail = 'admin@poppingbobainternational.com';
    const adminPass = 'admin123';
    const hashedAdminPass = await bcrypt.hash(adminPass, 10);

    const admin = await prisma.user.upsert({
        where: { email: adminEmail },
        update: {
            username: 'admin',
            password: hashedAdminPass,
            active: true,
            role: 'ADMIN',
            name: 'Administrador'
        },
        create: {
            email: adminEmail,
            username: 'admin',
            password: hashedAdminPass,
            active: true,
            role: 'ADMIN',
            name: 'Administrador'
        }
    });

    console.log('Admin user created/updated successfully:', admin.email);

    // Restore Esferas user as DISTRIBUIDOR
    const esferasEmail = 'esferas@poppingbobainternational.com';
    const esferasPass = 'esferas123';
    const hashedEsferasPass = await bcrypt.hash(esferasPass, 10);

    const esferas = await prisma.user.upsert({
        where: { email: esferasEmail },
        update: {
            username: 'esferas',
            password: hashedEsferasPass,
            active: true,
            role: 'DISTRIBUIDOR',
            name: 'Operario Esferas'
        },
        create: {
            email: esferasEmail,
            username: 'esferas',
            password: hashedEsferasPass,
            active: true,
            role: 'DISTRIBUIDOR',
            name: 'Operario Esferas'
        }
    });

    console.log('Esferas user (DISTRIBUIDOR) created/updated successfully:', esferas.email);
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
