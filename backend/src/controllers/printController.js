// Print controller — módulo del rol DISEÑO.
// Permite registrar etiquetas impresas y disparar el RPA Siigo (ENSAMBLE
// que descuenta MP y suma la etiqueta al inventario contable).
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const browserManager = require('../services/siigoBrowserManager');

const LABEL_GROUP_NAMES = ['MATERIA PRIMA ETIQUETAS Y SELLOS'];
const LABEL_SKU_PREFIX = ['MPET'];

const isLabelProduct = (p) => {
    if (!p) return false;
    const sku = (p.sku || '').toUpperCase();
    if (LABEL_SKU_PREFIX.some(pre => sku.startsWith(pre))) return true;
    const groupName = (p.group?.name || '').toUpperCase();
    if (LABEL_GROUP_NAMES.some(g => groupName === g)) return true;
    return false;
};

// GET /api/print/labels — lista todas las etiquetas con stock + sugerencia
exports.listLabels = async (req, res) => {
    try {
        const products = await prisma.product.findMany({
            where: {
                active: true,
                OR: [
                    { sku: { startsWith: 'MPET' } },
                    { group: { name: { in: LABEL_GROUP_NAMES } } },
                ],
            },
            include: { group: { select: { name: true } } },
            orderBy: { name: 'asc' },
        });
        const data = products.map(p => ({
            id: p.id,
            sku: p.sku,
            name: p.name,
            currentStock: p.currentStock || 0,
            minimumStock: p.minimumStock || 0,
            unit: p.unit || 'unidad',
            group: p.group?.name,
            isNegative: (p.currentStock || 0) < 0,
            needsPrint: (p.currentStock || 0) < (p.minimumStock || 0),
        }));
        res.json({ success: true, count: data.length, data });
    } catch (e) {
        console.error('[print listLabels]', e);
        res.status(500).json({ error: e.message });
    }
};

// POST /api/print/register — operario registra impresión + dispara RPA
//   body: { productId, quantity, observations? }
exports.register = async (req, res) => {
    try {
        const { productId, quantity, observations } = req.body || {};
        const userId = req.user?.id;
        if (!productId || !quantity || quantity <= 0) {
            return res.status(400).json({ error: 'productId y quantity (>0) son obligatorios' });
        }
        const product = await prisma.product.findUnique({
            where: { id: productId },
            include: { group: true },
        });
        if (!product) return res.status(404).json({ error: 'Producto no encontrado' });
        if (!isLabelProduct(product)) {
            return res.status(400).json({ error: `${product.sku} no es una etiqueta. Solo se pueden imprimir productos del grupo etiquetas.` });
        }

        // Crear rpaExecution + encolar al browser RPA
        const execution = await prisma.rpaExecution.create({
            data: {
                executionType: 'SIIGO_ASSEMBLY',
                status: 'RUNNING',
                productName: product.name,
                quantity: Math.round(Number(quantity)),
                assemblyType: 'proceso',
                observations: `IMPRESIÓN ETIQUETAS: ${quantity} × ${product.name}. ${observations || ''}`.trim(),
                triggeredById: userId || null,
            },
        });

        // Encolar (no bloqueamos la respuesta — el RPA es async)
        browserManager.enqueue({
            params: {
                productName: product.sku || product.name,
                quantity: Math.round(Number(quantity)),
                assemblyType: 'proceso',
                observations: `IMPRESIÓN: ${quantity} × ${product.name}.`,
            },
            executionId: execution.id,
            resolve: async () => {
                await prisma.rpaExecution.update({
                    where: { id: execution.id },
                    data: { status: 'SUCCESS', completedAt: new Date() },
                }).catch(() => {});
            },
            reject: async (err) => {
                await prisma.rpaExecution.update({
                    where: { id: execution.id },
                    data: { status: 'FAILED', errorMessage: String(err?.message || err), completedAt: new Date() },
                }).catch(() => {});
            },
        });

        res.json({
            success: true,
            executionId: execution.id,
            message: `Encolada impresión de ${quantity} × ${product.name}. El RPA enviará el ensamble a Siigo en segundo plano.`,
        });
    } catch (e) {
        console.error('[print register]', e);
        res.status(500).json({ error: e.message });
    }
};

// GET /api/print/history?limit=20 — últimas impresiones del rol
exports.history = async (req, res) => {
    try {
        const limit = Math.min(100, parseInt(req.query.limit || '30', 10));
        const rows = await prisma.rpaExecution.findMany({
            where: {
                executionType: 'SIIGO_ASSEMBLY',
                observations: { contains: 'IMPRESIÓN' },
            },
            include: { triggeredBy: { select: { name: true, email: true } } },
            orderBy: { startedAt: 'desc' },
            take: limit,
        });
        res.json({
            success: true,
            data: rows.map(r => ({
                id: r.id,
                productName: r.productName,
                quantity: r.quantity,
                status: r.status,
                createdAt: r.startedAt,
                completedAt: r.completedAt,
                triggeredBy: r.triggeredBy?.name || r.triggeredBy?.email || '?',
                errorMessage: r.errorMessage,
                observations: r.observations,
            })),
        });
    } catch (e) {
        console.error('[print history]', e);
        res.status(500).json({ error: e.message });
    }
};
