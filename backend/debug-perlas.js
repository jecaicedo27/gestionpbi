const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function go() {
    // Find LIQUIPOPS/PERLAS batches (have a flavor, not ESCARCHADOR)
    const batch = await p.productionBatch.findFirst({
        where: { 
            flavor: { not: null, notIn: ['ESCARCHADOR'] },
            createdAt: { gte: new Date('2026-04-15T00:00:00Z') }
        },
        orderBy: { createdAt: 'desc' },
        include: { product: { select: { name: true } } }
    });

    if (!batch) { console.log('No PERLAS batch today'); return; }
    console.log('BATCH: ' + batch.batchNumber + ' | Flavor: ' + batch.flavor + ' | Product: ' + (batch.product?.name || '?') + ' | Status: ' + batch.status);
    
    const notes = await p.assemblyNote.findMany({
        where: { productionBatchId: batch.id },
        include: {
            items: { include: { component: { select: { id: true, name: true, unit: true } } } },
            processType: { select: { code: true, name: true } }
        },
        orderBy: { stageOrder: 'asc' }
    });
    
    for (const note of notes) {
        const code = note.processType?.code || '?';
        console.log('\n[' + note.stageOrder + '] ' + note.stageName);
        console.log('    Tipo: ' + code + ' | Estado: ' + note.status + ' | Target: ' + ((note.targetQuantity||0)/1000).toFixed(1) + 'kg');
        
        if (note.items.length > 0) {
            for (const item of note.items) {
                const name = item.component?.name || 'unknown';
                const qty = item.plannedQuantity || 0;
                const agg = await p.materialLot.aggregate({
                    where: { productId: item.componentId, zone: 'PRODUCTION', currentQuantity: { gt: 0 }, status: { in: ['AVAILABLE','LOW_STOCK'] } },
                    _sum: { currentQuantity: true }
                });
                const rz = agg._sum.currentQuantity || 0;
                const ok = rz >= qty * 0.95 || name.toUpperCase() === 'AGUA';
                console.log('    ' + (ok?'✅':'❌') + ' ' + name + ': necesita ' + (qty/1000).toFixed(2) + 'kg | zona: ' + (rz/1000).toFixed(2) + 'kg');
            }
        } else {
            console.log('    (sin insumos directos)');
        }
    }

    // Also check the formula for BASE LIQUIPOPS to see if it's pulling correct values
    console.log('\n\n=== FORMULA DE BASE LIQUIPOPS ===');
    const baseProduct = await p.product.findFirst({ where: { name: { contains: 'BASE LIQUIPOPS', mode: 'insensitive' }, NOT: { name: { contains: 'DIOXIDO' } } } });
    if (baseProduct) {
        const formula = await p.formula.findFirst({
            where: { productId: baseProduct.id, isActive: true },
            include: { ingredients: { include: { rawMaterial: { select: { name: true } } } } },
            orderBy: { version: 'desc' }
        });
        if (formula) {
            console.log('Formula: ' + formula.name + ' v' + formula.version + ' | Base: ' + formula.baseQuantity + formula.baseUnit);
            for (const ing of formula.ingredients) {
                console.log('  - ' + (ing.rawMaterial?.name || '?') + ': ' + ing.quantity + ' ' + ing.unit);
            }
        } else {
            console.log('No active formula found for BASE LIQUIPOPS');
        }
    }

    // Check PROTECCION formula
    console.log('\n=== FORMULA DE PROTECCION MARACUYA ===');
    const protProduct = await p.product.findFirst({ where: { name: { equals: 'PROTECCION MARACUYA', mode: 'insensitive' } } });
    if (protProduct) {
        const formula = await p.formula.findFirst({
            where: { productId: protProduct.id, isActive: true },
            include: { ingredients: { include: { rawMaterial: { select: { name: true } } } } },
            orderBy: { version: 'desc' }
        });
        if (formula) {
            console.log('Formula: ' + formula.name + ' v' + formula.version + ' | Base: ' + formula.baseQuantity + formula.baseUnit);
            for (const ing of formula.ingredients) {
                console.log('  - ' + (ing.rawMaterial?.name || '?') + ': ' + ing.quantity + ' ' + ing.unit);
            }
        }
    }

    await p.$disconnect();
}
go().catch(e => { console.error(e); process.exit(1); });
