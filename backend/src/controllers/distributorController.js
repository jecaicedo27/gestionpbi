const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * Get available inventory grouped by flavor and size
 * Only shows finished products from 'sin_asignar' warehouse
 * Groups Geniality (PERLA_EXPLOSIVA) and Liquipops (SYRUP/BASE_CITRICA) separately
 */
exports.getAvailableInventory = async (req, res) => {
    try {
        // Get all finished products with stock > 0 (Actually we show all active, maybe stock > 0 logic is frontend? 
        // No, fetch says stock > 0 in comment, but code doesn't filter currentStock > 0 in WHERE, only active=true. 
        // Wait, "where stock > 0" comment is misleading? Or is it implicit?
        // Actually, the user WANTS to see items with negative stock, so we must ensure we fetch them.
        // The current query `where: { classification: ... active: true }` fetches ALL active products regardless of stock. This is good.

        const products = await prisma.product.findMany({
            where: {
                classification: 'PRODUCTO_TERMINADO', // Only finished products
                active: true  // Only show active products
            },
            select: {
                id: true,
                sku: true,
                name: true,
                type: true,
                classification: true,
                accountGroup: true,  // Need this to distinguish Geniality vs Liquipops
                currentStock: true,
                barcode: true,
                flavor: true,
                size: true,
                packSize: true  // Critical for wholesale box sales rules
            },
            orderBy: {
                name: 'asc'
            }
        });

        // FETCH FUTURE PRODUCTION SCHEDULE
        // We want ANY batch that is not completed/cancelled, representing incoming stock.
        const futureBatches = await prisma.productionBatch.findMany({
            where: {
                status: {
                    in: [
                        'PENDING',
                        'STAGE_1_BASE',
                        'STAGE_2_JARABE',
                        'STAGE_3_ESFERIFICACION',
                        'STAGE_4_PRODUCTO_FINAL',
                        'LABELING'
                    ]
                },
                // scheduledStart: { gte: new Date() } // REMOVE strict future check, if it's pending, it's incoming.
            },
            orderBy: { scheduledStart: 'asc' }, // Get earliest first
            select: { flavor: true, scheduledStart: true }
        });

        console.log(`[Distributor] Found ${futureBatches.length} pending batches.`);

        // Map Flavor -> Earliest Date
        const nextProductionMap = {};
        futureBatches.forEach(batch => {
            if (batch.flavor) {
                const key = batch.flavor.toUpperCase().trim();
                // Only keep the EARLIEST date
                if (!nextProductionMap[key]) {
                    nextProductionMap[key] = batch.scheduledStart;
                }
            }
        });

        console.log('[Distributor] Production Map:', Object.keys(nextProductionMap));

        // ═══ FETCH PHYSICAL STOCK FROM PRODUCTO_TERMINADO ═══
        const finishedStocks = await prisma.finishedLotStock.groupBy({
            by: ['productId'],
            where: { zone: 'PRODUCTO_TERMINADO', currentQuantity: { gt: 0 } },
            _sum: { currentQuantity: true }
        });
        const physicalStockMap = {};
        finishedStocks.forEach(s => { physicalStockMap[s.productId] = s._sum.currentQuantity || 0; });

        // ═══ FETCH ACTIVE RESERVATIONS AND PENDING ORDERS ═══
        const now = new Date();
        const currentDistributorId = req.user?.id;

        // Sum ALL cart reservations per product (include current distributor's own so they see stock decrease)
        const cartReservations = await prisma.cartReservation.groupBy({
            by: ['productId'],
            where: {
                expiresAt: { gt: now }
            },
            _sum: { quantity: true }
        });
        const cartReservedMap = {};
        cartReservations.forEach(r => { cartReservedMap[r.productId] = r._sum.quantity || 0; });

        // Sum pending/approved order items per product
        const pendingOrderItems = await prisma.orderItem.findMany({
            where: {
                order: { status: { in: ['PENDING', 'APPROVED', 'IN_PICKING', 'READY'] } }
            },
            select: { productId: true, requestedQty: true, allocatedQty: true, pendingQty: true }
        });
        const orderReservedMap = {};
        pendingOrderItems.forEach(item => {
            // Se resta la totalidad de lo pedido dado que el FinishedLotStock 
            // aún los contiene (hasta que el pedido se facture y salga de bodega).
            orderReservedMap[item.productId] = (orderReservedMap[item.productId] || 0) + item.requestedQty;
        });

        // Group by accountGroup: 1401=Liquipops, 1402=Geniality
        const grouped = {
            geniality: {},  // accountGroup 1402
            liquipops: {}   // accountGroup 1401
        };

        products.forEach(product => {
            // Only show sales products: 1401=Liquipops, 1402=Geniality
            if (product.accountGroup !== 1401 && product.accountGroup !== 1402) return;
            // Skip non-sale items like syrups/fructose that have flavor "Original"
            if ((product.flavor || '').toLowerCase() === 'original') return;

            const flavor = product.flavor || 'Sin Sabor';
            const size = product.size || 'unknown';

            // Determine if it's Geniality (1402) or Liquipops (1401)
            const category = product.accountGroup === 1402 ? 'geniality' : 'liquipops';

            if (!grouped[category][flavor]) {
                grouped[category][flavor] = {};
            }

            if (!grouped[category][flavor][size]) {
                grouped[category][flavor][size] = {
                    flavor,
                    size,
                    availableQty: 0,
                    products: []
                };
            }

            // Calculate REAL available: physical stock - cart reservations - pending orders
            const physicalStock = physicalStockMap[product.id] || 0;
            const cartReserved = cartReservedMap[product.id] || 0;
            const orderReserved = orderReservedMap[product.id] || 0;
            const realAvailable = Math.max(0, physicalStock - cartReserved - orderReserved);

            grouped[category][flavor][size].availableQty += realAvailable;

            // Resolve Next Production Date
            // Try perfect match, or robust match
            const productFlavorUpper = flavor.toUpperCase().trim();
            const nextDate = nextProductionMap[productFlavorUpper] || null;

            grouped[category][flavor][size].products.push({
                id: product.id,
                sku: product.sku,
                name: product.name,
                qty: realAvailable,
                totalStock: physicalStock,
                barcode: product.barcode,
                packSize: product.packSize || 1,
                nextProductionDate: nextDate
            });
        });

        // Convert to arrays
        const result = {
            geniality: Object.values(grouped.geniality).flatMap(flavors =>
                Object.values(flavors)
            ),
            liquipops: Object.values(grouped.liquipops).flatMap(flavors =>
                Object.values(flavors)
            )
        };

        res.json({
            success: true,
            data: result
        });

    } catch (error) {
        console.error('Error fetching available inventory:', error);
        res.status(500).json({
            success: false,
            error: 'Error al obtener inventario disponible'
        });
    }
};

/**
 * Create a new order for the distributor
 */
exports.createOrder = async (req, res) => {
    try {
        const { items, notes } = req.body;
        const distributorId = req.user.id;

        // Validate items
        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Debe incluir al menos un producto'
            });
        }

        // Require getAvailableQty locally to avoid circular dependencies if any
        const { getAvailableQty } = require('./cartController');

        // Validate products and check stock BEFORE the create loop
        const productIds = items.map(item => item.productId);
        const stockIssues = [];

        for (const item of items) {
            const product = await prisma.product.findUnique({
                where: { id: item.productId },
                select: { name: true }
            });
            if (!product) {
                throw new Error(`Producto con ID ${item.productId} no existe`);
            }
            const available = await getAvailableQty(item.productId, distributorId);
            if (item.requestedQty > available) {
                stockIssues.push({
                    product: product.name,
                    requested: item.requestedQty,
                    available,
                    backorderQty: item.requestedQty - available
                });
            }
        }

        if (stockIssues.length > 0) {
            console.log(`[Order Creation] Order includes backordered items:`, stockIssues);
        }

        // Resolve order prefix once
        const user = await prisma.user.findUnique({
            where: { id: distributorId },
            select: { username: true }
        });
        const today = new Date();
        const dateStr = String(today.getDate()).padStart(2, '0') +
            String(today.getMonth() + 1).padStart(2, '0') +
            today.getFullYear();
        const orderPrefix = `ORD-${user.username.toUpperCase()}-${dateStr}`;

        // Retry loop: handles P2002 race conditions on orderNumber
        let order = null;
        const MAX_RETRIES = 5;
        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            try {
                order = await prisma.$transaction(async (tx) => {
                    const existingCount = await tx.order.count({
                        where: { orderNumber: { startsWith: orderPrefix } }
                    });
                    const sequence = existingCount + 1 + attempt; // offset by attempt to avoid re-collision
                    const orderNumber = `${orderPrefix}-${sequence}`;

                    const newOrder = await tx.order.create({
                        data: {
                            orderNumber,
                            distributorId,
                            notes,
                            status: 'PENDING',
                            items: {
                                create: items.map(item => ({
                                    productId: item.productId,
                                    requestedQty: item.requestedQty,
                                    pendingQty: item.requestedQty,
                                    allocatedQty: 0
                                }))
                            }
                        },
                        include: {
                            items: {
                                include: {
                                    product: {
                                        select: { id: true, name: true, sku: true }
                                    }
                                }
                            },
                            distributor: {
                                select: { id: true, name: true, email: true }
                            }
                        }
                    });

                    // Clean up cart reservations
                    await tx.cartReservation.deleteMany({
                        where: { distributorId, productId: { in: productIds } }
                    });

                    return newOrder;
                });
                break; // success — exit retry loop
            } catch (txErr) {
                if (txErr.code === 'P2002' && attempt < MAX_RETRIES - 1) {
                    console.warn(`[Order] orderNumber collision on attempt ${attempt + 1}, retrying...`);
                    continue;
                }
                throw txErr; // non-retryable or exhausted retries
            }
        }

        // TODO: Send notification to admin/logística
        // notificationService.notifyNewOrder(order);

        res.status(201).json({
            success: true,
            data: order
        });

    } catch (error) {
        console.error('Error creating order:', error);
        
        if (error.code === 'INSUFFICIENT_STOCK') {
            return res.status(409).json({
                success: false,
                error: error.message,
                stockIssues: error.stockIssues
            });
        }
        
        res.status(500).json({
            success: false,
            error: error.message || 'Error al crear el pedido'
        });
    }
};

/**
 * Get orders for the logged-in distributor
 */
exports.getMyOrders = async (req, res) => {
    try {
        const distributorId = req.user.id;
        const { status } = req.query;

        const where = {
            distributorId
        };

        if (status) {
            where.status = status;
        }

        const orders = await prisma.order.findMany({
            where,
            include: {
                items: {
                    include: {
                        product: {
                            select: {
                                id: true,
                                name: true,
                                sku: true,
                                packSize: true,
                                flavor: true,
                                currentStock: true
                            }
                        },
                        pickingItems: {
                            select: {
                                id: true,
                                lotNumber: true,
                                scannedQty: true,
                                scannedAt: true,
                                productName: true
                            }
                        }
                    }
                },
                approver: {
                    select: {
                        name: true
                    }
                },
                picker: {
                    select: {
                        name: true
                    }
                }
            },
            orderBy: {
                createdAt: 'desc'
            }
        });

        // FETCH FUTURE PRODUCTION SCHEDULE (same as getAvailableInventory)
        const futureBatches = await prisma.productionBatch.findMany({
            where: {
                status: {
                    in: ['PENDING', 'STAGE_1_BASE', 'STAGE_2_JARABE',
                        'STAGE_3_ESFERIFICACION', 'STAGE_4_PRODUCTO_FINAL', 'LABELING']
                }
            },
            orderBy: { scheduledStart: 'asc' },
            select: { flavor: true, scheduledStart: true }
        });

        const nextProductionMap = {};
        futureBatches.forEach(batch => {
            if (batch.flavor && batch.scheduledStart) {
                const flavorKey = batch.flavor.toUpperCase().trim();
                if (!nextProductionMap[flavorKey]) {
                    nextProductionMap[flavorKey] = batch.scheduledStart;
                }
            }
        });

        // Enrich each order item with current inventory and production data
        const enrichedOrders = orders.map(order => ({
            ...order,
            items: order.items.map(item => {
                const product = item.product;
                const flavor = product.flavor || '';
                const flavorKey = flavor.toUpperCase().trim();
                const nextProductionDate = nextProductionMap[flavorKey] || null;

                // Get current available quantity (stock)
                const qty = product.currentStock || 0;

                return {
                    ...item,
                    qty,
                    nextProductionDate
                };
            })
        }));

        res.json({
            success: true,
            data: enrichedOrders
        });

    } catch (error) {
        console.error('Error fetching orders:', error);
        res.status(500).json({
            success: false,
            error: 'Error al obtener pedidos'
        });
    }
};

/**
 * Cancel an order (only if PENDING)
 */
exports.cancelOrder = async (req, res) => {
    try {
        const { id } = req.params;
        const distributorId = req.user.id;

        const order = await prisma.order.findFirst({
            where: {
                id,
                distributorId
            }
        });

        if (!order) {
            return res.status(404).json({
                success: false,
                error: 'Pedido no encontrado'
            });
        }

        if (order.status !== 'PENDING') {
            return res.status(400).json({
                success: false,
                error: 'Solo se pueden cancelar pedidos pendientes'
            });
        }

        const updated = await prisma.order.update({
            where: { id },
            data: {
                status: 'CANCELLED'
            },
            include: {
                items: {
                    include: {
                        product: true
                    }
                }
            }
        });

        res.json({
            success: true,
            data: updated
        });

    } catch (error) {
        console.error('Error canceling order:', error);
        res.status(500).json({
            success: false,
            error: 'Error al cancelar pedido'
        });
    }
};

/**
 * Legacy: Get catalog (kept for backwards compatibility)
 */
exports.getCatalog = async (req, res) => {
    try {
        const products = await prisma.product.findMany({
            where: {
                type: { in: ['PERLA_EXPLOSIVA', 'SYRUP', 'BASE_CITRICA'] },
                currentStock: { gt: 0 }
            },
            select: {
                id: true,
                sku: true,
                barcode: true,
                name: true,
                type: true,
                flavor: true,
                size: true,
                currentStock: true,
                unit: true,
                packSize: true,
                group: { select: { name: true } },
                inventoryAlternate: { select: { reservedQty: true } }
            },
            orderBy: { name: 'asc' }
        });

        const catalog = products.map(p => ({
            ...p,
            available: Math.max(0, p.currentStock - (p.inventoryAlternate?.reservedQty || 0))
        }));

        res.json({ success: true, data: catalog });
    } catch (error) {
        res.status(500).json({ error: 'Error obteniendo catálogo' });
    }
};

module.exports = exports;
