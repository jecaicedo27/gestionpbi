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
                    product: { select: { id: true, name: true, sku: true, unit: true, currentStock: true, warehouses: true, accountGroup: true } },
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

            // Look up product for SKU/name and group
            const product = await prisma.product.findUnique({
                where: { id: productId },
                select: { sku: true, name: true, currentStock: true, group: { select: { name: true } } }
            });
            if (!product) return res.status(404).json({ error: 'Producto no encontrado' });

            // ── Route finished products (LIQUIPOPS/GENIALITY) → FinishedLotStock ──
            const FINISHED_GROUPS = ['LIQUIPOPS', 'GENIALITY'];
            const isFinishedProduct = FINISHED_GROUPS.includes(product.group?.name?.toUpperCase());

            if (isFinishedProduct) {
                // Check for active duplicate: productId + lotNumber + zone (the unique constraint)
                const existing = await prisma.finishedLotStock.findFirst({
                    where: { productId, lotNumber, zone: 'PRODUCCION' }
                });
                if (existing && existing.currentQuantity > 0) {
                    return res.status(400).json({ error: `Ya existe un lote activo con número ${lotNumber} en zona Producción` });
                }

                // Upsert: reactivate depleted record OR create new
                let fls;
                if (existing) {
                    fls = await prisma.finishedLotStock.update({
                        where: { id: existing.id },
                        data: {
                            initialQuantity: qty,
                            currentQuantity: qty,
                            status: 'AVAILABLE',
                            expiresAt: expiresAt ? new Date(expiresAt) : null,
                        },
                        include: { product: { select: { id: true, name: true, sku: true } } }
                    });
                } else {
                    fls = await prisma.finishedLotStock.create({
                        data: {
                            productId,
                            lotNumber,
                            zone: 'PRODUCCION',
                            initialQuantity: qty,
                            currentQuantity: qty,
                            status: 'AVAILABLE',
                            expiresAt: expiresAt ? new Date(expiresAt) : null,
                        },
                        include: { product: { select: { id: true, name: true, sku: true } } }
                    });
                }

                return res.status(201).json({ ...fls, _type: 'FinishedLotStock' });
            }


            // ── Raw materials / intermediates → MaterialLot (original behavior) ──
            // Note: We allow creating lots even if they exceed Siigo stock.
            // Siigo sync can lag behind physical receipts, so hard-blocking is too restrictive.
            const existingLots = await prisma.materialLot.findMany({
                where: { productId, currentQuantity: { gt: 0 } },
                select: { currentQuantity: true }
            });
            const totalAssigned = existingLots.reduce((sum, l) => sum + l.currentQuantity, 0);
            const siigoStock = product.currentStock || 0;
            const available = Math.max(0, siigoStock - totalAssigned);

            if (qty > available) {
                console.warn(`⚠️ Lote excede stock disponible: ${qty}g > ${available}g (Siigo: ${siigoStock}g, asignado: ${totalAssigned}g) — producto: ${product.name}`);
            }

            const lot = await prisma.materialLot.create({
                data: {
                    productId,
                    siigoProductCode: product.sku,
                    siigoProductName: product.name,
                    lotNumber,
                    initialQuantity: qty,
                    currentQuantity: qty,
                    unit: product.unit || unit || 'gramo',
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
                            zone: true,
                            product: { select: { name: true } }
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

            const consumptionRows = consumptions.map(c => {
                // Prefer linked product name over raw siigoProductName for display
                const displayName = c.materialLot?.product?.name || c.materialLot?.siigoProductName;
                return {
                    ...c,
                    materialLot: c.materialLot ? { ...c.materialLot, siigoProductName: displayName } : c.materialLot,
                    type: 'CONSUMPTION',
                    date: c.usedAt,
                    quantity: -c.quantityUsed,
                    unit: c.materialLot?.unit || 'gramo',
                    zone: c.materialLot?.zone || null,
                    processInfo: c.assemblyNoteId ? noteMap[c.assemblyNoteId] || null : null
                };
            });

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
                // Lots always originate in WAREHOUSE (PO or manual). Only production-output lots start in PRODUCTION.
                const originZone = isPO ? 'WAREHOUSE' : (p.zone || 'PRODUCTION');
                return {
                    id: `${isPO ? 'ingress' : 'prod'}-${p.id}`,
                    type: isPO ? 'INGRESS' : 'PRODUCTION',
                    date: p.receivedAt,
                    quantity: p.initialQuantity,
                    unit: p.unit || 'gramo',
                    zone: originZone,
                    materialLot: {
                        id: p.id,
                        lotNumber: p.lotNumber,
                        siigoProductCode: p.siigoProductCode,
                        siigoProductName: p.siigoProductName,
                        initialQuantity: p.initialQuantity,
                        currentQuantity: p.currentQuantity,
                        unit: p.unit,
                        zone: p.zone
                    },
                    materialLotId: p.id,
                    usedBy: null,
                    processInfo: isPO ? { stageName: `OC ${poInfo?.orderNumber || ''}`, productionBatch: null } : null,
                    observations: isPO ? `Compra — ${poInfo?.supplierName || 'Proveedor'}` : 'Producción'
                };
            });

            // ── 3. Zone Transfers (bidirectional — each transfer creates egress + ingress) ──
            const ztWhere = {};
            if (productId) ztWhere.productId = productId;
            if (sku) ztWhere.materialLot = { siigoProductCode: sku };
            if (startDate || endDate) {
                ztWhere.createdAt = {};
                if (startDate) ztWhere.createdAt.gte = new Date(startDate);
                if (endDate) ztWhere.createdAt.lte = new Date(endDate + 'T23:59:59');
            }

            const zoneTransfers = await prisma.zoneTransfer.findMany({
                where: ztWhere,
                orderBy: { createdAt: 'desc' },
                take: maxRows,
                include: {
                    materialLot: {
                        select: {
                            id: true,
                            lotNumber: true,
                            siigoProductCode: true,
                            siigoProductName: true,
                            initialQuantity: true,
                            currentQuantity: true,
                            unit: true,
                            zone: true
                        }
                    },
                    transferredBy: { select: { id: true, name: true, role: true } }
                }
            });

            const transferRows = [];
            zoneTransfers.forEach(zt => {
                // direction: IN = bodega→producción, OUT = producción→bodega
                const fromZone = zt.direction === 'IN' ? 'WAREHOUSE' : 'PRODUCTION';
                const toZone = zt.direction === 'IN' ? 'PRODUCTION' : 'WAREHOUSE';
                const lotData = zt.materialLot ? {
                    id: zt.materialLot.id,
                    lotNumber: zt.materialLot.lotNumber,
                    siigoProductCode: zt.materialLot.siigoProductCode,
                    siigoProductName: zt.materialLot.siigoProductName,
                    initialQuantity: zt.materialLot.initialQuantity,
                    currentQuantity: zt.materialLot.currentQuantity,
                    unit: zt.materialLot.unit,
                    zone: zt.materialLot.zone
                } : null;

                const destLot = zt.materialLot ? materialLots.find(l => 
                    l.siigoProductCode === zt.materialLot.siigoProductCode && 
                    l.lotNumber === zt.materialLot.lotNumber && 
                    l.zone === toZone
                ) : null;

                const destLotData = destLot ? {
                    id: destLot.id,
                    lotNumber: destLot.lotNumber,
                    siigoProductCode: destLot.siigoProductCode,
                    siigoProductName: destLot.siigoProductName,
                    initialQuantity: destLot.initialQuantity,
                    currentQuantity: destLot.currentQuantity,
                    unit: destLot.unit,
                    zone: toZone
                } : (zt.materialLot ? { ...lotData, currentQuantity: 0, zone: toZone } : null);

                // Row 1: EGRESS from source zone
                transferRows.push({
                    id: `zt-out-${zt.id}`,
                    type: 'TRANSFER_OUT',
                    date: zt.createdAt,
                    quantity: -zt.quantity,
                    unit: zt.unit || 'gramo',
                    zone: fromZone,
                    materialLot: lotData,
                    materialLotId: zt.materialLotId,
                    usedBy: zt.transferredBy,
                    processInfo: null,
                    observations: `Traslado → ${toZone === 'PRODUCTION' ? 'Producción' : 'Bodega'}`
                });
                // Row 2: INGRESS to destination zone
                transferRows.push({
                    id: `zt-in-${zt.id}`,
                    type: 'TRANSFER_IN',
                    date: zt.createdAt,
                    quantity: zt.quantity,
                    unit: zt.unit || 'gramo',
                    zone: toZone,
                    materialLot: destLotData || lotData,
                    materialLotId: destLot ? destLot.id : zt.materialLotId,
                    usedBy: zt.transferredBy,
                    processInfo: null,
                    observations: `Traslado ← ${fromZone === 'WAREHOUSE' ? 'Bodega' : 'Producción'}`
                });
            });

            // ── 4. FinishedLotTransfer (finished product zone transfers: PROD→PT, PROD→NC) ──
            const fltWhere = {};
            if (startDate || endDate) {
                fltWhere.createdAt = {};
                if (startDate) fltWhere.createdAt.gte = new Date(startDate);
                if (endDate) fltWhere.createdAt.lte = new Date(endDate + 'T23:59:59');
            }

            const finishedTransfers = await prisma.finishedLotTransfer.findMany({
                where: fltWhere,
                orderBy: { createdAt: 'desc' },
                take: maxRows,
                include: {
                    product: { select: { id: true, name: true, sku: true, unit: true } },
                    transferredBy: { select: { id: true, name: true, role: true } },
                },
            });

            const finishedTransferRows = [];
            if (finishedTransfers.length > 0) {
                // Query actual current stock in PRODUCCION for accurate "remaining" display
                const fltProductIds = [...new Set(finishedTransfers.filter(ft => ft.fromZone !== ft.toZone).map(ft => ft.productId))];
                const fltLotNumbers = [...new Set(finishedTransfers.filter(ft => ft.fromZone !== ft.toZone).map(ft => ft.lotNumber))];
                const currentStocks = fltProductIds.length > 0 ? await prisma.finishedLotStock.findMany({
                    where: { productId: { in: fltProductIds }, lotNumber: { in: fltLotNumbers }, zone: 'PRODUCCION' },
                    select: { productId: true, lotNumber: true, currentQuantity: true, initialQuantity: true },
                }) : [];
                const stockMap = {};
                currentStocks.forEach(s => { stockMap[`${s.productId}_${s.lotNumber}`] = s; });

                finishedTransfers.forEach(ft => {
                    if (ft.fromZone === ft.toZone) return; // skip ingestion records
                    const prodName = ft.product?.name || '';
                    const stockKey = `${ft.productId}_${ft.lotNumber}`;
                    const actualStock = stockMap[stockKey];
                    const lotData = {
                        id: `flt-${ft.id}`,
                        lotNumber: ft.lotNumber,
                        siigoProductCode: ft.product?.sku || '',
                        siigoProductName: prodName,
                        initialQuantity: actualStock?.initialQuantity ?? ft.quantity,
                        currentQuantity: actualStock?.currentQuantity ?? 0,
                        unit: ft.product?.unit || 'unidad',
                        zone: 'PRODUCTION',
                    };
                    const zoneName = (z) => z === 'PRODUCCION' ? 'Producción' : z === 'PRODUCTO_TERMINADO' ? 'Producto Terminado' : z === 'NO_CONFORME' ? 'No Conforme' : z === 'BODEGA' ? 'Bodega' : z === 'CUARENTENA' ? 'Cuarentena' : z === 'MAQUILA' ? 'Maquila' : z;
                    // Egress from source zone
                    finishedTransferRows.push({
                        id: `flt-out-${ft.id}`,
                        type: 'TRANSFER_OUT',
                        date: ft.createdAt,
                        quantity: -ft.quantity,
                        unit: ft.product?.unit || 'unidad',
                        zone: 'PRODUCTION',
                        materialLot: lotData,
                        materialLotId: `flt-${ft.id}`,
                        usedBy: ft.transferredBy,
                        processInfo: null,
                        observations: `${zoneName(ft.fromZone)} → ${zoneName(ft.toZone)}`,
                    });
                    // Ingress to destination zone
                    finishedTransferRows.push({
                        id: `flt-in-${ft.id}`,
                        type: 'TRANSFER_IN',
                        date: ft.createdAt,
                        quantity: ft.quantity,
                        unit: ft.product?.unit || 'unidad',
                        zone: ft.toZone === 'PRODUCTO_TERMINADO' ? 'WAREHOUSE' : 'PRODUCTION',
                        materialLot: lotData,
                        materialLotId: `flt-${ft.id}`,
                        usedBy: ft.transferredBy,
                        processInfo: null,
                        observations: `${zoneName(ft.fromZone)} → ${zoneName(ft.toZone)}`,
                    });
                });
            }

            // ── 5. Merge & sort by date desc ──
            let all = [...consumptionRows, ...lotRows, ...transferRows, ...finishedTransferRows]
                .sort((a, b) => new Date(b.date) - new Date(a.date));

            // ── 5. Optional zone filter (BEFORE slice to avoid losing older entries) ──
            if (zone) {
                all = all.filter(r => r.zone === zone);
            }
            all = all.slice(0, maxRows);

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
            // Try MaterialLot first
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
            if (lot) return res.json(lot);

            // Fallback: try FinishedLotStock (from finished zone)
            const fls = await prisma.finishedLotStock.findUnique({
                where: { id },
                include: {
                    product: { select: { id: true, name: true, sku: true } },
                    transfers: {
                        orderBy: { createdAt: 'desc' },
                        include: {
                            transferredBy: { select: { id: true, name: true } }
                        }
                    }
                }
            });
            if (!fls) return res.status(404).json({ error: 'Lote no encontrado' });

            // Map transfers to same shape as consumptions for frontend compatibility
            const consumptions = fls.transfers.map(t => ({
                id: t.id,
                quantityUsed: t.quantity,
                usedAt: t.createdAt,
                usedBy: t.transferredBy,
                observations: `${t.fromZone} → ${t.toZone}${t.reason ? ': ' + t.reason : ''}`,
            }));
            res.json({ ...fls, consumptions });
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
            // Try MaterialLot first
            const lot = await prisma.materialLot.findUnique({
                where: { id },
                include: { _count: { select: { consumptions: true } } }
            });
            if (lot) {
                if (lot._count.consumptions > 0) {
                    return res.status(400).json({ error: 'No se puede eliminar un lote con consumos registrados' });
                }
                await prisma.materialLot.delete({ where: { id } });
                return res.json({ success: true });
            }

            // Fallback: try FinishedLotStock
            const fls = await prisma.finishedLotStock.findUnique({
                where: { id },
                include: { _count: { select: { transfers: true } } }
            });
            if (!fls) return res.status(404).json({ error: 'Lote no encontrado' });
            if (fls._count.transfers > 0) {
                return res.status(400).json({ error: 'No se puede eliminar un lote con transferencias registradas' });
            }
            await prisma.finishedLotStock.delete({ where: { id } });
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

