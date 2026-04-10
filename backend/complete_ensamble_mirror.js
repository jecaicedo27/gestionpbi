/**
 * Completa la nota ENSAMBLE espejo de GENI02 para CEREZA-260407-0953.
 * Esta nota es solo un registro de trazabilidad Siigo — el EMPAQUE físico ya fue completado.
 * Ejecutar una sola vez para desbloquear el handoff a logística.
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const LOT = 'CEREZA-260407-0953';
const ADMIN_ID = '83aba310-80ef-483b-b116-008ed37e968f';

async function run() {
    const batch = await prisma.productionBatch.findFirst({
        where: { batchNumber: LOT },
        select: { id: true }
    });
    if (!batch) { console.error('Batch no encontrado'); return; }

    // Buscar nota ENSAMBLE PENDING de GENI02 (1000ml) en este batch
    const mirror = await prisma.assemblyNote.findFirst({
        where: {
            productionBatchId: batch.id,
            processType: { code: 'ENSAMBLE' },
            status: { not: 'COMPLETED' },
            product: { sku: 'GENI02' }
        },
        include: { product: { select: { sku: true, name: true } } }
    });

    if (!mirror) {
        console.log('✅ No hay nota ENSAMBLE pendiente para GENI02 — ya está OK');
        return;
    }

    console.log(`Completando nota: [${mirror.id}] ${mirror.stageName} | ${mirror.product?.sku} | Status: ${mirror.status}`);

    // Si está PENDING, primero hay que pasarla a EXECUTING
    if (mirror.status === 'PENDING') {
        await prisma.assemblyNote.update({
            where: { id: mirror.id },
            data: { status: 'EXECUTING', startedAt: new Date(), startedById: ADMIN_ID }
        });
        console.log('  → Nota puesta en EXECUTING');
    }

    // Completar con la cantidad real del EMPAQUE (135 unidades)
    await prisma.assemblyNote.update({
        where: { id: mirror.id },
        data: {
            status: 'COMPLETED',
            completedAt: new Date(),
            completedById: ADMIN_ID,
            actualQuantity: 135,
            observations: `Ensamble Siigo espejo auto-completado — EMPAQUE GENI02 lote ${LOT} ya procesado físicamente.`
        }
    });

    console.log(`✅ Nota ENSAMBLE [${mirror.id}] completada — lote ${LOT} desbloqueado para handoff a logística`);

    // Verificar estado final
    const pending = await prisma.assemblyNote.findMany({
        where: {
            productionBatchId: batch.id,
            status: { not: 'COMPLETED' },
            processType: { code: { in: ['ENSAMBLE', 'ENSAMBLE_SIIGO'] } }
        },
        include: { product: { select: { sku: true } } }
    });

    if (pending.length === 0) {
        console.log('\n✅ Ninguna nota ENSAMBLE pendiente — lote completamente libre para envío a logística');
    } else {
        console.log('\nNotas ENSAMBLE aún pendientes (de otros productos en el batch):');
        pending.forEach(n => console.log(`  → ${n.product?.sku} | ${n.stageName} | ${n.status} (OK — son de otros carritos)`));
    }
}

run().catch(console.error).finally(() => prisma.$disconnect());
