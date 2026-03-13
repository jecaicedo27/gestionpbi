const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * Director Logística: Approve order
 * POST /api/orders/:id/approve
 */
exports.approveOrder = async (req, res) => {
    try {
        const { id } = req.params;
        const { removedItems = [], modifiedQuantities = {} } = req.body;
        const approverId = req.user.id;

        // Verify user is Director Logística
        if (!['ADMIN', 'LOGISTICA'].includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                error: 'Solo el Director Logística puede aprobar pedidos'
            });
        }

        // Get order with items
        const order = await prisma.order.findUnique({
            where: { id },
            include: { items: true }
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
                error: 'Solo se pueden aprobar pedidos pendientes'
            });
        }

        // Remove items if specified
        if (removedItems.length > 0) {
            await prisma.orderItem.deleteMany({
                where: {
                    id: { in: removedItems }
                }
            });
        }

        // Modify quantities if specified
        for (const [itemId, newQty] of Object.entries(modifiedQuantities)) {
            await prisma.orderItem.update({
                where: { id: itemId },
                data: {
                    requestedQty: newQty,
                    allocatedQty: newQty,
                    pendingQty: 0
                }
            });
        }

        // Update order status
        const updatedOrder = await prisma.order.update({
            where: { id },
            data: {
                status: 'APPROVED',
                approvedBy: approverId,
                approvedAt: new Date()
            },
            include: {
                items: {
                    include: {
                        product: true
                    }
                },
                distributor: true
            }
        });

        res.json({
            success: true,
            message: 'Pedido aprobado exitosamente',
            data: updatedOrder
        });
    } catch (error) {
        console.error('Error approving order:', error);
        res.status(500).json({
            success: false,
            error: 'Error al aprobar el pedido'
        });
    }
};

/**
 * Director Logística: Reject order
 * POST /api/orders/:id/reject
 */
exports.rejectOrder = async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;
        const approverId = req.user.id;

        // Verify user is Director Logística
        if (!['ADMIN', 'LOGISTICA'].includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                error: 'Solo el Director Logística puede rechazar pedidos'
            });
        }

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

        const updatedOrder = await prisma.order.update({
            where: { id },
            data: {
                status: 'REJECTED',
                approvedBy: approverId,
                approvedAt: new Date(),
                dispatchNotes: reason || 'Rechazado por Director Logística'
            },
            include: {
                distributor: true
            }
        });

        res.json({
            success: true,
            message: 'Pedido rechazado',
            data: updatedOrder
        });
    } catch (error) {
        console.error('Error rejecting order:', error);
        res.status(500).json({
            success: false,
            error: 'Error al rechazar el pedido'
        });
    }
};

/**
 * Operario Picking: Start picking an order
 * POST /api/orders/:id/start-picking
 */
exports.startPicking = async (req, res) => {
    try {
        const { id } = req.params;
        const pickerId = req.user.id;

        // Verify user is Operario Picking
        if (!['ADMIN', 'OPERARIO_PICKING', 'LOGISTICA'].includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                error: 'Solo operarios de picking pueden iniciar la separación'
            });
        }

        const order = await prisma.order.findUnique({
            where: { id },
            include: { items: true }
        });

        if (!order) {
            return res.status(404).json({
                success: false,
                error: 'Pedido no encontrado'
            });
        }

        if (order.status !== 'APPROVED') {
            return res.status(400).json({
                success: false,
                error: 'Solo se pueden separar pedidos aprobados'
            });
        }

        const updatedOrder = await prisma.order.update({
            where: { id },
            data: {
                status: 'IN_PICKING',
                pickingStartedAt: new Date(),
                pickingStartedBy: pickerId,
                pickingProgress: 0
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
            message: 'Separación iniciada',
            data: updatedOrder
        });
    } catch (error) {
        console.error('Error starting picking:', error);
        res.status(500).json({
            success: false,
            error: 'Error al iniciar la separación'
        });
    }
};

/**
 * Operario Picking: Scan QR code and record item
 * POST /api/orders/:id/scan
 */
exports.scanItem = async (req, res) => {
    try {
        const { id } = req.params;
        const { orderItemId, qrData, scannedQty } = req.body;
        const scannerId = req.user.id;

        // Verify user is Operario Picking
        if (!['ADMIN', 'OPERARIO_PICKING', 'LOGISTICA'].includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                error: 'Solo operarios de picking pueden escanear items'
            });
        }

        const order = await prisma.order.findUnique({
            where: { id },
            include: {
                items: {
                    include: {
                        pickingItems: true
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

        if (order.status !== 'IN_PICKING') {
            return res.status(400).json({
                success: false,
                error: 'El pedido no está en proceso de separación'
            });
        }

        // Validate QR data
        if (!qrData.productCode || !qrData.barcode || !qrData.lotNumber || !qrData.expirationDate) {
            return res.status(400).json({
                success: false,
                error: 'Datos de QR incompletos'
            });
        }

        // Create picking item record
        await prisma.orderPickingItem.create({
            data: {
                orderItemId,
                productCode: qrData.productCode,
                barcode: qrData.barcode,
                productName: qrData.name || qrData.productName || '',
                unitsPerBox: qrData.unitsPerBox || 1,
                lotNumber: qrData.lotNumber || qrData.lot,
                expirationDate: new Date(qrData.expirationDate),
                scannedQty: scannedQty || qrData.unitsPerBox || 1,
                scannedBy: scannerId
            }
        });

        // Calculate progress
        const totalRequested = order.items.reduce((sum, item) => sum + item.requestedQty, 0);
        const updatedOrder = await prisma.order.findUnique({
            where: { id },
            include: {
                items: {
                    include: {
                        pickingItems: true
                    }
                }
            }
        });

        const totalScanned = updatedOrder.items.reduce((sum, item) =>
            sum + item.pickingItems.reduce((s, pi) => s + pi.scannedQty, 0), 0
        );

        const progress = Math.min(100, Math.round((totalScanned / totalRequested) * 100));

        // Update order progress
        const finalOrder = await prisma.order.update({
            where: { id },
            data: { pickingProgress: progress },
            include: {
                items: {
                    include: {
                        product: true,
                        pickingItems: true
                    }
                }
            }
        });

        res.json({
            success: true,
            message: 'Item escaneado correctamente',
            data: {
                order: finalOrder,
                progress,
                scannedQty: totalScanned,
                totalQty: totalRequested
            }
        });
    } catch (error) {
        console.error('Error scanning item:', error);
        res.status(500).json({
            success: false,
            error: 'Error al escanear el item'
        });
    }
};

/**
 * Operario Picking: Complete picking
 * POST /api/orders/:id/complete-picking
 */
exports.completePicking = async (req, res) => {
    try {
        const { id } = req.params;

        const order = await prisma.order.findUnique({
            where: { id },
            include: {
                items: {
                    include: {
                        pickingItems: true
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

        if (order.status !== 'IN_PICKING') {
            return res.status(400).json({
                success: false,
                error: 'El pedido no está en proceso de separación'
            });
        }

        // Verify all items have been picked
        const allItemsPicked = order.items.every(item => {
            const scannedTotal = item.pickingItems.reduce((sum, pi) => sum + pi.scannedQty, 0);
            return scannedTotal >= item.requestedQty;
        });

        if (!allItemsPicked) {
            return res.status(400).json({
                success: false,
                error: 'No todos los items han sido escaneados completamente'
            });
        }

        const updatedOrder = await prisma.order.update({
            where: { id },
            data: {
                status: 'READY',
                pickingProgress: 100
            },
            include: {
                items: {
                    include: {
                        product: true,
                        pickingItems: true
                    }
                },
                distributor: true
            }
        });

        res.json({
            success: true,
            message: 'Separación completada. Pedido listo para despacho',
            data: updatedOrder
        });
    } catch (error) {
        console.error('Error completing picking:', error);
        res.status(500).json({
            success: false,
            error: 'Error al completar la separación'
        });
    }
};

/**
 * Get picking progress for an order
 * GET /api/orders/:id/picking-progress
 */
exports.getPickingProgress = async (req, res) => {
    try {
        const { id } = req.params;

        const order = await prisma.order.findUnique({
            where: { id },
            include: {
                items: {
                    include: {
                        product: {
                            select: {
                                id: true,
                                name: true,
                                sku: true
                            }
                        },
                        pickingItems: true
                    }
                },
                picker: {
                    select: {
                        id: true,
                        name: true
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

        // Calculate detailed progress
        const itemsProgress = order.items.map(item => {
            const scannedQty = item.pickingItems.reduce((sum, pi) => sum + pi.scannedQty, 0);
            const progress = Math.min(100, Math.round((scannedQty / item.requestedQty) * 100));

            return {
                itemId: item.id,
                productName: item.product.name,
                requestedQty: item.requestedQty,
                scannedQty,
                progress,
                completed: scannedQty >= item.requestedQty,
                pickingItems: item.pickingItems
            };
        });

        const totalRequested = order.items.reduce((sum, item) => sum + item.requestedQty, 0);
        const totalScanned = order.items.reduce((sum, item) =>
            sum + item.pickingItems.reduce((s, pi) => s + pi.scannedQty, 0), 0
        );

        res.json({
            success: true,
            data: {
                orderId: order.id,
                orderNumber: order.orderNumber,
                status: order.status,
                pickingProgress: order.pickingProgress,
                pickingStartedAt: order.pickingStartedAt,
                picker: order.picker,
                totalRequested,
                totalScanned,
                itemsProgress,
                itemsCompleted: itemsProgress.filter(i => i.completed).length,
                itemsTotal: itemsProgress.length
            }
        });
    } catch (error) {
        console.error('Error getting picking progress:', error);
        res.status(500).json({
            success: false,
            error: 'Error al obtener el progreso'
        });
    }
};
