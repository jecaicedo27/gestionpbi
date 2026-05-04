/**
 * purchaseOrderController.js — CRUD for Purchase Orders
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const logger = require('../utils/logger');
const {
    buildPurchaseOrderWorkflowAlert,
    emitPurchaseOrderWorkflowAlert,
    normalizeRole
} = require('../services/purchaseOrderAlertService');

/**
 * GET /procurement/purchase-orders
 */
exports.list = async (req, res) => {
    try {
        const { status, page = 1, limit = 20 } = req.query;
        const where = {};
        if (status) where.status = status;

        const [orders, total] = await Promise.all([
            prisma.purchaseOrder.findMany({
                where,
                include: {
                    items: { select: { id: true, siigoProductName: true, quantityOrdered: true, quantityReceived: true, lots: { select: { id: true } } } },
                    receptions: {
                        select: {
                            id: true,
                            status: true,
                            siigoRef: true,
                            items: { select: { orderItemId: true, quantityReceived: true } }
                        }
                    },
                    createdBy: { select: { name: true } },
                    approvedBy: { select: { name: true } },
                    _count: { select: { receptions: true } }
                },
                orderBy: { createdAt: 'desc' },
                take: parseInt(limit),
                skip: (parseInt(page) - 1) * parseInt(limit)
            }),
            prisma.purchaseOrder.count({ where })
        ]);

        res.json({ orders, total, page: parseInt(page), totalPages: Math.ceil(total / parseInt(limit)) });
    } catch (error) {
        logger.error('Error listing purchase orders:', error.message);
        res.status(500).json({ error: 'Error listando órdenes de compra' });
    }
};

/**
 * GET /procurement/purchase-orders/:id
 */
exports.getById = async (req, res) => {
    try {
        let order = await prisma.purchaseOrder.findUnique({
            where: { id: req.params.id },
            include: {
                items: {
                    include: {
                        lots: {
                            orderBy: { receivedAt: 'desc' },
                            include: {
                                attachments: { orderBy: { createdAt: 'asc' } }
                            }
                        }
                    }
                },
                receptions: {
                    include: {
                        items: {
                            include: { orderItem: { select: { siigoProductName: true, siigoProductCode: true } } }
                        },
                        receivedBy: { select: { name: true } },
                        accountingUser: { select: { name: true } }
                    },
                    orderBy: { receivedAt: 'desc' }
                },
                createdBy: { select: { name: true, role: true } },
                approvedBy: { select: { name: true, role: true } },
                paidBy: { select: { name: true, role: true } },
                supplier: { select: { id: true, ivaRate: true, reteFuenteRate: true, paymentTermDays: true } }
            }
        });

        if (!order) return res.status(404).json({ error: 'Orden no encontrada' });

        // Auto-link supplier if missing
        if (!order.supplierDbId && order.supplierNit) {
            const supplier = await prisma.supplier.findFirst({ where: { identification: order.supplierNit } });
            if (supplier) {
                await prisma.purchaseOrder.update({ where: { id: order.id }, data: { supplierDbId: supplier.id } });
                order.supplier = { id: supplier.id, ivaRate: supplier.ivaRate, reteFuenteRate: supplier.reteFuenteRate, paymentTermDays: supplier.paymentTermDays };
            }
        }

        res.json(order);
    } catch (error) {
        logger.error('Error getting purchase order:', error.message);
        res.status(500).json({ error: 'Error obteniendo orden de compra' });
    }
};

/**
 * POST /procurement/purchase-orders
 */
exports.create = async (req, res) => {
    try {
        const { supplierId, supplierName, supplierNit, notes, expectedDate, items, paymentMethod, creditDueDate } = req.body;

        if (!supplierId || !supplierName || !items?.length) {
            return res.status(400).json({ error: 'Faltan datos: proveedor y al menos 1 producto' });
        }

        // Generate order number: OC-YYMM-NNN
        const now = new Date();
        const prefix = `OC-${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, '0')}`;
        const lastOrder = await prisma.purchaseOrder.findFirst({
            where: { orderNumber: { startsWith: prefix } },
            orderBy: { orderNumber: 'desc' }
        });
        const seq = lastOrder ? parseInt(lastOrder.orderNumber.split('-')[2]) + 1 : 1;
        const orderNumber = `${prefix}-${String(seq).padStart(3, '0')}`;

        // Resolve credit due date: use explicit value, or calculate from supplier paymentTermDays
        let resolvedCreditDueDate = null;
        const resolvedPaymentMethod = (paymentMethod || 'CONTADO').toUpperCase();
        if (resolvedPaymentMethod === 'CREDITO') {
            if (creditDueDate) {
                resolvedCreditDueDate = new Date(creditDueDate);
            } else {
                // Auto-calculate from supplier paymentTermDays
                const supplier = await prisma.supplier.findFirst({ where: { siigoId: supplierId } });
                const days = supplier?.paymentTermDays || 30;
                resolvedCreditDueDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
            }
        }

        const order = await prisma.purchaseOrder.create({
            data: {
                orderNumber,
                supplierId,
                supplierName,
                supplierNit: supplierNit || null,
                notes: notes || null,
                expectedDate: expectedDate ? new Date(expectedDate) : null,
                createdById: req.user.id,
                status: 'PENDING_APPROVAL',
                paymentMethod: resolvedPaymentMethod,
                creditDueDate: resolvedCreditDueDate,
                items: {
                    create: items.map(item => ({
                        siigoProductCode: item.siigoProductCode,
                        siigoProductName: item.siigoProductName,
                        quantityOrdered: item.quantityOrdered,
                        packagingQtyGrams: item.packagingQtyGrams || null,
                        packagingDesc: item.packagingDesc || null,
                    }))
                }
            },
            include: { items: true }
        });

        logger.info(`📋 OC creada: ${orderNumber} (${resolvedPaymentMethod}) por ${req.user.name}`);
        res.status(201).json(order);
    } catch (error) {
        logger.error('Error creating purchase order:', error.message);
        res.status(500).json({ error: 'Error creando orden de compra' });
    }
};

/**
 * PUT /procurement/purchase-orders/:id — Update order details (supplier, items, notes)
 */
exports.update = async (req, res) => {
    try {
        const order = await prisma.purchaseOrder.findUnique({ where: { id: req.params.id }, include: { items: true } });
        if (!order) return res.status(404).json({ error: 'Orden no encontrada' });

        const { supplierId, supplierName, supplierNit, notes, expectedDate, items, paymentMethod, creditDueDate } = req.body;

        const data = {};
        if (supplierId !== undefined) data.supplierId = supplierId;
        if (supplierName !== undefined) data.supplierName = supplierName;
        if (supplierNit !== undefined) data.supplierNit = supplierNit || null;
        if (notes !== undefined) data.notes = notes || null;
        if (expectedDate !== undefined) data.expectedDate = expectedDate ? new Date(expectedDate) : null;
        if (paymentMethod !== undefined) data.paymentMethod = paymentMethod.toUpperCase();

        if (supplierId) {
            const supplier = await prisma.supplier.findFirst({ where: { siigoId: supplierId } });
            if (supplier) data.supplierDbId = supplier.id;
        }

        if (items && items.length > 0) {
            await prisma.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: order.id } });
            await prisma.purchaseOrderItem.createMany({
                data: items.map(item => ({
                    id: require('crypto').randomUUID(),
                    purchaseOrderId: order.id,
                    siigoProductCode: item.siigoProductCode,
                    siigoProductName: item.siigoProductName,
                    quantityOrdered: item.quantityOrdered,
                    packagingQtyGrams: item.packagingQtyGrams || null,
                    packagingDesc: item.packagingDesc || null,
                    unitCost: item.unitCost || null,
                    productId: item.productId || null,
                }))
            });
        }

        const updated = await prisma.purchaseOrder.update({
            where: { id: req.params.id },
            data,
            include: { items: true }
        });

        logger.info(`✏️ OC ${order.orderNumber} editada por ${req.user.name}`);
        res.json(updated);
    } catch (error) {
        logger.error('Error updating purchase order:', error.message);
        res.status(500).json({ error: 'Error actualizando orden de compra' });
    }
};

/**
 * PUT /procurement/purchase-orders/:id/approve
 */
exports.approve = async (req, res) => {
    try {
        const order = await prisma.purchaseOrder.findUnique({ where: { id: req.params.id } });
        if (!order) return res.status(404).json({ error: 'Orden no encontrada' });
        if (order.status !== 'PENDING_APPROVAL') {
            return res.status(400).json({ error: `No se puede aprobar en estado ${order.status}` });
        }

        const updated = await prisma.purchaseOrder.update({
            where: { id: req.params.id },
            data: {
                status: 'APPROVED',
                approvedById: req.user.id,
                approvedAt: new Date()
            }
        });

        logger.info(`✅ OC ${order.orderNumber} aprobada por ${req.user.name}`);
        res.json(updated);
    } catch (error) {
        logger.error('Error approving PO:', error.message);
        res.status(500).json({ error: 'Error aprobando orden' });
    }
};

/**
 * PUT /procurement/purchase-orders/:id/send — Mark as sent to supplier
 */
exports.markSent = async (req, res) => {
    try {
        const order = await prisma.purchaseOrder.findUnique({ where: { id: req.params.id } });
        if (!order) return res.status(404).json({ error: 'Orden no encontrada' });
        if (order.status !== 'APPROVED') {
            return res.status(400).json({ error: 'Solo se puede enviar una OC aprobada' });
        }

        const updated = await prisma.purchaseOrder.update({
            where: { id: req.params.id },
            data: { status: 'SENT' }
        });

        logger.info(`📨 OC ${order.orderNumber} enviada al proveedor`);
        res.json(updated);
    } catch (error) {
        logger.error('Error marking PO as sent:', error.message);
        res.status(500).json({ error: 'Error actualizando orden' });
    }
};

/**
 * PUT /procurement/purchase-orders/:id/send-to-cartera — Requires quotation, sends to Cartera
 */
exports.sendToCartera = async (req, res) => {
    try {
        const order = await prisma.purchaseOrder.findUnique({ where: { id: req.params.id } });
        if (!order) return res.status(404).json({ error: 'Orden no encontrada' });
        if (order.status !== 'SENT') {
            return res.status(400).json({ error: 'La OC debe estar en estado "Enviada" para pasar a Cartera' });
        }
        if (order.paymentMethod === 'CREDITO') {
            return res.status(400).json({ error: 'Las OC a crédito no pasan por Cartera antes de recepción. La mercancía se recibe directamente.' });
        }

        const quotations = order.quotationUrls || [];
        if (!Array.isArray(quotations) || quotations.length === 0) {
            return res.status(400).json({ error: 'Debe subir la cotización del proveedor antes de enviar a Cartera' });
        }

        const updated = await prisma.purchaseOrder.update({
            where: { id: req.params.id },
            data: { status: 'PAYMENT_PENDING' }
        });
        emitPurchaseOrderWorkflowAlert(
            req,
            buildPurchaseOrderWorkflowAlert('PAYMENT_PENDING', updated)
        );

        logger.info(`📨 OC ${order.orderNumber} enviada a Cartera`);
        res.json(updated);
    } catch (error) {
        logger.error('Error sending PO to cartera:', error.message);
        res.status(500).json({ error: 'Error actualizando orden' });
    }
};

/**
 * PUT /procurement/purchase-orders/:id/cancel
 */
exports.cancel = async (req, res) => {
    try {
        const updated = await prisma.purchaseOrder.update({
            where: { id: req.params.id },
            data: { status: 'CANCELLED' }
        });
        logger.info(`❌ OC ${updated.orderNumber} cancelada`);
        res.json(updated);
    } catch (error) {
        logger.error('Error cancelling PO:', error.message);
        res.status(500).json({ error: 'Error cancelando orden' });
    }
};

/**
 * PUT /procurement/purchase-orders/:id/payment-method
 */
exports.updatePaymentMethod = async (req, res) => {
    try {
        const { paymentMethod } = req.body;
        const validMethods = ['CONTADO', 'CREDITO'];
        if (!validMethods.includes(paymentMethod)) {
            return res.status(400).json({ error: 'Método de pago inválido' });
        }

        const order = await prisma.purchaseOrder.findUnique({
            where: { id: req.params.id },
            include: {
                supplier: { select: { paymentTermDays: true } }
            }
        });
        if (!order) return res.status(404).json({ error: 'Orden no encontrada' });

        let updateData = { paymentMethod };
        if (paymentMethod === 'CONTADO') {
            updateData.creditDueDate = null;
            updateData.creditPaid = false;
            updateData.creditPaidAt = null;
        } else {
            if (!order.creditDueDate) {
                const days = order.supplier?.paymentTermDays || 30;
                const baseDate = order.createdAt || new Date();
                updateData.creditDueDate = new Date(baseDate.getTime() + days * 24 * 60 * 60 * 1000);
            }

            // Si la OC ya habia sido enviada a Cartera y luego cambia a credito,
            // debe volver al flujo operativo de recepcion directa.
            if (order.status === 'PAYMENT_PENDING') {
                updateData.status = 'SENT';
            }
        }

        const updated = await prisma.purchaseOrder.update({
            where: { id: req.params.id },
            data: updateData
        });

        logger.info(`🔄 OC ${updated.orderNumber} cambió a ${paymentMethod} por ${req.user ? req.user.name : 'Unknown'}`);
        res.json(updated);
    } catch (error) {
        logger.error('Error updating payment method:', error.message);
        res.status(500).json({ error: 'Error actualizando el método de pago' });
    }
};

/**
 * PUT /procurement/purchase-orders/:id/payment — Cartera registers costs + payment
 */
exports.registerPayment = async (req, res) => {
    try {
        const { itemCosts, paymentNotes, taxConfig } = req.body;
        const order = await prisma.purchaseOrder.findUnique({
            where: { id: req.params.id },
            include: { items: true, supplier: { select: { id: true, ivaRate: true, reteFuenteRate: true, fiscalConfigConfirmed: true } } }
        });
        if (!order) return res.status(404).json({ error: 'Orden no encontrada' });

        // Auto-confirm fiscal config if provided from Cartera during payment
        if (taxConfig && order.supplier) {
            const parsedIva = parseFloat(taxConfig.ivaRate) || 0;
            const parsedRete = parseFloat(taxConfig.reteFuenteRate) || 0;
            await prisma.supplier.update({
                where: { id: order.supplier.id },
                data: {
                    ivaRate: parsedIva,
                    reteFuenteRate: parsedRete,
                    fiscalConfigConfirmed: true,
                    fiscalConfigAt: new Date(),
                    fiscalConfigById: req.user?.id || null
                }
            });
            order.supplier.ivaRate = parsedIva;
            order.supplier.reteFuenteRate = parsedRete;
            order.supplier.fiscalConfigConfirmed = true;
        }

        // Block payment if supplier fiscal config not confirmed by accounting
        if (!order.supplier?.fiscalConfigConfirmed) {
            return res.status(400).json({ error: 'Contabilidad no ha configurado al proveedor. Vaya a Proveedores → Configuración Fiscal y confirme IVA/Retención antes de registrar el pago.' });
        }
        if (!['SENT', 'PAYMENT_PENDING'].includes(order.status)) {
            return res.status(400).json({ error: `No se puede registrar pago en estado ${order.status}` });
        }

        // Require payment proof
        const proofs = order.paymentProofUrls || [];
        if (!Array.isArray(proofs) || proofs.length === 0) {
            return res.status(400).json({ error: 'Debe subir al menos un comprobante de pago antes de registrar el pago' });
        }

        // Tax rates from supplier config
        const ivaRate = order.supplier?.ivaRate || 0;
        const reteRate = order.supplier?.reteFuenteRate || 0;
        const factor = 1 + (ivaRate / 100) - (reteRate / 100);

        // Build per-item audit data and update PO items
        let subtotalAll = 0;
        const itemCostsAudit = {};

        if (itemCosts && typeof itemCosts === 'object') {
            for (const [itemId, costData] of Object.entries(itemCosts)) {
                const item = order.items.find(i => i.id === itemId);
                if (!item) continue;
                // totalPay from frontend is now the BASE price (sin IVA)
                const basePay = typeof costData === 'object' ? (costData.totalPay || costData.unitCostPerKg || 0) : parseFloat(costData);
                const kgs = item.quantityOrdered / 1000;
                const unitCostPerKg = kgs > 0 ? Math.round(basePay / kgs) : 0;
                await prisma.purchaseOrderItem.update({
                    where: { id: itemId },
                    data: { unitCost: unitCostPerKg }
                });
                subtotalAll += basePay;
                itemCostsAudit[itemId] = { totalPay: basePay, subtotal: Math.round(basePay), unitCostPerKg, productName: item.siigoProductName, quantityG: item.quantityOrdered };
            }
        }

        // Forward-calculate total from base (sin IVA)
        const paymentSubtotal = subtotalAll;
        const paymentIvaAmount = paymentSubtotal * (ivaRate / 100);
        const paymentReteAmount = paymentSubtotal * (reteRate / 100);
        const paymentTotal = paymentSubtotal + paymentIvaAmount - paymentReteAmount;

        // Update PO status to PAID with full audit data
        const updated = await prisma.purchaseOrder.update({
            where: { id: req.params.id },
            data: {
                status: 'PAID',
                paidById: req.user.id,
                paidAt: new Date(),
                paymentNotes: paymentNotes || null,
                paymentSubtotal: Math.round(paymentSubtotal),
                paymentIvaAmount: Math.round(paymentIvaAmount),
                paymentReteAmount: Math.round(paymentReteAmount),
                paymentTotal: Math.round(paymentTotal),
                paymentIvaRate: ivaRate,
                paymentReteRate: reteRate,
                paymentItemCosts: itemCostsAudit
            },
            include: { items: true }
        });

        logger.info(`💳 OC ${order.orderNumber} pagada por ${req.user.name} — Total: $${Math.round(paymentTotal).toLocaleString()}`);
        res.json(updated);
    } catch (error) {
        logger.error('Error registering payment:', error.message);
        res.status(500).json({ error: 'Error registrando pago' });
    }
};

/**
 * PUT /procurement/purchase-orders/:id/credit-payment — Register deferred credit payment
 */
exports.registerCreditPayment = async (req, res) => {
    try {
        const { itemCosts, paymentNotes, taxConfig } = req.body;
        const order = await prisma.purchaseOrder.findUnique({
            where: { id: req.params.id },
            include: { items: true, supplier: { select: { id: true, ivaRate: true, reteFuenteRate: true, fiscalConfigConfirmed: true } } }
        });
        if (!order) return res.status(404).json({ error: 'Orden no encontrada' });

        // Auto-confirm fiscal config if provided from Cartera during payment
        if (taxConfig && order.supplier) {
            const parsedIva = parseFloat(taxConfig.ivaRate) || 0;
            const parsedRete = parseFloat(taxConfig.reteFuenteRate) || 0;
            await prisma.supplier.update({
                where: { id: order.supplier.id },
                data: {
                    ivaRate: parsedIva,
                    reteFuenteRate: parsedRete,
                    fiscalConfigConfirmed: true,
                    fiscalConfigAt: new Date(),
                    fiscalConfigById: req.user?.id || null
                }
            });
            order.supplier.ivaRate = parsedIva;
            order.supplier.reteFuenteRate = parsedRete;
            order.supplier.fiscalConfigConfirmed = true;
        }

        // Block credit payment if supplier fiscal config not confirmed by accounting
        if (!order.supplier?.fiscalConfigConfirmed) {
            return res.status(400).json({ error: 'Contabilidad no ha configurado al proveedor. Vaya a Proveedores → Configuración Fiscal y confirme IVA/Retención antes de registrar el pago.' });
        }
        if (order.paymentMethod !== 'CREDITO') {
            return res.status(400).json({ error: 'Solo OCs a crédito pueden usar pago diferido' });
        }
        if (order.creditPaid) {
            return res.status(400).json({ error: 'Esta OC ya fue pagada' });
        }

        // Require payment proof
        const proofs = order.paymentProofUrls || [];
        if (!Array.isArray(proofs) || proofs.length === 0) {
            return res.status(400).json({ error: 'Debe subir al menos un comprobante de pago antes de registrar el pago' });
        }

        // Tax rates from supplier config
        const ivaRate = order.supplier?.ivaRate || 0;
        const reteRate = order.supplier?.reteFuenteRate || 0;
        const factor = 1 + (ivaRate / 100) - (reteRate / 100);

        // Build per-item audit data
        let subtotalAll = 0;
        const itemCostsAudit = {};

        if (itemCosts && typeof itemCosts === 'object') {
            for (const [itemId, costData] of Object.entries(itemCosts)) {
                const item = order.items.find(i => i.id === itemId);
                if (!item) continue;
                // totalPay from frontend is now the BASE price (sin IVA)
                const basePay = typeof costData === 'object' ? (costData.totalPay || costData.unitCostPerKg || 0) : parseFloat(costData);
                const kgs = item.quantityOrdered / 1000;
                const unitCostPerKg = kgs > 0 ? Math.round(basePay / kgs) : 0;
                await prisma.purchaseOrderItem.update({
                    where: { id: itemId },
                    data: { unitCost: unitCostPerKg }
                });
                subtotalAll += basePay;
                itemCostsAudit[itemId] = { totalPay: basePay, subtotal: Math.round(basePay), unitCostPerKg, productName: item.siigoProductName, quantityG: item.quantityOrdered };
            }
        }

        // Forward-calculate total from base (sin IVA)
        const paymentSubtotal = subtotalAll;
        const paymentIvaAmount = paymentSubtotal * (ivaRate / 100);
        const paymentReteAmount = paymentSubtotal * (reteRate / 100);
        const paymentTotal = paymentSubtotal + paymentIvaAmount - paymentReteAmount;

        // Mark credit as paid (does NOT change OC status)
        const updated = await prisma.purchaseOrder.update({
            where: { id: req.params.id },
            data: {
                creditPaid: true,
                creditPaidAt: new Date(),
                paidById: req.user.id,
                paidAt: new Date(),
                paymentNotes: paymentNotes || null,
                paymentSubtotal: Math.round(paymentSubtotal),
                paymentIvaAmount: Math.round(paymentIvaAmount),
                paymentReteAmount: Math.round(paymentReteAmount),
                paymentTotal: Math.round(paymentTotal),
                paymentIvaRate: ivaRate,
                paymentReteRate: reteRate,
                paymentItemCosts: itemCostsAudit
            },
            include: { items: true }
        });

        logger.info(`💳 OC ${order.orderNumber} — crédito pagado por ${req.user.name} — Total: $${Math.round(paymentTotal).toLocaleString()}`);
        res.json(updated);
    } catch (error) {
        logger.error('Error registering credit payment:', error.message);
        res.status(500).json({ error: 'Error registrando pago de crédito' });
    }
};

/**
 * GET /procurement/purchase-order-alerts/pending — Pending workflow alerts for Cartera/Contabilidad
 */
exports.getPendingWorkflowAlerts = async (req, res) => {
    try {
        const role = normalizeRole(req.user?.role);
        const queries = [];

        if (role === 'CARTERA') {
            queries.push(
                prisma.purchaseOrder.findMany({
                    where: { status: 'PAYMENT_PENDING' },
                    orderBy: { updatedAt: 'desc' },
                    take: 20
                }).then(orders => orders.map(order => buildPurchaseOrderWorkflowAlert('PAYMENT_PENDING', order, { createdAt: order.updatedAt })))
            );

            queries.push(
                prisma.purchaseOrder.findMany({
                    where: {
                        status: 'COMPLETED',
                        paymentMethod: 'CREDITO',
                        creditPaid: false
                    },
                    orderBy: { updatedAt: 'desc' },
                    take: 20
                }).then(orders => orders.map(order => buildPurchaseOrderWorkflowAlert('CREDIT_PAYMENT_PENDING', order, { createdAt: order.updatedAt })))
            );
        }

        if (role === 'CONTABILIDAD') {
            queries.push(
                prisma.reception.findMany({
                    where: {
                        status: { not: 'COMPLETED' },
                        items: { some: { quantityReceived: { gt: 0 } } },
                        purchaseOrder: {
                            is: { status: { in: ['PARTIALLY_RECEIVED', 'ACCOUNTING_PENDING'] } }
                        }
                    },
                    include: {
                        purchaseOrder: true,
                        items: { select: { quantityReceived: true } }
                    },
                    orderBy: { receivedAt: 'desc' },
                    take: 20
                }).then(receptions => receptions.map(reception => {
                    const receivedTotal = (reception.items || []).reduce((sum, item) => sum + (item.quantityReceived || 0), 0);
                    return buildPurchaseOrderWorkflowAlert('ACCOUNTING_PENDING', reception.purchaseOrder, {
                        receptionId: reception.id,
                        createdAt: reception.receivedAt,
                        message: `La OC ${reception.purchaseOrder.orderNumber} de ${reception.purchaseOrder.supplierName} tiene una recepción ${receivedTotal > 0 ? `por ${(receivedTotal / 1000).toLocaleString()} kg ` : ''}pendiente de registrar en Siigo.`
                    });
                }))
            );
        }

        const results = await Promise.all(queries);
        const alerts = results
            .flat()
            .filter(Boolean)
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .slice(0, 30);

        res.json({ alerts });
    } catch (error) {
        logger.error('Error getting purchase order workflow alerts:', error.message);
        res.status(500).json({ error: 'Error obteniendo alertas de órdenes de compra' });
    }
};

/**
 * GET /procurement/suppliers — Fetch from local DB (synced from Siigo)
 */
exports.getSuppliers = async (req, res) => {
    try {
        const { search } = req.query;
        const where = { active: true };
        if (search) {
            where.OR = [
                { name: { contains: search, mode: 'insensitive' } },
                { identification: { contains: search, mode: 'insensitive' } }
            ];
        }
        const suppliers = await prisma.supplier.findMany({
            where,
            orderBy: { name: 'asc' },
            take: 1000
        });
        res.json(suppliers);
    } catch (error) {
        logger.error('Error fetching suppliers:', error.message);
        res.status(500).json({ error: 'Error obteniendo proveedores' });
    }
};

/**
 * GET /procurement/raw-materials — Fetch active MP products from local DB
 */
exports.getRawMaterials = async (req, res) => {
    try {
        const { search } = req.query;
        const PROCESS_GROUPS = ['PRODUCTOS EN PROCESO LIQUIPOPS', 'PRODUCTOS EN PROCESO GENIALITY'];

        const where = {
            active: true,
            sku: { startsWith: 'MP' },
            group: { name: { notIn: PROCESS_GROUPS } }
        };

        if (search) {
            where.OR = [
                { name: { contains: search, mode: 'insensitive' } },
                { sku: { contains: search, mode: 'insensitive' } }
            ];
        }

        const products = await prisma.product.findMany({
            where,
            select: { id: true, sku: true, name: true, unit: true, currentStock: true, packSize: true, group: { select: { name: true } } },
            orderBy: { name: 'asc' },
            take: 500
        });

        res.json(products.map(p => ({
            id: p.id,
            sku: p.sku,
            name: p.name,
            unit: p.unit,
            currentStock: p.currentStock,
            packSize: p.packSize || null,
            groupName: p.group?.name
        })));
    } catch (error) {
        logger.error('Error fetching raw materials:', error.message);
        res.status(500).json({ error: 'Error obteniendo materias primas' });
    }
};

/**
 * GET /procurement/custom-items
 */
exports.getCustomItems = async (req, res) => {
    try {
        const items = await prisma.customProcurementItem.findMany({
            where: { active: true },
            orderBy: { name: 'asc' }
        });
        res.json(items);
    } catch (error) {
        logger.error('Error fetching custom items:', error.message);
        res.status(500).json({ error: 'Error obteniendo insumos personalizados' });
    }
};

/**
 * POST /procurement/custom-items
 */
exports.createCustomItem = async (req, res) => {
    try {
        const { name } = req.body;
        if (!name || name.trim().length === 0) {
            return res.status(400).json({ error: 'El nombre es requerido' });
        }

        // Generate CUS-XXXX code
        const lastItem = await prisma.customProcurementItem.findFirst({
            where: { code: { startsWith: 'CUS-' } },
            orderBy: { code: 'desc' }
        });
        let nextNumber = 1;
        if (lastItem && lastItem.code) {
            const matches = lastItem.code.match(/CUS-(\d+)/);
            if (matches && matches[1]) {
                nextNumber = parseInt(matches[1], 10) + 1;
            }
        }
        const code = `CUS-${String(nextNumber).padStart(4, '0')}`;

        const newItem = await prisma.customProcurementItem.create({
            data: {
                name: name.trim().toUpperCase(),
                code,
                active: true
            }
        });

        logger.info(`📝 Nuevo insumo personalizado creado: ${newItem.code} - ${newItem.name}`);
        res.status(201).json(newItem);
    } catch (error) {
        logger.error('Error creating custom item:', error.message);
        res.status(500).json({ error: 'Error creando insumo personalizado' });
    }
};

/**
 * DELETE /procurement/custom-items/:id
 */
exports.deleteCustomItem = async (req, res) => {
    try {
        await prisma.customProcurementItem.update({
            where: { id: req.params.id },
            data: { active: false }
        });
        res.json({ success: true });
    } catch (error) {
        logger.error('Error deleting custom item:', error.message);
        res.status(500).json({ error: 'Error eliminando insumo personalizado' });
    }
};
