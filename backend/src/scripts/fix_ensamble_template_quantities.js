/**
 * Fix COMPUESTO ENSAMBLE template stage inputs
 * 
 * Problem: ENSAMBLE stages for all COMPUESTO templates store per-gram ratios
 * instead of absolute formula quantities.
 * 
 * Fix: Update quantityPerUnit in ENSAMBLE stage inputs to match formula quantities.
 * Also fix the EXECUTING note 1c776b6c's items.
 * 
 * Usage:
 *   DRY RUN:  node /tmp/fix_ensamble_template_quantities.js
 *   WRITE:    node /tmp/fix_ensamble_template_quantities.js --write
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const WRITE = process.argv.includes('--write');
const EXECUTING_NOTE_ID = '1c776b6c-31e4-4d69-a0d8-b9109afdcc58';

async function main() {
    console.log(`\n=== FIX COMPUESTO ENSAMBLE TEMPLATE QUANTITIES ===`);
    console.log(`Mode: ${WRITE ? '🔴 WRITE' : '🟢 DRY RUN'}\n`);

    // 1. Get all active COMPUESTO templates with ENSAMBLE stages
    const templates = await prisma.assemblyTemplate.findMany({
        where: {
            product: { name: { startsWith: 'COMPUESTO', mode: 'insensitive' } },
            isActive: true
        },
        include: {
            product: { select: { id: true, name: true } },
            stages: {
                where: { processType: { code: 'ENSAMBLE' } },
                include: {
                    inputs: {
                        include: { product: { select: { id: true, name: true } } },
                        orderBy: { displayOrder: 'asc' }
                    }
                }
            }
        }
    });

    let totalUpdated = 0;

    for (const tmpl of templates) {
        console.log(`\n📋 Template ${tmpl.templateCode} — ${tmpl.product.name}`);

        // Get the formula for this product
        const formula = await prisma.formula.findFirst({
            where: { productId: tmpl.product.id, isActive: true },
            include: {
                items: {
                    include: { ingredient: { select: { id: true, name: true } } },
                    orderBy: { additionOrder: 'asc' }
                }
            }
        });

        if (!formula) {
            console.log(`  ⚠️ No active formula found, skipping`);
            continue;
        }

        console.log(`  Formula: baseQty=${formula.baseQuantity} ${formula.baseUnit}`);

        // Build map: ingredientId → { quantity, unit }
        const formulaMap = {};
        for (const fi of formula.items) {
            formulaMap[fi.ingredientId] = { quantity: fi.quantity, unit: fi.unit };
        }

        for (const stage of tmpl.stages) {
            for (const inp of stage.inputs) {
                const match = formulaMap[inp.productId];
                if (!match) {
                    console.log(`  ⚠️ ${inp.product.name} — no formula match`);
                    continue;
                }

                const oldQpu = inp.quantityPerUnit;
                const newQpu = match.quantity;

                if (Math.abs(oldQpu - newQpu) < 0.0001) {
                    console.log(`  ✅ ${inp.product.name} — already correct (${newQpu})`);
                    continue;
                }

                console.log(`  🔧 ${inp.product.name}: ${oldQpu} → ${newQpu} ${match.unit}`);
                totalUpdated++;

                if (WRITE) {
                    await prisma.assemblyTemplateStageInput.update({
                        where: { id: inp.id },
                        data: { quantityPerUnit: newQpu }
                    });
                }
            }
        }
    }

    // 2. Fix the specific EXECUTING note
    console.log(`\n\n📝 Fixing EXECUTING note ${EXECUTING_NOTE_ID}...`);
    const note = await prisma.assemblyNote.findUnique({
        where: { id: EXECUTING_NOTE_ID },
        include: {
            product: { select: { id: true, name: true } },
            items: { include: { component: { select: { id: true, name: true } } } }
        }
    });

    if (!note) {
        console.log('  ⚠️ Note not found');
    } else {
        console.log(`  Note: ${note.product.name} — status: ${note.status}`);

        const formula = await prisma.formula.findFirst({
            where: { productId: note.product.id, isActive: true },
            include: {
                items: { include: { ingredient: true }, orderBy: { additionOrder: 'asc' } }
            }
        });

        if (!formula) {
            console.log('  ⚠️ No formula found');
        } else {
            const formulaMap = {};
            for (const fi of formula.items) {
                formulaMap[fi.ingredientId] = { quantity: fi.quantity, unit: fi.unit };
            }

            for (const item of note.items) {
                const match = formulaMap[item.componentId];
                if (!match) {
                    console.log(`  ⚠️ ${item.component?.name} — no formula match`);
                    continue;
                }

                const oldQty = item.plannedQuantity;
                const newQty = match.quantity;

                if (Math.abs(oldQty - newQty) < 0.0001) {
                    console.log(`  ✅ ${item.component?.name} — already correct (${newQty})`);
                    continue;
                }

                console.log(`  🔧 ${item.component?.name}: ${oldQty} → ${newQty} ${match.unit}`);
                totalUpdated++;

                if (WRITE) {
                    await prisma.assemblyNoteItem.update({
                        where: { id: item.id },
                        data: { plannedQuantity: newQty }
                    });
                }
            }
        }
    }

    console.log(`\n\n✅ Total changes: ${totalUpdated}`);
    if (!WRITE) {
        console.log('🟢 DRY RUN — no changes written. Run with --write to apply.');
    } else {
        console.log('🔴 Changes applied successfully.');
    }

    await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
