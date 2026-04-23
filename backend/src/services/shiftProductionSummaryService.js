const COLOMBIA_TZ = 'America/Bogota';
const COMPLETED_NOTE_STATUS = 'COMPLETED';
const COMPLETED_BATCH_STATUS = 'COMPLETED';
const ACTIVE_BATCH_STATUSES = [
    'STAGE_1_BASE',
    'STAGE_2_JARABE',
    'STAGE_3_ESFERIFICACION',
    'STAGE_4_PRODUCTO_FINAL',
    'LABELING'
];
const RECENT_ACTIVITY_LOOKBACK_HOURS = 24;
const SUMMARY_AREAS = ['PRODUCCION', 'SIROPES', 'EMPAQUE'];
const PACKAGING_CODES = ['EMPAQUE', 'G_EMPAQUE'];
const ENSAMBLE_CODES = ['ENSAMBLE', 'G_ENSAMBLE'];
const SIROPE_CODES = ['G_PESAJE', 'G_MEZCLADO', 'G_EMPAQUE', 'G_ENSAMBLE', 'GE_PREMIX', 'GE_BASE_LIQUIDA', 'GE_COCCION'];
const SIROPE_KEYWORDS = ['SIROPE', 'SABORIZACION', 'GENIALITY', 'LIQUIMON'];
const PREMIX_KEYWORDS = [
    'PREMEZCLA',
    'PROTONICO',
    'FUENTE DE CALCIO',
    'GOMA',
    'GOMAS',
    'CONSERVANTE',
    'CONSERVANTES',
    'CALCIO DIOXIDO',
    'CALCIO DIÓXIDO',
    'ALGINATO PREPARADO',
    'AZUCAR INVERTER',
    'AZÚCAR INVERTER',
    'PROTECCION',
    'PROTECCIÓN'
];
const AREA_LABELS = {
    PRODUCCION: {
        title: 'Revisión de perlas - Producción',
        areaLabel: 'Producción Perlas',
        receivedTitle: 'Lotes actuales de perlas en producción',
        completedTitle: 'Lotes producidos durante el turno',
        remainingTitle: 'Lotes que siguen en producción',
        pendingTitle: 'Lotes que faltan por producir',
        completedVerb: 'terminó producción'
    },
    SIROPES: {
        title: 'Baches de siropes',
        areaLabel: 'Siropes',
        receivedTitle: 'Baches recibidos por Siropes',
        completedTitle: 'Baches terminados por Siropes',
        remainingTitle: 'Baches que quedan en Siropes',
        pendingTitle: 'Baches pendientes de iniciar en Siropes',
        completedVerb: 'terminó sirope'
    },
    EMPAQUE: {
        title: 'Baches de empaque',
        areaLabel: 'Empaque',
        receivedTitle: 'Baches recibidos por Empaque',
        completedTitle: 'Baches terminados por Empaque',
        remainingTitle: 'Baches que quedan en Empaque',
        pendingTitle: 'Baches pendientes de iniciar en Empaque',
        completedVerb: 'terminó empaque'
    }
};

function getDateString(dateInput) {
    if (!dateInput) return null;
    if (typeof dateInput === 'string') return dateInput.slice(0, 10);
    return dateInput.toISOString().slice(0, 10);
}

function addDays(dateStr, days) {
    const date = new Date(`${dateStr}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

function localDateTimeToUtc(dateStr, time) {
    return new Date(`${dateStr}T${time}:00-05:00`);
}

function subtractHours(date, hours) {
    return new Date(date.getTime() - (hours * 60 * 60 * 1000));
}

function getShiftWindow(operationalDate, outgoingShift) {
    const dateStr = getDateString(operationalDate);
    if (!dateStr) throw new Error('Fecha operacional inválida');

    if (outgoingShift === 'MANANA') {
        return {
            start: localDateTimeToUtc(dateStr, '06:00'),
            end: localDateTimeToUtc(dateStr, '14:00')
        };
    }

    if (outgoingShift === 'TARDE') {
        return {
            start: localDateTimeToUtc(dateStr, '14:00'),
            end: localDateTimeToUtc(dateStr, '22:00')
        };
    }

    if (outgoingShift === 'NOCHE') {
        return {
            start: localDateTimeToUtc(dateStr, '22:00'),
            end: localDateTimeToUtc(addDays(dateStr, 1), '06:00')
        };
    }

    throw new Error(`Turno inválido: ${outgoingShift}`);
}

function formatColombiaTime(date) {
    if (!date) return null;
    return new Intl.DateTimeFormat('es-CO', {
        timeZone: COLOMBIA_TZ,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    }).format(new Date(date));
}

function normalizeText(value) {
    return String(value || '')
        .toUpperCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[-_]+/g, ' ');
}

function getNoteCode(note) {
    return note?.processType?.code || '';
}

function getBatchSearchText(batch) {
    return [
        batch.batchNumber,
        batch.flavor,
        batch.product?.name,
        ...(batch.outputTargets || []).map(target => target.product?.name),
        ...(batch.assemblyNotes || []).map(note => note.stageName)
    ].map(normalizeText).join(' ');
}

function getBatchIdentityText(batch) {
    return [
        batch.batchNumber,
        batch.flavor,
        batch.product?.name,
        ...(batch.outputTargets || []).map(target => target.product?.name)
    ].map(normalizeText).join(' ');
}

function getBatchLabel(batch) {
    return batch.flavor || batch.product?.name || batch.batchNumber;
}

function getCleanNotes(batch) {
    return (batch.assemblyNotes || [])
        .filter(note => note.status !== 'FAILED')
        .sort((a, b) => (a.stageOrder || 0) - (b.stageOrder || 0));
}

function getCompletedNotesAt(notes, cutoff) {
    return (notes || []).filter(note => {
        if (note.status !== COMPLETED_NOTE_STATUS) return false;
        if (!note.completedAt) return false;
        return new Date(note.completedAt) <= cutoff;
    }).length;
}

function getProgressAt(notes, cutoff) {
    const total = (notes || []).length;
    if (total <= 0) return 0;

    const completed = getCompletedNotesAt(notes, cutoff);
    return Math.max(0, Math.min(100, Math.round((completed / total) * 100)));
}

function getCurrentStepAt(notes, cutoff) {
    const active = notes.find(note =>
        note.startedAt &&
        new Date(note.startedAt) <= cutoff &&
        (!note.completedAt || new Date(note.completedAt) > cutoff)
    );
    if (active) return active.stageName;

    const next = notes.find(note =>
        note.status !== COMPLETED_NOTE_STATUS ||
        (note.completedAt && new Date(note.completedAt) > cutoff)
    );
    return next?.stageName || null;
}

function isAreaCompleteAt(notes, cutoff) {
    if (!notes || notes.length === 0) return false;
    return notes.every(note =>
        note.status === COMPLETED_NOTE_STATUS &&
        note.completedAt &&
        new Date(note.completedAt) <= cutoff
    );
}

function getAreaCompletionAt(notes) {
    if (!notes || notes.length === 0) return null;
    const complete = notes.every(note => note.status === COMPLETED_NOTE_STATUS && note.completedAt);
    if (!complete) return null;
    return maxDate(notes.map(note => note.completedAt));
}

function maxDate(dates) {
    return dates
        .filter(Boolean)
        .map(date => new Date(date))
        .sort((a, b) => b - a)[0] || null;
}

function minDate(dates) {
    return dates
        .filter(Boolean)
        .map(date => new Date(date))
        .sort((a, b) => a - b)[0] || null;
}

function isBetween(date, start, end) {
    if (!date) return false;
    const value = new Date(date);
    return value >= start && value < end;
}

function getAreaActivityDates(notes, availableAt = null, completionAt = null) {
    const dates = [availableAt, completionAt];
    (notes || []).forEach(note => {
        dates.push(note.startedAt, note.completedAt);
    });
    return dates.filter(Boolean);
}

function getLastAreaActivityAt(notes, availableAt = null, completionAt = null) {
    return maxDate(getAreaActivityDates(notes, availableAt, completionAt));
}

function hasAreaActivityBetween(notes, start, end, availableAt = null, completionAt = null) {
    return getAreaActivityDates(notes, availableAt, completionAt).some(date => isBetween(date, start, end));
}

function hasAreaActivityBefore(notes, cutoff, availableAt = null) {
    if (availableAt && new Date(availableAt) < cutoff) return true;
    return (notes || []).some(note =>
        (note.startedAt && new Date(note.startedAt) < cutoff) ||
        (note.completedAt && new Date(note.completedAt) < cutoff)
    );
}

function hasAnyCode(batch, codes) {
    const set = new Set(codes);
    return getCleanNotes(batch).some(note => set.has(getNoteCode(note)));
}

function isPackagingCode(code) {
    return PACKAGING_CODES.includes(code);
}

function isEnsambleCode(code) {
    return ENSAMBLE_CODES.includes(code);
}

function getFirstPackagingOrder(batch) {
    const packagingOrders = getCleanNotes(batch)
        .filter(note => isPackagingCode(getNoteCode(note)))
        .map(note => note.stageOrder || 9999);
    return packagingOrders.length > 0 ? Math.min(...packagingOrders) : 9999;
}

function isSiropeBatch(batch) {
    const text = getBatchSearchText(batch);
    if (SIROPE_KEYWORDS.some(keyword => text.includes(normalizeText(keyword)))) return true;
    return getCleanNotes(batch).some(note => SIROPE_CODES.includes(getNoteCode(note)));
}

function isPremixBatch(batch) {
    const text = getBatchIdentityText(batch);
    return PREMIX_KEYWORDS.some(keyword => text.includes(normalizeText(keyword)));
}

function isLiquipopsBatch(batch) {
    const text = getBatchIdentityText(batch);
    return text.includes('LIQUIPOPS');
}

function isPearlProductionBatch(batch) {
    if (isSiropeBatch(batch) || isPremixBatch(batch)) return false;
    if (isLiquipopsBatch(batch)) return true;
    return hasAnyCode(batch, ['FORMACION', 'PROTECCION_GATE']) ||
        (hasAnyCode(batch, ['CONTEO']) && hasAnyCode(batch, ['EMPAQUE']));
}

function getAreaNotes(batch, area) {
    const notes = getCleanNotes(batch);
    const firstPackagingOrder = getFirstPackagingOrder(batch);

    if (area === 'EMPAQUE') {
        return notes.filter(note => {
            const code = getNoteCode(note);
            const stageOrder = note.stageOrder || 0;
            return isPackagingCode(code) || (isEnsambleCode(code) && stageOrder > firstPackagingOrder);
        });
    }

    if (area === 'PRODUCCION' || area === 'SIROPES') {
        return notes.filter(note => {
            const code = getNoteCode(note);
            const stageOrder = note.stageOrder || 0;
            return stageOrder < firstPackagingOrder && !isPackagingCode(code);
        });
    }

    return notes;
}

function batchMatchesArea(batch, area) {
    if (area === 'PRODUCCION') return isPearlProductionBatch(batch);
    if (area === 'SIROPES') return isSiropeBatch(batch);
    if (area === 'EMPAQUE') return hasAnyCode(batch, PACKAGING_CODES);
    return true;
}

function getAreaAvailableAt(batch, area, areaNotes) {
    if (area !== 'EMPAQUE') {
        return minDate([
            batch.scheduledStart,
            batch.createdAt,
            batch.startedAt,
            ...areaNotes.map(note => note.startedAt || note.completedAt)
        ]);
    }

    const notes = getCleanNotes(batch);
    const firstPackagingOrder = getFirstPackagingOrder(batch);
    const previousNotes = notes.filter(note => (note.stageOrder || 0) < firstPackagingOrder);
    const packagingNotes = getAreaNotes(batch, 'EMPAQUE');
    const firstPackagingActivity = minDate(packagingNotes.map(note => note.startedAt || note.completedAt));

    if (previousNotes.length === 0) {
        return firstPackagingActivity;
    }

    const previousComplete = previousNotes.every(note =>
        note.status === COMPLETED_NOTE_STATUS &&
        note.completedAt
    );
    return previousComplete ? maxDate(previousNotes.map(note => note.completedAt)) : firstPackagingActivity;
}

function isActiveProductionBatch(batch) {
    return ACTIVE_BATCH_STATUSES.includes(batch.status);
}

function buildBatchSummary(batch, areaNotes, progress, timeField = null) {
    const total = areaNotes.length;
    const completed = Math.round((progress / 100) * total);

    return {
        id: batch.id,
        batchNumber: batch.batchNumber,
        label: getBatchLabel(batch),
        product: batch.product?.name || null,
        status: batch.status,
        progress,
        stageCompleted: total > 0 ? completed : 0,
        stageTotal: total,
        currentStep: timeField?.cutoff ? getCurrentStepAt(areaNotes, timeField.cutoff) : null,
        startedAt: batch.startedAt,
        scheduledStart: batch.scheduledStart,
        scheduledEnd: batch.scheduledEnd,
        completedAt: timeField?.date || batch.completedAt,
        time: timeField?.date ? formatColombiaTime(timeField.date) : null
    };
}

async function buildShiftProductionSummary(prisma, handover) {
    if (!handover) throw new Error('Relevo no encontrado');

    const area = SUMMARY_AREAS.includes(handover.area) ? handover.area : 'PRODUCCION';
    const labels = AREA_LABELS[area] || AREA_LABELS.PRODUCCION;
    const { start, end } = getShiftWindow(handover.operationalDate, handover.outgoingShift);
    const lookbackStart = subtractHours(start, RECENT_ACTIVITY_LOOKBACK_HOURS);

    const batches = await prisma.productionBatch.findMany({
        where: {
            status: { not: 'FAILED' },
            OR: [
                { completedAt: { gte: start, lt: end } },
                { startedAt: { gte: lookbackStart, lt: end } },
                { updatedAt: { gte: lookbackStart, lt: end } },
                {
                    status: { in: ACTIVE_BATCH_STATUSES },
                    updatedAt: { gte: lookbackStart, lt: end }
                },
                {
                    assemblyNotes: {
                        some: {
                            OR: [
                                { startedAt: { gte: lookbackStart, lt: end } },
                                { completedAt: { gte: lookbackStart, lt: end } },
                                { updatedAt: { gte: lookbackStart, lt: end } }
                            ]
                        }
                    }
                },
                {
                    assemblyNotes: {
                        some: {
                            completedAt: { gte: start, lt: end }
                        }
                    }
                }
            ],
            AND: [
                {
                    OR: [
                        { assemblyNotes: { some: { startedAt: { lt: end } } } },
                        { assemblyNotes: { some: { completedAt: { lt: end } } } },
                        { startedAt: { lt: end } },
                        { completedAt: { lt: end } },
                        { scheduledStart: { lt: end } },
                        { createdAt: { lt: end } },
                        { updatedAt: { lt: end } }
                    ]
                }
            ]
        },
        include: {
            product: { select: { name: true } },
            outputTargets: {
                include: {
                    product: { select: { name: true } }
                }
            },
            assemblyNotes: {
                select: {
                    id: true,
                    stageName: true,
                    stageOrder: true,
                    status: true,
                    createdAt: true,
                    startedAt: true,
                    completedAt: true,
                    updatedAt: true,
                    processType: { select: { code: true, name: true } }
                },
                orderBy: { stageOrder: 'asc' }
            }
        },
        orderBy: [{ startedAt: 'asc' }, { createdAt: 'asc' }],
        take: 120
    });

    const receivedInProcess = [];
    const completedDuringShift = [];
    const remainingForNextShift = [];
    const pendingToProduce = [];

    for (const batch of batches) {
        if (!batchMatchesArea(batch, area)) continue;

        const areaNotes = getAreaNotes(batch, area);
        const hasAreaNotes = areaNotes.length > 0;
        const pendingStart = batch.scheduledStart || batch.createdAt || batch.updatedAt;

        if (!hasAreaNotes) {
            const pendingDuringShift = batch.status === 'PENDING' && pendingStart && new Date(pendingStart) >= start && new Date(pendingStart) < end;
            if (pendingDuringShift && (area === 'PRODUCCION' || area === 'SIROPES')) {
                pendingToProduce.push({
                    ...buildBatchSummary(batch, [], 0, { cutoff: end }),
                    currentStep: 'Pendiente de iniciar'
                });
            }
            continue;
        }

        const availableAt = getAreaAvailableAt(batch, area, areaNotes);
        const completionAt = getAreaCompletionAt(areaNotes);
        const progressAtStart = getProgressAt(areaNotes, start);
        const progressAtEnd = getProgressAt(areaNotes, end);
        const completedByStart = isAreaCompleteAt(areaNotes, start);
        const completedByEnd = isAreaCompleteAt(areaNotes, end);
        const completedDuring = completionAt && new Date(completionAt) >= start && new Date(completionAt) < end && completedByEnd;
        const lastActivityAt = getLastAreaActivityAt(areaNotes, availableAt, completionAt);
        const hasRecentActivity = lastActivityAt && lastActivityAt >= lookbackStart && lastActivityAt < end;
        const movedDuringShift = hasAreaActivityBetween(areaNotes, start, end, availableAt, completionAt);
        const relevantForShift = completedDuring || movedDuringShift || hasRecentActivity || (isActiveProductionBatch(batch) && availableAt);
        const availableByStart = availableAt && new Date(availableAt) < start;
        const availableByEnd = availableAt && new Date(availableAt) < end;
        const shouldShowZeroProgress = area === 'EMPAQUE';
        const isPendingToStart = batch.status === 'PENDING' && progressAtEnd === 0;

        if (
            relevantForShift &&
            availableByStart &&
            hasAreaActivityBefore(areaNotes, start, availableAt) &&
            !completedByStart &&
            (progressAtStart > 0 || shouldShowZeroProgress)
        ) {
            receivedInProcess.push(buildBatchSummary(batch, areaNotes, progressAtStart, { cutoff: start }));
        }

        if (completedDuring) {
            completedDuringShift.push(buildBatchSummary(batch, areaNotes, 100, { date: completionAt, cutoff: end }));
        }

        if (
            relevantForShift &&
            !isPendingToStart &&
            availableByEnd &&
            hasAreaActivityBefore(areaNotes, end, availableAt) &&
            !completedByEnd &&
            (progressAtEnd > 0 || shouldShowZeroProgress)
        ) {
            remainingForNextShift.push(buildBatchSummary(batch, areaNotes, progressAtEnd, { cutoff: end }));
        }

        if (
            isPendingToStart &&
            area !== 'EMPAQUE' &&
            pendingStart &&
            new Date(pendingStart) >= start &&
            new Date(pendingStart) < end
        ) {
            pendingToProduce.push({
                ...buildBatchSummary(batch, areaNotes, 0, { cutoff: end }),
                currentStep: getCurrentStepAt(areaNotes, end) || 'Pendiente de iniciar'
            });
        }
    }

    completedDuringShift.sort((a, b) => new Date(a.completedAt) - new Date(b.completedAt));
    remainingForNextShift.sort((a, b) => b.progress - a.progress);
    pendingToProduce.sort((a, b) => new Date(a.scheduledStart || a.startedAt || 0) - new Date(b.scheduledStart || b.startedAt || 0));

    return {
        handoverId: handover.id,
        area,
        title: labels.title,
        areaLabel: labels.areaLabel,
        labels,
        outgoingShift: handover.outgoingShift,
        incomingShift: handover.incomingShift,
        operationalDate: getDateString(handover.operationalDate),
        window: {
            start,
            end,
            startLabel: formatColombiaTime(start),
            endLabel: formatColombiaTime(end)
        },
        receivedInProcess,
        currentInProcess: remainingForNextShift,
        completedDuringShift,
        remainingForNextShift,
        pendingToProduce,
        totals: {
            receivedInProcess: receivedInProcess.length,
            currentInProcess: remainingForNextShift.length,
            completedDuringShift: completedDuringShift.length,
            remainingForNextShift: remainingForNextShift.length,
            pendingToProduce: pendingToProduce.length
        },
        generatedAt: new Date()
    };
}

module.exports = {
    buildShiftProductionSummary,
    getShiftWindow
};
