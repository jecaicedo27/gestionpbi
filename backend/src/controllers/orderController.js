const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');
const cacheService = require('../services/cacheService');

const prisma = new PrismaClient();

const createOrder = async (req, res) => {
    const { items } = req.body;
    const distributorId = req.user.id;

    try {
        // 1. Validate Items and Check Stock
        // We need to check both Physical Stock AND Available Stock (Physical - Reserved)
        // For MVP Phase 2, we will trust the frontend sent valid IDs, but we must check quantities.

        const productIds = items.map(i => i.productId);
        const products = await prisma.product.findMany({
            where: { id: { in: productIds } },
            include: { inventoryAlternate: true }
        });

        // Check availability
        for (const item of items) {
            const product = products.find(p => p.id === item.productId);
            if (!product) {
                return res.status(400).json({ error: `Producto no encontrado: ${item.productId}` });
            }

            const reserved = product.inventoryAlternate?.reservedQty || 0;
            const available = product.currentStock - reserved;

            if (available < item.quantity) {
                return res.status(400).json({
                    error: `Stock insuficiente para ${product.name}. Disponible: ${available}, Solicitado: ${item.quantity}`
                });
            }
        }

        // 2. Create Order Transaction
        // We use a transaction to ensure Order Creation AND Stock Reservation happen atomically.

        const result = await prisma.$transaction(async (tx) => {
            // Generate Order Number
            const count = await tx.order.count();
            const orderNumber = `ORD-${String(count + 1).padStart(6, '0')}`;

            // Create Order
            const order = await tx.order.create({
                data: {
                    orderNumber,
                    distributorId,
                    status: 'PENDING',
                    items: {
                        create: items.map(item => ({
                            productId: item.productId,
                            requestedQty: item.quantity,
                            pendingQty: item.quantity,
                            allocatedQty: 0
                        }))
                    }
                },
                include: { items: true }
            });

            // Reserve Stock (Update InventoryAlternate)
            for (const item of items) {
                await tx.inventoryAlternate.upsert({
                    where: { productId: item.productId },
                    update: {
                        reservedQty: { increment: item.quantity },
                        availableQty: { decrement: item.quantity } // Optional: sync availableQty field or calc on fly
                    },
                    create: {
                        productId: item.productId,
                        reservedQty: item.quantity,
                        availableQty: -item.quantity // Initial state if no record existed (should match product stock calc)
                    }
                });
            }

            return order;
        });

        // Invalidate dashboard cache as stock properties changed
        await cacheService.invalidatePattern('inventory:*');

        // Notify Logistics (via Socket.io if available)
        const io = req.app.get('io');
        if (io) {
            io.emit('order:new', {
                id: result.id,
                orderNumber: result.orderNumber,
                distributor: req.user.name
            });
        }

        logger.info(`Order created: ${result.orderNumber} by ${req.user.email}`);

        res.json({ success: true, data: result });

    } catch (error) {
        logger.error('Create Order Error:', error);
        res.status(500).json({ error: 'Error creando el pedido' });
    }
};

const getOrders = async (req, res) => {
    try {
        const { status, page = 1, limit = 50 } = req.query;
        const skip = (page - 1) * limit;

        const where = {};
        if (status) where.status = status;

        // Distributors only see their own orders
        if (req.user.role === 'DISTRIBUIDOR') {
            where.distributorId = req.user.id;
        }

        const [orders, total] = await Promise.all([
            prisma.order.findMany({
                where,
                include: {
                    distributor: { select: { name: true, email: true } },
                    items: { include: { product: { select: { name: true, sku: true, currentStock: true, packSize: true, unit: true } } } }
                },
                orderBy: { createdAt: 'desc' },
                skip: Number(skip),
                take: Number(limit)
            }),
            prisma.order.count({ where })
        ]);

        res.json({
            success: true,
            data: orders,
            meta: {
                total,
                page: Number(page),
                limit: Number(limit),
                pages: Math.ceil(total / limit)
            }
        });

    } catch (error) {
        logger.error('Get Orders Error:', error);
        res.status(500).json({ error: 'Error obteniendo pedidos' });
    }
};

const updateOrderStatus = async (req, res) => {
    const { id } = req.params;
    const { status, trackingNumber, carrier } = req.body;

    try {
        const updateData = {
            status,
            // Update timestamps
            ...(status === 'READY' ? { readyAt: new Date() } : {}),
            ...(status === 'DISPATCHED' ? {
                dispatchedAt: new Date(),
                trackingGuide: trackingNumber,
                dispatchNotes: carrier
            } : {}),
            ...(status === 'INVOICED' ? { invoicedAt: new Date() } : {})
        };

        const order = await prisma.order.update({
            where: { id: parseInt(id) },
            data: updateData
        });

        // Emit socket event
        const io = req.app.get('io');
        if (io) io.emit('order:updated', order);

        res.json({ success: true, data: order });
    } catch (error) {
        logger.error('Update Order Error:', error);
        res.status(500).json({ error: 'Error actualizando pedido' });
    }
};

// Import admin/logistics methods
const {
    approveOrder,
    rejectOrder,
    markReady,
    invoiceOrder,
    dispatchOrder,
    deliverOrder,
    getTransportGuide,
    getAllOrders,
    getOrderById,
    getOrderCounts
} = require('./orderControllerExtensions');

module.exports = {
    createOrder,
    getOrders,
    updateOrderStatus,
    approveOrder,
    rejectOrder,
    markReady,
    invoiceOrder,
    dispatchOrder,
    deliverOrder,
    getTransportGuide,
    getAllOrders,
    getOrderById,
    getOrderCounts
};
