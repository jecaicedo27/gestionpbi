const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const browserManager = require('../services/siigoBrowserManager');

/**
 * POST /api/rpa/siigo-assembly
 * Trigger Siigo assembly note creation via RPA - enqueues in sequential queue
 */
const createSiigoAssemblyNote = async (req, res) => {
    try {
        const { productName, productSku, quantity, assemblyType, observations, assemblyNoteId } = req.body;

        if (!productName || !quantity) {
            return res.status(400).json({
                success: false,
                error: 'productName y quantity son requeridos'
            });
        }

        // Resolve SKU if not provided
        let resolvedSku = productSku || null;
        if (!resolvedSku) {
            const prod = await prisma.product.findFirst({ where: { name: productName }, select: { sku: true } });
            resolvedSku = prod?.sku || null;
        }

        // Create execution record in DB
        const execution = await prisma.rpaExecution.create({
            data: {
                executionType: 'SIIGO_ASSEMBLY',
                status: 'RUNNING',
                productName,
                quantity: Number(quantity),
                assemblyType: assemblyType || 'proceso',
                observations: observations || null,
                assemblyNoteId: assemblyNoteId || null,
                triggeredById: req.user?.id || null
            }
        });

        // Respond immediately
        res.json({
            success: true,
            status: 'ENCOLADO',
            executionId: execution.id,
            queueLength: browserManager.queue.length + 1,
            message: `Bot RPA encolado para ${productName} (${quantity} uds). ${browserManager.queue.length > 0 ? `Posición en cola: ${browserManager.queue.length + 1}` : 'Procesando...'}`
        });

        // Enqueue task — use SKU for Siigo search if available, otherwise name
        const startTime = Date.now();
        const params = {
            productName: resolvedSku || productName,
            quantity: Number(quantity),
            assemblyType: assemblyType || 'proceso',
            observations: observations || ''
        };

        browserManager.enqueue({
            params,
            executionId: execution.id,
            resolve: async (result) => {
                const durationMs = Date.now() - startTime;
                await prisma.rpaExecution.update({
                    where: { id: execution.id },
                    data: {
                        status: result.success ? 'SUCCESS' : 'FAILED',
                        siigoNoteCode: result.siigoNoteCode || null,
                        siigoUrl: result.url || null,
                        screenshotPath: result.screenshotPath || null,
                        errorMessage: result.error || null,
                        logs: result.logs || [],
                        completedAt: new Date(),
                        durationMs
                    }
                });
                console.log(`🤖 RPA [${execution.id}] ${result.success ? '✅' : '❌'} ${result.siigoNoteCode || 'sin NE'} (${(durationMs / 1000).toFixed(1)}s)`);
            },
            reject: async (err) => {
                const durationMs = Date.now() - startTime;
                await prisma.rpaExecution.update({
                    where: { id: execution.id },
                    data: {
                        status: 'FAILED',
                        errorMessage: err.message,
                        screenshotPath: err.screenshotPath || null,
                        logs: err.logs || [],
                        completedAt: new Date(),
                        durationMs
                    }
                });
                console.error(`🤖 RPA [${execution.id}] ❌ ERROR: ${err.message}`);
            }
        });

    } catch (error) {
        console.error('Error in createSiigoAssemblyNote:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * GET /api/rpa/history
 * Get history of all RPA executions
 */
const getHistory = async (req, res) => {
    try {
        const { limit = 50, status, type } = req.query;

        const where = {};
        if (status) where.status = status;
        if (type) where.executionType = type;

        const executions = await prisma.rpaExecution.findMany({
            where,
            include: {
                assemblyNote: {
                    select: { id: true, noteNumber: true, stageName: true, product: { select: { sku: true, name: true } } }
                },
                triggeredBy: {
                    select: { id: true, name: true }
                }
            },
            orderBy: { startedAt: 'desc' },
            take: parseInt(limit)
        });

        res.json(executions);
    } catch (error) {
        console.error('Error fetching RPA history:', error);
        res.status(500).json({ error: 'Error fetching history' });
    }
};

/**
 * POST /api/rpa/:id/retry
 * Retry a failed RPA execution - reuses the same record
 */
const retryExecution = async (req, res) => {
    try {
        const { id } = req.params;

        const original = await prisma.rpaExecution.findUnique({ where: { id } });
        if (!original) return res.status(404).json({ error: 'Ejecución no encontrada' });

        // Reset the SAME record to RUNNING
        await prisma.rpaExecution.update({
            where: { id },
            data: {
                status: 'RUNNING',
                siigoNoteCode: null,
                errorMessage: null,
                logs: [],
                screenshotPath: null,
                siigoUrl: null,
                completedAt: null,
                durationMs: null,
                startedAt: new Date()
            }
        });

        res.json({
            success: true,
            status: 'ENCOLADO',
            executionId: id,
            queueLength: browserManager.queue.length + 1,
            message: `Reintento encolado para ${original.productName}`
        });

        // Enqueue — resolve SKU from product name for Siigo search
        const startTime = Date.now();
        const prod = await prisma.product.findFirst({ where: { name: original.productName }, select: { sku: true } });
        const retrySku = prod?.sku || null;
        browserManager.enqueue({
            params: {
                productName: retrySku || original.productName,
                quantity: original.quantity,
                assemblyType: original.assemblyType || 'proceso',
                observations: original.observations || ''
            },
            executionId: id,
            resolve: async (result) => {
                const durationMs = Date.now() - startTime;
                await prisma.rpaExecution.update({
                    where: { id },
                    data: {
                        status: result.success ? 'SUCCESS' : 'FAILED',
                        siigoNoteCode: result.siigoNoteCode || null,
                        siigoUrl: result.url || null,
                        screenshotPath: result.screenshotPath || null,
                        errorMessage: result.error || null,
                        logs: result.logs || [],
                        completedAt: new Date(),
                        durationMs
                    }
                });
            },
            reject: async (err) => {
                await prisma.rpaExecution.update({
                    where: { id },
                    data: {
                        status: 'FAILED',
                        errorMessage: err.message,
                        screenshotPath: err.screenshotPath || null,
                        logs: err.logs || [],
                        completedAt: new Date(),
                        durationMs: Date.now() - startTime
                    }
                });
            }
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

/**
 * GET /api/rpa/queue-status
 * Get the current queue and browser status
 */
const getQueueStatus = async (req, res) => {
    res.json(browserManager.getStatus());
};

module.exports = { createSiigoAssemblyNote, getHistory, retryExecution, getQueueStatus };
