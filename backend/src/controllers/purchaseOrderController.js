/**
 * purchaseOrderController.js — CRUD for Purchase Orders
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const logger = require('../utils/logger');

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
                    receptions: { select: { id: true, status: true, siigoRef: true } },
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
                        lots: { orderBy: { receivedAt: 'desc' } }
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
        const { supplierId, supplierName, supplierNit, notes, expectedDate, items } = req.body;

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

        logger.info(`📋 OC creada: ${orderNumber} por ${req.user.name}`);
        res.status(201).json(order);
    } catch (error) {
        logger.error('Error creating purchase order:', error.message);
        res.status(500).json({ error: 'Error creando orden de compra' });
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

        const quotations = order.quotationUrls || [];
        if (!Array.isArray(quotations) || quotations.length === 0) {
            return res.status(400).json({ error: 'Debe subir la cotización del proveedor antes de enviar a Cartera' });
        }

        const updated = await prisma.purchaseOrder.update({
            where: { id: req.params.id },
            data: { status: 'PAYMENT_PENDING' }
        });

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
 * PUT /procurement/purchase-orders/:id/payment — Cartera registers costs + payment
 */
exports.registerPayment = async (req, res) => {
    try {
        const { itemCosts, paymentNotes } = req.body;
        const order = await prisma.purchaseOrder.findUnique({
            where: { id: req.params.id },
            include: { items: true, supplier: { select: { ivaRate: true, reteFuenteRate: true } } }
        });
        if (!order) return res.status(404).json({ error: 'Orden no encontrada' });
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
        let totalPayAll = 0;
        const itemCostsAudit = {};

        if (itemCosts && typeof itemCosts === 'object') {
            for (const [itemId, costData] of Object.entries(itemCosts)) {
                const item = order.items.find(i => i.id === itemId);
                if (!item) continue;
                const totalPay = typeof costData === 'object' ? (costData.totalPay || costData.unitCostPerKg || 0) : parseFloat(costData);
                // Back-calculate subtotal (before taxes) then compute cost per kg
                const subtotal = factor > 0 ? totalPay / factor : totalPay;
                const kgs = item.quantityOrdered / 1000;
                const unitCostPerKg = kgs > 0 ? Math.round(subtotal / kgs) : 0;
                await prisma.purchaseOrderItem.update({
                    where: { id: itemId },
                    data: { unitCost: unitCostPerKg }
                });
                totalPayAll += totalPay;
                itemCostsAudit[itemId] = { totalPay, subtotal: Math.round(subtotal), unitCostPerKg, productName: item.siigoProductName, quantityG: item.quantityOrdered };
            }
        }

        // Calculate audit totals
        const paymentSubtotal = factor > 0 ? totalPayAll / factor : totalPayAll;
        const paymentIvaAmount = paymentSubtotal * (ivaRate / 100);
        const paymentReteAmount = paymentSubtotal * (reteRate / 100);

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
                paymentTotal: Math.round(totalPayAll),
                paymentIvaRate: ivaRate,
                paymentReteRate: reteRate,
                paymentItemCosts: itemCostsAudit
            },
            include: { items: true }
        });

        logger.info(`💳 OC ${order.orderNumber} pagada por ${req.user.name} — Total: $${Math.round(totalPayAll).toLocaleString()}`);
        res.json(updated);
    } catch (error) {
        logger.error('Error registering payment:', error.message);
        res.status(500).json({ error: 'Error registrando pago' });
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
