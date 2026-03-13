/**
 * Fix ALL ENSAMBLE template inputs + note items across all product types
 * (COMPUESTO, PROTECCION, etc.)
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
    let totalFixed = 0;

    // 1. Fix ALL template ENSAMBLE stage inputs
    const templates = await p.assemblyTemplate.findMany({
        where: { isActive: true },
        include: {
            product: { select: { id: true, name: true } },
            stages: {
                where: { processType: { code: 'ENSAMBLE' } },
                include: {
                    inputs: { include: { product: { select: { id: true, name: true } } } }
                }
            }
        }
    });

    for (const tmpl of templates) {
        if (tmpl.stages.length === 0) continue;

        const formula = await p.formula.findFirst({
            where: { productId: tmpl.product.id, isActive: true },
            include: { items: true }
        });
        if (!formula || !formula.items || formula.items.length === 0) continue;

        const fmap = {};
        for (const fi of formula.items) {
            fmap[fi.ingredientId] = fi.quantity;
        }

        for (const s of tmpl.stages) {
            for (const inp of s.inputs) {
                const fqty = fmap[inp.productId];
                if (fqty === undefined) continue;
                if (Math.abs(inp.quantityPerUnit - fqty) < 0.0001) continue;
                // Per-gram ratio: value < 1 but formula > 1
                if (inp.quantityPerUnit < 1 && fqty > 1) {
                    console.log(`🔧 TMPL ${tmpl.product.name} | ${inp.product.name}: ${inp.quantityPerUnit} → ${fqty}`);
                    await p.assemblyTemplateStageInput.update({
                        where: { id: inp.id },
                        data: { quantityPerUnit: fqty }
                    });
                    totalFixed++;
                }
            }
        }
    }

    // 2. Fix ALL PENDING/EXECUTING ENSAMBLE note items
    const notes = await p.assemblyNote.findMany({
        where: {
            processType: { code: 'ENSAMBLE' },
            status: { in: ['PENDING', 'EXECUTING'] }
        },
        include: {
            product: { select: { id: true, name: true } },
            items: { include: { component: { select: { id: true, name: true } } } }
        }
    });

    for (const note of notes) {
        const formula = await p.formula.findFirst({
            where: { productId: note.product.id, isActive: true },
            include: { items: true }
        });
        if (!formula || !formula.items || formula.items.length === 0) continue;

        const fmap = {};
        for (const fi of formula.items) {
            fmap[fi.ingredientId] = fi.quantity;
        }

        for (const item of note.items) {
            const fqty = fmap[item.componentId];
            if (fqty === undefined) continue;
            if (Math.abs(item.plannedQuantity - fqty) < 0.001) continue;
            if (item.plannedQuantity < 1 && fqty > 1) {
                const cname = item.component ? item.component.name : 'unknown';
                console.log(`📝 NOTE ${note.product.name} | ${cname}: ${item.plannedQuantity} → ${fqty}`);
                await p.assemblyNoteItem.update({
                    where: { id: item.id },
                    data: { plannedQuantity: fqty }
                });
                totalFixed++;
            }
        }
    }

    console.log(`\n✅ Total fixes: ${totalFixed}`);
    await p.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
