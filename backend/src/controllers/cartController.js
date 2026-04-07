const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');

const prisma = new PrismaClient();
const RESERVATION_TTL_MS = 30 * 60 * 1000; // 30 min idle timeout
const RESERVATION_MAX_MS = 2 * 60 * 60 * 1000;  // 2 hour ABSOLUTE MAX — heartbeat cannot extend beyond this

/**
 * Get available quantity for a product (stock - cart reservations - pending orders)
 */
async function getAvailableQty(productId, excludeDistributorId = null, tx = prisma) {
    // Sum stock strictly from the physical PRODUCTO_TERMINADO zone
    const finishedStock = await tx.finishedLotStock.aggregate({
        where: {
            productId,
            zone: 'PRODUCTO_TERMINADO',
            currentQuantity: { gt: 0 }
        },
        _sum: { currentQuantity: true }
    });
    const physicalStock = finishedStock._sum.currentQuantity || 0;

    // Sum cart reservations (excluding specified distributor and expired)
    const cartWhere = {
        productId,
        expiresAt: { gt: new Date() }
    };
    if (excludeDistributorId) {
        cartWhere.distributorId = { not: excludeDistributorId };
    }
    const cartAgg = await tx.cartReservation.aggregate({
        where: cartWhere,
        _sum: { quantity: true }
    });

    // Sum pending/approved/in-progress order items (findMany + manual sum, aggregate doesn't support nested relation filters)
    const pendingItems = await tx.orderItem.findMany({
        where: {
            productId,
            order: {
                status: { in: ['PENDING', 'APPROVED', 'IN_PICKING', 'READY'] }
            }
        },
        select: { requestedQty: true, allocatedQty: true, pendingQty: true }
    });
    // Subtract the full requested quantity for active orders.
    // Because even if they are physically allocated/picked, they are still 
    // sitting in the FinishedLotStock database until invoiced/dispatched.
    const orderReserved = pendingItems.reduce((sum, i) => sum + i.requestedQty, 0);

    const reserved = (cartAgg._sum.quantity || 0) + orderReserved;
    return Math.max(0, physicalStock - reserved);
}

/**
 * Broadcast updated availability for a product to all connected clients
 */
function broadcastAvailability(io, productId, availableQty) {
    if (io) {
        io.emit('inventory:updated', { productId, availableQty });
    }
}

/**
 * POST /api/cart/reserve
 * Body: { productId, quantity }
 */
exports.reserve = async (req, res) => {
    try {
        const { productId, quantity } = req.body;
        const distributorId = req.user.id;

        if (!productId || !quantity || quantity <= 0) {
            return res.status(400).json({ success: false, error: 'productId y quantity son requeridos' });
        }

        // Check product exists
        const product = await prisma.product.findUnique({
            where: { id: productId },
            select: { id: true, name: true, currentStock: true }
        });
        if (!product) {
            return res.status(404).json({ success: false, error: 'Producto no encontrado' });
        }

        // Calculate available (excluding this distributor's own reservations)
        const available = await getAvailableQty(productId, distributorId);
        
        // Calculate backorder (if requested quantity exceeds physical availability)
        // We now ALLOW reservations beyond stock to capture demand for production
        const backorderQty = Math.max(0, quantity - available);

        // Upsert reservation (allow over-ordering / backorders)
        const reservation = await prisma.cartReservation.upsert({
            where: {
                distributorId_productId: { distributorId, productId }
            },
            update: {
                quantity,
                expiresAt: new Date(Date.now() + RESERVATION_TTL_MS)
            },
            create: {
                distributorId,
                productId,
                quantity,
                expiresAt: new Date(Date.now() + RESERVATION_TTL_MS)
            }
        });

        // Broadcast updated availability to all clients
        const newAvailable = await getAvailableQty(productId);
        const io = req.app.get('io');
        broadcastAvailability(io, productId, newAvailable);

        res.json({
            success: true,
            data: reservation,
            availableQty: newAvailable,
            backorder: backorderQty > 0,
            backorderQty
        });

    } catch (error) {
        logger.error('Cart Reserve Error:', error);
        res.status(500).json({ success: false, error: 'Error al reservar' });
    }
};

/**
 * DELETE /api/cart/release/:productId
 */
exports.release = async (req, res) => {
    try {
        const { productId } = req.params;
        const distributorId = req.user.id;

        await prisma.cartReservation.deleteMany({
            where: { distributorId, productId }
        });

        // Broadcast updated availability
        const newAvailable = await getAvailableQty(productId);
        const io = req.app.get('io');
        broadcastAvailability(io, productId, newAvailable);

        res.json({ success: true, availableQty: newAvailable });

    } catch (error) {
        logger.error('Cart Release Error:', error);
        res.status(500).json({ success: false, error: 'Error al liberar' });
    }
};

/**
 * GET /api/cart
 * Returns current cart for logged-in distributor
 */
exports.getCart = async (req, res) => {
    try {
        const distributorId = req.user.id;

        // Clean expired first
        await prisma.cartReservation.deleteMany({
            where: { distributorId, expiresAt: { lt: new Date() } }
        });

        const items = await prisma.cartReservation.findMany({
            where: { distributorId },
            include: {
                product: {
                    select: {
                        id: true, name: true, sku: true, flavor: true,
                        size: true, packSize: true, currentStock: true,
                        type: true, accountGroup: true
                    }
                }
            }
        });

        res.json({ success: true, data: items });

    } catch (error) {
        logger.error('Get Cart Error:', error);
        res.status(500).json({ success: false, error: 'Error al obtener carrito' });
    }
};

/**
 * DELETE /api/cart/clear
 * Clears all cart items for logged-in distributor
 */
exports.clearCart = async (req, res) => {
    try {
        const distributorId = req.user.id;

        // Get all product IDs before clearing (for broadcasting)
        const items = await prisma.cartReservation.findMany({
            where: { distributorId },
            select: { productId: true }
        });

        await prisma.cartReservation.deleteMany({
            where: { distributorId }
        });

        // Broadcast availability for all released products
        const io = req.app.get('io');
        for (const item of items) {
            const avail = await getAvailableQty(item.productId);
            broadcastAvailability(io, item.productId, avail);
        }

        res.json({ success: true });

    } catch (error) {
        logger.error('Clear Cart Error:', error);
        res.status(500).json({ success: false, error: 'Error al limpiar carrito' });
    }
};

/**
 * Heartbeat — extend expiry for all items in cart
 * POST /api/cart/heartbeat
 */
exports.heartbeat = async (req, res) => {
    try {
        const distributorId = req.user.id;
        const now = Date.now();

        // Get current items to enforce absolute max TTL
        const items = await prisma.cartReservation.findMany({
            where: { distributorId },
            select: { id: true, productId: true, createdAt: true }
        });

        const expired = [];
        const toExtend = [];

        for (const item of items) {
            const absoluteExpiry = new Date(item.createdAt).getTime() + RESERVATION_MAX_MS;
            if (now >= absoluteExpiry) {
                // Past the absolute max — force release
                expired.push(item.id);
            } else {
                // Extend but not beyond absolute max
                const newExpiry = Math.min(now + RESERVATION_TTL_MS, absoluteExpiry);
                toExtend.push({ id: item.id, expiresAt: new Date(newExpiry) });
            }
        }

        // Delete items that exceeded absolute max
        if (expired.length > 0) {
            await prisma.cartReservation.deleteMany({ where: { id: { in: expired } } });
        }

        // Extend valid items
        for (const item of toExtend) {
            await prisma.cartReservation.update({
                where: { id: item.id },
                data: { expiresAt: item.expiresAt }
            });
        }

        res.json({
            success: true,
            expiredCount: expired.length,
            extended: toExtend.length,
            message: expired.length > 0 ? `${expired.length} artículo(s) expiraron (límite 2h). Vuelve a agregarlos.` : null
        });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Error heartbeat' });
    }
};

/**
 * Cleanup expired reservations — call from cron/interval
 * Returns product IDs that were freed
 */
exports.cleanupExpired = async (io) => {
    try {
        // Find expired reservations
        const expired = await prisma.cartReservation.findMany({
            where: { expiresAt: { lt: new Date() } },
            select: { productId: true }
        });

        if (expired.length === 0) return;

        // Get unique product IDs
        const productIds = [...new Set(expired.map(e => e.productId))];

        // Delete expired
        await prisma.cartReservation.deleteMany({
            where: { expiresAt: { lt: new Date() } }
        });

        // Broadcast updated availability for freed products
        for (const pid of productIds) {
            const avail = await getAvailableQty(pid);
            broadcastAvailability(io, pid, avail);
        }

        if (productIds.length > 0) {
            logger.info(`[CartCleanup] Freed ${expired.length} expired reservations for ${productIds.length} products`);
        }
    } catch (error) {
        logger.error('Cart Cleanup Error:', error);
    }
};

// Export helper for use in other controllers
exports.getAvailableQty = getAvailableQty;
