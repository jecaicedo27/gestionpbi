/**
 * seed_shifts.js — Seed the shift scheduling module with initial employees
 * and the current week's schedule (April 6-11, 2026).
 *
 * Run: node src/scripts/seed_shifts.js
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    console.log('🔧 Seeding shift employees...');

    // ── Employees ────────────────────────────────────────────────
    const employees = [
        // Producción — Grupo 1 (esta semana: MAÑANA)
        { name: 'Gabriel Andrés',     area: 'PRODUCCION', role: 'LIDER',    groupNumber: 1 },
        { name: 'Alberto Gabiria',    area: 'PRODUCCION', role: 'OPERARIO', groupNumber: 1 },
        { name: 'Dubier Narváez',     area: 'PRODUCCION', role: 'OPERARIO', groupNumber: 1 },
        // Producción — Grupo 2 (esta semana: TARDE)
        { name: 'Yonathan Ontiveros', area: 'PRODUCCION', role: 'LIDER',    groupNumber: 2 },
        { name: 'Claudia Burgos',     area: 'PRODUCCION', role: 'OPERARIO', groupNumber: 2 },
        { name: 'Luis Fernando',      area: 'PRODUCCION', role: 'OPERARIO', groupNumber: 2 },
        // Producción — Grupo 3 (esta semana: NOCHE)
        { name: 'Jesús Canchila',     area: 'PRODUCCION', role: 'LIDER',    groupNumber: 3 },
        { name: 'Kelvin Hoyos',       area: 'PRODUCCION', role: 'OPERARIO', groupNumber: 3, restrictions: ['MANANA', 'NOCHE'] },
        { name: 'Drilly Ramírez',     area: 'PRODUCCION', role: 'OPERARIO', groupNumber: 3 },
        // Siropes
        { name: 'Juan Carlos Muñoz',  area: 'SIROPES',   role: 'OPERARIO', groupNumber: 1 },
        { name: 'Andrés Melgizo',     area: 'SIROPES',   role: 'OPERARIO', groupNumber: 2 },
        // Empaque
        { name: 'David Vergara',      area: 'EMPAQUE',   role: 'OPERARIO', groupNumber: 1 },
        { name: 'Karen Dahiana',      area: 'EMPAQUE',   role: 'OPERARIO', groupNumber: 2 },
        { name: 'Ximena Benavides',   area: 'EMPAQUE',   role: 'OPERARIO', groupNumber: 3 },
        // Fijos
        { name: 'Hugo Armando',       area: 'LOGISTICA', role: 'OPERARIO', isFixed: true },
        { name: 'Ledy',               area: 'ASEO',      role: 'OPERARIO', isFixed: true },
    ];

    const createdEmployees = {};
    for (const emp of employees) {
        const existing = await prisma.shiftEmployee.findFirst({ where: { name: emp.name } });
        if (existing) {
            console.log(`  ⏭️  ${emp.name} already exists`);
            createdEmployees[emp.name] = existing;
        } else {
            const created = await prisma.shiftEmployee.create({
                data: {
                    name: emp.name,
                    area: emp.area,
                    role: emp.role || 'OPERARIO',
                    groupNumber: emp.groupNumber || null,
                    isFixed: emp.isFixed || false,
                    restrictions: emp.restrictions || [],
                }
            });
            console.log(`  ✅ Created: ${created.name} (${created.area})`);
            createdEmployees[emp.name] = created;
        }
    }

    // ── This week's schedule (April 6-11, 2026) ─────────────────
    const weekStart = new Date('2026-04-06T00:00:00');
    const weekEnd = new Date('2026-04-12T23:59:59');

    console.log('\n📅 Creating schedule for week April 6-11, 2026...');

    const week = await prisma.shiftWeek.upsert({
        where: { weekStart },
        create: {
            weekStart,
            weekEnd,
            status: 'PUBLISHED',
            publishedAt: new Date(),
            note: 'En el turno de la noche empieza el domingo, 10 PM y termina viernes amaneciendo sábado 6 AM'
        },
        update: {}
    });

    // Delete old assignments for this week
    await prisma.shiftAssignment.deleteMany({ where: { weekId: week.id } });

    const assignments = [
        // Producción
        { name: 'Gabriel Andrés',     area: 'PRODUCCION', shift: 'MANANA' },
        { name: 'Alberto Gabiria',    area: 'PRODUCCION', shift: 'MANANA' },
        { name: 'Dubier Narváez',     area: 'PRODUCCION', shift: 'MANANA' },
        { name: 'Yonathan Ontiveros', area: 'PRODUCCION', shift: 'TARDE' },
        { name: 'Claudia Burgos',     area: 'PRODUCCION', shift: 'TARDE' },
        { name: 'Luis Fernando',      area: 'PRODUCCION', shift: 'TARDE' },
        { name: 'Jesús Canchila',     area: 'PRODUCCION', shift: 'NOCHE' },
        { name: 'Kelvin Hoyos',       area: 'PRODUCCION', shift: 'NOCHE' },
        { name: 'Drilly Ramírez',     area: 'PRODUCCION', shift: 'NOCHE' },
        // Siropes
        { name: 'Juan Carlos Muñoz',  area: 'SIROPES', shift: 'TARDE' },
        { name: 'Andrés Melgizo',     area: 'SIROPES', shift: 'MANANA' },
        // Empaque
        { name: 'David Vergara',      area: 'EMPAQUE', shift: 'MANANA' },
        { name: 'Karen Dahiana',      area: 'EMPAQUE', shift: 'TARDE' },
        { name: 'Ximena Benavides',   area: 'EMPAQUE', shift: 'NOCHE' },
        // Fijos
        { name: 'Hugo Armando',       area: 'LOGISTICA', shift: 'DIURNO' },
        { name: 'Ledy',               area: 'ASEO',      shift: 'DIURNO' },
    ];

    for (const a of assignments) {
        const emp = createdEmployees[a.name];
        if (!emp) { console.log(`  ❌ Employee not found: ${a.name}`); continue; }
        await prisma.shiftAssignment.create({
            data: {
                weekId: week.id,
                employeeId: emp.id,
                area: a.area,
                shift: a.shift,
            }
        });
        console.log(`  📋 ${a.name} → ${a.area} ${a.shift}`);
    }

    console.log('\n✅ Seed complete!');
    await prisma.$disconnect();
}

main().catch(e => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
});
