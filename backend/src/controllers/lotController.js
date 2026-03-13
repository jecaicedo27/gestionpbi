const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const lotController = {
    /**
     * GET /lots?sku=XXX — list lots for a product (with available balance)
     */
    getLots: async (req, res) => {
        try {
            const { sku, productId, status, zone } = req.query;
            const where = {};
            if (sku) where.siigoProductCode = sku;
            if (productId) where.productId = productId;
            if (zone) where.zone = zone;
            if (status) {
                where.status = { in: status.split(',') };
            } else {
                where.status = { in: ['AVAILABLE', 'LOW_STOCK'] };
            }

            const lots = await prisma.materialLot.findMany({
                where,
                orderBy: [{ expiresAt: 'asc' }, { receivedAt: 'desc' }],
                include: {
                    product: { select: { id: true, name: true, sku: true, unit: true, currentStock: true } },
                    _count: { select: { consumptions: true } }
                }
            });

            res.json(lots);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },

    /**
     * POST /lots — register a new lot manually
     */
    createLot: async (req, res) => {
        try {
            const { productId, lotNumber, quantity, unit, expiresAt } = req.body;

            if (!productId || !lotNumber || !quantity) {
                return res.status(400).json({ error: 'productId, lotNumber y quantity son requeridos' });
            }

            const qty = parseInt(quantity);
            if (qty <= 0) return res.status(400).json({ error: 'La cantidad debe ser mayor a 0' });

            // Look up product for SKU/name and current Siigo stock
            const product = await prisma.product.findUnique({
                where: { id: productId },
                select: { sku: true, name: true, currentStock: true }
            });
            if (!product) return res.status(404).json({ error: 'Producto no encontrado' });

            // ── Validation: total lots cannot exceed Siigo stock ──
            const existingLots = await prisma.materialLot.findMany({
                where: { productId, currentQuantity: { gt: 0 } },
                select: { currentQuantity: true }
            });
            const totalAssigned = existingLots.reduce((sum, l) => sum + l.currentQuantity, 0);
            const siigoStock = product.currentStock || 0;
            const available = Math.max(0, siigoStock - totalAssigned);

            if (qty > available) {
                return res.status(400).json({
                    error: `No se puede crear lote de ${qty.toLocaleString()}g. ` +
                        `Stock Siigo: ${siigoStock.toLocaleString()}g, ` +
                        `ya asignado en lotes: ${totalAssigned.toLocaleString()}g, ` +
                        `disponible para lotear: ${available.toLocaleString()}g.`
                });
            }

            const lot = await prisma.materialLot.create({
                data: {
                    productId,
                    siigoProductCode: product.sku,
                    siigoProductName: product.name,
                    lotNumber,
                    initialQuantity: qty,
                    currentQuantity: qty,
                    unit: unit || 'gramo',
                    expiresAt: expiresAt ? new Date(expiresAt) : null,
                    status: 'AVAILABLE'
                },
                include: {
                    product: { select: { id: true, name: true, sku: true } }
                }
            });

            res.status(201).json(lot);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },

    /**
     * POST /lots/:id/consume — register partial consumption
     */
    consumeLot: async (req, res) => {
        try {
            const { id } = req.params;
            const { quantity, assemblyNoteId, observations } = req.body;
            const userId = req.body.userId || req.user?.id;

            if (!quantity || quantity <= 0) {
                return res.status(400).json({ error: 'quantity debe ser mayor a 0' });
            }
            if (!userId) {
                return res.status(400).json({ error: 'userId es requerido' });
            }

            const lot = await prisma.materialLot.findUnique({ where: { id } });
            if (!lot) return res.status(404).json({ error: 'Lote no encontrado' });
            if (lot.currentQuantity < quantity) {
                return res.status(400).json({
                    error: `Cantidad insuficiente. Disponible: ${lot.currentQuantity}g, solicitado: ${quantity}g`
                });
            }

            const [consumption, updatedLot] = await prisma.$transaction([
                prisma.lotConsumption.create({
                    data: {
                        materialLotId: id,
                        quantityUsed: parseInt(quantity),
                        usedById: userId,
                        assemblyNoteId: assemblyNoteId || null,
                        observations: observations || null
                    }
                }),
                prisma.materialLot.update({
                    where: { id },
                    data: {
                        currentQuantity: { decrement: parseInt(quantity) },
                        status: (lot.currentQuantity - quantity) <= 0 ? 'DEPLETED'
                            : (lot.currentQuantity - quantity) < lot.initialQuantity * 0.1 ? 'LOW_STOCK'
                                : 'AVAILABLE'
                    }
                })
            ]);

            res.json({ consumption, lot: updatedLot });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },

    /**
     * GET /lots/traceability — admin audit panel (consumptions + productions)
     */
    getTraceability: async (req, res) => {
        try {
            const { sku, productId, startDate, endDate, userId, limit, zone } = req.query;
            const maxRows = parseInt(limit) || 200;

            // ── 1. Consumptions (negative) ────────────────────────
            const consumptionWhere = {};
            if (sku) consumptionWhere.materialLot = { siigoProductCode: sku };
            if (productId) consumptionWhere.materialLot = { ...consumptionWhere.materialLot, productId };
            if (userId) consumptionWhere.usedById = userId;
            if (startDate || endDate) {
                consumptionWhere.usedAt = {};
                if (startDate) consumptionWhere.usedAt.gte = new Date(startDate);
                if (endDate) consumptionWhere.usedAt.lte = new Date(endDate + 'T23:59:59');
            }

            const consumptions = await prisma.lotConsumption.findMany({
                where: consumptionWhere,
                orderBy: { usedAt: 'desc' },
                take: maxRows,
                include: {
                    materialLot: {
                        select: {
                            lotNumber: true,
                            siigoProductCode: true,
                            siigoProductName: true,
                            initialQuantity: true,
                            currentQuantity: true,
                            unit: true,
                            zone: true
                        }
                    },
                    usedBy: { select: { id: true, name: true, role: true } }
                }
            });

            // Resolve assembly note info
            const noteIds = [...new Set(consumptions.filter(c => c.assemblyNoteId).map(c => c.assemblyNoteId))];
            const notes = noteIds.length > 0 ? await prisma.assemblyNote.findMany({
                where: { id: { in: noteIds } },
                select: { id: true, noteNumber: true, stageName: true, productionBatch: { select: { batchNumber: true } } }
            }) : [];
            const noteMap = {};
            notes.forEach(n => { noteMap[n.id] = n; });

            const consumptionRows = consumptions.map(c => ({
                ...c,
                type: 'CONSUMPTION',
                date: c.usedAt,
                quantity: -c.quantityUsed,
                unit: c.materialLot?.unit || 'gramo',
                zone: c.materialLot?.zone || null,
                processInfo: c.assemblyNoteId ? noteMap[c.assemblyNoteId] || null : null
            }));

            // ── 2. MaterialLot entries (positive — from production OR PO ingress) ──
            const lotWhere = {};
            if (sku) lotWhere.siigoProductCode = sku;
            if (productId) lotWhere.productId = productId;
            if (startDate || endDate) {
                lotWhere.receivedAt = {};
                if (startDate) lotWhere.receivedAt.gte = new Date(startDate);
                if (endDate) lotWhere.receivedAt.lte = new Date(endDate + 'T23:59:59');
            }
            lotWhere.lotNumber = { not: '' };

            const materialLots = await prisma.materialLot.findMany({
                where: lotWhere,
                orderBy: { receivedAt: 'desc' },
                take: maxRows,
                select: {
                    id: true,
                    lotNumber: true,
                    siigoProductCode: true,
                    siigoProductName: true,
                    initialQuantity: true,
                    currentQuantity: true,
                    unit: true,
                    zone: true,
                    receivedAt: true,
                    purchaseOrderItemId: true,
                    purchaseOrderItem: {
                        select: {
                            purchaseOrder: {
                                select: { orderNumber: true, supplierName: true }
                            }
                        }
                    },
                    product: { select: { id: true, name: true } }
                }
            });

            const lotRows = materialLots.map(p => {
                const isPO = !!p.purchaseOrderItemId;
                const poInfo = p.purchaseOrderItem?.purchaseOrder;
                return {
                    id: `${isPO ? 'ingress' : 'prod'}-${p.id}`,
                    type: isPO ? 'INGRESS' : 'PRODUCTION',
                    date: p.receivedAt,
                    quantity: p.initialQuantity,
                    unit: p.unit || 'gramo',
                    zone: p.zone || null,
                    materialLot: {
                        lotNumber: p.lotNumber,
                        siigoProductCode: p.siigoProductCode,
                        siigoProductName: p.siigoProductName,
                        initialQuantity: p.initialQuantity,
                        currentQuantity: p.currentQuantity,
                        unit: p.unit,
                        zone: p.zone
                    },
                    usedBy: null,
                    processInfo: isPO ? { stageName: `OC ${poInfo?.orderNumber || ''}`, productionBatch: null } : null,
                    observations: isPO ? `Compra — ${poInfo?.supplierName || 'Proveedor'}` : 'Producción'
                };
            });

            // ── 3. Merge & sort by date desc ──
            let all = [...consumptionRows, ...lotRows]
                .sort((a, b) => new Date(b.date) - new Date(a.date))
                .slice(0, maxRows);

            // ── 4. Optional zone filter ──
            if (zone) {
                all = all.filter(r => r.zone === zone);
            }

            res.json(all);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },

    /**
     * GET /lots/:id/history — consumption history for a specific lot
     */
    getLotHistory: async (req, res) => {
        try {
            const { id } = req.params;
            const lot = await prisma.materialLot.findUnique({
                where: { id },
                include: {
                    product: { select: { id: true, name: true, sku: true } },
                    consumptions: {
                        orderBy: { usedAt: 'desc' },
                        include: {
                            usedBy: { select: { id: true, name: true } }
                        }
                    }
                }
            });
            if (!lot) return res.status(404).json({ error: 'Lote no encontrado' });
            res.json(lot);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },

    /**
     * DELETE /lots/:id — delete a lot (only if no consumptions)
     */
    deleteLot: async (req, res) => {
        try {
            const { id } = req.params;
            const lot = await prisma.materialLot.findUnique({
                where: { id },
                include: { _count: { select: { consumptions: true } } }
            });
            if (!lot) return res.status(404).json({ error: 'Lote no encontrado' });
            if (lot._count.consumptions > 0) {
                return res.status(400).json({ error: 'No se puede eliminar un lote con consumos registrados' });
            }
            await prisma.materialLot.delete({ where: { id } });
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },

    /**
     * GET /lots/stock-by-zone — aggregated stock per product per zone
     */
    getStockByZone: async (req, res) => {
        try {
            const { search } = req.query;

            // Get all lots with stock, grouped by zone + product
            const lotWhere = {
                currentQuantity: { gt: 0 },
                status: { in: ['AVAILABLE', 'LOW_STOCK'] }
            };

            const lots = await prisma.materialLot.findMany({
                where: lotWhere,
                select: {
                    id: true,
                    lotNumber: true,
                    currentQuantity: true,
                    initialQuantity: true,
                    unit: true,
                    zone: true,
                    status: true,
                    receivedAt: true,
                    expiresAt: true,
                    productId: true,
                    siigoProductName: true,
                    product: { select: { id: true, name: true, sku: true, unit: true } }
                },
                orderBy: { receivedAt: 'desc' }
            });

            // Get last consumption per product (for "last activity")
            const lastConsumptions = await prisma.$queryRaw`
                SELECT ml."productId", MAX(lc."usedAt") as last_consumed, ml.zone
                FROM lot_consumptions lc
                JOIN material_lots ml ON ml.id = lc."materialLotId"
                GROUP BY ml."productId", ml.zone`;
            const lastConsumedMap = {};
            lastConsumptions.forEach(r => {
                const key = `${r.productId}_${r.zone}`;
                lastConsumedMap[key] = r.last_consumed;
            });

            // Group by zone → product
            const grouped = {};
            for (const lot of lots) {
                const zone = lot.zone || 'WAREHOUSE';
                const pid = lot.productId || `unlinked_${lot.id}`;
                const key = `${zone}_${pid}`;
                const isUnlinked = !lot.productId;

                if (!grouped[key]) {
                    grouped[key] = {
                        zone,
                        productId: lot.productId || null,
                        productName: lot.product?.name || lot.siigoProductName || '(Sin producto)',
                        sku: lot.product?.sku || '',
                        unit: lot.unit || lot.product?.unit || 'gramo',
                        totalStock: 0,
                        lotCount: 0,
                        unlinked: isUnlinked,
                        lots: [],
                        lastReceived: null,
                        lastConsumed: lastConsumedMap[`${lot.productId}_${zone}`] || null
                    };
                }

                grouped[key].totalStock += lot.currentQuantity;
                grouped[key].lotCount++;
                grouped[key].lots.push({
                    id: lot.id,
                    lotNumber: lot.lotNumber,
                    currentQuantity: lot.currentQuantity,
                    initialQuantity: lot.initialQuantity,
                    siigoProductName: lot.siigoProductName || '',
                    status: lot.status,
                    receivedAt: lot.receivedAt,
                    expiresAt: lot.expiresAt
                });
                if (!grouped[key].lastReceived || lot.receivedAt > grouped[key].lastReceived) {
                    grouped[key].lastReceived = lot.receivedAt;
                }
            }

            // Convert to arrays per zone
            let allItems = Object.values(grouped);

            // Apply search filter
            if (search) {
                const s = search.toLowerCase();
                allItems = allItems.filter(i =>
                    i.productName.toLowerCase().includes(s) ||
                    i.sku?.toLowerCase().includes(s) ||
                    i.lots.some(l => l.lotNumber?.toLowerCase().includes(s) || l.siigoProductName?.toLowerCase().includes(s))
                );
            }

            // Sort by product name within each zone
            allItems.sort((a, b) => a.productName.localeCompare(b.productName));

            const result = {
                WAREHOUSE: allItems.filter(i => i.zone === 'WAREHOUSE'),
                PRODUCTION: allItems.filter(i => i.zone === 'PRODUCTION')
            };

            res.json(result);
        } catch (error) {
            console.error('getStockByZone error:', error.message);
            res.status(500).json({ error: error.message });
        }
    },

    /**
     * PATCH /lots/:id/link — link an orphaned lot to a product
     */
    linkLot: async (req, res) => {
        try {
            const { id } = req.params;
            const { productId } = req.body;
            if (!productId) return res.status(400).json({ error: 'productId es requerido' });

            const lot = await prisma.materialLot.findUnique({ where: { id } });
            if (!lot) return res.status(404).json({ error: 'Lote no encontrado' });

            const product = await prisma.product.findUnique({ where: { id: productId }, select: { id: true, name: true, sku: true } });
            if (!product) return res.status(404).json({ error: 'Producto no encontrado' });

            const updated = await prisma.materialLot.update({
                where: { id },
                data: {
                    productId,
                    siigoProductCode: product.sku || lot.siigoProductCode,
                    siigoProductName: product.name || lot.siigoProductName
                }
            });

            res.json({ success: true, lot: updated });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },

    /**
     * GET /lots/products-without-lots — products with stock but no active lots
     */
    getProductsWithoutLots: async (req, res) => {
        try {
            const { search } = req.query;

            const where = {
                currentStock: { gt: 0 },
                active: true
            };
            if (search) {
                where.OR = [
                    { name: { contains: search, mode: 'insensitive' } },
                    { sku: { contains: search, mode: 'insensitive' } }
                ];
            }

            const products = await prisma.product.findMany({
                where,
                select: {
                    id: true,
                    name: true,
                    sku: true,
                    type: true,
                    currentStock: true,
                    unit: true,
                    group: { select: { id: true, name: true } },
                    materialLots: {
                        where: { currentQuantity: { gt: 0 }, status: { in: ['AVAILABLE', 'LOW_STOCK'] } },
                        select: { id: true, currentQuantity: true }
                    }
                },
                orderBy: { name: 'asc' }
            });

            // Include products with NO lots OR with unassigned stock (siigo > sum of lots)
            const result = products
                .map(p => {
                    const assignedStock = p.materialLots.reduce((sum, l) => sum + l.currentQuantity, 0);
                    const unassigned = p.currentStock - assignedStock;
                    return {
                        id: p.id,
                        name: p.name,
                        sku: p.sku,
                        type: p.type,
                        groupId: p.group?.id || null,
                        groupName: p.group?.name || 'Sin Grupo',
                        siigoStock: p.currentStock,
                        assignedStock,
                        unassignedStock: Math.max(0, unassigned),
                        activeLots: p.materialLots.length,
                        unit: p.unit,
                        status: p.materialLots.length === 0 ? 'sin_lotes' : 'parcial'
                    };
                })
                .filter(p => p.activeLots === 0 || p.unassignedStock > 0);

            res.json(result);
        } catch (error) {
            console.error('getProductsWithoutLots error:', error.message);
            res.status(500).json({ error: error.message });
        }
    }
};

module.exports = lotController;

