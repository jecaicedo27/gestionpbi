const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');
const cacheService = require('../services/cacheService');

const prisma = new PrismaClient();

/**
 * Admin/Logistics: Approve an order
 * Allocates inventory and changes status to APPROVED
 */
exports.approveOrder = async (req, res) => {
    try {
        const { id } = req.params;
        const approverId = req.user.id;

        const order = await prisma.order.findUnique({
            where: { id },
            include: {
                items: {
                    include: {
                        product: true
                    }
                },
                distributor: {
                    select: {
                        name: true,
                        email: true
                    }
                }
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
                error: `No se puede aprobar un pedido con estado ${order.status}`
            });
        }

        // Note: Stock validation removed — backorders are allowed.
        // Insufficient stock items will be fulfilled from upcoming production.

        const { skipInsufficient } = req.body || {};

        // Approve and allocate in transaction
        const updated = await prisma.$transaction(async (tx) => {
            // If skipInsufficient, remove items where stock < requested
            if (skipInsufficient) {
                const insufficientItems = order.items.filter(
                    item => (item.product?.currentStock || 0) < item.requestedQty
                );
                if (insufficientItems.length > 0) {
                    await tx.orderItem.deleteMany({
                        where: { id: { in: insufficientItems.map(i => i.id) } }
                    });
                    // Also release reserved stock for removed items
                    for (const item of insufficientItems) {
                        try {
                            await tx.inventoryAlternate.update({
                                where: { productId: item.productId },
                                data: {
                                    reservedQty: { decrement: item.requestedQty },
                                    availableQty: { increment: item.requestedQty }
                                }
                            });
                        } catch (e) { /* no alternate record */ }
                    }
                }
            }

            // Get remaining items after potential deletions
            const remainingItems = skipInsufficient
                ? order.items.filter(item => (item.product?.currentStock || 0) >= item.requestedQty)
                : order.items;

            if (remainingItems.length === 0) {
                throw new Error('No quedan productos con stock suficiente para aprobar');
            }

            // Update order status
            const approvedOrder = await tx.order.update({
                where: { id },
                data: {
                    status: 'APPROVED',
                    approvedBy: approverId,
                    approvedAt: new Date(),
                    ...(skipInsufficient ? { notes: (order.notes || '') + ' [Aprobado sin faltantes]' } : {})
                },
                include: {
                    items: {
                        include: {
                            product: true
                        }
                    },
                    distributor: true,
                    approver: {
                        select: {
                            name: true
                        }
                    }
                }
            });

            // Update allocated quantities for remaining items
            for (const item of remainingItems) {
                await tx.orderItem.update({
                    where: { id: item.id },
                    data: {
                        allocatedQty: item.requestedQty,
                        pendingQty: 0
                    }
                });
            }

            return approvedOrder;
        });

        // Invalidate cache
        await cacheService.invalidatePattern('inventory:*');

        // Notify distributor via WebSocket
        const io = req.app.get('io');
        if (io) {
            io.emit('order:approved', {
                orderId: updated.id,
                orderNumber: updated.orderNumber,
                distributorId: updated.distributorId
            });
        }

        logger.info(`Order ${updated.orderNumber} approved by ${req.user.email}`);

        res.json({
            success: true,
            data: updated
        });

    } catch (error) {
        logger.error('Approve Order Error:', error);
        res.status(500).json({
            success: false,
            error: 'Error al aprobar pedido'
        });
    }
};

/**
 * Admin/Logistics: Reject an order
 */
exports.rejectOrder = async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;

        const order = await prisma.order.findUnique({
            where: { id }
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
                error: 'Solo se pueden rechazar pedidos pendientes'
            });
        }

        const updated = await prisma.order.update({
            where: { id },
            data: {
                status: 'REJECTED',
                rejectedReason: reason,
                approvedBy: req.user.id,
                approvedAt: new Date()
            },
            include: {
                distributor: true,
                items: {
                    include: {
                        product: true
                    }
                }
            }
        });

        // Notify distributor
        const io = req.app.get('io');
        if (io) {
            io.emit('order:rejected', {
                orderId: updated.id,
                orderNumber: updated.orderNumber,
                distributorId: updated.distributorId,
                reason
            });
        }

        logger.info(`Order ${updated.orderNumber} rejected by ${req.user.email}`);

        res.json({
            success: true,
            data: updated
        });

    } catch (error) {
        logger.error('Reject Order Error:', error);
        res.status(500).json({
            success: false,
            error: 'Error al rechazar pedido'
        });
    }
};

/**
 * Logistics: Mark order as ready for dispatch
 */
exports.markReady = async (req, res) => {
    try {
        const { id } = req.params;

        const order = await prisma.order.findUnique({
            where: { id }
        });

        if (!order) {
            return res.status(404).json({
                success: false,
                error: 'Pedido no encontrado'
            });
        }

        if (!['APPROVED', 'IN_PROGRESS'].includes(order.status)) {
            return res.status(400).json({
                success: false,
                error: 'El pedido debe estar aprobado o en progreso'
            });
        }

        const updated = await prisma.order.update({
            where: { id },
            data: {
                status: 'READY',
                readyAt: new Date(),
                completionPercent: 100
            },
            include: {
                distributor: true,
                items: {
                    include: {
                        product: true
                    }
                }
            }
        });

        // Notify
        const io = req.app.get('io');
        if (io) {
            io.emit('order:ready', {
                orderId: updated.id,
                orderNumber: updated.orderNumber,
                distributorId: updated.distributorId
            });
        }

        logger.info(`Order ${updated.orderNumber} marked as ready`);

        res.json({
            success: true,
            data: updated
        });

    } catch (error) {
        logger.error('Mark Ready Error:', error);
        res.status(500).json({
            success: false,
            error: 'Error al marcar como listo'
        });
    }
};

/**
 * Commercial: Invoice order (upload invoice PDF + account statement)
 * POST /api/orders/:id/invoice
 */
exports.invoiceOrder = async (req, res) => {
    try {
        const { id } = req.params;

        const order = await prisma.order.findUnique({
            where: { id },
            include: {
                items: { include: { product: true } },
                distributor: true
            }
        });

        if (!order) {
            return res.status(404).json({ success: false, error: 'Pedido no encontrado' });
        }

        if (order.status !== 'READY') {
            return res.status(400).json({ success: false, error: 'El pedido debe estar listo para facturar' });
        }

        // ── Create invoice in Siigo ──
        let siigoResult = null;
        let siigoError = null;
        try {
            const siigoService = require('../services/siigoService');
            siigoResult = await siigoService.createInvoice(order);
            logger.info(`✅ Siigo invoice created for order ${order.orderNumber}: ${siigoResult.name || siigoResult.number}`);
        } catch (siigoErr) {
            siigoError = siigoErr;
            logger.error(`⚠️ Siigo invoice failed for order ${order.orderNumber}:`, JSON.stringify(siigoErr));
            // If Siigo fails completely, return error instead of silently continuing
            if (!siigoResult) {
                return res.status(500).json({
                    success: false,
                    error: 'Error creando factura en Siigo',
                    siigoError: siigoErr.error || siigoErr.message || 'Error desconocido',
                    siigoDetails: siigoErr.details || []
                });
            }
        }

        const updated = await prisma.order.update({
            where: { id },
            data: {
                status: 'INVOICED',
                invoicedAt: new Date(),
                invoicedBy: req.user.id,
                invoiceNumber: siigoResult?.name || siigoResult?.number?.toString() || null,
                invoicePdfUrl: siigoResult?.public_url || null
            },
            include: { distributor: { select: { name: true } } }
        });

        logger.info(`Order ${updated.orderNumber} invoiced by ${req.user.name || req.user.id} → Siigo: ${siigoResult?.name}`);

        res.json({
            success: true,
            data: updated,
            siigoInvoice: siigoResult ? { id: siigoResult.id, number: siigoResult.number, name: siigoResult.name } : null
        });

    } catch (error) {
        logger.error('Invoice Order Error:', error);
        res.status(500).json({ success: false, error: 'Error al facturar pedido' });
    }
};

/**
 * Logistics: Dispatch order with enhanced details + auto transport guide
 * POST /api/orders/:id/dispatch
 */
exports.dispatchOrder = async (req, res) => {
    try {
        const { id } = req.params;
        const {
            driverName, licensePlate, driverCedula,
            amountPaid, destination, dispatchTime, dispatchNotes
        } = req.body;

        const order = await prisma.order.findUnique({
            where: { id },
            include: {
                items: { include: { product: { select: { name: true, packSize: true } } } }
            }
        });

        if (!order) {
            return res.status(404).json({ success: false, error: 'Pedido no encontrado' });
        }

        if (order.status !== 'INVOICED') {
            return res.status(400).json({ success: false, error: 'El pedido debe estar facturado para despachar' });
        }

        if (!driverName || !licensePlate || !destination) {
            return res.status(400).json({ success: false, error: 'Nombre del conductor, placa y destino son requeridos' });
        }

        // Auto-calc total weight based on product name
        const getWeightGrams = (name) => {
            const n = (name || '').toUpperCase();
            if (n.includes('SIROPE') || n.includes('GENIALITY')) return n.includes('1000') ? 1300 : n.includes('360') ? 500 : 1300;
            if (n.includes('LIQUIMON')) return n.includes('1000') ? 1000 : 500;
            const m = n.match(/(\d+)\s*GR/); if (m) return parseInt(m[1]);
            return 350;
        };
        const totalWeightKg = order.items.reduce((sum, item) => {
            return sum + ((item.allocatedQty || 0) * getWeightGrams(item.product?.name) / 1000);
        }, 0);

        // Auto-generate transport guide number
        const now = new Date();
        const dateStr = `${String(now.getDate()).padStart(2, '0')}${String(now.getMonth() + 1).padStart(2, '0')}${now.getFullYear()}`;
        const count = await prisma.order.count({ where: { transportGuideNumber: { not: null } } });
        const transportGuideNumber = `GUIA-${dateStr}-${String(count + 1).padStart(4, '0')}`;

        // Deduct from physical stock when dispatching
        const updated = await prisma.$transaction(async (tx) => {
            const dispatchedOrder = await tx.order.update({
                where: { id },
                data: {
                    status: 'DISPATCHED',
                    dispatchedAt: now,
                    driverName,
                    licensePlate: licensePlate.toUpperCase(),
                    driverCedula,
                    amountPaid: amountPaid ? parseFloat(amountPaid) : null,
                    totalWeightKg: Math.round(totalWeightKg * 100) / 100,
                    dispatchTime: dispatchTime || now.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }),
                    destination,
                    dispatchNotes,
                    transportGuideNumber,
                    trackingGuide: transportGuideNumber
                },
                include: {
                    items: { include: { product: true } },
                    distributor: true
                }
            });

            // Deduct stock
            for (const item of dispatchedOrder.items) {
                await tx.product.update({
                    where: { id: item.productId },
                    data: { currentStock: { decrement: item.allocatedQty } }
                });

                // Update inventory alternate (safe — skip if not found)
                try {
                    await tx.inventoryAlternate.update({
                        where: { productId: item.productId },
                        data: { reservedQty: { decrement: item.allocatedQty } }
                    });
                } catch (e) { /* No alternate record */ }
            }

            return dispatchedOrder;
        });

        // Invalidate cache
        await cacheService.invalidatePattern('inventory:*');

        // Notify
        const io = req.app.get('io');
        if (io) {
            io.emit('order:dispatched', {
                orderId: updated.id,
                orderNumber: updated.orderNumber,
                distributorId: updated.distributorId,
                transportGuideNumber
            });
        }

        logger.info(`Order ${updated.orderNumber} dispatched — guide: ${transportGuideNumber}, driver: ${driverName}`);

        res.json({ success: true, data: updated });

    } catch (error) {
        logger.error('Dispatch Order Error:', error);
        res.status(500).json({ success: false, error: 'Error al despachar pedido' });
    }
};

/**
 * Mark order as DELIVERED
 * POST /api/orders/:id/deliver
 * Can include a signed guide image upload
 */
exports.deliverOrder = async (req, res) => {
    try {
        const { id } = req.params;

        const order = await prisma.order.findUnique({
            where: { id },
            include: { distributor: { select: { name: true, id: true } } }
        });

        if (!order) {
            return res.status(404).json({ success: false, error: 'Pedido no encontrado' });
        }

        if (order.status !== 'DISPATCHED') {
            return res.status(400).json({ success: false, error: 'El pedido debe estar despachado para confirmar entrega' });
        }

        // Distributors can only deliver their own orders
        if (req.user.role === 'DISTRIBUIDOR' && order.distributorId !== req.user.id) {
            return res.status(403).json({ success: false, error: 'No autorizado' });
        }

        const data = {
            status: 'DELIVERED',
            deliveredAt: new Date()
        };

        // If a signed guide file was uploaded
        if (req.file) {
            data.signedGuideUrl = `/uploads/signed-guides/${req.file.filename}`;
        }

        const updated = await prisma.order.update({
            where: { id },
            data,
            include: { distributor: { select: { name: true } } }
        });

        // Notify via socket
        const io = req.app.get('io');
        if (io) {
            io.emit('order:delivered', {
                orderId: updated.id,
                orderNumber: updated.orderNumber,
                distributorId: updated.distributorId,
                confirmedBy: req.user.name || req.user.email
            });
        }

        logger.info(`Order ${updated.orderNumber} delivered — confirmed by ${req.user.name || req.user.email}`);

        res.json({ success: true, data: updated });

    } catch (error) {
        logger.error('Deliver Order Error:', error);
        res.status(500).json({ success: false, error: 'Error al confirmar entrega' });
    }
};

/**
 * Get printable transport guide HTML
 * GET /api/orders/:id/transport-guide
 */
exports.getTransportGuide = async (req, res) => {
    try {
        const { id } = req.params;

        const order = await prisma.order.findUnique({
            where: { id },
            include: {
                items: { include: { product: { select: { name: true, sku: true, packSize: true } } } },
                distributor: { select: { name: true, email: true } }
            }
        });

        if (!order || !order.transportGuideNumber) {
            return res.status(404).json({ success: false, error: 'Guía no encontrada' });
        }

        const getWeightG = (name) => {
            const n = (name || '').toUpperCase();
            if (n.includes('SIROPE') || n.includes('GENIALITY')) return n.includes('1000') ? 1300 : n.includes('360') ? 500 : 1300;
            if (n.includes('LIQUIMON')) return n.includes('1000') ? 1000 : 500;
            const m = n.match(/(\d+)\s*GR/); if (m) return parseInt(m[1]);
            return 350;
        };
        const rows = order.items.map(item => {
            const qty = item.allocatedQty || 0;
            const weightG = getWeightG(item.product?.name);
            const boxes = Math.ceil(qty / 12); // 12 units per box
            const weightKg = (qty * weightG / 1000).toFixed(2);
            return `<tr>
                <td>${item.product?.name || item.product?.sku}</td>
                <td style="text-align:center">${qty}</td>
                <td style="text-align:center">${boxes}</td>
                <td style="text-align:center">${weightKg} kg</td>
            </tr>`;
        }).join('');

        const html = `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Guía de Transporte - ${order.transportGuideNumber}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', Arial, sans-serif; padding: 30px; color: #333; }
        .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #7C3AED; padding-bottom: 15px; margin-bottom: 20px; }
        .logo { font-size: 24px; font-weight: 800; color: #7C3AED; }
        .guide-number { font-size: 18px; font-weight: 700; color: #7C3AED; text-align: right; }
        .guide-number small { display: block; font-size: 12px; color: #999; font-weight: 400; }
        .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 20px; }
        .info-box { border: 1px solid #E5E7EB; border-radius: 8px; padding: 12px; }
        .info-box h4 { font-size: 11px; text-transform: uppercase; color: #7C3AED; margin-bottom: 6px; letter-spacing: 1px; }
        .info-box p { font-size: 14px; margin: 2px 0; }
        .info-box .value { font-weight: 600; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
        th { background: #7C3AED; color: white; padding: 8px 12px; text-align: left; font-size: 12px; text-transform: uppercase; }
        td { padding: 8px 12px; border-bottom: 1px solid #E5E7EB; font-size: 13px; }
        tr:nth-child(even) { background: #F9FAFB; }
        .totals { display: flex; justify-content: flex-end; gap: 30px; margin-bottom: 30px; font-size: 14px; }
        .totals span { font-weight: 700; color: #7C3AED; }
        .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 40px; }
        .sig-block { border-top: 2px solid #333; padding-top: 8px; text-align: center; }
        .sig-block p { font-size: 12px; color: #666; }
        .sig-block .name { font-weight: 700; font-size: 14px; color: #333; }
        .footer { margin-top: 30px; text-align: center; font-size: 11px; color: #999; border-top: 1px solid #E5E7EB; padding-top: 10px; }
        @media print { body { padding: 15px; } }
    </style>
</head>
<body>
    <div class="header">
        <div>
            <div class="logo">LIQUIPOPS</div>
            <p style="font-size:12px;color:#666">Guía de Transporte de Mercancía</p>
        </div>
        <div class="guide-number">
            ${order.transportGuideNumber}
            <small>Pedido: ${order.orderNumber}</small>
        </div>
    </div>

    <div class="info-grid">
        <div class="info-box">
            <h4>Datos del Distribuidor</h4>
            <p><span class="value">${order.distributor?.name}</span></p>
            <p>${order.distributor?.email || ''}</p>
        </div>
        <div class="info-box">
            <h4>Datos del Conductor</h4>
            <p>Nombre: <span class="value">${order.driverName || ''}</span></p>
            <p>Cédula: <span class="value">${order.driverCedula || ''}</span></p>
            <p>Placa: <span class="value">${order.licensePlate || ''}</span></p>
        </div>
        <div class="info-box">
            <h4>Despacho</h4>
            <p>Fecha: <span class="value">${order.dispatchedAt ? new Date(order.dispatchedAt).toLocaleDateString('es-CO') : ''}</span></p>
            <p>Hora: <span class="value">${order.dispatchTime || ''}</span></p>
            <p>Destino: <span class="value">${order.destination || ''}</span></p>
        </div>
        <div class="info-box">
            <h4>Resumen</h4>
            <p>Peso total: <span class="value">${order.totalWeightKg || 0} kg</span></p>
            <p>Monto: <span class="value">$${(order.amountPaid || 0).toLocaleString('es-CO')}</span></p>
            <p>Factura: <span class="value">${order.invoiceNumber || 'N/A'}</span></p>
        </div>
    </div>

    <table>
        <thead>
            <tr><th>Producto</th><th>Unidades</th><th>Cajas</th><th>Peso</th></tr>
        </thead>
        <tbody>${rows}</tbody>
    </table>

    <div class="totals">
        <div>Total productos: <span>${order.items.length}</span></div>
        <div>Total peso: <span>${order.totalWeightKg || 0} kg</span></div>
    </div>

    <div class="signatures">
        <div class="sig-block">
            <p class="name">${order.driverName || 'Conductor'}</p>
            <p>C.C. ${order.driverCedula || ''}</p>
            <p>Firma del Conductor</p>
        </div>
        <div class="sig-block">
            <p class="name">Responsable Logística</p>
            <p>LIQUIPOPS SAS</p>
            <p>Firma Autorizada</p>
        </div>
    </div>

    <div class="footer">
        Documento generado automáticamente — ${new Date().toLocaleString('es-CO')}
    </div>

    <script>window.onload = () => window.print();</script>
</body>
</html>`;

        res.setHeader('Content-Type', 'text/html');
        res.send(html);

    } catch (error) {
        logger.error('Transport Guide Error:', error);
        res.status(500).json({ success: false, error: 'Error al generar guía' });
    }
};

/**
 * Get order counts by status (for tab badges)
 */
exports.getOrderCounts = async (req, res) => {
    try {
        const where = {};
        // Scope to distributor if not admin
        if (req.user.role === 'DISTRIBUIDOR') {
            where.distributorId = req.user.id;
        }

        const statuses = ['PENDING', 'APPROVED', 'IN_PICKING', 'READY', 'INVOICED', 'DISPATCHED', 'DELIVERED'];
        const counts = {};

        await Promise.all(statuses.map(async (status) => {
            counts[status] = await prisma.order.count({ where: { ...where, status } });
        }));

        res.json({ success: true, data: counts });
    } catch (error) {
        logger.error('Get Order Counts Error:', error);
        res.status(500).json({ success: false, error: 'Error al obtener contadores' });
    }
};

/**
 * Get all orders with filters (Admin/Logistics only)
 */
exports.getAllOrders = async (req, res) => {
    try {
        const { status, distributorId, page = 1, limit = 50, startDate, endDate } = req.query;
        const skip = (page - 1) * limit;

        const where = {};

        if (status) where.status = status;
        if (distributorId) where.distributorId = distributorId;

        // Scope to own orders for distributors
        if (req.user.role === 'DISTRIBUIDOR') {
            where.distributorId = req.user.id;
        }

        if (startDate || endDate) {
            where.createdAt = {};
            if (startDate) where.createdAt.gte = new Date(startDate);
            if (endDate) where.createdAt.lte = new Date(endDate);
        }

        const [orders, total] = await Promise.all([
            prisma.order.findMany({
                where,
                include: {
                    distributor: {
                        select: {
                            id: true,
                            name: true,
                            email: true
                        }
                    },
                    items: {
                        include: {
                            product: {
                                select: {
                                    id: true,
                                    name: true,
                                    sku: true,
                                    type: true,
                                    packSize: true,
                                    currentStock: true
                                }
                            },
                            pickingItems: {
                                select: {
                                    id: true,
                                    lotNumber: true,
                                    scannedQty: true
                                }
                            }
                        }
                    },
                    approver: {
                        select: {
                            name: true
                        }
                    }
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
        logger.error('Get All Orders Error:', error);
        res.status(500).json({
            success: false,
            error: 'Error al obtener pedidos'
        });
    }
};

/**
 * Get order by ID with full details
 */
exports.getOrderById = async (req, res) => {
    try {
        const { id } = req.params;

        const order = await prisma.order.findUnique({
            where: { id },
            include: {
                distributor: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                        username: true
                    }
                },
                items: {
                    include: {
                        product: {
                            select: {
                                id: true,
                                name: true,
                                sku: true,
                                type: true,
                                flavor: true,
                                size: true
                            }
                        }
                    }
                },
                approver: {
                    select: {
                        id: true,
                        name: true,
                        email: true
                    }
                }
            }
        });

        if (!order) {
            return res.status(404).json({
                success: false,
                error: 'Pedido no encontrado'
            });
        }

        // Check permissions: distributors can only see their own orders
        if (req.user.role === 'DISTRIBUIDOR' && order.distributorId !== req.user.id) {
            return res.status(403).json({
                success: false,
                error: 'No autorizado'
            });
        }

        res.json({
            success: true,
            data: order
        });

    } catch (error) {
        logger.error('Get Order By ID Error:', error);
        res.status(500).json({
            success: false,
            error: 'Error al obtener pedido'
        });
    }
};
