/**
 * receptionController.js — Handles partial receptions for Purchase Orders
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const logger = require('../utils/logger');
const {
    buildPurchaseOrderWorkflowAlert,
    emitPurchaseOrderWorkflowAlert
} = require('../services/purchaseOrderAlertService');
const {
    storeMaterialLotAttachment,
    cleanupStoredMaterialLotFiles
} = require('../services/materialLotAttachmentService');

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
const parseLotsPayload = (value) => {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }
    return [];
};
const normalizeAttachmentType = (value) => {
    const normalized = String(value || '').trim().toUpperCase();
    return normalized === 'FICHA_TECNICA' ? 'FICHA_TECNICA' : 'CERTIFICADO_CALIDAD';
};
const isRawMaterialSku = (sku) => String(sku || '').toUpperCase().startsWith('MP');

let materialLotAttachmentTableAvailableCache = null;
const hasMaterialLotAttachmentTable = async () => {
    if (typeof materialLotAttachmentTableAvailableCache === 'boolean') {
        return materialLotAttachmentTableAvailableCache;
    }

    try {
        const result = await prisma.$queryRawUnsafe(
            "SELECT to_regclass('public.material_lot_attachments') AS table_name"
        );
        materialLotAttachmentTableAvailableCache = Boolean(result?.[0]?.table_name);
    } catch (error) {
        logger.warn(`No se pudo validar material_lot_attachments: ${error.message}`);
        materialLotAttachmentTableAvailableCache = false;
    }

    return materialLotAttachmentTableAvailableCache;
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

        const orderItemsById = new Map(order.items.map(item => [item.id, item]));
        const seenItems = new Set();
        const receivedItems = [];

        for (const item of items) {
            const quantityReceived = Number(item.quantityReceived || 0);
            if (quantityReceived <= 0) continue;

            if (seenItems.has(item.orderItemId)) {
                return res.status(400).json({ error: 'Hay productos repetidos en la recepción' });
            }
            seenItems.add(item.orderItemId);

            const orderItem = orderItemsById.get(item.orderItemId);
            if (!orderItem) {
                return res.status(400).json({ error: 'La recepción incluye un producto que no pertenece a esta OC' });
            }

            const remaining = Math.max(0, orderItem.quantityOrdered - orderItem.quantityReceived);
            if (quantityReceived > remaining) {
                return res.status(400).json({
                    error: `${orderItem.siigoProductName} excede lo pendiente por recibir. Pendiente: ${remaining.toLocaleString()} g`
                });
            }

            receivedItems.push({
                orderItemId: item.orderItemId,
                quantityExpected: Number(item.quantityExpected ?? remaining),
                quantityReceived,
                discrepancyNote: item.discrepancyNote || null
            });
        }

        if (receivedItems.length === 0) {
            return res.status(400).json({ error: 'Debe registrar al menos un producto con cantidad recibida mayor a 0' });
        }

        const { reception, updatedOrder, allReceived } = await prisma.$transaction(async (tx) => {
            const createdReception = await tx.reception.create({
                data: {
                    purchaseOrderId,
                    receivedById: req.user.id,
                    observations: observations || null,
                    status: 'RECEIVED',
                    items: { create: receivedItems }
                },
                include: { items: true }
            });

            for (const item of receivedItems) {
                await tx.purchaseOrderItem.update({
                    where: { id: item.orderItemId },
                    data: { quantityReceived: { increment: item.quantityReceived } }
                });
            }

            const updatedItems = await tx.purchaseOrderItem.findMany({
                where: { purchaseOrderId }
            });
            const allItemsReceived = updatedItems.every(i => i.quantityReceived >= i.quantityOrdered);
            const orderAfterReception = await tx.purchaseOrder.update({
                where: { id: purchaseOrderId },
                data: { status: allItemsReceived ? 'ACCOUNTING_PENDING' : 'PARTIALLY_RECEIVED' }
            });

            return {
                reception: createdReception,
                updatedOrder: orderAfterReception,
                allReceived: allItemsReceived
            };
        });

        emitPurchaseOrderWorkflowAlert(
            req,
            buildPurchaseOrderWorkflowAlert('ACCOUNTING_PENDING', updatedOrder, {
                receptionId: reception.id,
                message: allReceived
                    ? `La OC ${updatedOrder.orderNumber} de ${updatedOrder.supplierName} ya fue recibida completa por Logística y está lista para contabilizar.`
                    : `La OC ${updatedOrder.orderNumber} de ${updatedOrder.supplierName} tiene una recepción parcial lista para contabilizar. Lo faltante queda pendiente por recibir.`
            })
        );

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

        const [orderItemsState, pendingReceptions] = await Promise.all([
            prisma.purchaseOrderItem.findMany({
                where: { purchaseOrderId: reception.purchaseOrderId },
                select: { quantityOrdered: true, quantityReceived: true }
            }),
            prisma.reception.count({
                where: {
                    purchaseOrderId: reception.purchaseOrderId,
                    status: { not: 'COMPLETED' },
                    items: { some: { quantityReceived: { gt: 0 } } }
                }
            })
        ]);

        const allItemsReceived = orderItemsState.every(item => item.quantityReceived >= item.quantityOrdered);
        const nextOrderStatus = allItemsReceived
            ? (pendingReceptions === 0 ? 'COMPLETED' : 'ACCOUNTING_PENDING')
            : 'PARTIALLY_RECEIVED';

        const completedOrder = await prisma.purchaseOrder.update({
            where: { id: reception.purchaseOrderId },
            data: { status: nextOrderStatus }
        });

        if (nextOrderStatus === 'COMPLETED') {
            if (completedOrder.paymentMethod === 'CREDITO' && !completedOrder.creditPaid) {
                emitPurchaseOrderWorkflowAlert(
                    req,
                    buildPurchaseOrderWorkflowAlert('CREDIT_PAYMENT_PENDING', completedOrder, { receptionId: reception.id })
                );
            }
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
    const storedFiles = [];
    try {
        const attachmentsTableAvailable = await hasMaterialLotAttachmentTable();
        const purchaseOrderItemId = req.body.purchaseOrderItemId;
        const lots = parseLotsPayload(req.body.lots);

        if (!lots?.length) return res.status(400).json({ error: 'No se proporcionaron lotes' });

        const orderItem = await prisma.purchaseOrderItem.findUnique({
            where: { id: purchaseOrderItemId },
            include: {
                lots: { select: { initialQuantity: true } },
                purchaseOrder: {
                    select: { receptions: { select: { siigoRef: true } } }
                }
            }
        });
        if (!orderItem) return res.status(404).json({ error: 'Item de OC no encontrado' });

        const resolvedProduct = orderItem.productId
            ? await prisma.product.findUnique({
                where: { id: orderItem.productId },
                select: { id: true, type: true, unit: true }
            })
            : await prisma.product.findFirst({
                where: { sku: orderItem.siigoProductCode },
                select: { id: true, type: true, unit: true }
            });

        const requiresTechnicalSupport = resolvedProduct?.type === 'MATERIA_PRIMA' || isRawMaterialSku(orderItem.siigoProductCode);

        const accountedReceived = await prisma.receptionItem.aggregate({
            where: {
                orderItemId: purchaseOrderItemId,
                quantityReceived: { gt: 0 },
                reception: { is: { siigoRef: { not: null } } }
            },
            _sum: { quantityReceived: true }
        });
        const accountedReceivedQty = accountedReceived._sum.quantityReceived || 0;

        if (accountedReceivedQty <= 0) {
            return res.status(400).json({ error: 'No se puede lotear sin una recepción validada por Contabilidad en Siigo para este producto.' });
        }

        // Validate: total lots (existing + new) cannot exceed quantityReceived
        const existingLotsTotal = (orderItem.lots || []).reduce((sum, l) => sum + l.initialQuantity, 0);
        const newLotsTotal = lots.reduce((sum, l) => sum + (l.quantity || 0), 0);
        const totalAfter = existingLotsTotal + newLotsTotal;
        const maxAllowed = accountedReceivedQty;

        if (totalAfter > maxAllowed) {
            const remaining = maxAllowed - existingLotsTotal;
            return res.status(400).json({
                error: `La suma de lotes (${(totalAfter / 1000).toLocaleString()} kg) excede lo recibido y contabilizado (${(maxAllowed / 1000).toLocaleString()} kg). Disponible para lotear: ${(remaining / 1000).toLocaleString()} kg`
            });
        }

        const filesByField = new Map();
        for (const file of req.files || []) {
            const current = filesByField.get(file.fieldname) || [];
            current.push(file);
            filesByField.set(file.fieldname, current);
        }

        // Validate individual lots have valid data
        for (let index = 0; index < lots.length; index += 1) {
            const lot = lots[index];
            const attachmentFiles = filesByField.get(`lotAttachments_${index}`) || [];
            if (!lot.lotNumber?.trim()) return res.status(400).json({ error: 'Todos los lotes deben tener número de lote' });
            if (!lot.quantity || lot.quantity <= 0) return res.status(400).json({ error: 'La cantidad de cada lote debe ser mayor a 0' });
            if (!lot.expiresAt?.trim()) return res.status(400).json({ error: 'Todos los lotes deben tener fecha de vencimiento' });
            if (requiresTechnicalSupport && attachmentFiles.length === 0) {
                return res.status(400).json({ error: 'Cada lote de materia prima debe incluir certificado de calidad o ficha técnica.' });
            }
        }

        // Resolve productId by SKU (so lot appears in inventory)
        let resolvedProductId = resolvedProduct?.id || orderItem.productId || null;

        // Resolve product unit for correct lot creation
        const productUnit = resolvedProduct?.unit || 'gramo';

        const created = await prisma.$transaction(async (tx) => {
            const materialLots = [];
            for (let index = 0; index < lots.length; index += 1) {
                const lot = lots[index];
                const materialLot = await tx.materialLot.create({
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

                const attachmentFiles = filesByField.get(`lotAttachments_${index}`) || [];
                if (attachmentFiles.length > 0 && attachmentsTableAvailable) {
                    for (const file of attachmentFiles) {
                        const stored = await storeMaterialLotAttachment(materialLot.id, file);
                        storedFiles.push(stored);
                        await tx.materialLotAttachment.create({
                            data: {
                                materialLotId: materialLot.id,
                                type: normalizeAttachmentType(lot.attachmentType),
                                originalName: stored.originalName,
                                storedName: stored.storedName,
                                mimeType: stored.mimeType,
                                sizeBytes: stored.sizeBytes,
                                url: stored.url,
                                uploadedById: req.user?.id || null
                            }
                        });
                    }
                } else if (attachmentFiles.length > 0 && !attachmentsTableAvailable) {
                    logger.warn(`material_lot_attachments no existe; se omite persistencia de adjuntos para lote ${materialLot.id}`);
                }

                materialLots.push(materialLot);
            }
            return materialLots;
        });

        logger.info(`🏷️ ${created.length} lotes creados para ${orderItem.siigoProductName} — Total: ${(newLotsTotal / 1000).toFixed(1)} kg`);
        res.status(201).json(created);
    } catch (error) {
        await cleanupStoredMaterialLotFiles(storedFiles);
        logger.error('Error creating lots:', error.message, error.stack);
        res.status(500).json({ error: 'Error creando lotes: ' + error.message });
    }
};

/**
 * GET /procurement/lots — List available lots, optionally filter by SKU
 */
exports.listLots = async (req, res) => {
    try {
        const attachmentsTableAvailable = await hasMaterialLotAttachmentTable();
        const { sku, status = 'AVAILABLE' } = req.query;
        const where = {};
        if (sku) where.siigoProductCode = sku;
        if (status !== 'ALL') where.status = status;

        const lots = await prisma.materialLot.findMany({
            where,
            orderBy: { receivedAt: 'asc' }, // FIFO order
            include: {
                ...(attachmentsTableAvailable ? {
                    attachments: {
                        orderBy: { createdAt: 'asc' }
                    }
                } : {}),
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
