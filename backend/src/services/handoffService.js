/**
 * handoffService.js
 * 
 * Business logic for Product Handoffs (Actas de Entrega).
 * Handles the creation of handoff requests by Production and their
 * reception (approval) by Logistics, executing the stock transfer.
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { computeStatus } = require('./finishedLotService'); // Helper if we want, or I can just rewrite it here. Wait, finishedLotService doesn't export computeStatus.

function getStatus(currentQty, initialQty) {
    if (currentQty <= 0) return 'DEPLETED';
    if (currentQty <= initialQty * 0.15) return 'LOW';
    return 'AVAILABLE';
}

/**
 * Generate a sequential handoff number.
 * Format: ENT-YYMMDD-XXX
 */
async function generateHandoffNumber() {
    const today = new Date();
    const prefix = `ENT-${today.getFullYear().toString().slice(-2)}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
    
    const last = await prisma.productHandoff.findFirst({
        where: { handoffNumber: { startsWith: prefix } },
        orderBy: { handoffNumber: 'desc' }
    });

    let seq = 1;
    if (last) {
        const parts = last.handoffNumber.split('-');
        seq = parseInt(parts[2], 10) + 1;
    }
    return `${prefix}-${String(seq).padStart(3, '0')}`;
}

/**
 * Creates a new handoff request from Production.
 * @param {Object} data 
 * @param {string} data.userId User creating the handoff
 * @param {Array} data.items Array of { productId, lotNumber, requestedQuantity }
 * @param {string} data.notes Optional notes
 */
async function createHandoff({ userId, items, notes }) {
    if (!items || items.length === 0) throw new Error('El acta de entrega debe tener al menos un lote.');

    // ── Guard: No duplicate PENDING handoffs for the same product+lot ──────────
    for (const item of items) {
        const existingPending = await prisma.handoffItem.findFirst({
            where: {
                productId: item.productId,
                lotNumber: item.lotNumber,
                handoff: { status: 'PENDING' }
            },
            include: { handoff: { select: { handoffNumber: true } } }
        });
        if (existingPending) {
            throw new Error(
                `El lote ${item.lotNumber} ya tiene un acta pendiente (${existingPending.handoff.handoffNumber}). ` +
                `Espera a que logística la reciba o rechace antes de crear otra.`
            );
        }
    }

    const handoffNumber = await generateHandoffNumber();

    return prisma.$transaction(async (tx) => {
        // Here we could validate that the requested quantity actually exists in PRODUCCION,
        // but we'll let Logistics handle discrepancies if they find less physical boxes.
        // For strictness, let's validate that MaterialLot or FinishedLotStock has the stock.
        for (const item of items) {
            let available = 0;
            // First check MaterialLot (PRODUCTION)
            const ml = await tx.materialLot.findFirst({
                where: { productId: item.productId, lotNumber: item.lotNumber, zone: 'PRODUCTION' }
            });
            if (ml) available += ml.currentQuantity;

            // Then check FinishedLotStock (PRODUCCION)
            const fl = await tx.finishedLotStock.findUnique({
                where: { productId_lotNumber_zone: { productId: item.productId, lotNumber: item.lotNumber, zone: 'PRODUCCION' } }
            });
            if (fl) available += fl.currentQuantity;

            if (available < item.requestedQuantity) {
                // Get product name for error
                const p = await tx.product.findUnique({ where: { id: item.productId } });
                throw new Error(`Stock insuficiente en PRODUCCION para el producto ${p?.name || 'Desconocido'} lote ${item.lotNumber}. Disponible: ${available}, Solicitado: ${item.requestedQuantity}`);
            }
        }

        // Create the handoff
        const handoff = await tx.productHandoff.create({
            data: {
                handoffNumber,
                createdById: userId,
                fromZone: 'PRODUCCION',
                toZone: 'PRODUCTO_TERMINADO',
                notes,
                status: 'PENDING',
                items: {
                    create: items.map(i => ({
                        productId: i.productId,
                        lotNumber: i.lotNumber,
                        requestedQuantity: i.requestedQuantity
                    }))
                }
            },
            include: { items: true }
        });

        return handoff;
    });
}

/**
 * Get all pending handoffs.
 */
async function getPendingHandoffs() {
    return prisma.productHandoff.findMany({
        where: { status: 'PENDING' },
        include: {
            createdBy: { select: { id: true, name: true } },
            items: {
                include: { product: { select: { id: true, name: true, sku: true } } }
            }
        },
        orderBy: { createdAt: 'desc' }
    });
}

/**
 * Get history of handoffs (Completed / Rejected).
 */
async function getHandoffHistory(limit = 50) {
    return prisma.productHandoff.findMany({
        where: { status: { in: ['COMPLETED', 'REJECTED'] } },
        include: {
            createdBy: { select: { id: true, name: true } },
            receivedBy: { select: { id: true, name: true } },
            items: {
                include: { product: { select: { id: true, name: true, sku: true } } }
            }
        },
        orderBy: { createdAt: 'desc' },
        take: limit
    });
}

/**
 * Receive and confirm a handoff.
 * Moves the inventory from PRODUCCION to PRODUCTO_TERMINADO.
 * @param {string} handoffId 
 * @param {string} receivedById 
 * @param {Array} receivedItems Array of { itemId, receivedQuantity } in case Logistics found discrepancies.
 */
async function receiveHandoff({ handoffId, receivedById, receivedItems }) {
    return prisma.$transaction(async (tx) => {
        const handoff = await tx.productHandoff.findUnique({
            where: { id: handoffId },
            include: { items: true }
        });

        if (!handoff) throw new Error('Acta de entrega no encontrada');
        if (handoff.status !== 'PENDING') throw new Error(`El acta ya se encuentra en estado ${handoff.status}`);

        const itemMap = new Map(handoff.items.map(i => [i.id, i]));

        // Validate and process each item
        for (const reqItem of receivedItems) {
            const hItem = itemMap.get(reqItem.itemId);
            if (!hItem) continue;

            const qty = parseInt(reqItem.receivedQuantity);
            if (isNaN(qty) || qty < 0) throw new Error('Cantidad recibida inválida');

            // Update item with received quantity
            await tx.handoffItem.update({
                where: { id: hItem.id },
                data: { receivedQuantity: qty }
            });

            // If qty is 0, they rejected this specific item line
            if (qty === 0) continue;

            // --- EXECUTE TRANSFER (similar to transferZone logic) ---
            const productId = hItem.productId;
            const lotNumber = hItem.lotNumber;
            const fromZone = handoff.fromZone; // "PRODUCCION"
            const toZone = handoff.toZone;     // "PRODUCTO_TERMINADO"

            // 1. Validate Source
            let source = await tx.finishedLotStock.findUnique({
                where: { productId_lotNumber_zone: { productId, lotNumber, zone: fromZone } }
            });

            let isMaterialLot = false;
            let matSource = null;

            if ((!source || source.currentQuantity < qty) && fromZone === 'PRODUCCION') {
                matSource = await tx.materialLot.findFirst({
                    where: { productId, lotNumber, zone: 'PRODUCTION' }
                });
                if (matSource && matSource.currentQuantity >= qty) {
                    isMaterialLot = true;
                    source = {
                        id: matSource.id,
                        productId: matSource.productId,
                        lotNumber: matSource.lotNumber,
                        initialQuantity: matSource.initialQuantity,
                        currentQuantity: matSource.currentQuantity,
                        batchId: null,
                        expiresAt: matSource.expiresAt
                    };
                }
            }

            if (!source || source.currentQuantity < qty) {
                const available = source?.currentQuantity || 0;
                throw new Error(`Stock insuficiente para el lote ${lotNumber}: disponible ${available}, se intentan recibir ${qty}`);
            }

            // 2. Decrement Source
            const newSourceQty = source.currentQuantity - qty;
            if (isMaterialLot) {
                await tx.materialLot.update({
                    where: { id: matSource.id },
                    data: { currentQuantity: newSourceQty }
                });
            } else {
                await tx.finishedLotStock.update({
                    where: { id: source.id },
                    data: {
                        currentQuantity: newSourceQty,
                        status: getStatus(newSourceQty, source.initialQuantity)
                    }
                });
            }

            // 3. Increment/Create Destination
            const destKey = { productId, lotNumber, zone: toZone };
            const existing = await tx.finishedLotStock.findUnique({
                where: { productId_lotNumber_zone: destKey }
            });

            let dest;
            if (existing) {
                const newInit = existing.initialQuantity + qty;
                const newCurr = existing.currentQuantity + qty;
                dest = await tx.finishedLotStock.update({
                    where: { id: existing.id },
                    data: {
                        initialQuantity: newInit,
                        currentQuantity: newCurr,
                        status: getStatus(newCurr, newInit)
                    }
                });
            } else {
                dest = await tx.finishedLotStock.create({
                    data: {
                        productId,
                        lotNumber,
                        zone: toZone,
                        initialQuantity: qty,
                        currentQuantity: qty,
                        batchId: source.batchId,
                        expiresAt: source.expiresAt,
                        status: 'AVAILABLE'
                    }
                });
            }

            // Decrement productionZoneStock if leaving PRODUCCION
            if (fromZone === 'PRODUCCION') {
                const curProd = await tx.product.findUnique({
                    where: { id: productId },
                    select: { productionZoneStock: true }
                });
                const curZone = curProd?.productionZoneStock || 0;
                const safeDec = Math.min(qty, Math.max(0, curZone));
                if (safeDec > 0) {
                    await tx.product.update({
                        where: { id: productId },
                        data: { productionZoneStock: { decrement: safeDec } }
                    });
                }
            }

            // 4. Log transfer
            await tx.finishedLotTransfer.create({
                data: {
                    finishedLotStockId: isMaterialLot ? dest.id : source.id,
                    productId,
                    lotNumber,
                    fromZone,
                    toZone,
                    quantity: qty,
                    reason: `Recepción de Acta ${handoff.handoffNumber}`,
                    transferredById: receivedById
                }
            });
        }

        // Mark handoff as COMPLETED
        const completedHandoff = await tx.productHandoff.update({
            where: { id: handoffId },
            data: {
                status: 'COMPLETED',
                receivedById,
                completedAt: new Date()
            },
            include: { items: true, createdBy: { select: { name: true } }, receivedBy: { select: { name: true } } }
        });

        return completedHandoff;
    });
}

/**
 * Reject a handoff entirely without receiving items.
 */
async function rejectHandoff({ handoffId, receivedById, reason }) {
    // We just mark it as REJECTED, no stock is moved.
    return prisma.productHandoff.update({
        where: { id: handoffId },
        data: {
            status: 'REJECTED',
            receivedById,
            notes: reason,
            completedAt: new Date()
        }
    });
}

module.exports = {
    createHandoff,
    getPendingHandoffs,
    getHandoffHistory,
    receiveHandoff,
    rejectHandoff
};
