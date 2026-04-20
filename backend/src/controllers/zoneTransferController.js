const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * Zone Transfer Controller
 * 
 * Manages material movements between Bodega General (WAREHOUSE) and
 * Zona de Producción (PRODUCTION). Tracks lot-level transfers with
 * user traceability.
 */

// ── GET /zone-transfers — History with filters ────────────────────────────
exports.listTransfers = async (req, res) => {
    try {
        const { productId, direction, days = 7, limit = 100 } = req.query;
        const since = new Date();
        since.setDate(since.getDate() - parseInt(days));

        const where = { createdAt: { gte: since } };
        if (productId) where.productId = productId;
        if (direction) where.direction = direction;

        const transfers = await prisma.zoneTransfer.findMany({
            where,
            include: {
                product: { select: { id: true, name: true, sku: true, unit: true } },
                materialLot: { select: { id: true, lotNumber: true, zone: true, currentQuantity: true } },
                transferredBy: { select: { id: true, name: true } }
            },
            orderBy: { createdAt: 'desc' },
            take: parseInt(limit)
        });

        res.json(transfers);
    } catch (error) {
        console.error('Error listing zone transfers:', error);
        res.status(500).json({ error: error.message });
    }
};

// ── GET /zone-transfers/zone-stock — Production zone stock summary ────────
exports.getZoneStock = async (req, res) => {
    try {
        const { search } = req.query;

        // Get products with productionZoneStock > 0 OR with lots in PRODUCTION zone
        const where = {
            OR: [
                { productionZoneStock: { gt: 0 } },
                { materialLots: { some: { zone: 'PRODUCTION', currentQuantity: { gt: 0 } } } }
            ]
        };
        if (search) {
            where.AND = {
                OR: [
                    { name: { contains: search, mode: 'insensitive' } },
                    { sku: { contains: search, mode: 'insensitive' } }
                ]
            };
        }

        const products = await prisma.product.findMany({
            where,
            select: {
                id: true,
                name: true,
                sku: true,
                unit: true,
                currentStock: true,
                productionZoneStock: true,
                packSize: true,
                materialLots: {
                    where: { zone: 'PRODUCTION', currentQuantity: { gt: 0 } },
                    select: {
                        id: true,
                        lotNumber: true,
                        currentQuantity: true,
                        unit: true,
                        status: true,
                        receivedAt: true,
                        expiresAt: true
                    },
                    orderBy: { receivedAt: 'desc' }
                }
            },
            orderBy: { name: 'asc' }
        });

        const productsWithLotTotals = products.map(product => {
            const lotZoneStock = (product.materialLots || []).reduce(
                (sum, lot) => sum + Number(lot.currentQuantity || 0),
                0
            );

            return {
                ...product,
                productionZoneStock: lotZoneStock > 0
                    ? lotZoneStock
                    : Number(product.productionZoneStock || 0)
            };
        });

        res.json(productsWithLotTotals);
    } catch (error) {
        console.error('Error getting zone stock:', error);
        res.status(500).json({ error: error.message });
    }
};

// ── GET /zone-transfers/available-lots/:productId — Lots in WAREHOUSE ─────
exports.getAvailableLots = async (req, res) => {
    try {
        const { productId } = req.params;

        // Get product to determine the correct display unit
        const product = await prisma.product.findUnique({
            where: { id: productId },
            select: { unit: true }
        });
        const productUnit = product?.unit || 'unidad';

        const lots = await prisma.materialLot.findMany({
            where: {
                productId,
                zone: 'WAREHOUSE',
                currentQuantity: { gt: 0 },
                status: { in: ['AVAILABLE', 'LOW_STOCK'] }
            },
            select: {
                id: true,
                lotNumber: true,
                currentQuantity: true,
                initialQuantity: true,
                unit: true,
                status: true,
                receivedAt: true,
                expiresAt: true
            },
            orderBy: { receivedAt: 'desc' }
        });

        // Override lot unit with the product's unit for correct display
        const lotsWithUnit = lots.map(l => ({
            ...l,
            unit: productUnit
        }));

        res.json(lotsWithUnit);
    } catch (error) {
        console.error('Error getting available lots:', error);
        res.status(500).json({ error: error.message });
    }
};

// ── POST /zone-transfers/transfer-in — Move material INTO production zone ─
exports.transferIn = async (req, res) => {
    try {
        const { productId, materialLotId, quantity, observations, photos } = req.body;
        const userId = req.body.userId || req.user?.id;

        if (!productId || !quantity || quantity <= 0) {
            return res.status(400).json({ error: 'productId y quantity son obligatorios' });
        }

        const result = await prisma.$transaction(async (tx) => {
            // 1. Validate product exists
            const product = await tx.product.findUnique({ where: { id: productId } });
            if (!product) throw new Error('Producto no encontrado');

            // 2. If lot specified, validate it
            let lot = null;
            let lotNumber = null;
            if (materialLotId) {
                lot = await tx.materialLot.findUnique({ where: { id: materialLotId } });
                if (!lot) throw new Error('Lote no encontrado');
                if (lot.productId !== productId) throw new Error('El lote no pertenece a este producto');
                if (lot.zone !== 'WAREHOUSE') throw new Error('Este lote ya está en zona de producción');
                if (lot.currentQuantity < quantity) {
                    throw new Error(`Cantidad insuficiente en lote. Disponible: ${lot.currentQuantity}, Solicitado: ${quantity}`);
                }
                lotNumber = lot.lotNumber;

                // Decrement lot quantity and mark zone
                const newLotQty = lot.currentQuantity - Math.round(quantity);
                if (newLotQty <= 0) {
                    // Entire lot moves to production
                    await tx.materialLot.update({
                        where: { id: materialLotId },
                        data: { zone: 'PRODUCTION', currentQuantity: lot.currentQuantity }
                    });
                } else {
                    // Partial transfer: create a new lot in PRODUCTION zone
                    await tx.materialLot.update({
                        where: { id: materialLotId },
                        data: { currentQuantity: newLotQty }
                    });
                    await tx.materialLot.create({
                        data: {
                            productId: lot.productId,
                            siigoProductCode: lot.siigoProductCode,
                            siigoProductName: lot.siigoProductName,
                            lotNumber: lot.lotNumber,
                            initialQuantity: Math.round(quantity),
                            currentQuantity: Math.round(quantity),
                            unit: lot.unit,
                            receivedAt: lot.receivedAt,
                            expiresAt: lot.expiresAt,
                            status: 'AVAILABLE',
                            zone: 'PRODUCTION',
                            purchaseOrderItemId: lot.purchaseOrderItemId
                        }
                    });
                }
            }

            // 3. Decrement warehouse stock, increment zone stock
            await tx.product.update({
                where: { id: productId },
                data: {
                    currentStock: { decrement: quantity },
                    productionZoneStock: { increment: quantity }
                }
            });

            // 4. Create transfer record
            const transfer = await tx.zoneTransfer.create({
                data: {
                    productId,
                    materialLotId: materialLotId || null,
                    direction: 'IN',
                    quantity,
                    unit: product.unit || 'unidad',
                    lotNumber,
                    transferredById: userId,
                    observations,
                    photos: Array.isArray(photos) ? photos : []
                },
                include: {
                    product: { select: { name: true, sku: true } },
                    transferredBy: { select: { name: true } }
                }
            });

            return transfer;
        });

        console.log(`📦 Zone Transfer IN: ${result.quantity} × ${result.product.name} by ${result.transferredBy.name}`);
        res.json(result);
    } catch (error) {
        console.error('Error transferring in:', error);
        res.status(400).json({ error: error.message });
    }
};

// ── POST /zone-transfers/transfer-out — Return material TO warehouse ──────
exports.transferOut = async (req, res) => {
    try {
        const { productId, materialLotId, quantity, observations } = req.body;
        const userId = req.body.userId || req.user?.id;

        if (!productId || !quantity || quantity <= 0) {
            return res.status(400).json({ error: 'productId y quantity son obligatorios' });
        }

        const result = await prisma.$transaction(async (tx) => {
            const product = await tx.product.findUnique({ where: { id: productId } });
            if (!product) throw new Error('Producto no encontrado');
            if (product.productionZoneStock < quantity) {
                throw new Error(`Cantidad insuficiente en zona. Disponible: ${product.productionZoneStock}, Solicitado: ${quantity}`);
            }

            let lotNumber = null;
            if (materialLotId) {
                const lot = await tx.materialLot.findUnique({ where: { id: materialLotId } });
                if (lot) {
                    lotNumber = lot.lotNumber;
                    await tx.materialLot.update({
                        where: { id: materialLotId },
                        data: { zone: 'WAREHOUSE' }
                    });
                }
            }

            await tx.product.update({
                where: { id: productId },
                data: {
                    currentStock: { increment: quantity },
                    productionZoneStock: { decrement: quantity }
                }
            });

            const transfer = await tx.zoneTransfer.create({
                data: {
                    productId,
                    materialLotId: materialLotId || null,
                    direction: 'OUT',
                    quantity,
                    unit: product.unit || 'unidad',
                    lotNumber,
                    transferredById: userId,
                    observations
                },
                include: {
                    product: { select: { name: true, sku: true } },
                    transferredBy: { select: { name: true } }
                }
            });

            return transfer;
        });

        console.log(`📦 Zone Transfer OUT: ${result.quantity} × ${result.product.name} by ${result.transferredBy.name}`);
        res.json(result);
    } catch (error) {
        console.error('Error transferring out:', error);
        res.status(400).json({ error: error.message });
    }
};

// ── GET /zone-transfers/search-products — Search products for transfer ────
exports.searchProducts = async (req, res) => {
    try {
        const { q } = req.query;
        if (!q || q.length < 2) return res.json([]);

        const products = await prisma.product.findMany({
            where: {
                OR: [
                    { name: { contains: q, mode: 'insensitive' } },
                    { sku: { contains: q, mode: 'insensitive' } }
                ],
                active: true
            },
            select: {
                id: true,
                name: true,
                sku: true,
                unit: true,
                currentStock: true,
                productionZoneStock: true,
                packSize: true,
                _count: { select: { materialLots: { where: { zone: 'WAREHOUSE', currentQuantity: { gt: 0 } } } } }
            },
            take: 20,
            orderBy: { name: 'asc' }
        });

        res.json(products);
    } catch (error) {
        console.error('Error searching products:', error);
        res.status(500).json({ error: error.message });
    }
};
