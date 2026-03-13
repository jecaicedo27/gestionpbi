const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');

const prisma = new PrismaClient();
const RESERVATION_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Get available quantity for a product (stock - cart reservations - pending orders)
 */
async function getAvailableQty(productId, excludeDistributorId = null) {
    const product = await prisma.product.findUnique({
        where: { id: productId },
        select: { currentStock: true }
    });
    if (!product) return 0;

    // Sum cart reservations (excluding specified distributor and expired)
    const cartWhere = {
        productId,
        expiresAt: { gt: new Date() }
    };
    if (excludeDistributorId) {
        cartWhere.distributorId = { not: excludeDistributorId };
    }
    const cartAgg = await prisma.cartReservation.aggregate({
        where: cartWhere,
        _sum: { quantity: true }
    });

    // Sum pending/approved/in-progress order items (findMany + manual sum, aggregate doesn't support nested relation filters)
    const pendingItems = await prisma.orderItem.findMany({
        where: {
            productId,
            order: {
                status: { in: ['PENDING', 'APPROVED', 'IN_PICKING', 'READY'] }
            }
        },
        select: { requestedQty: true }
    });
    const orderReserved = pendingItems.reduce((sum, i) => sum + i.requestedQty, 0);

    const reserved = (cartAgg._sum.quantity || 0) + orderReserved;
    return Math.max(0, product.currentStock - reserved);
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
        const isBackorder = quantity > available;

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
            backorder: isBackorder,
            backorderQty: isBackorder ? quantity - available : 0
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

        await prisma.cartReservation.updateMany({
            where: { distributorId },
            data: { expiresAt: new Date(Date.now() + RESERVATION_TTL_MS) }
        });

        res.json({ success: true });
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
