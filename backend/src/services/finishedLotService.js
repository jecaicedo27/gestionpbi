/**
 * finishedLotService.js
 *
 * All business logic for finished product lot tracking.
 * Every stock mutation runs inside a Prisma transaction.
 *
 * Zones: PRODUCCION → PRODUCTO_TERMINADO → dispatch
 *        PRODUCCION → NO_CONFORME (damaged / marketing)
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ── helpers ──────────────────────────────────────────────────────────────────

function computeStatus(currentQty, initialQty) {
    if (currentQty <= 0) return 'DEPLETED';
    if (currentQty <= initialQty * 0.15) return 'LOW';
    return 'AVAILABLE';
}

// ── Ingest from production ──────────────────────────────────────────────────

/**
 * Create or increment stock when empaque/MarcadoCajas completes.
 * Stock goes to PRODUCCION zone initially.
 */
async function ingestFromProduction({ productId, lotNumber, quantity, batchId, expiresAt, userId, zone, reason: customReason, perCarrito }) {
    const targetZone = zone || 'PRODUCCION';
    return prisma.$transaction(async (tx) => {
        // ── DUPLICATE GUARD: block re-ingestion of the same lot within 3 minutes ──
        // Per-carrito calls use a unique reason string per carrito, so they don't block each other.
        const ingestReason = customReason || 'Ingreso desde producción';
        const threeMinutesAgo = new Date(Date.now() - 3 * 60 * 1000);
        const recentIngestion = await tx.finishedLotTransfer.findFirst({
            where: {
                productId,
                lotNumber,
                fromZone: targetZone,
                toZone: targetZone,
                reason: ingestReason, // scoped to exact reason — per-carrito reasons are unique
                createdAt: { gte: threeMinutesAgo },
            },
            orderBy: { createdAt: 'desc' },
        });
        if (recentIngestion) {
            const secsAgo = Math.round((Date.now() - new Date(recentIngestion.createdAt).getTime()) / 1000);
            throw new Error(
                `DUPLICATE_INGESTION:Ya se registró un ingreso de ${recentIngestion.quantity} uds ` +
                `para el lote ${lotNumber} hace ${secsAgo}s. ` +
                `Si es un ingreso adicional real, espera 3 minutos o contacta al administrador.`
            );
        }

        // ── ASSEMBLY COMPLETION GUARD (per-product) ─────────────────────────────────
        // Block ingestion if THIS specific product still has pending ENSAMBLE SIIGO
        // stages. Other products in the same batch that are already assembled can
        // be ingested independently (auto-ingested at ENSAMBLE completion).
        // EXCEPTION: per-carrito calls skip this guard — products are ingested progressively
        // as each carrito is assembled, before the full batch ENSAMBLE note is completed.
        if (!perCarrito) {
            const batch = await tx.productionBatch.findFirst({
                where: { batchNumber: lotNumber },
                select: { id: true, batchNumber: true },
            });
            if (batch) {
                const pendingEnsamble = await tx.assemblyNote.findMany({
                    where: {
                        productionBatchId: batch.id,
                        productId: productId, // ← per-product check
                        status: { not: 'COMPLETED' },
                        processType: { code: { in: ['ENSAMBLE', 'ENSAMBLE_SIIGO'] } },
                        product: { accountGroup: { in: [1401, 1402] } },
                    },
                    include: { product: { select: { name: true } } },
                });
                if (pendingEnsamble.length > 0) {
                    const stageNames = [...new Set(pendingEnsamble.map(n => n.product?.name || n.stageName))].join(', ');
                    throw new Error(
                        `ASSEMBLY_INCOMPLETE:El producto ${stageNames} del lote ${lotNumber} aún tiene etapas de Ensamble Siigo ` +
                        `sin completar. ` +
                        `Finaliza el ensamble antes de registrar el ingreso a logística.`
                    );
                }
            }
        }


        // Upsert: if same product+lot+zone already exists, increment
        const existing = await tx.finishedLotStock.findUnique({
            where: {
                productId_lotNumber_zone: {
                    productId,
                    lotNumber,
                    zone: targetZone,
                },
            },
        });

        let stock;
        if (existing) {
            const newInitial = existing.initialQuantity + quantity;
            const newCurrent = existing.currentQuantity + quantity;
            stock = await tx.finishedLotStock.update({
                where: { id: existing.id },
                data: {
                    initialQuantity: newInitial,
                    currentQuantity: newCurrent,
                    status: computeStatus(newCurrent, newInitial),
                    batchId: batchId || existing.batchId,
                    expiresAt: expiresAt || existing.expiresAt,
                },
            });
        } else {
            stock = await tx.finishedLotStock.create({
                data: {
                    productId,
                    lotNumber,
                    zone: targetZone,
                    initialQuantity: quantity,
                    currentQuantity: quantity,
                    batchId: batchId || null,
                    expiresAt: expiresAt ? new Date(expiresAt) : null,
                    status: 'AVAILABLE',
                },
            });
        }

        // Log the ingestion as a transfer
        await tx.finishedLotTransfer.create({
            data: {
                finishedLotStockId: stock.id,
                productId,
                lotNumber,
                fromZone: targetZone,
                toZone: targetZone,
                quantity,
                reason: ingestReason,
                transferredById: userId,
            },
        });

        return stock;
    });
}

// ── Zone Transfer ───────────────────────────────────────────────────────────

/**
 * Transfer stock between zones (e.g. PRODUCCION → PRODUCTO_TERMINADO).
 */
async function transferZone({ productId, lotNumber, fromZone, toZone, quantity, userId, reason, observations }) {
    if (fromZone === toZone) throw new Error('fromZone y toZone no pueden ser iguales');
    if (quantity <= 0) throw new Error('La cantidad debe ser mayor a 0');

    return prisma.$transaction(async (tx) => {
        // 1. Validate source has enough stock
        // 1. Validate source has enough stock
        let source = await tx.finishedLotStock.findUnique({
            where: {
                productId_lotNumber_zone: { productId, lotNumber, zone: fromZone },
            },
        });

        let isMaterialLot = false;
        let matSource = null;

        if ((!source || source.currentQuantity < quantity) && fromZone === 'PRODUCCION') {
            // Fallback: Check MaterialLot in PRODUCTION
            matSource = await tx.materialLot.findFirst({
                where: { productId, lotNumber, zone: 'PRODUCTION' },
            });
            if (matSource && matSource.currentQuantity >= quantity) {
                isMaterialLot = true;
                source = {
                    id: matSource.id,
                    productId: matSource.productId,
                    lotNumber: matSource.lotNumber,
                    zone: 'PRODUCCION', // virtual map
                    initialQuantity: matSource.initialQuantity,
                    currentQuantity: matSource.currentQuantity,
                    batchId: null,
                    expiresAt: matSource.expiresAt
                };
            }
        }

        if (!source || source.currentQuantity < quantity) {
            const available = source?.currentQuantity || 0;
            throw new Error(`Stock insuficiente en ${fromZone}: disponible ${available}, solicitado ${quantity}`);
        }

        // 2. Decrement source
        const newSourceQty = source.currentQuantity - quantity;
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
                    status: computeStatus(newSourceQty, source.initialQuantity),
                },
            });
        }

        // 3. Upsert destination
        const destKey = { productId, lotNumber, zone: toZone };
        const existing = await tx.finishedLotStock.findUnique({
            where: { productId_lotNumber_zone: destKey },
        });

        let dest;
        if (existing) {
            const newInit = existing.initialQuantity + quantity;
            const newCurr = existing.currentQuantity + quantity;
            dest = await tx.finishedLotStock.update({
                where: { id: existing.id },
                data: {
                    initialQuantity: newInit,
                    currentQuantity: newCurr,
                    status: computeStatus(newCurr, newInit),
                },
            });
        } else {
            dest = await tx.finishedLotStock.create({
                data: {
                    productId,
                    lotNumber,
                    zone: toZone,
                    initialQuantity: quantity,
                    currentQuantity: quantity,
                    batchId: source.batchId,
                    expiresAt: source.expiresAt,
                    status: 'AVAILABLE',
                },
            });
        }

        // 4. Log transfer
        await tx.finishedLotTransfer.create({
            data: {
                finishedLotStockId: isMaterialLot ? dest.id : source.id, // Use destination if source is MaterialLot (to avoid FK error)
                productId,
                lotNumber,
                fromZone,
                toZone,
                quantity,
                reason: reason || `Transferencia ${fromZone} → ${toZone}`,
                transferredById: userId,
                observations: observations || null,
            },
        });

        return { source: { ...source, currentQuantity: newSourceQty }, dest };
    });
}

// ── Consume for Order (Picking) ─────────────────────────────────────────────

/**
 * Consume stock from PRODUCTO_TERMINADO zone when picking for an order.
 * Only PRODUCTO_TERMINADO is valid for dispatch.
 */
async function consumeForOrder({ productId, lotNumber, quantity, orderId, userId }) {
    const zone = 'PRODUCTO_TERMINADO';

    return prisma.$transaction(async (tx) => {
        const stock = await tx.finishedLotStock.findUnique({
            where: {
                productId_lotNumber_zone: { productId, lotNumber, zone },
            },
        });

        if (!stock || stock.currentQuantity < quantity) {
            const available = stock?.currentQuantity || 0;
            throw new Error(`Stock insuficiente en PRODUCTO_TERMINADO para lote ${lotNumber}: disponible ${available}, solicitado ${quantity}`);
        }

        const newQty = stock.currentQuantity - quantity;
        await tx.finishedLotStock.update({
            where: { id: stock.id },
            data: {
                currentQuantity: newQty,
                status: computeStatus(newQty, stock.initialQuantity),
            },
        });

        // Log as transfer out (PRODUCTO_TERMINADO → dispatch/consumed)
        await tx.finishedLotTransfer.create({
            data: {
                finishedLotStockId: stock.id,
                productId,
                lotNumber,
                fromZone: zone,
                toZone: zone, // stays in PT but consumed
                quantity,
                reason: 'Despacho por picking',
                orderId: orderId || null,
                transferredById: userId,
            },
        });

        return { ...stock, currentQuantity: newQty };
    });
}

// ── Queries ─────────────────────────────────────────────────────────────────

/**
 * Get finished lot stock by zone, optionally filtered by product.
 */
async function getStockByZone(zone, productId) {
    const where = {
        zone,
        product: {
            accountGroup: { in: [1401, 1402] },
            // Exclude work-in-process products (SKU prefix 'PROCE' = PROCEso Empresa Liquipops)
            // These premixes are consumed in production and must NOT appear in empaque handoffs
            sku: { not: { startsWith: 'PROCE' } },
        },
    };
    if (productId) where.productId = productId;
    // Only show lots with stock > 0 or recently depleted
    where.currentQuantity = { gte: 0 };

    const finished = await prisma.finishedLotStock.findMany({
        where,
        include: {
            product: { select: { id: true, name: true, sku: true, barcode: true, flavor: true, size: true, packSize: true, currentStock: true } },
        },
        orderBy: [{ product: { name: 'asc' } }, { lotNumber: 'asc' }],
    });

    // Also fetch from MaterialLot
    let matZone = zone;
    if (zone === 'PRODUCCION') matZone = 'PRODUCTION';
    if (zone === 'BODEGA') matZone = 'WAREHOUSE';

    const matWhere = {
        zone: matZone,
        currentQuantity: { gt: 0 },
        product: {
            accountGroup: { in: [1401, 1402] },
            sku: { not: { startsWith: 'PROCE' } },
        },
    };
    if (productId) matWhere.productId = productId;

    const matLots = await prisma.materialLot.findMany({
        where: matWhere,
        include: {
            product: { select: { id: true, name: true, sku: true, barcode: true, flavor: true, size: true, packSize: true, currentStock: true } }
        },
        orderBy: [{ siigoProductName: 'asc' }, { lotNumber: 'asc' }]
    });

    const mappedMat = matLots.map(l => ({
        id: l.id,
        productId: l.productId,
        product: l.product,
        lotNumber: l.lotNumber,
        zone: zone, // Keep standard format
        initialQuantity: l.initialQuantity,
        currentQuantity: l.currentQuantity,
        status: computeStatus(l.currentQuantity, l.initialQuantity),
        createdAt: l.receivedAt,
        updatedAt: l.receivedAt,
        expiresAt: l.expiresAt,
        labelPrinted: l.labelPrinted,
        labelPrintedAt: l.labelPrintedAt,
        _source: 'materialLot'
    }));

    // ── DEDUP: hide materialLot entries that already have a finishedLotStock record
    // (avoids double-row when assembly automation AND manual ingestion both exist)
    const existingKeys = new Set(
        finished.map(f => `${f.productId}_${f.lotNumber}`)
    );
    const dedupedMat = mappedMat.filter(
        m => !existingKeys.has(`${m.productId}_${m.lotNumber}`)
    );

    const allStocks = [...finished, ...dedupedMat];

    // ── ASSEMBLY STATUS ENRICHMENT (PRODUCCION zone only, per-product) ─────
    // For each stock record, check if THAT specific product still has pending
    // ENSAMBLE/ENSAMBLE_SIIGO stages. This lets the frontend disable only those
    // products that haven't completed assembly, not the entire batch.
    if (zone === 'PRODUCCION' && allStocks.length > 0) {
        const lotNumbers = [...new Set(allStocks.map(s => s.lotNumber))];

        // Get all pending ENSAMBLE notes for batches matching our lot numbers
        const pendingNotes = await prisma.assemblyNote.findMany({
            where: {
                productionBatch: { batchNumber: { in: lotNumbers } },
                status: { not: 'COMPLETED' },
                processType: { code: { in: ['ENSAMBLE', 'ENSAMBLE_SIIGO'] } },
                product: { accountGroup: { in: [1401, 1402] } },
            },
            select: {
                productId: true,
                productionBatchId: true,
                productionBatch: { select: { batchNumber: true } },
                product: { select: { accountGroup: true } },
            },
        });

        // Geniality products (accountGroup 1402) inject stock dynamically per-carrito
        // and do not wait for the Ensamble/Empaque note to complete before handoffs.

        // Build pending set — skip Geniality products whose EMPAQUE is done
        const pendingKeys = new Set(
            pendingNotes
                .filter(n => {
                    // Geniality products (1402) inject stock dynamically per-carrito.
                    // We DO NOT block their handoffs, as partial deliveries to logistics are expected.
                    if (n.product?.accountGroup === 1402) return false;
                    return true;
                })
                .map(n => `${n.productId}_${n.productionBatch?.batchNumber}`)
        );
        for (const s of allStocks) {
            s.assemblyPending = pendingKeys.has(`${s.productId}_${s.lotNumber}`);
        }
    }

    return allStocks;
}

/**
 * Get available lots for a product in PRODUCTO_TERMINADO zone (for picking modal).
 * Returns FIFO order (oldest first).
 */
async function getAvailableLots(productId) {
    return prisma.finishedLotStock.findMany({
        where: {
            productId,
            zone: 'PRODUCTO_TERMINADO',
            currentQuantity: { gt: 0 },
            status: { not: 'DEPLETED' },
        },
        include: {
            product: { select: { id: true, name: true, sku: true, barcode: true, packSize: true } },
        },
        orderBy: { createdAt: 'asc' }, // FIFO
    });
}

/**
 * Get stock summary per zone (for dashboard).
 */
async function getStockSummary() {
    const zones = ['PRODUCCION', 'PRODUCTO_TERMINADO', 'NO_CONFORME', 'CUARENTENA', 'MAQUILA'];
    const result = {};

    for (const zone of zones) {
        const stocks = await prisma.finishedLotStock.findMany({
            where: { zone, currentQuantity: { gt: 0 }, product: { accountGroup: { in: [1401, 1402] }, sku: { not: { startsWith: 'PROCE' } } } },
            include: {
                product: { select: { id: true, name: true, sku: true } },
            },
        });

        // Aggregate by product
        const byProduct = {};
        for (const s of stocks) {
            const key = s.productId;
            if (!byProduct[key]) {
                byProduct[key] = {
                    productId: s.productId,
                    productName: s.product.name,
                    sku: s.product.sku,
                    totalUnits: 0,
                    lotCount: 0,
                };
            }
            byProduct[key].totalUnits += s.currentQuantity;
            byProduct[key].lotCount += 1;
        }

        result[zone] = {
            products: Object.values(byProduct),
            totalLots: stocks.length,
            totalUnits: stocks.reduce((sum, s) => sum + s.currentQuantity, 0),
        };

        // If PRODUCCION, inject MaterialLots in PRODUCTION
        if (zone === 'PRODUCCION') {
            const matLots = await prisma.materialLot.findMany({
                where: { zone: 'PRODUCTION', currentQuantity: { gt: 0 }, product: { accountGroup: { in: [1401, 1402] }, sku: { not: { startsWith: 'PROCE' } } } },
                include: { product: { select: { id: true, name: true, sku: true } } },
            });
            for (const l of matLots) {
                const key = l.productId || l.siigoProductCode;
                if (!byProduct[key]) {
                    byProduct[key] = {
                        productId: l.productId,
                        productName: l.product?.name || l.siigoProductName,
                        sku: l.product?.sku || l.siigoProductCode,
                        totalUnits: 0,
                        lotCount: 0,
                    };
                }
                byProduct[key].totalUnits += l.currentQuantity;
                byProduct[key].lotCount += 1;
            }
            result[zone].products = Object.values(byProduct);
            result[zone].totalLots += matLots.length;
            result[zone].totalUnits += matLots.reduce((sum, l) => sum + l.currentQuantity, 0);
        }
    }

    // Add BODEGA summary from MaterialLot (finished products in main warehouse)
    const bodegaLots = await prisma.materialLot.findMany({
        where: {
            zone: 'WAREHOUSE',
            currentQuantity: { gt: 0 },
            product: { accountGroup: { in: [1401, 1402] } },
        },
        include: { product: { select: { id: true, name: true, sku: true } } },
    });
    const bodegaByProduct = {};
    for (const l of bodegaLots) {
        const key = l.productId || l.siigoProductCode;
        if (!bodegaByProduct[key]) {
            bodegaByProduct[key] = {
                productId: l.productId,
                productName: l.product?.name || l.siigoProductName,
                sku: l.product?.sku || l.siigoProductCode,
                totalUnits: 0,
                lotCount: 0,
            };
        }
        bodegaByProduct[key].totalUnits += l.currentQuantity;
        bodegaByProduct[key].lotCount += 1;
    }
    result.BODEGA = {
        products: Object.values(bodegaByProduct),
        totalLots: bodegaLots.length,
        totalUnits: bodegaLots.reduce((sum, l) => sum + l.currentQuantity, 0),
    };

    return result;
}

/**
 * Get lot transfers history (movements).
 */
async function getTransferHistory({ lotNumber, productId, limit = 50 }) {
    const where = {};
    if (lotNumber) where.lotNumber = lotNumber;
    if (productId) where.productId = productId;

    return prisma.finishedLotTransfer.findMany({
        where,
        include: {
            product: { select: { id: true, name: true, sku: true } },
            transferredBy: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
    });
}

/**
 * Get lots shipped to a specific order (for recall).
 */
async function getLotsByOrder(orderId) {
    return prisma.finishedLotTransfer.findMany({
        where: { orderId, reason: 'Despacho por picking' },
        include: {
            product: { select: { id: true, name: true, sku: true, barcode: true } },
        },
        orderBy: { createdAt: 'asc' },
    });
}

/**
 * Reverse lookup: given a lot number, find all orders/distributors that received it.
 * Essential for recall management.
 */
async function getOrdersByLot(lotNumber) {
    const transfers = await prisma.finishedLotTransfer.findMany({
        where: {
            lotNumber,
            reason: 'Despacho por picking',
            orderId: { not: null },
        },
        include: {
            product: { select: { id: true, name: true, sku: true } },
            transferredBy: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
    });

    // Enrich with order + distributor info
    const enriched = [];
    for (const t of transfers) {
        let order = null;
        try {
            order = await prisma.order.findUnique({
                where: { id: t.orderId },
                select: {
                    id: true, orderNumber: true, status: true, createdAt: true,
                    distributor: { select: { id: true, name: true, email: true, phone: true } },
                },
            });
        } catch { /* order may have been deleted */ }
        enriched.push({ ...t, order });
    }

    return enriched;
}

/**
 * Get recall report: for each lot, show a summary of affected distributors.
 * Optionally filtered by productId.
 */
async function getRecallReport({ productId, lotNumber }) {
    const where = { reason: 'Despacho por picking', orderId: { not: null } };
    if (productId) where.productId = productId;
    if (lotNumber) where.lotNumber = { contains: lotNumber, mode: 'insensitive' };

    const transfers = await prisma.finishedLotTransfer.findMany({
        where,
        include: {
            product: { select: { id: true, name: true, sku: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
    });

    // Group by lotNumber
    const byLot = {};
    for (const t of transfers) {
        if (!byLot[t.lotNumber]) {
            byLot[t.lotNumber] = {
                lotNumber: t.lotNumber,
                productName: t.product?.name,
                sku: t.product?.sku,
                productId: t.productId,
                totalDispatched: 0,
                orderIds: new Set(),
            };
        }
        byLot[t.lotNumber].totalDispatched += t.quantity;
        byLot[t.lotNumber].orderIds.add(t.orderId);
    }

    // Enrich with distributor info
    const result = [];
    for (const lot of Object.values(byLot)) {
        const orderIds = Array.from(lot.orderIds);
        const orders = await prisma.order.findMany({
            where: { id: { in: orderIds } },
            select: {
                id: true, orderNumber: true, status: true,
                distributor: { select: { id: true, name: true, email: true, phone: true } },
            },
        });

        const distributors = {};
        for (const o of orders) {
            if (o.distributor) {
                const dId = o.distributor.id;
                if (!distributors[dId]) {
                    distributors[dId] = { ...o.distributor, orders: [] };
                }
                distributors[dId].orders.push({ id: o.id, orderNumber: o.orderNumber, status: o.status });
            }
        }

        result.push({
            lotNumber: lot.lotNumber,
            productName: lot.productName,
            sku: lot.sku,
            totalDispatched: lot.totalDispatched,
            orderCount: orderIds.length,
            distributors: Object.values(distributors),
        });
    }

    return result;
}

module.exports = {
    ingestFromProduction,
    transferZone,
    consumeForOrder,
    getStockByZone,
    getAvailableLots,
    getStockSummary,
    getTransferHistory,
    getLotsByOrder,
    getOrdersByLot,
    getRecallReport,
};
