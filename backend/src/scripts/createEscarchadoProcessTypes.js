/**
 * createEscarchadoProcessTypes.js
 * 
 * Crea los ProcessTypes exclusivos del flujo Escarchado Geniality:
 *   GE_PREMIX        → Preparación del premix seco
 *   GE_BASE_LIQUIDA  → Base líquida + incorporación (20 min agitación)
 *   GE_COCCION       → Cocción (65°C) y enfriamiento (45°C → 40°C)
 *
 * Los stages G_EMPAQUE y G_ENSAMBLE se REUSAN — no se crean nuevos.
 * 
 * Uso: node backend/src/scripts/createEscarchadoProcessTypes.js
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const ESCARCHADO_PROCESS_TYPES = [
    {
        code: 'GE_PREMIX',
        name: '(GE) Premix Seco',
        category: 'PREPARACION',
        icon: '🧂',
        color: '#d97706',
    },
    {
        code: 'GE_BASE_LIQUIDA',
        name: '(GE) Base Líquida + Incorporación',
        category: 'PREPARACION',
        icon: '💧',
        color: '#0891b2',
    },
    {
        code: 'GE_COCCION',
        name: '(GE) Cocción y Enfriamiento',
        category: 'COCCION',
        icon: '🌡️',
        color: '#dc2626',
    },
];

async function main() {
    console.log('🏭 Creando ProcessTypes para flujo Escarchado...\n');

    let created = 0;
    let skipped = 0;

    for (const pt of ESCARCHADO_PROCESS_TYPES) {
        const existing = await prisma.processType.findUnique({ where: { code: pt.code } });
        if (existing) {
            console.log(`  ⏭️  SKIP  ${pt.code} — ya existe`);
            skipped++;
            continue;
        }

        await prisma.processType.create({ data: pt });
        console.log(`  ✅  CREATED  ${pt.code} — ${pt.name}`);
        created++;
    }

    console.log(`\n📊 Resultado: ${created} creados, ${skipped} omitidos.`);

    // Verify
    const all = await prisma.processType.findMany({
        where: { code: { startsWith: 'GE_' } },
        select: { code: true, name: true },
        orderBy: { code: 'asc' }
    });
    console.log('\n🔍 ProcessTypes GE_* en BD:');
    all.forEach(pt => console.log(`   ${pt.code}: ${pt.name}`));
}

main()
    .catch(e => { console.error('❌ Error:', e); process.exit(1); })
    .finally(() => prisma.$disconnect());
