const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const browserManager = require('../services/siigoBrowserManager');

/**
 * POST /api/rpa/siigo-assembly
 * Trigger Siigo assembly note creation via RPA - enqueues in sequential queue
 */
const createSiigoAssemblyNote = async (req, res) => {
    try {
        const { productName, productSku, quantity, assemblyType, observations, assemblyNoteId, allowMultiple } = req.body;

        if (!productName || !quantity) {
            return res.status(400).json({
                success: false,
                error: 'productName y quantity son requeridos'
            });
        }

        // ── Idempotency guard: reject if same assemblyNoteId already running or done ──
        if (assemblyNoteId && !allowMultiple) {
            const existing = await prisma.rpaExecution.findFirst({
                where: {
                    assemblyNoteId,
                    status: { in: ['RUNNING', 'SUCCESS'] }
                },
                orderBy: { startedAt: 'desc' }
            });
            if (existing) {
                return res.status(409).json({
                    success: false,
                    status: existing.status,
                    executionId: existing.id,
                    siigoNoteCode: existing.siigoNoteCode,
                    error: `Ya existe una ejecución ${existing.status === 'SUCCESS' ? 'exitosa' : 'en curso'} para esta nota de ensamble (${existing.siigoNoteCode || existing.id}).`
                });
            }
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
 * POST /api/rpa/siigo-adjustment
 * Trigger Siigo inventory adjustment creation via RPA
 */
const createSiigoAdjustment = async (req, res) => {
    try {
        const { productName, productSku, quantity, accountCode, triggerSourceId } = req.body;

        if (!productName || !quantity) {
            return res.status(400).json({
                success: false,
                error: 'productName y quantity son requeridos'
            });
        }

        // Create execution record in DB
        const execution = await prisma.rpaExecution.create({
            data: {
                executionType: 'SIIGO_ADJUSTMENT',
                status: 'RUNNING',
                productName,
                quantity: Number(quantity),
                observations: `Ajuste contable: ${accountCode}`,
                triggeredById: req.user?.id || null
            }
        });

        // Respond immediately
        res.json({
            success: true,
            status: 'ENCOLADO',
            executionId: execution.id,
            queueLength: browserManager.queue.length + 1,
            message: `Bot Ajuste RPA encolado para ${productName} (${quantity} uds).`
        });

        // Enqueue task
        const startTime = Date.now();
        const params = {
            productName: productSku || productName,
            quantity: Number(quantity),
            accountCode: accountCode || '71050504'
        };

        browserManager.enqueue({
            type: 'adjustment',
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
                console.log(`🤖 RPA Ajuste [${execution.id}] ${result.success ? '✅' : '❌'} ${result.siigoNoteCode || 'sin doc'} (${(durationMs / 1000).toFixed(1)}s)`);
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
                console.error(`🤖 RPA Ajuste [${execution.id}] ❌ ERROR: ${err.message}`);
            }
        });

    } catch (error) {
        console.error('Error in createSiigoAdjustment:', error);
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

        const isAdjustment = original.executionType === 'SIIGO_ADJUSTMENT';
        let accountCode = '71050504';
        if (isAdjustment && original.observations) {
            const match = original.observations.match(/Ajuste contable:?\\s*(\\d+)/i);
            if (match) accountCode = match[1];
        }

        const taskPayload = isAdjustment ? {
            type: 'adjustment',
            params: {
                productName: retrySku || original.productName,
                quantity: original.quantity,
                accountCode
            }
        } : {
            type: 'assembly',
            params: {
                productName: retrySku || original.productName,
                quantity: original.quantity,
                assemblyType: original.assemblyType || 'proceso',
                observations: original.observations || ''
            }
        };

        browserManager.enqueue({
            ...taskPayload,
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

/**
 * GET /api/rpa/orphan-notes
 * Find COMPLETED EMPAQUE notes that have no linked RPA execution.
 * These are the "invisible" failures — the system completed but never registered in Siigo.
 */
const getOrphanNotes = async (req, res) => {
    try {
        const { days = 30 } = req.query;
        const cutoff = new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000);

        const orphans = await prisma.assemblyNote.findMany({
            where: {
                status: 'COMPLETED',
                processType: { code: { in: ['EMPAQUE', 'G_EMPAQUE'] } },
                rpaExecutions: { none: {} },
                completedAt: { gte: cutoff }
            },
            include: {
                product: { select: { id: true, name: true, sku: true } },
                productionBatch: { select: { batchNumber: true } },
                processType: { select: { code: true } }
            },
            orderBy: { completedAt: 'desc' }
        });

        // Only return notes that have actual production data (not zero-qty stubs)
        const withData = orphans.filter(n => {
            const emp = n.processParameters?.empaque;
            const carriots = (n.processParameters?.carriots_consumed || []).length;
            const qty = emp?.conteo_qty || emp?.approved_qty || 0;
            return qty > 0 || carriots > 0;
        }).map(n => {
            const emp = n.processParameters?.empaque || {};
            const qty = emp.conteo_qty || emp.approved_qty || n.targetQuantity || 0;
            return {
                id: n.id,
                stageName: n.stageName,
                productName: n.product?.name,
                productSku: n.product?.sku,
                productId: n.product?.id,
                quantity: qty,
                approvedQty: emp.approved_qty || qty,
                defectiveQty: emp.defective_qty || 0,
                batchNumber: n.productionBatch?.batchNumber,
                completedAt: n.completedAt,
                processCode: n.processType?.code,
                carriots: (n.processParameters?.carriots_consumed || []).length
            };
        });

        res.json({ count: withData.length, days: Number(days), orphans: withData });
    } catch (error) {
        console.error('Error fetching orphan notes:', error);
        res.status(500).json({ error: error.message });
    }
};

/**
 * POST /api/rpa/dispatch-orphan
 * Fire an RPA for an orphan assembly note (completed but never registered in Siigo).
 */
const dispatchOrphan = async (req, res) => {
    try {
        const { assemblyNoteId } = req.body;
        if (!assemblyNoteId) return res.status(400).json({ error: 'assemblyNoteId requerido' });

        // Ensure no existing RUNNING/SUCCESS execution
        const existing = await prisma.rpaExecution.findFirst({
            where: { assemblyNoteId, status: { in: ['RUNNING', 'SUCCESS'] } }
        });
        if (existing) {
            return res.status(409).json({
                success: false,
                error: `Ya existe una ejecución ${existing.status} para esta nota (${existing.siigoNoteCode || existing.id}).`
            });
        }

        const note = await prisma.assemblyNote.findUnique({
            where: { id: assemblyNoteId },
            include: {
                product: { select: { name: true, sku: true } },
                productionBatch: { select: { batchNumber: true } }
            }
        });
        if (!note) return res.status(404).json({ error: 'Nota no encontrada' });

        const emp = note.processParameters?.empaque || {};
        const qty = emp.conteo_qty || emp.approved_qty || note.targetQuantity || 0;
        if (qty <= 0) return res.status(400).json({ error: 'La nota no tiene cantidad registrada' });

        const productName = note.product?.name || 'Producto';
        const productSku = note.product?.sku || null;
        const batchNumber = note.productionBatch?.batchNumber || '';
        const aprobados = emp.approved_qty || qty;
        const defectivos = emp.defective_qty || 0;

        const execution = await prisma.rpaExecution.create({
            data: {
                executionType: 'SIIGO_ASSEMBLY',
                status: 'RUNNING',
                productName,
                quantity: Number(qty),
                assemblyType: 'proceso',
                observations: `${note.stageName}. Lote: ${batchNumber}. Real fabricado: ${qty}. Aprobados: ${aprobados}. Defectuosos: ${defectivos}. [Reenvío desde panel]`,
                assemblyNoteId,
                triggeredById: req.user?.id || null
            }
        });

        res.json({
            success: true,
            status: 'ENCOLADO',
            executionId: execution.id,
            message: `RPA encolado para ${productName} (${qty} uds)`
        });

        const startTime = Date.now();
        browserManager.enqueue({
            type: 'assembly',
            params: {
                productName: productSku || productName,
                quantity: Number(qty),
                assemblyType: 'proceso',
                observations: `${note.stageName}. Lote: ${batchNumber}. Fabricado: ${qty}. Aprobados: ${aprobados}. Defectuosos: ${defectivos}.`
            },
            executionId: execution.id,
            resolve: async (result) => {
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
                        durationMs: Date.now() - startTime
                    }
                });
            },
            reject: async (err) => {
                await prisma.rpaExecution.update({
                    where: { id: execution.id },
                    data: {
                        status: 'FAILED',
                        errorMessage: err.message,
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

module.exports = { createSiigoAssemblyNote, createSiigoAdjustment, getHistory, retryExecution, getQueueStatus, getOrphanNotes, dispatchOrphan };

