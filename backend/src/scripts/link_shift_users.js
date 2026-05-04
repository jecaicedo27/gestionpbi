/**
 * link_shift_users.js — Link ShiftEmployee records to ERP User accounts.
 * Run: node src/scripts/link_shift_users.js
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    console.log('🔗 Linking ShiftEmployees to ERP Users...\n');

    // Mapping: ShiftEmployee name → User email
    const links = [
        { shiftName: 'Gabriel Andrés',     userEmail: 'gabriel@pbi.com' },
        { shiftName: 'Alberto Gabiria',    userEmail: 'alberto@pbi.com' },
        { shiftName: 'Dubier Narváez',     userEmail: 'dubiern@pbi.com' },
        { shiftName: 'Yonathan Ontiveros', userEmail: 'jontiveros@pbi.com' },
        { shiftName: 'Claudia Burgos',     userEmail: 'claudiab@pbi.com' },
        { shiftName: 'Luis Fernando',      userEmail: 'luism@pbi.com' },
        { shiftName: 'Jesús Canchila',     userEmail: 'jesus@pbi.com' },
        { shiftName: 'Kelvin Hoyos',       userEmail: 'kelvin@pbi.com' },
        { shiftName: 'Drilly Ramírez',     userEmail: 'drillym@pbi.com' },
        { shiftName: 'Andrés Melgizo',     userEmail: 'andresm@pbi.com' },
        { shiftName: 'Juan Carlos Muñoz',  userEmail: 'juanm@pbi.com' },
        { shiftName: 'David Vergara',      userEmail: 'davidv@pbi.com' },
        { shiftName: 'Karen Dahiana',      userEmail: 'karen@pbi.com' },
        { shiftName: 'Ximena Benavides',   userEmail: 'ximena@pbi.com' },
        { shiftName: 'Hugo Armando',       userEmail: 'hugo@pbi.com' },
        { shiftName: 'Ledy',               userEmail: 'leddyh@pbi.com' },
    ];

    for (const link of links) {
        const emp = await prisma.shiftEmployee.findFirst({ where: { name: link.shiftName } });
        const user = await prisma.user.findUnique({ where: { email: link.userEmail } });

        if (!emp) { console.log(`  ❌ ShiftEmployee not found: ${link.shiftName}`); continue; }
        if (!user) { console.log(`  ❌ User not found: ${link.userEmail}`); continue; }

        await prisma.shiftEmployee.update({
            where: { id: emp.id },
            data: { userId: user.id }
        });
        console.log(`  ✅ ${link.shiftName} → ${user.name} (${user.email})`);
    }

    console.log('\n✅ Linking complete!');
    await prisma.$disconnect();
}

main().catch(e => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
});
