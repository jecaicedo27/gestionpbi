/**
 * createEscarchadoSiropeFormulas.js
 *
 * Crea las fórmulas de empaque para los dos siropes terminados Escarchado:
 *   - SIROPE GENIALITY ESCARCHADOR X 360 ML  (FORM-ESC-360)
 *   - SIROPE GENIALITY ESCARCHADOR X 1000 ML (FORM-ESC-1000)
 *
 * Patrón igual al de otros siropes Geniality terminados (FORM126, FORM125).
 * Ingredientes: tarro + tapa + foil + base escarchador + etiqueta
 *
 * Uso: node backend/src/scripts/createEscarchadoSiropeFormulas.js
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ── Productos terminados ────────────────────────────────────────────────────
const SIROPE_360_ID  = 'fc512899-ed81-4dd8-8e91-eae8d8798630'; // SIROPE GENIALITY ESCARCHADOR X 360 ML
const SIROPE_1000_ID = 'e190b466-de48-4f41-a90b-b0fb0f88f56b'; // SIROPE GENIALITY ESCARCHADOR X 1000 ML

// ── Ingredientes de empaque (IDs de la BD) ──────────────────────────────────
const ING = {
    // Comunes en 360ml (mismos tarros que otros 360ml Geniality)
    tarro360:    '5134516e-defd-4661-aeab-3496500a5a52', // TARRO GENIALITY 360 ML
    tapa360:     'd213a04e-2b58-49f8-b8a4-fd235bdf828b', // TAPA GENIALITY 360 ML
    foil360:     '4080be0a-3f48-4bdf-bbd6-9bcaccc5f3dd', // FOIL TARRO GENIALITY 360 ML
    etiqueta360: '0d386dd5-3ecf-4908-b2a9-637720369f18', // ETIQUETA GENIALITY ESCARCHADOR 360ML

    // Comunes en 1000ml (mismos que otros 1000ml Geniality)
    tarro1000:    '7c793fc6-6eda-479e-b440-44e9659a524f', // TARRO CORBATIN GENIALITY 1000 ML
    tapa1000:     '636213f7-6cb3-4fda-aef1-cffbff572d9c', // TAPA CORBATIN GENIALITY 1000 ML
    foil1000:     '6494b54f-ec73-41a5-8cb3-03e1f372922a', // FOIL TARRO 1000 ML
    etiqueta1000: '4f01b614-cc9b-4059-bb61-850bf197e295', // ETIQUETA GENIALITY ESCARCHADOR 1000ML

    // Base escarchador (producto intermedio — output del proceso de producción)
    base: '6c90814c-2b7e-4865-abc1-88721e22a1db', // BASE ESCARCHADOR
};

const ADMIN_ID = 'fdbf8d09-5770-44d2-99e4-5dd7c9dbb2ab';

// ── Definición de fórmulas ──────────────────────────────────────────────────
const FORMULAS = [
    {
        formulaCode: 'FORM-ESC-360',
        formulaName: 'Escarchado 360 ML',
        productId:   SIROPE_360_ID,
        baseUnit:    'units',
        baseQuantity: 1,
        description: 'Fórmula de empaque para SIROPE GENIALITY ESCARCHADOR X 360 ML. 1 unidad de producto terminado.',
        items: [
            { ingredientId: ING.tarro360,    quantity: 1,   unit: 'unidad',  ingredientType: 'PACKAGING' },
            { ingredientId: ING.tapa360,     quantity: 1,   unit: 'unidad',  ingredientType: 'PACKAGING' },
            { ingredientId: ING.foil360,     quantity: 1,   unit: 'unidad',  ingredientType: 'PACKAGING' },
            { ingredientId: ING.base,        quantity: 360, unit: 'gramo',   ingredientType: 'SEMI_FINISHED' },
            { ingredientId: ING.etiqueta360, quantity: 1,   unit: 'unidad',  ingredientType: 'PACKAGING' },
        ]
    },
    {
        formulaCode: 'FORM-ESC-1000',
        formulaName: 'Escarchado 1000 ML',
        productId:   SIROPE_1000_ID,
        baseUnit:    'units',
        baseQuantity: 1,
        description: 'Fórmula de empaque para SIROPE GENIALITY ESCARCHADOR X 1000 ML. 1 unidad de producto terminado.',
        items: [
            { ingredientId: ING.tarro1000,    quantity: 1,    unit: 'unidad', ingredientType: 'PACKAGING' },
            { ingredientId: ING.tapa1000,     quantity: 1,    unit: 'unidad', ingredientType: 'PACKAGING' },
            { ingredientId: ING.foil1000,     quantity: 1,    unit: 'unidad', ingredientType: 'PACKAGING' },
            { ingredientId: ING.base,         quantity: 1000, unit: 'gramo',  ingredientType: 'SEMI_FINISHED' },
            { ingredientId: ING.etiqueta1000, quantity: 1,    unit: 'unidad', ingredientType: 'PACKAGING' },
        ]
    }
];

async function createFormula(f) {
    // Verificar si ya existe
    const existing = await prisma.formula.findFirst({ where: { formulaCode: f.formulaCode } });
    if (existing) {
        console.log(`  ⏭️  SKIP ${f.formulaCode} — ya existe (id: ${existing.id})`);
        return existing;
    }

    // Versión
    const latest = await prisma.formula.findFirst({ where: { productId: f.productId }, orderBy: { version: 'desc' } });
    const version = latest ? latest.version + 1 : 1;

    const formula = await prisma.$transaction(async (tx) => {
        const newFormula = await tx.formula.create({
            data: {
                formulaCode:              f.formulaCode.toUpperCase(),
                formulaName:              f.formulaName,
                productId:                f.productId,
                version,
                baseUnit:                 f.baseUnit,
                baseQuantity:             f.baseQuantity || 1.0,
                expectedYieldPercentage:  100.0,
                description:              f.description,
                createdById:              ADMIN_ID,
                updatedById:              ADMIN_ID,
            }
        });

        let totalQty = f.items.reduce((a, i) => a + i.quantity, 0);

        for (let idx = 0; idx < f.items.length; idx++) {
            const item = f.items[idx];
            await tx.formulaItem.create({
                data: {
                    formulaId:      newFormula.id,
                    ingredientId:   item.ingredientId,
                    ingredientType: item.ingredientType || 'RAW_MATERIAL',
                    quantity:       item.quantity,
                    unit:           item.unit,
                    percentage:     totalQty > 0 ? (item.quantity / totalQty) * 100 : null,
                    additionOrder:  idx + 1,
                }
            });
        }

        return tx.formula.findUnique({
            where: { id: newFormula.id },
            include: { product: { select: { name: true } }, items: { include: { ingredient: { select: { name: true } } }, orderBy: { additionOrder: 'asc' } } }
        });
    });

    return formula;
}

async function main() {
    console.log('🏭 Creando fórmulas de empaque Escarchado...\n');

    for (const f of FORMULAS) {
        console.log(`📋 Procesando ${f.formulaCode}...`);
        const result = await createFormula(f);
        console.log(`  ✅ ${result.formulaCode} | ${result.product?.name}`);
        result.items?.forEach(i => console.log(`     - ${i.ingredient?.name} | ${i.quantity} ${i.unit}`));
        console.log();
    }

    console.log('✅ Fórmulas creadas. Recarga la página de Formulaciones Geniality.');
}

main()
    .catch(e => { console.error('❌ Error:', e.message); process.exit(1); })
    .finally(() => prisma.$disconnect());
