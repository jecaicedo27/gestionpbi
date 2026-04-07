const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const EVIDENCE_URL_PATTERN = /^(\/uploads\/|https?:\/\/)/i;

const toBogotaDate = (value) => {
    if (!value) return null;
    return new Date(new Date(value).toLocaleString('en-US', { timeZone: 'America/Bogota' }));
};

const buildLotKeyFromDate = (value) => {
    const date = toBogotaDate(value);
    if (!date || Number.isNaN(date.getTime())) return null;

    const yy = String(date.getFullYear()).slice(-2);
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const mi = String(date.getMinutes()).padStart(2, '0');

    return `${yy}${mm}${dd}-${hh}${mi}`;
};

const extractDisplayLot = (batch) => {
    const batchNumber = String(batch?.batchNumber || '');
    const directMatch = batchNumber.match(/(\d{6}-\d{4})/);
    if (directMatch) return directMatch[1];

    const digits = batchNumber.replace(/\D/g, '');
    if (digits.length >= 10) {
        return `${digits.slice(0, 6)}-${digits.slice(6, 10)}`;
    }

    return buildLotKeyFromDate(
        batch?.startedAt
        || batch?.scheduledStart
        || batch?.createdAt
    );
};

const toCompactLot = (value) => String(value || '').replace(/\D/g, '').slice(0, 10) || null;

const unique = (values = []) => [...new Set(values.filter(Boolean))];

const sortByDateAsc = (values = [], key = 'at') => [...values].sort((left, right) => {
    const leftTime = left?.[key] ? new Date(left[key]).getTime() : 0;
    const rightTime = right?.[key] ? new Date(right[key]).getTime() : 0;
    return leftTime - rightTime;
});

const sortByDateDesc = (values = [], key = 'at') => [...values].sort((left, right) => {
    const leftTime = left?.[key] ? new Date(left[key]).getTime() : 0;
    const rightTime = right?.[key] ? new Date(right[key]).getTime() : 0;
    return rightTime - leftTime;
});

const getBatchWindow = (batch, notes = []) => {
    const starts = [
        batch?.startedAt,
        batch?.scheduledStart,
        batch?.createdAt,
        ...notes.map(note => note?.startedAt).filter(Boolean),
        ...notes.map(note => note?.createdAt).filter(Boolean)
    ]
        .filter(Boolean)
        .map(value => new Date(value).getTime());

    const ends = [
        batch?.completedAt,
        batch?.scheduledEnd,
        batch?.updatedAt,
        ...notes.map(note => note?.completedAt).filter(Boolean),
        ...notes.map(note => note?.updatedAt).filter(Boolean)
    ]
        .filter(Boolean)
        .map(value => new Date(value).getTime());

    const start = starts.length > 0 ? new Date(Math.min(...starts)) : new Date();
    const end = ends.length > 0 ? new Date(Math.max(...ends)) : new Date();

    return {
        start,
        end,
        startBuffer: new Date(start.getTime() - (24 * 60 * 60 * 1000)),
        endBuffer: new Date(end.getTime() + (24 * 60 * 60 * 1000)),
        outputStartBuffer: new Date(start.getTime() - (2 * 60 * 60 * 1000)),
        outputEndBuffer: new Date(end.getTime() + (8 * 60 * 60 * 1000))
    };
};

const toShortProcessSummary = (note) => ({
    id: note.id,
    noteNumber: note.noteNumber,
    stageOrder: note.stageOrder,
    stageName: note.stageName,
    status: note.status,
    processType: note.processType?.code || null,
    startedAt: note.startedAt,
    completedAt: note.completedAt
});

const pushEvidence = (bucket, seen, evidence) => {
    if (!evidence?.url || !EVIDENCE_URL_PATTERN.test(evidence.url)) return;

    const key = `${evidence.url}|${evidence.sourceType || ''}|${evidence.sourceId || ''}`;
    if (seen.has(key)) return;

    seen.add(key);
    bucket.push(evidence);
};

const collectNestedEvidence = ({ value, labelPrefix = '', sourceType, sourceId, sourceLabel, at, bucket, seen }) => {
    if (value == null) return;

    if (typeof value === 'string') {
        if (EVIDENCE_URL_PATTERN.test(value)) {
            pushEvidence(bucket, seen, {
                url: value,
                label: labelPrefix || 'Archivo',
                sourceType,
                sourceId,
                sourceLabel,
                at
            });
        }
        return;
    }

    if (Array.isArray(value)) {
        value.forEach((entry, index) => {
            collectNestedEvidence({
                value: entry,
                labelPrefix: labelPrefix ? `${labelPrefix} ${index + 1}` : `Archivo ${index + 1}`,
                sourceType,
                sourceId,
                sourceLabel,
                at,
                bucket,
                seen
            });
        });
        return;
    }

    if (typeof value === 'object') {
        Object.entries(value).forEach(([key, entry]) => {
            const cleanKey = String(key || '').replace(/[_-]+/g, ' ').trim();
            collectNestedEvidence({
                value: entry,
                labelPrefix: labelPrefix ? `${labelPrefix} · ${cleanKey}` : cleanKey,
                sourceType,
                sourceId,
                sourceLabel,
                at,
                bucket,
                seen
            });
        });
    }
};

const buildNoteEvidence = (note) => {
    const bucket = [];
    const seen = new Set();

    collectNestedEvidence({
        value: note.processParameters,
        labelPrefix: 'Proceso',
        sourceType: 'PRODUCTION_NOTE',
        sourceId: note.id,
        sourceLabel: note.stageName,
        at: note.completedAt || note.updatedAt,
        bucket,
        seen
    });

    collectNestedEvidence({
        value: note.actualParameters,
        labelPrefix: 'Parámetro real',
        sourceType: 'PRODUCTION_NOTE',
        sourceId: note.id,
        sourceLabel: note.stageName,
        at: note.completedAt || note.updatedAt,
        bucket,
        seen
    });

    (note.qualityChecks || []).forEach((check) => {
        (check.photoUrls || []).forEach((url, index) => {
            pushEvidence(bucket, seen, {
                url,
                label: `${check.checkName || 'QC'} · Foto ${index + 1}`,
                sourceType: 'QUALITY_CHECK',
                sourceId: check.id,
                sourceLabel: note.stageName,
                at: check.checkedAt
            });
        });
    });

    return sortByDateAsc(bucket);
};

const buildOperatorTimeline = ({
    batch,
    notes,
    lotConsumptions,
    zoneTransfers,
    purchaseOrders,
    microSamples,
    pqrCases
}) => {
    const timeline = [];

    const push = ({ at, user, action, sourceType, sourceId, sourceLabel, detail }) => {
        if (!user?.id && !user?.name) return;

        timeline.push({
            at,
            user: user ? {
                id: user.id || null,
                name: user.name || 'Sin usuario',
                role: user.role || null
            } : null,
            action,
            sourceType,
            sourceId,
            sourceLabel,
            detail: detail || null
        });
    };

    notes.forEach((note) => {
        if (note.startedAt && note.executedBy) {
            push({
                at: note.startedAt,
                user: note.executedBy,
                action: 'Inicio de etapa',
                sourceType: 'PRODUCTION_NOTE',
                sourceId: note.id,
                sourceLabel: note.stageName,
                detail: note.processType?.name || note.processType?.code || null
            });
        }

        if (note.completedAt && note.completedBy) {
            push({
                at: note.completedAt,
                user: note.completedBy,
                action: 'Cierre de etapa',
                sourceType: 'PRODUCTION_NOTE',
                sourceId: note.id,
                sourceLabel: note.stageName,
                detail: note.status
            });
        }

        (note.processVariables || []).forEach((variable) => {
            push({
                at: variable.capturedAt,
                user: variable.capturedBy,
                action: `Registro variable ${variable.variableName}`,
                sourceType: 'PROCESS_VARIABLE',
                sourceId: variable.id,
                sourceLabel: note.stageName,
                detail: `${variable.variableValue}${variable.variableUnit ? ` ${variable.variableUnit}` : ''}`.trim()
            });
        });

        (note.qualityChecks || []).forEach((check) => {
            push({
                at: check.checkedAt,
                user: check.checkedBy,
                action: `Chequeo ${check.checkName}`,
                sourceType: 'QUALITY_CHECK',
                sourceId: check.id,
                sourceLabel: note.stageName,
                detail: check.resultValue || (check.passed ? 'PASA' : 'NO PASA')
            });
        });
    });

    lotConsumptions.forEach((consumption) => {
        push({
            at: consumption.usedAt,
            user: consumption.usedBy,
            action: 'Consumo de lote',
            sourceType: 'LOT_CONSUMPTION',
            sourceId: consumption.id,
            sourceLabel: consumption.materialLot?.lotNumber || consumption.materialLot?.siigoProductName || 'Lote',
            detail: `${consumption.quantityUsed} g`
        });
    });

    zoneTransfers.forEach((transfer) => {
        push({
            at: transfer.createdAt,
            user: transfer.transferredBy,
            action: transfer.direction === 'IN' ? 'Ingreso a zona' : 'Retorno a bodega',
            sourceType: 'ZONE_TRANSFER',
            sourceId: transfer.id,
            sourceLabel: transfer.materialLot?.lotNumber || transfer.product?.name || 'Traslado',
            detail: `${transfer.quantity} ${transfer.unit || ''}`.trim()
        });
    });

    purchaseOrders.forEach((order) => {
        push({
            at: order.createdAt,
            user: order.createdBy,
            action: 'Creación OC',
            sourceType: 'PURCHASE_ORDER',
            sourceId: order.id,
            sourceLabel: order.orderNumber,
            detail: order.supplierName
        });

        if (order.approvedAt && order.approvedBy) {
            push({
                at: order.approvedAt,
                user: order.approvedBy,
                action: 'Aprobación OC',
                sourceType: 'PURCHASE_ORDER',
                sourceId: order.id,
                sourceLabel: order.orderNumber,
                detail: order.status
            });
        }

        if (order.paidAt && order.paidBy) {
            push({
                at: order.paidAt,
                user: order.paidBy,
                action: 'Registro de pago',
                sourceType: 'PURCHASE_ORDER',
                sourceId: order.id,
                sourceLabel: order.orderNumber,
                detail: order.paymentMethod
            });
        }

        (order.receptions || []).forEach((reception) => {
            push({
                at: reception.receivedAt,
                user: reception.receivedBy,
                action: 'Recepción logística',
                sourceType: 'RECEPTION',
                sourceId: reception.id,
                sourceLabel: order.orderNumber,
                detail: reception.status
            });

            if (reception.accountingAt && reception.accountingUser) {
                push({
                    at: reception.accountingAt,
                    user: reception.accountingUser,
                    action: 'Validación contable recepción',
                    sourceType: 'RECEPTION',
                    sourceId: reception.id,
                    sourceLabel: order.orderNumber,
                    detail: reception.siigoRef || reception.providerInvoiceNumber || reception.status
                });
            }
        });
    });

    microSamples.forEach((sample) => {
        push({
            at: sample.takenAt,
            user: sample.takenBy,
            action: 'Toma de muestra micro',
            sourceType: 'MICRO_SAMPLE',
            sourceId: sample.id,
            sourceLabel: sample.sampleNumber,
            detail: sample.lotNumber || sample.batchCode || sample.workContext || null
        });

        (sample.internalLogs || []).forEach((log) => {
            push({
                at: log.logDate,
                user: log.recordedBy,
                action: 'Seguimiento interno de muestra',
                sourceType: 'MICRO_INTERNAL_LOG',
                sourceId: log.id,
                sourceLabel: sample.sampleNumber,
                detail: log.observations || null
            });
        });
    });

    pqrCases.forEach((pqr) => {
        push({
            at: pqr.createdAt,
            user: pqr.user,
            action: pqr.isInternal ? 'Creación PQR interno' : 'Creación PQR',
            sourceType: 'PQR',
            sourceId: pqr.id,
            sourceLabel: pqr.ticketNumber,
            detail: pqr.stage
        });

        if (pqr.resolvedAt && pqr.managedBy) {
            push({
                at: pqr.resolvedAt,
                user: pqr.managedBy,
                action: 'Cierre PQR',
                sourceType: 'PQR',
                sourceId: pqr.id,
                sourceLabel: pqr.ticketNumber,
                detail: pqr.status
            });
        }
    });

    if (batch.startedAt && batch.createdAt && batch.startedAt !== batch.createdAt) {
        timeline.push({
            at: batch.createdAt,
            user: null,
            action: 'Batch programado',
            sourceType: 'BATCH',
            sourceId: batch.id,
            sourceLabel: batch.batchNumber,
            detail: batch.notes || null
        });
    }

    return sortByDateAsc(timeline);
};

const TRACEABILITY_SEGMENT_LABELS = {
    FINISHED_PRODUCT: 'Producto terminado',
    SUBPROCESS: 'Subproceso',
    UNCLASSIFIED: 'Sin clasificar'
};

const resolveBatchSegment = (batch = {}) => {
    const hasOutputTargets = Array.isArray(batch.outputTargets) && batch.outputTargets.length > 0;
    const hasPrimaryProduct = Boolean(batch.product || batch.productId);

    if (hasOutputTargets) {
        return {
            key: 'FINISHED_PRODUCT',
            label: TRACEABILITY_SEGMENT_LABELS.FINISHED_PRODUCT
        };
    }

    if (hasPrimaryProduct) {
        return {
            key: 'SUBPROCESS',
            label: TRACEABILITY_SEGMENT_LABELS.SUBPROCESS
        };
    }

    return {
        key: 'UNCLASSIFIED',
        label: TRACEABILITY_SEGMENT_LABELS.UNCLASSIFIED
    };
};

const buildListWhere = ({ search, status, dateFrom, dateTo, segment, productId, processType }) => {
    const where = {
        OR: [
            { assemblyNotes: { some: {} } },
            { outputTargets: { some: {} } }
        ]
    };
    const andFilters = [];

    if (status && status !== 'ALL') {
        where.status = status;
    }

    if (search) {
        andFilters.push({
            OR: [
                { batchNumber: { contains: search, mode: 'insensitive' } },
                { flavor: { contains: search, mode: 'insensitive' } },
                { product: { name: { contains: search, mode: 'insensitive' } } },
                { outputTargets: { some: { product: { name: { contains: search, mode: 'insensitive' } } } } }
            ]
        });
    }

    if (segment === 'FINISHED_PRODUCT') {
        andFilters.push({ outputTargets: { some: {} } });
    }

    if (segment === 'SUBPROCESS') {
        andFilters.push({
            AND: [
                { outputTargets: { none: {} } },
                { product: { isNot: null } }
            ]
        });
    }

    if (productId) {
        andFilters.push({
            OR: [
                { product: { is: { id: productId } } },
                { outputTargets: { some: { productId } } }
            ]
        });
    }

    if (processType) {
        andFilters.push({
            assemblyNotes: {
                some: {
                    processType: {
                        code: processType
                    }
                }
            }
        });
    }

    if (dateFrom || dateTo) {
        where.createdAt = {};
        if (dateFrom) where.createdAt.gte = new Date(dateFrom);
        if (dateTo) where.createdAt.lte = new Date(`${dateTo}T23:59:59.999Z`);
    }

    if (andFilters.length > 0) {
        where.AND = andFilters;
    }

    return where;
};

exports.listBatches = async (req, res) => {
    try {
        const {
            page = 1,
            limit = 30,
            search = '',
            status = '',
            segment = '',
            productId = '',
            processType = '',
            dateFrom = '',
            dateTo = ''
        } = req.query;

        const take = Math.min(parseInt(limit, 10) || 30, 100);
        const currentPage = Math.max(parseInt(page, 10) || 1, 1);
        const skip = (currentPage - 1) * take;
        const where = buildListWhere({ search, status, dateFrom, dateTo, segment, productId, processType });

        const [total, batches, facetSource] = await Promise.all([
            prisma.productionBatch.count({ where }),
            prisma.productionBatch.findMany({
                where,
                skip,
                take,
                orderBy: { createdAt: 'desc' },
                include: {
                    product: {
                        select: { id: true, name: true, sku: true }
                    },
                    outputTargets: {
                        include: {
                            product: {
                                select: { id: true, name: true, sku: true }
                            }
                        },
                        orderBy: [{ plannedWeightKg: 'desc' }, { plannedUnits: 'desc' }]
                    },
                    assemblyNotes: {
                        orderBy: { stageOrder: 'asc' },
                        include: {
                            processType: {
                                select: { code: true, name: true }
                            },
                            qualityChecks: {
                                select: { id: true, photoUrls: true }
                            }
                        }
                    }
                }
            }),
            prisma.productionBatch.findMany({
                where,
                select: {
                    product: {
                        select: { id: true, name: true, sku: true }
                    },
                    outputTargets: {
                        select: {
                            productId: true,
                            product: {
                                select: { id: true, name: true, sku: true }
                            }
                        }
                    },
                    assemblyNotes: {
                        select: {
                            processType: {
                                select: { code: true, name: true }
                            }
                        }
                    }
                }
            })
        ]);

        const data = batches.map((batch) => {
            const notes = batch.assemblyNotes || [];
            const displayLot = extractDisplayLot(batch);
            const compactLot = toCompactLot(displayLot);
            const segmentInfo = resolveBatchSegment(batch);
            const evidenceCount = notes.reduce((count, note) => (
                count + buildNoteEvidence(note).length
            ), 0);
            const completedNotes = notes.filter(note => note.status === 'COMPLETED');
            const operators = unique([
                ...notes.map(note => note.executedById),
                ...notes.map(note => note.completedById)
            ]);
            const processTypes = unique(notes.map(note => note.processType?.name || note.processType?.code));
            const trackedProducts = unique([
                batch.product?.name,
                ...(batch.outputTargets || []).map(target => target.product?.name)
            ]);

            return {
                id: batch.id,
                batchNumber: batch.batchNumber,
                displayLot,
                compactLot,
                segment: segmentInfo,
                flavor: batch.flavor,
                status: batch.status,
                scheduledStart: batch.scheduledStart,
                scheduledEnd: batch.scheduledEnd,
                startedAt: batch.startedAt,
                completedAt: batch.completedAt,
                createdAt: batch.createdAt,
                notes: batch.notes,
                product: batch.product ? {
                    id: batch.product.id,
                    name: batch.product.name,
                    sku: batch.product.sku
                } : null,
                outputTargets: (batch.outputTargets || []).map(target => ({
                    productId: target.productId,
                    productName: target.product?.name || 'Producto',
                    sku: target.product?.sku || null,
                    plannedUnits: target.plannedUnits,
                    plannedWeightKg: target.plannedWeightKg
                })),
                trackedProducts,
                stats: {
                    stagesTotal: notes.length,
                    stagesCompleted: completedNotes.length,
                    operatorCount: operators.length,
                    evidenceCount,
                    processTypes
                },
                processOverview: notes.map(toShortProcessSummary)
            };
        });

        const productsMap = new Map();
        const processTypeMap = new Map();
        const segmentCounter = {
            FINISHED_PRODUCT: 0,
            SUBPROCESS: 0,
            UNCLASSIFIED: 0
        };

        facetSource.forEach((batch) => {
            const segmentInfo = resolveBatchSegment(batch);
            segmentCounter[segmentInfo.key] = (segmentCounter[segmentInfo.key] || 0) + 1;

            if (batch.product?.id) {
                productsMap.set(batch.product.id, {
                    id: batch.product.id,
                    name: batch.product.name,
                    sku: batch.product.sku || null,
                    segment: 'SUBPROCESS'
                });
            }

            (batch.outputTargets || []).forEach((target) => {
                if (!target.product?.id) return;

                productsMap.set(target.product.id, {
                    id: target.product.id,
                    name: target.product.name,
                    sku: target.product.sku || null,
                    segment: 'FINISHED_PRODUCT'
                });
            });

            (batch.assemblyNotes || []).forEach((note) => {
                if (!note.processType?.code) return;

                processTypeMap.set(note.processType.code, {
                    value: note.processType.code,
                    label: note.processType.name || note.processType.code
                });
            });
        });

        res.json({
            data,
            filters: {
                segments: Object.entries(segmentCounter).map(([key, count]) => ({
                    key,
                    label: TRACEABILITY_SEGMENT_LABELS[key] || key,
                    count
                })),
                products: [...productsMap.values()].sort((left, right) => left.name.localeCompare(right.name, 'es')),
                processTypes: [...processTypeMap.values()].sort((left, right) => left.label.localeCompare(right.label, 'es'))
            },
            pagination: {
                page: currentPage,
                limit: take,
                total,
                totalPages: Math.max(Math.ceil(total / take), 1)
            }
        });
    } catch (error) {
        console.error('[productiveTraceability] listBatches error:', error);
        res.status(500).json({ error: 'No se pudo cargar la lista de trazabilidad productiva.' });
    }
};

exports.getBatchDetail = async (req, res) => {
    try {
        const { id } = req.params;

        const batch = await prisma.productionBatch.findUnique({
            where: { id },
            include: {
                product: {
                    select: { id: true, name: true, sku: true, unit: true }
                },
                outputTargets: {
                    include: {
                        product: {
                            select: { id: true, name: true, sku: true, unit: true }
                        }
                    },
                    orderBy: [{ plannedWeightKg: 'desc' }, { plannedUnits: 'desc' }]
                },
                assemblyNotes: {
                    orderBy: { stageOrder: 'asc' },
                    include: {
                        product: { select: { id: true, name: true, sku: true, unit: true } },
                        template: { select: { id: true, templateCode: true, templateName: true, version: true } },
                        stage: { select: { id: true, stageOrder: true, stageName: true } },
                        processType: { select: { id: true, code: true, name: true, category: true } },
                        createdBy: { select: { id: true, name: true, role: true } },
                        executedBy: { select: { id: true, name: true, role: true } },
                        completedBy: { select: { id: true, name: true, role: true } },
                        items: {
                            orderBy: { createdAt: 'asc' },
                            include: {
                                component: { select: { id: true, name: true, sku: true, unit: true } },
                                consumedBy: { select: { id: true, name: true, role: true } }
                            }
                        },
                        processVariables: {
                            orderBy: { capturedAt: 'asc' },
                            include: {
                                capturedBy: { select: { id: true, name: true, role: true } }
                            }
                        },
                        qualityChecks: {
                            orderBy: { checkedAt: 'asc' },
                            include: {
                                checkedBy: { select: { id: true, name: true, role: true } }
                            }
                        },
                        rpaExecutions: {
                            orderBy: { startedAt: 'asc' },
                            include: {
                                triggeredBy: { select: { id: true, name: true, role: true } }
                            }
                        }
                    }
                }
            }
        });

        if (!batch) {
            return res.status(404).json({ error: 'Batch no encontrado.' });
        }

        const notes = batch.assemblyNotes || [];
        const noteIds = notes.map(note => note.id);
        const noteNumbers = unique(notes.map(note => note.noteNumber));
        const displayLot = extractDisplayLot(batch);
        const compactLot = toCompactLot(displayLot);
        const segmentInfo = resolveBatchSegment(batch);
        const relatedProductIds = unique([
            batch.productId,
            ...batch.outputTargets.map(target => target.productId),
            ...notes.map(note => note.productId),
            ...notes.flatMap(note => note.items.map(item => item.componentId))
        ]);
        const window = getBatchWindow(batch, notes);

        const lotConsumptionsPromise = noteIds.length > 0
            ? prisma.lotConsumption.findMany({
                where: { assemblyNoteId: { in: noteIds } },
                include: {
                    materialLot: {
                        include: {
                            product: { select: { id: true, name: true, sku: true, unit: true } },
                            purchaseOrderItem: {
                                include: {
                                    product: { select: { id: true, name: true, sku: true, unit: true } },
                                    purchaseOrder: {
                                        select: {
                                            id: true,
                                            orderNumber: true,
                                            supplierName: true,
                                            status: true
                                        }
                                    }
                                }
                            }
                        }
                    },
                    usedBy: { select: { id: true, name: true, role: true } }
                },
                orderBy: { usedAt: 'asc' }
            })
            : Promise.resolve([]);

        const registryFilter = [];
        if (compactLot) registryFilter.push({ lotCode: { startsWith: compactLot } });
        if (displayLot) registryFilter.push({ premixLot: { equals: displayLot, mode: 'insensitive' } });
        if (noteNumbers.length > 0) {
            registryFilter.push({ mixAssemblyNote: { in: noteNumbers } });
            registryFilter.push({ protectionAssemblyNote: { in: noteNumbers } });
        }

        const productionLotsPromise = registryFilter.length > 0
            ? prisma.productionLot.findMany({
                where: { OR: registryFilter },
                orderBy: { productionDate: 'desc' }
            })
            : Promise.resolve([]);

        const syrupRegistryFilter = [];
        if (compactLot) syrupRegistryFilter.push({ lotCode: { startsWith: compactLot } });
        if (displayLot) syrupRegistryFilter.push({ lotCode: { contains: displayLot, mode: 'insensitive' } });
        if (noteNumbers.length > 0) syrupRegistryFilter.push({ assemblyNote: { in: noteNumbers } });

        const syrupLotsPromise = syrupRegistryFilter.length > 0
            ? prisma.syrupLot.findMany({
                where: { OR: syrupRegistryFilter },
                orderBy: { productionDate: 'desc' }
            })
            : Promise.resolve([]);

        const microFilters = [];
        if (batch.batchNumber) microFilters.push({ batchCode: { contains: batch.batchNumber, mode: 'insensitive' } });
        if (displayLot) microFilters.push({ lotNumber: { contains: displayLot, mode: 'insensitive' } });
        if (compactLot) microFilters.push({ lotNumber: { contains: compactLot, mode: 'insensitive' } });

        const microSamplesPromise = microFilters.length > 0
            ? prisma.microSample.findMany({
                where: { OR: microFilters },
                select: {
                    id: true,
                    sampleNumber: true,
                    samplingPointId: true,
                    takenAt: true,
                    takenById: true,
                    lotNumber: true,
                    batchCode: true,
                    sampleDescription: true,
                    workflowType: true,
                    workContext: true,
                    shift: true,
                    zoneName: true,
                    laboratoryProfile: true,
                    lab: true,
                    reportNumber: true,
                    reportUrl: true,
                    status: true,
                    notes: true,
                    startedAt: true,
                    completedAt: true,
                    closedAt: true,
                    finalConclusion: true,
                    finalReportData: true,
                    createdAt: true,
                    updatedAt: true,
                    samplingPoint: { select: { id: true, code: true, name: true, zoneName: true, processArea: true } },
                    takenBy: { select: { id: true, name: true, role: true } },
                    attachments: {
                        orderBy: { createdAt: 'desc' },
                        select: {
                            id: true,
                            category: true,
                            originalName: true,
                            storedName: true,
                            mimeType: true,
                            sizeBytes: true,
                            url: true,
                            createdAt: true
                        }
                    },
                    internalLogs: {
                        orderBy: { logDate: 'asc' },
                        select: {
                            id: true,
                            logDate: true,
                            dayNumber: true,
                            observations: true,
                            readings: true,
                            recordedBy: { select: { id: true, name: true, role: true } }
                        }
                    },
                    results: {
                        select: {
                            id: true,
                            value: true,
                            valueText: true,
                            isDetected: true,
                            isCompliant: true,
                            notes: true,
                            createdAt: true,
                            parameter: { select: { id: true, code: true, name: true, specMax: true, specText: true } }
                        }
                    }
                },
                orderBy: { takenAt: 'desc' }
            })
            : Promise.resolve([]);

        const pqrItemLotFilters = [];
        if (displayLot) pqrItemLotFilters.push({ lotNumber: { contains: displayLot, mode: 'insensitive' } });
        if (compactLot) pqrItemLotFilters.push({ lotNumber: { contains: compactLot, mode: 'insensitive' } });

        const pqrCasesPromise = pqrItemLotFilters.length > 0
            ? prisma.pQR.findMany({
                where: {
                    items: {
                        some: {
                            OR: pqrItemLotFilters
                        }
                    }
                },
                include: {
                    user: { select: { id: true, name: true, role: true } },
                    managedBy: { select: { id: true, name: true, role: true } },
                    items: {
                        include: {
                            product: { select: { id: true, name: true, sku: true } },
                            evidence: true
                        }
                    }
                },
                orderBy: { createdAt: 'desc' }
            })
            : Promise.resolve([]);

        const [lotConsumptions, productionLots, syrupLots, microSamples, pqrCases] = await Promise.all([
            lotConsumptionsPromise,
            productionLotsPromise,
            syrupLotsPromise,
            microSamplesPromise,
            pqrCasesPromise
        ]);

        const consumedLotIds = unique(lotConsumptions.map(entry => entry.materialLotId));
        const purchaseOrderIds = unique(lotConsumptions.map(entry => entry.materialLot?.purchaseOrderItem?.purchaseOrder?.id));

        const purchaseOrders = purchaseOrderIds.length > 0
            ? await prisma.purchaseOrder.findMany({
                where: { id: { in: purchaseOrderIds } },
                include: {
                    supplier: { select: { id: true, name: true, identification: true } },
                    createdBy: { select: { id: true, name: true, role: true } },
                    approvedBy: { select: { id: true, name: true, role: true } },
                    paidBy: { select: { id: true, name: true, role: true } },
                    items: {
                        include: {
                            product: { select: { id: true, name: true, sku: true, unit: true } },
                            lots: { orderBy: { receivedAt: 'desc' } }
                        }
                    },
                    receptions: {
                        include: {
                            items: {
                                include: {
                                    orderItem: {
                                        select: {
                                            id: true,
                                            siigoProductName: true,
                                            siigoProductCode: true,
                                            quantityOrdered: true,
                                            quantityReceived: true
                                        }
                                    }
                                }
                            },
                            receivedBy: { select: { id: true, name: true, role: true } },
                            accountingUser: { select: { id: true, name: true, role: true } }
                        },
                        orderBy: { receivedAt: 'desc' }
                    }
                },
                orderBy: { createdAt: 'desc' }
            })
            : [];

        const zoneTransferFilters = [];
        if (consumedLotIds.length > 0) {
            zoneTransferFilters.push({ materialLotId: { in: consumedLotIds } });
        }
        if (relatedProductIds.length > 0) {
            zoneTransferFilters.push({
                AND: [
                    { materialLotId: null },
                    { productId: { in: relatedProductIds } },
                    { createdAt: { gte: window.startBuffer, lte: window.endBuffer } }
                ]
            });
        }

        const zoneTransfers = zoneTransferFilters.length > 0
            ? await prisma.zoneTransfer.findMany({
                where: { OR: zoneTransferFilters },
                include: {
                    product: { select: { id: true, name: true, sku: true, unit: true } },
                    materialLot: { select: { id: true, lotNumber: true, currentQuantity: true, unit: true, zone: true } },
                    transferredBy: { select: { id: true, name: true, role: true } }
                },
                orderBy: { createdAt: 'asc' }
            })
            : [];

        const outputLotProducts = unique([
            ...batch.outputTargets.map(target => target.productId),
            ...notes.map(note => note.productId),
            batch.productId
        ]);

        const producedMaterialLots = outputLotProducts.length > 0
            ? await prisma.materialLot.findMany({
                where: {
                    purchaseOrderItemId: null,
                    productId: { in: outputLotProducts },
                    receivedAt: {
                        gte: window.outputStartBuffer,
                        lte: window.outputEndBuffer
                    }
                },
                include: {
                    product: { select: { id: true, name: true, sku: true, unit: true } }
                },
                orderBy: { receivedAt: 'asc' }
            })
            : [];

        const evidence = [];
        const evidenceSeen = new Set();

        notes.forEach((note) => {
            buildNoteEvidence(note).forEach((entry) => pushEvidence(evidence, evidenceSeen, entry));
        });

        purchaseOrders.forEach((order) => {
            (order.quotationUrls || []).forEach((url, index) => {
                pushEvidence(evidence, evidenceSeen, {
                    url,
                    label: `OC ${order.orderNumber} · Cotización ${index + 1}`,
                    sourceType: 'PURCHASE_ORDER',
                    sourceId: order.id,
                    sourceLabel: order.orderNumber,
                    at: order.createdAt
                });
            });

            (order.paymentProofUrls || []).forEach((url, index) => {
                pushEvidence(evidence, evidenceSeen, {
                    url,
                    label: `OC ${order.orderNumber} · Pago ${index + 1}`,
                    sourceType: 'PURCHASE_ORDER',
                    sourceId: order.id,
                    sourceLabel: order.orderNumber,
                    at: order.paidAt || order.updatedAt
                });
            });

            (order.receptions || []).forEach((reception) => {
                // Fase 8: photoProductUrl y photoInvoiceUrl eliminados (eran legacy sin datos)
                // siigoScreenshotUrl se mantiene
                [reception.siigoScreenshotUrl]
                    .filter(Boolean)
                    .forEach((url, index) => {
                        pushEvidence(evidence, evidenceSeen, {
                            url,
                            label: `Recepción ${order.orderNumber} · Siigo ${index + 1}`,
                            sourceType: 'RECEPTION',
                            sourceId: reception.id,
                            sourceLabel: order.orderNumber,
                            at: reception.receivedAt
                        });
                    });

                [...(reception.invoiceImageUrls || []), ...(reception.receptionPhotoUrls || [])].forEach((url, index) => {
                    pushEvidence(evidence, evidenceSeen, {
                        url,
                        label: `Recepción ${order.orderNumber} · Evidencia ${index + 1}`,
                        sourceType: 'RECEPTION',
                        sourceId: reception.id,
                        sourceLabel: order.orderNumber,
                        at: reception.receivedAt
                    });
                });
            });
        });

        zoneTransfers.forEach((transfer) => {
            (transfer.photos || []).forEach((url, index) => {
                pushEvidence(evidence, evidenceSeen, {
                    url,
                    label: `Traslado ${transfer.direction} · Foto ${index + 1}`,
                    sourceType: 'ZONE_TRANSFER',
                    sourceId: transfer.id,
                    sourceLabel: transfer.product?.name || transfer.materialLot?.lotNumber || 'Traslado',
                    at: transfer.createdAt
                });
            });
        });

        microSamples.forEach((sample) => {
            (sample.attachments || []).forEach((attachment) => {
                pushEvidence(evidence, evidenceSeen, {
                    url: attachment.url,
                    label: `${sample.sampleNumber} · ${attachment.category || 'Adjunto'}`,
                    sourceType: 'MICRO_SAMPLE',
                    sourceId: sample.id,
                    sourceLabel: sample.sampleNumber,
                    at: attachment.createdAt
                });
            });
        });

        pqrCases.forEach((pqr) => {
            [pqr.dispatchEvidenceUrl, pqr.creditNoteUrl, pqr.invoiceUrl, pqr.accountStatementUrl, pqr.adjustmentDocUrl]
                .filter(Boolean)
                .forEach((url) => {
                    pushEvidence(evidence, evidenceSeen, {
                        url,
                        label: `${pqr.ticketNumber} · Documento`,
                        sourceType: 'PQR',
                        sourceId: pqr.id,
                        sourceLabel: pqr.ticketNumber,
                        at: pqr.updatedAt
                    });
                });

            (pqr.items || []).forEach((item) => {
                (item.evidence || []).forEach((entry, index) => {
                    pushEvidence(evidence, evidenceSeen, {
                        url: entry.url,
                        label: `${pqr.ticketNumber} · Evidencia ${index + 1}`,
                        sourceType: 'PQR',
                        sourceId: pqr.id,
                        sourceLabel: item.product?.name || pqr.ticketNumber,
                        at: entry.createdAt
                    });
                });
            });
        });

        const operatorTimeline = buildOperatorTimeline({
            batch,
            notes,
            lotConsumptions,
            zoneTransfers,
            purchaseOrders,
            microSamples,
            pqrCases
        });

        const notePayload = notes.map((note) => ({
            id: note.id,
            noteNumber: note.noteNumber,
            stageOrder: note.stageOrder,
            stageName: note.stageName,
            status: note.status,
            targetQuantity: note.targetQuantity,
            actualQuantity: note.actualQuantity,
            unit: note.unit,
            startedAt: note.startedAt,
            completedAt: note.completedAt,
            createdAt: note.createdAt,
            updatedAt: note.updatedAt,
            notes: note.notes,
            observations: note.observations,
            batchCode: note.batchCode,
            template: note.template ? {
                id: note.template.id,
                templateCode: note.template.templateCode,
                templateName: note.template.templateName,
                version: note.template.version
            } : null,
            processType: note.processType,
            product: note.product,
            operators: {
                createdBy: note.createdBy,
                executedBy: note.executedBy,
                completedBy: note.completedBy
            },
            items: (note.items || []).map((item) => ({
                id: item.id,
                component: item.component,
                componentType: item.componentType,
                plannedQuantity: item.plannedQuantity,
                actualQuantity: item.actualQuantity,
                unit: item.unit,
                lotNumber: item.lotNumber,
                consumed: item.consumed,
                consumedAt: item.consumedAt,
                consumedBy: item.consumedBy,
                notes: item.notes
            })),
            processVariables: (note.processVariables || []).map((variable) => ({
                id: variable.id,
                variableName: variable.variableName,
                variableValue: variable.variableValue,
                variableUnit: variable.variableUnit,
                expectedMin: variable.expectedMin,
                expectedMax: variable.expectedMax,
                isWithinRange: variable.isWithinRange,
                capturedAt: variable.capturedAt,
                capturedBy: variable.capturedBy
            })),
            qualityChecks: (note.qualityChecks || []).map((check) => ({
                id: check.id,
                checkType: check.checkType,
                checkName: check.checkName,
                resultValue: check.resultValue,
                expectedValue: check.expectedValue,
                passed: check.passed,
                notes: check.notes,
                checkedAt: check.checkedAt,
                checkedBy: check.checkedBy,
                photoUrls: check.photoUrls || []
            })),
            rpaExecutions: (note.rpaExecutions || []).map((execution) => ({
                id: execution.id,
                executionType: execution.executionType,
                status: execution.status,
                productName: execution.productName,
                quantity: execution.quantity,
                assemblyType: execution.assemblyType,
                observations: execution.observations,
                siigoNoteCode: execution.siigoNoteCode,
                siigoUrl: execution.siigoUrl,
                screenshotPath: execution.screenshotPath,
                errorMessage: execution.errorMessage,
                startedAt: execution.startedAt,
                completedAt: execution.completedAt,
                durationMs: execution.durationMs,
                triggeredBy: execution.triggeredBy
            })),
            processParameters: note.processParameters || null,
            actualParameters: note.actualParameters || null,
            evidence: buildNoteEvidence(note)
        }));

        const supplyLots = lotConsumptions.map((consumption) => ({
            id: consumption.id,
            quantityUsed: consumption.quantityUsed,
            usedAt: consumption.usedAt,
            observations: consumption.observations,
            usedBy: consumption.usedBy,
            materialLot: consumption.materialLot ? {
                id: consumption.materialLot.id,
                product: consumption.materialLot.product || consumption.materialLot.purchaseOrderItem?.product || null,
                siigoProductCode: consumption.materialLot.siigoProductCode,
                siigoProductName: consumption.materialLot.siigoProductName,
                lotNumber: consumption.materialLot.lotNumber,
                unit: consumption.materialLot.unit,
                initialQuantity: consumption.materialLot.initialQuantity,
                currentQuantity: consumption.materialLot.currentQuantity,
                status: consumption.materialLot.status,
                zone: consumption.materialLot.zone,
                receivedAt: consumption.materialLot.receivedAt,
                expiresAt: consumption.materialLot.expiresAt,
                purchaseOrder: consumption.materialLot.purchaseOrderItem?.purchaseOrder || null
            } : null
        }));

        const completedNotes = notes.filter((note) => note.status === 'COMPLETED');
        const qualityCheckCount = notes.reduce((total, note) => total + (note.qualityChecks?.length || 0), 0);
        const processVariableCount = notes.reduce((total, note) => total + (note.processVariables?.length || 0), 0);

        res.json({
            batch: {
                id: batch.id,
                batchNumber: batch.batchNumber,
                displayLot,
                compactLot,
                segment: segmentInfo,
                status: batch.status,
                flavor: batch.flavor,
                notes: batch.notes,
                product: batch.product,
                scheduledStart: batch.scheduledStart,
                scheduledEnd: batch.scheduledEnd,
                startedAt: batch.startedAt,
                completedAt: batch.completedAt,
                createdAt: batch.createdAt,
                updatedAt: batch.updatedAt,
                baseWeight: batch.baseWeight,
                projectedTotalWeight: batch.projectedTotalWeight,
                expectedOutput: batch.expectedOutput,
                actualOutput: batch.actualOutput,
                containersProduced: batch.containersProduced,
                containersLabeled: batch.containersLabeled
            },
            summary: {
                outputTargets: (batch.outputTargets || []).map((target) => ({
                    id: target.id,
                    product: target.product,
                    plannedUnits: target.plannedUnits,
                    plannedWeightKg: target.plannedWeightKg
                })),
                stats: {
                    stagesTotal: notes.length,
                    stagesCompleted: completedNotes.length,
                    consumedLots: supplyLots.length,
                    transfers: zoneTransfers.length,
                    producedMaterialLots: producedMaterialLots.length,
                    qualityChecks: qualityCheckCount,
                    processVariables: processVariableCount,
                    microSamples: microSamples.length,
                    pqrCases: pqrCases.length,
                    evidence: evidence.length
                }
            },
            supply: {
                consumptions: supplyLots,
                purchaseOrders,
                zoneTransfers,
                producedMaterialLots
            },
            process: {
                notes: notePayload,
                operatorTimeline
            },
            quality: {
                productionRegistry: productionLots,
                syrupRegistry: syrupLots,
                pqrCases
            },
            microbiology: {
                samples: microSamples
            },
            evidence: sortByDateDesc(evidence),
            relatedKeys: {
                displayLot,
                compactLot,
                batchNumber: batch.batchNumber,
                noteNumbers
            }
        });
    } catch (error) {
        console.error('[productiveTraceability] getBatchDetail error:', error);
        res.status(500).json({ error: 'No se pudo construir la trazabilidad productiva del lote.' });
    }
};
