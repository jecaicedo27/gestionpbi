const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/inventory-count/sessions
// List all count sessions (most recent first)
// ─────────────────────────────────────────────────────────────────────────────
exports.getSessions = async (req, res) => {
    try {
        const sessions = await prisma.inventoryCountSession.findMany({
            orderBy: { createdAt: 'desc' },
            include: {
                createdBy: { select: { name: true } },
                _count: { select: { lines: true } }
            }
        });
        res.json(sessions);
    } catch (err) {
        console.error('[inventoryCount] getSessions error:', err);
        res.status(500).json({ error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/inventory-count/sessions
// Create a new session
// ─────────────────────────────────────────────────────────────────────────────
exports.createSession = async (req, res) => {
    try {
        const { month, warehouseName, type, observations } = req.body;
        const userId = req.user?.id;
        if (!month || !warehouseName) return res.status(400).json({ error: 'month y warehouseName son requeridos' });

        // Generate unique session code: IC-YYYYMM-BODEGA
        const slug = warehouseName.toUpperCase().replace(/\s+/g, '-').replace(/[^A-Z0-9-]/g, '').slice(0, 20);
        const ts = Date.now().toString().slice(-4);
        const sessionCode = `IC-${month.replace('-', '')}-${slug}-${ts}`;

        const session = await prisma.inventoryCountSession.create({
            data: {
                sessionCode,
                month,
                warehouseName,
                type: type || 'MATERIA_PRIMA',
                observations: observations || null,
                createdById: userId
            },
            include: { createdBy: { select: { name: true } } }
        });
        res.status(201).json(session);
    } catch (err) {
        console.error('[inventoryCount] createSession error:', err);
        res.status(500).json({ error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/inventory-count/sessions/:id
// Get session detail with lines + real-time system qty from MaterialLot
// ─────────────────────────────────────────────────────────────────────────────
exports.getSession = async (req, res) => {
    try {
        const { id } = req.params;
        const session = await prisma.inventoryCountSession.findUnique({
            where: { id },
            include: {
                createdBy: { select: { name: true } },
                lines: {
                    include: {
                        product: { select: { name: true, sku: true, currentStock: true, warehouses: true } },
                        materialLot: { select: { lotNumber: true, currentQuantity: true, initialQuantity: true, status: true } }
                    },
                    orderBy: [{ productName: 'asc' }, { createdAt: 'asc' }]
                }
            }
        });
        if (!session) return res.status(404).json({ error: 'Sesión no encontrada' });

        // Enrich each line with real-time systemQty (not persisted)
        const enrichedLines = session.lines.map(line => ({
            ...line,
            systemQty: line.materialLot?.currentQuantity ?? line.product?.currentStock ?? null,
            // Extract Siigo warehouse stock from warehouses JSON
            siigoWarehouseQty: extractSiigoStock(line.product?.warehouses)
        }));

        res.json({ ...session, lines: enrichedLines });
    } catch (err) {
        console.error('[inventoryCount] getSession error:', err);
        res.status(500).json({ error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/inventory-count/sessions/:id/close
// Close a session
// ─────────────────────────────────────────────────────────────────────────────
exports.closeSession = async (req, res) => {
    try {
        const { id } = req.params;
        const session = await prisma.inventoryCountSession.update({
            where: { id },
            data: { status: 'CLOSED', closedAt: new Date() }
        });
        res.json(session);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/inventory-count/sessions/:id
// Delete session (only IN_PROGRESS)
// ─────────────────────────────────────────────────────────────────────────────
exports.deleteSession = async (req, res) => {
    try {
        const { id } = req.params;
        const session = await prisma.inventoryCountSession.findUnique({ where: { id }, select: { status: true } });
        if (!session) return res.status(404).json({ error: 'No encontrada' });
        if (session.status === 'CLOSED') return res.status(400).json({ error: 'No se puede eliminar una sesión cerrada' });
        await prisma.inventoryCountSession.delete({ where: { id } });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/inventory-count/sessions/:id/lines
// Upsert a count line (one product + one lot)
// ─────────────────────────────────────────────────────────────────────────────
exports.upsertLine = async (req, res) => {
    try {
        const { id: sessionId } = req.params;
        const { lineId, productId, productName, siigoProductCode, lotId, lotNumber, physicalQty, unit, siigoQty, notes } = req.body;

        if (lineId) {
            // Update existing line
            const line = await prisma.inventoryCountLine.update({
                where: { id: lineId },
                data: {
                    physicalQty: Number(physicalQty),
                    siigoQty: siigoQty != null ? Number(siigoQty) : undefined,
                    notes: notes || null
                },
                include: { materialLot: { select: { currentQuantity: true } } }
            });
            return res.json({ ...line, systemQty: line.materialLot?.currentQuantity ?? null });
        }

        // Create new line
        const line = await prisma.inventoryCountLine.create({
            data: {
                sessionId,
                productId: productId || null,
                productName: productName || 'Sin nombre',
                siigoProductCode: siigoProductCode || null,
                lotId: lotId || null,
                lotNumber: lotNumber || 'Sin lote',
                physicalQty: Number(physicalQty) || 0,
                unit: unit || 'gramo',
                siigoQty: siigoQty != null ? Number(siigoQty) : null,
                notes: notes || null
            },
            include: { materialLot: { select: { currentQuantity: true } } }
        });
        res.status(201).json({ ...line, systemQty: line.materialLot?.currentQuantity ?? null });
    } catch (err) {
        console.error('[inventoryCount] upsertLine error:', err);
        res.status(500).json({ error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/inventory-count/lines/:lineId
// ─────────────────────────────────────────────────────────────────────────────
exports.deleteLine = async (req, res) => {
    try {
        const { lineId } = req.params;
        await prisma.inventoryCountLine.delete({ where: { id: lineId } });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/inventory-count/sessions/:id/report
// Discrepancy report for a session
// ─────────────────────────────────────────────────────────────────────────────
exports.getReport = async (req, res) => {
    try {
        const { id } = req.params;
        const session = await prisma.inventoryCountSession.findUnique({
            where: { id },
            include: {
                lines: {
                    include: {
                        product: { select: { name: true, sku: true, currentStock: true, warehouses: true } },
                        materialLot: { select: { lotNumber: true, currentQuantity: true } }
                    },
                    orderBy: { productName: 'asc' }
                }
            }
        });
        if (!session) return res.status(404).json({ error: 'No encontrada' });

        const report = session.lines.map(line => {
            const systemQty = line.materialLot?.currentQuantity ?? line.product?.currentStock ?? 0;
            const siigoWarehouseQty = extractSiigoStock(line.product?.warehouses);
            const diffERP = line.physicalQty - systemQty;
            const diffSiigo = siigoWarehouseQty != null ? line.physicalQty - siigoWarehouseQty : null;
            return {
                productName: line.productName,
                lotNumber: line.lotNumber,
                unit: line.unit,
                physicalQty: line.physicalQty,
                systemQty,
                siigoQty: line.siigoQty ?? siigoWarehouseQty,
                siigoWarehouseQty,
                diffERP,
                diffSiigo,
                notes: line.notes,
                hasMismatch: Math.abs(diffERP) > 1
            };
        });

        res.json({ session: { id: session.id, sessionCode: session.sessionCode, month: session.month, warehouseName: session.warehouseName, status: session.status }, report });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// ─── Helper ─────────────────────────────────────────────────────────────────
function extractSiigoStock(warehousesJson) {
    if (!warehousesJson) return null;
    try {
        const warehouses = typeof warehousesJson === 'string' ? JSON.parse(warehousesJson) : warehousesJson;
        if (!Array.isArray(warehouses)) return null;
        return warehouses.reduce((sum, w) => sum + (w.quantity || 0), 0);
    } catch { return null; }
}
