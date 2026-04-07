/**
 * receptionController.js — Handles partial receptions for Purchase Orders
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const logger = require('../utils/logger');

const normalizeDigits = (value) => String(value || '').replace(/\D/g, '');
const extractTrailingNumber = (value) => {
    const matches = String(value || '').match(/\d+/g);
    if (!matches || matches.length === 0) return '';
    return String(parseInt(matches[matches.length - 1], 10));
};
const supplierNamesMatch = (left, right) => {
    const a = String(left || '').trim().toUpperCase();
    const b = String(right || '').trim().toUpperCase();
    if (!a || !b) return false;
    return a.includes(b) || b.includes(a) || a.split(' ')[0] === b.split(' ')[0];
};

/**
 * POST /procurement/receptions
 */
exports.create = async (req, res) => {
    try {
        const { purchaseOrderId, observations, items } = req.body;
        // Nota: photoProductUrl y photoInvoiceUrl eliminados (Fase 8) — usar invoiceImageUrls / receptionPhotoUrls

        if (!purchaseOrderId || !items?.length) {
            return res.status(400).json({ error: 'Faltan datos de recepción' });
        }

        const order = await prisma.purchaseOrder.findUnique({
            where: { id: purchaseOrderId },
            include: { items: true }
        });
        if (!order) return res.status(404).json({ error: 'OC no encontrada' });
        if (!['SENT', 'PAID', 'PARTIALLY_RECEIVED'].includes(order.status)) {
            return res.status(400).json({ error: `OC en estado ${order.status} no puede recibir mercancía` });
        }

        // Create reception with items
        const reception = await prisma.reception.create({
            data: {
                purchaseOrderId,
                receivedById: req.user.id,
                observations: observations || null,
                status: 'RECEIVED',
                items: {
                    create: items.map(item => ({
                        orderItemId: item.orderItemId,
                        quantityExpected: item.quantityExpected,
                        quantityReceived: item.quantityReceived,
                        discrepancyNote: item.discrepancyNote || null
                    }))
                }
            },
            include: { items: true }
        });

        // Update accumulated received quantity on each PO item
        for (const item of items) {
            await prisma.purchaseOrderItem.update({
                where: { id: item.orderItemId },
                data: { quantityReceived: { increment: item.quantityReceived } }
            });
        }

        // Update PO status: check if all items are fully received
        const updatedItems = await prisma.purchaseOrderItem.findMany({
            where: { purchaseOrderId }
        });
        const allReceived = updatedItems.every(i => i.quantityReceived >= i.quantityOrdered);
        await prisma.purchaseOrder.update({
            where: { id: purchaseOrderId },
            data: { status: allReceived ? 'ACCOUNTING_PENDING' : 'PARTIALLY_RECEIVED' }
        });

        logger.info(`📦 Recepción creada para OC ${order.orderNumber} por ${req.user.name}`);
        res.status(201).json(reception);
    } catch (error) {
        logger.error('Error creating reception:', error.message);
        res.status(500).json({ error: 'Error registrando recepción' });
    }
};

/**
 * GET /procurement/receptions/:id
 */
exports.getById = async (req, res) => {
    try {
        const reception = await prisma.reception.findUnique({
            where: { id: req.params.id },
            include: {
                items: { include: { orderItem: true } },
                receivedBy: { select: { name: true } },
                accountingUser: { select: { name: true } },
                purchaseOrder: { select: { orderNumber: true, supplierName: true } }
            }
        });
        if (!reception) return res.status(404).json({ error: 'Recepción no encontrada' });
        res.json(reception);
    } catch (error) {
        logger.error('Error getting reception:', error.message);
        res.status(500).json({ error: 'Error obteniendo recepción' });
    }
};

/**
 * PUT /procurement/receptions/:id/validate — Accounting validates + creates Siigo purchase invoice
 */
exports.validate = async (req, res) => {
    try {
        const { accountingNotes, itemCosts, providerInvoiceNumber, providerInvoicePrefix, siigoCompraCode, siigoSyncData } = req.body;

        // Fetch reception with items + order + supplier
        const reception = await prisma.reception.findUnique({
            where: { id: req.params.id },
            include: {
                items: { include: { orderItem: true } },
                purchaseOrder: {
                    include: { supplier: true }
                }
            }
        });
        if (!reception) return res.status(404).json({ error: 'Recepción no encontrada' });

        // Require invoice photo from provider
        const invoices = reception.invoiceImageUrls || [];
        if (!Array.isArray(invoices) || invoices.length === 0) {
            return res.status(400).json({ error: 'Debe subir la factura del proveedor antes de validar contablemente' });
        }

        // Require provider invoice number
        if (!providerInvoiceNumber || !providerInvoiceNumber.trim()) {
            return res.status(400).json({ error: 'Debe ingresar el número de factura del proveedor' });
        }

        if (!siigoSyncData || typeof siigoSyncData !== 'object') {
            return res.status(400).json({ error: 'Debe sincronizar la compra exacta de Siigo antes de validar contablemente' });
        }

        const requestedPurchaseNumber = extractTrailingNumber(siigoCompraCode);
        const syncedPurchaseNumber = extractTrailingNumber(siigoSyncData.number ?? siigoSyncData.name);
        if (!requestedPurchaseNumber || !syncedPurchaseNumber || requestedPurchaseNumber !== syncedPurchaseNumber) {
            return res.status(400).json({
                error: `La compra sincronizada no coincide con la solicitada. Se pidió ${requestedPurchaseNumber || siigoCompraCode || 'N/A'} y Siigo devolvió ${syncedPurchaseNumber || siigoSyncData.name || 'otra compra'}.`
            });
        }

        const expectedSupplierNit = normalizeDigits(reception.purchaseOrder.supplierNit || reception.purchaseOrder.supplier?.identification);
        const syncedSupplierNit = normalizeDigits(siigoSyncData.supplier?.identification);
        const supplierMatches = expectedSupplierNit && syncedSupplierNit
            ? expectedSupplierNit === syncedSupplierNit
            : supplierNamesMatch(reception.purchaseOrder.supplierName, siigoSyncData.supplier?.name);

        if (!supplierMatches) {
            return res.status(400).json({
                error: `La compra sincronizada pertenece a otro proveedor: ${siigoSyncData.supplier?.name || 'Desconocido'}.`
            });
        }

        // Build Siigo reference from sync data
        const siigoInvoiceRef = siigoSyncData?.name || (syncedPurchaseNumber ? `Compra ${syncedPurchaseNumber}` : null);

        // Update reception
        const updated = await prisma.reception.update({
            where: { id: req.params.id },
            data: {
                status: 'COMPLETED',
                accountingUserId: req.user.id,
                accountingAt: new Date(),
                siigoRef: siigoInvoiceRef,
                siigoPurchaseId: siigoSyncData?.siigoId || null,
                accountingNotes: accountingNotes || null,
                providerInvoiceNumber: providerInvoiceNumber || null,
                itemCosts: itemCosts || null
            }
        });

        // Update unit costs on PO items if provided
        if (itemCosts && typeof itemCosts === 'object') {
            for (const [itemId, costData] of Object.entries(itemCosts)) {
                const unitCost = typeof costData === 'object' ? costData.unitCostPerKg : parseFloat(costData);
                await prisma.purchaseOrderItem.update({
                    where: { id: itemId },
                    data: { unitCost }
                });
            }
        }

        // Check if all receptions for this PO are validated
        const pendingReceptions = await prisma.reception.count({
            where: {
                purchaseOrderId: reception.purchaseOrderId,
                status: { not: 'COMPLETED' }
            }
        });
        if (pendingReceptions === 0) {
            await prisma.purchaseOrder.update({
                where: { id: reception.purchaseOrderId },
                data: { status: 'COMPLETED' }
            });
        }

        logger.info(`💰 Recepción validada por contabilidad: ${req.user.name} — Siigo ref: ${siigoInvoiceRef || 'N/A'}`);
        res.json(updated);
    } catch (error) {
        logger.error('Error validating reception:', error.message);
        res.status(500).json({ error: 'Error validando recepción' });
    }
};

/**
 * POST /procurement/lots — Create material lots from reception
 */
exports.createLots = async (req, res) => {
    try {
        const { purchaseOrderItemId, lots } = req.body;

        if (!lots?.length) return res.status(400).json({ error: 'No se proporcionaron lotes' });

        const orderItem = await prisma.purchaseOrderItem.findUnique({
            where: { id: purchaseOrderItemId },
            include: {
                lots: { select: { initialQuantity: true } }
            }
        });
        if (!orderItem) return res.status(404).json({ error: 'Item de OC no encontrado' });

        // Validate: total lots (existing + new) cannot exceed quantityReceived
        const existingLotsTotal = (orderItem.lots || []).reduce((sum, l) => sum + l.initialQuantity, 0);
        const newLotsTotal = lots.reduce((sum, l) => sum + (l.quantity || 0), 0);
        const totalAfter = existingLotsTotal + newLotsTotal;
        const maxAllowed = orderItem.quantityReceived || 0;

        if (totalAfter > maxAllowed) {
            const remaining = maxAllowed - existingLotsTotal;
            return res.status(400).json({
                error: `La suma de lotes (${(totalAfter / 1000).toLocaleString()} kg) excede lo recibido (${(maxAllowed / 1000).toLocaleString()} kg). Disponible para lotear: ${(remaining / 1000).toLocaleString()} kg`
            });
        }

        // Validate individual lots have valid data
        for (const lot of lots) {
            if (!lot.lotNumber?.trim()) return res.status(400).json({ error: 'Todos los lotes deben tener número de lote' });
            if (!lot.quantity || lot.quantity <= 0) return res.status(400).json({ error: 'La cantidad de cada lote debe ser mayor a 0' });
        }

        // Resolve productId by SKU (so lot appears in inventory)
        let resolvedProductId = orderItem.productId || null;
        if (!resolvedProductId && orderItem.siigoProductCode) {
            const product = await prisma.product.findFirst({
                where: { sku: orderItem.siigoProductCode },
                select: { id: true }
            });
            if (product) resolvedProductId = product.id;
        }

        // Resolve product unit for correct lot creation
        let productUnit = 'gramo';
        if (resolvedProductId) {
            const prod = await prisma.product.findUnique({
                where: { id: resolvedProductId },
                select: { unit: true }
            });
            if (prod?.unit) productUnit = prod.unit;
        }

        const created = [];
        for (const lot of lots) {
            const materialLot = await prisma.materialLot.create({
                data: {
                    purchaseOrderItemId,
                    productId: resolvedProductId,
                    siigoProductCode: orderItem.siigoProductCode,
                    siigoProductName: orderItem.siigoProductName,
                    lotNumber: lot.lotNumber,
                    initialQuantity: lot.quantity,
                    currentQuantity: lot.quantity,
                    unit: productUnit,
                    expiresAt: lot.expiresAt ? new Date(lot.expiresAt) : null,
                    qrData: JSON.stringify({
                        lot: lot.lotNumber,
                        sku: orderItem.siigoProductCode,
                        name: orderItem.siigoProductName,
                        qty: lot.quantity,
                        received: new Date().toISOString().slice(0, 10)
                    })
                }
            });
            created.push(materialLot);
        }

        logger.info(`🏷️ ${created.length} lotes creados para ${orderItem.siigoProductName} — Total: ${(newLotsTotal / 1000).toFixed(1)} kg`);
        res.status(201).json(created);
    } catch (error) {
        logger.error('Error creating lots:', error.message, error.stack);
        res.status(500).json({ error: 'Error creando lotes: ' + error.message });
    }
};

/**
 * GET /procurement/lots — List available lots, optionally filter by SKU
 */
exports.listLots = async (req, res) => {
    try {
        const { sku, status = 'AVAILABLE' } = req.query;
        const where = {};
        if (sku) where.siigoProductCode = sku;
        if (status !== 'ALL') where.status = status;

        const lots = await prisma.materialLot.findMany({
            where,
            orderBy: { receivedAt: 'asc' }, // FIFO order
            include: {
                purchaseOrderItem: {
                    select: {
                        purchaseOrder: { select: { orderNumber: true, supplierName: true } }
                    }
                }
            }
        });
        res.json(lots);
    } catch (error) {
        logger.error('Error listing lots:', error.message);
        res.status(500).json({ error: 'Error listando lotes' });
    }
};

/**
 * GET /procurement/lots/stock-summary — Stock summary per SKU
 */
exports.stockSummary = async (req, res) => {
    try {
        const stocks = await prisma.materialLot.groupBy({
            by: ['siigoProductCode', 'siigoProductName'],
            where: { status: { in: ['AVAILABLE', 'LOW_STOCK'] } },
            _sum: { currentQuantity: true },
            _count: { id: true }
        });

        const result = stocks.map(s => ({
            sku: s.siigoProductCode,
            name: s.siigoProductName,
            totalGrams: s._sum.currentQuantity || 0,
            totalKg: Math.round((s._sum.currentQuantity || 0) / 1000),
            lotCount: s._count.id
        })).sort((a, b) => a.name.localeCompare(b.name));

        res.json(result);
    } catch (error) {
        logger.error('Error getting stock summary:', error.message);
        res.status(500).json({ error: 'Error obteniendo resumen de inventario' });
    }
};
