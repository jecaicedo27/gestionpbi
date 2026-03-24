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

// ─── Excel Upload ─────────────────────────────────────────────
const XLSX = require('xlsx');

const createOrderFromExcel = async (req, res) => {
    try {
        const { distributorId } = req.body;
        if (!distributorId) return res.status(400).json({ error: 'distributorId es requerido' });
        if (!req.file) return res.status(400).json({ error: 'Archivo Excel es requerido' });

        // Validate distributor exists
        const distributor = await prisma.user.findUnique({
            where: { id: distributorId },
            select: { id: true, name: true, role: true }
        });
        if (!distributor) return res.status(404).json({ error: 'Distribuidor no encontrado' });

        // Parse Excel
        const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

        // Skip header row (row 0), start from row 1
        // Col B (idx 1) = barcode, Col G (idx 6) = quantity
        const parsedItems = [];
        const warnings = [];
        const debugRows = []; // for debugging

        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const barcode = String(row[1] || '').trim();
            const qty = parseFloat(row[6]) || 0;
            const productName = String(row[2] || '').trim();

            // Debug: capture first 5 rows
            if (i <= 5) {
                debugRows.push({ rowNum: i + 1, colA: row[0], colB: row[1], colC: row[2], colD: row[3], colE: row[4], colF: row[5], colG: row[6], parsedBarcode: barcode, parsedQty: qty });
            }

            if (!barcode || qty <= 0) continue;

            // Find product by barcode
            const product = await prisma.product.findFirst({
                where: { barcode },
                select: { id: true, name: true, sku: true, barcode: true, currentStock: true, packSize: true }
            });

            if (!product) {
                warnings.push(`Fila ${i + 1}: código de barras ${barcode} ("${productName}") no encontrado`);
                continue;
            }

            parsedItems.push({
                productId: product.id,
                quantity: qty,
                product
            });
        }

        if (parsedItems.length === 0) {
            return res.status(400).json({
                error: 'No se encontraron productos válidos en el Excel',
                warnings,
                debug: { totalRows: rows.length, headerRow: rows[0], sampleRows: debugRows }
            });
        }

        // If ?preview=1, return parsed items without creating order
        if (req.query.preview === '1') {
            return res.json({
                preview: true,
                items: parsedItems.map(i => ({
                    productId: i.productId,
                    name: i.product.name,
                    sku: i.product.sku,
                    barcode: i.product.barcode,
                    quantity: i.quantity,
                    currentStock: i.product.currentStock,
                    packSize: i.product.packSize
                })),
                warnings
            });
        }

        // Create order (same transactional pattern as createOrder)
        const result = await prisma.$transaction(async (tx) => {
            const count = await tx.order.count();
            const orderNumber = `ORD-${String(count + 1).padStart(6, '0')}`;

            const order = await tx.order.create({
                data: {
                    orderNumber,
                    distributorId,
                    status: 'PENDING',
                    notes: `[Excel] Pedido cargado desde archivo Excel`,
                    items: {
                        create: parsedItems.map(item => ({
                            productId: item.productId,
                            requestedQty: item.quantity,
                            pendingQty: item.quantity,
                            allocatedQty: 0
                        }))
                    }
                },
                include: {
                    items: { include: { product: { select: { name: true, sku: true } } } },
                    distributor: { select: { name: true } }
                }
            });

            // Reserve stock
            for (const item of parsedItems) {
                await tx.inventoryAlternate.upsert({
                    where: { productId: item.productId },
                    update: { reservedQty: { increment: item.quantity }, availableQty: { decrement: item.quantity } },
                    create: { productId: item.productId, reservedQty: item.quantity, availableQty: -item.quantity }
                });
            }

            return order;
        });

        // Invalidate cache
        await cacheService.invalidatePattern('inventory:*');

        // Socket notification
        const io = req.app.get('io');
        if (io) {
            io.emit('order:new', {
                id: result.id,
                orderNumber: result.orderNumber,
                distributor: distributor.name,
                source: 'excel'
            });
        }

        logger.info(`Excel order created: ${result.orderNumber} for ${distributor.name} (${parsedItems.length} items)`);

        res.json({ success: true, data: result, warnings });

    } catch (error) {
        logger.error('Create Order from Excel Error:', error);
        res.status(500).json({ error: 'Error creando pedido desde Excel: ' + error.message });
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
    createOrderFromExcel,
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
