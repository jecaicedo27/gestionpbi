const crypto = require('crypto');
const { Prisma } = require('@prisma/client');
const { buildQrString } = require('../utils/qrFormat');
const { formatPackQuantity, resolvePackOptionForLabel } = require('./productPackOptionService');

const MAX_PACKAGE_LABELS_PER_PRINT = 500;

const businessError = (message, statusCode = 400) => {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
};

const normalizeText = (value) => {
    if (value == null) return null;
    const clean = String(value).trim();
    return clean || null;
};

const normalizeCode = (value) => {
    const clean = String(value || '')
        .trim()
        .toUpperCase()
        .replace(/\s+/g, '');
    return clean || null;
};

const toOptionalDate = (value) => {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const toPositiveInt = (value, fieldName = 'value', max = null) => {
    const numeric = Number.parseInt(value, 10);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        throw businessError(`${fieldName} debe ser un entero positivo`);
    }
    if (max && numeric > max) {
        throw businessError(`${fieldName} no puede ser mayor a ${max}`);
    }
    return numeric;
};

const sanitizeSku = (value) => String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8);

const buildPackageMetadataForQuantity = (packMeta, quantity, unit) => {
    const packMatchesLabel = packMeta?.quantity && Number(packMeta.quantity) === Number(quantity);
    if (packMatchesLabel) {
        return {
            packOptionId: packMeta.id || null,
            packLabel: packMeta.label,
            packUnitQuantity: packMeta.quantity,
            packContainerType: packMeta.containerType || null
        };
    }

    return {
        packOptionId: packMeta?.id || null,
        packLabel: `Parcial ${formatPackQuantity(quantity, unit)}`,
        packUnitQuantity: quantity,
        packContainerType: packMeta?.containerType || null
    };
};

const buildPackageQuantities = ({
    currentQuantity,
    quantityPerPackage,
    packageCount,
    coverLotQuantity,
    packageQuantities
}) => {
    const totalQuantity = toPositiveInt(currentQuantity, 'La cantidad actual del lote');
    const explicitQuantities = Array.isArray(packageQuantities)
        ? packageQuantities.map((qty, index) => toPositiveInt(qty, `packageQuantities[${index}]`, totalQuantity))
        : [];

    if (explicitQuantities.length > 0) {
        if (explicitQuantities.length > MAX_PACKAGE_LABELS_PER_PRINT) {
            throw businessError(`No se pueden generar mas de ${MAX_PACKAGE_LABELS_PER_PRINT} rotulos en una operacion`);
        }
        const explicitTotal = explicitQuantities.reduce((sum, qty) => sum + qty, 0);
        if (coverLotQuantity && explicitTotal !== totalQuantity) {
            throw businessError(`Las cantidades por rotulo suman ${explicitTotal}, pero deben cubrir ${totalQuantity}.`);
        }
        if (explicitTotal > totalQuantity) {
            throw businessError(`Las cantidades por rotulo suman ${explicitTotal}, pero el lote disponible para rotular tiene ${totalQuantity}.`);
        }
        return explicitQuantities;
    }

    const perPackage = toPositiveInt(quantityPerPackage, 'quantityPerPackage');
    const expectedPackages = Math.ceil(totalQuantity / perPackage);
    const requestedPackages = packageCount
        ? toPositiveInt(packageCount, 'packageCount', MAX_PACKAGE_LABELS_PER_PRINT)
        : expectedPackages;

    if (coverLotQuantity && requestedPackages !== expectedPackages) {
        throw businessError(`Para cubrir ${totalQuantity} con rotulos de ${perPackage}, deben generarse ${expectedPackages} unidad(es) fisica(s).`);
    }

    const finalCount = coverLotQuantity ? expectedPackages : requestedPackages;
    if (finalCount > MAX_PACKAGE_LABELS_PER_PRINT) {
        throw businessError(`No se pueden generar mas de ${MAX_PACKAGE_LABELS_PER_PRINT} rotulos en una operacion`);
    }

    const quantities = [];
    if (coverLotQuantity) {
        let remaining = totalQuantity;
        for (let index = 0; index < finalCount; index += 1) {
            const quantity = Math.min(perPackage, remaining);
            if (quantity <= 0) break;
            quantities.push(quantity);
            remaining -= quantity;
        }
        return quantities;
    }

    const requestedTotal = finalCount * perPackage;
    if (requestedTotal > totalQuantity) {
        throw businessError(`Los rotulos solicitados representan ${requestedTotal}, pero el lote solo tiene ${totalQuantity}.`);
    }

    for (let index = 0; index < finalCount; index += 1) {
        quantities.push(perPackage);
    }
    return quantities;
};

const resolvePrintableLot = async (tx, lotId) => {
    const materialLot = await tx.materialLot.findUnique({
        where: { id: lotId },
        include: {
            product: {
                select: {
                    id: true,
                    name: true,
                    sku: true,
                    barcode: true,
                    unit: true
                }
            }
        }
    });

    if (materialLot) {
        return {
            type: 'material',
            id: materialLot.id,
            productId: materialLot.product?.id,
            productName: materialLot.product?.name || materialLot.siigoProductName,
            product: materialLot.product || null,
            sku: materialLot.product?.sku || materialLot.siigoProductCode,
            barcode: materialLot.product?.barcode || null,
            lotNumber: materialLot.lotNumber,
            zone: materialLot.zone || 'WAREHOUSE',
            currentQuantity: materialLot.currentQuantity,
            unit: materialLot.unit || materialLot.product?.unit || 'gramo',
            receivedAt: materialLot.receivedAt,
            expiresAt: materialLot.expiresAt
        };
    }

    const finishedLot = await tx.finishedLotStock.findUnique({
        where: { id: lotId },
        include: {
            product: {
                select: {
                    id: true,
                    name: true,
                    sku: true,
                    barcode: true,
                    unit: true
                }
            }
        }
    });

    if (finishedLot) {
        return {
            type: 'finished',
            id: finishedLot.id,
            productId: finishedLot.product?.id,
            productName: finishedLot.product?.name,
            product: finishedLot.product || null,
            sku: finishedLot.product?.sku || null,
            barcode: finishedLot.product?.barcode || null,
            lotNumber: finishedLot.lotNumber,
            zone: finishedLot.zone,
            currentQuantity: finishedLot.currentQuantity,
            unit: finishedLot.product?.unit || 'gramo',
            receivedAt: finishedLot.createdAt,
            expiresAt: finishedLot.expiresAt
        };
    }

    throw businessError('Lote no encontrado', 404);
};

const getLabelInclude = () => ({
    product: {
        select: {
            id: true,
            name: true,
            sku: true,
            barcode: true,
            unit: true
        }
    },
    packOption: true
});

const buildSourceWhere = (source) => (
    source.type === 'material'
        ? { materialLotId: source.id }
        : { finishedLotStockId: source.id }
);

const getActivePackageLabels = async (tx, source) => tx.packageLabel.findMany({
    where: {
        ...buildSourceWhere(source),
        status: 'ACTIVE'
    },
    include: getLabelInclude(),
    orderBy: [{ sequence: 'asc' }, { createdAt: 'asc' }]
});

const labelToDto = (label, source = null) => {
    const product = label.product || source?.product || {};
    return {
        id: label.id,
        packageCode: label.packageCode,
        productId: label.productId,
        productName: source?.productName || product.name || null,
        sku: source?.sku || product.sku || null,
        barcode: source?.barcode || product.barcode || null,
        lotNumber: label.lotNumber,
        zone: label.zone || source?.zone || null,
        quantity: label.quantity,
        unit: label.unit,
        sequence: label.sequence,
        totalPackages: label.totalPackages,
        qrPayload: label.qrPayload,
        status: label.status,
        materialLotId: label.materialLotId || null,
        finishedLotStockId: label.finishedLotStockId || null,
        sourceType: label.materialLotId ? 'MATERIAL_LOT' : 'FINISHED_LOT',
        packOptionId: label.packOptionId || label.packOption?.id || null,
        packLabel: label.packLabel || label.packOption?.label || null,
        packUnitQuantity: label.packUnitQuantity || label.packOption?.quantity || null,
        packContainerType: label.packContainerType || label.packOption?.containerType || null,
        printedAt: label.printedAt || null,
        receivedAt: label.receivedAt || null,
        expiresAt: label.expiresAt || null,
        createdAt: label.createdAt || null
    };
};

const generateCandidateCode = (source) => {
    const lotChunk = String(source.lotNumber || '')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(-8) || 'LOTE';
    const skuChunk = sanitizeSku(source.sku) || 'SKU';
    const randomChunk = crypto.randomBytes(3).toString('hex').toUpperCase();
    return `PKG-${skuChunk}-${lotChunk}-${randomChunk}`;
};

const generateUniquePackageCode = async (tx, source) => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
        const candidate = generateCandidateCode(source);
        const existing = await tx.packageLabel.findUnique({
            where: { packageCode: candidate },
            select: { id: true }
        });
        if (!existing) return candidate;
    }

    throw businessError('No fue posible generar un codigo unico para el rotulo');
};

const refreshActiveLabelTotals = async (tx, labels, source, totalPackages) => {
    if (!Array.isArray(labels) || labels.length === 0 || !totalPackages) return;

    for (const label of labels) {
        const qrPayload = buildQrString({
            packageId: label.packageCode,
            lotNumber: source.lotNumber,
            sku: source.sku,
            barcode: source.barcode,
            quantity: label.quantity,
            containerType: label.packContainerType,
            receivedAt: label.receivedAt || source.receivedAt,
            expiresAt: label.expiresAt || source.expiresAt,
            boxNumber: label.sequence,
            totalBoxes: totalPackages
        });

        await tx.packageLabel.update({
            where: { id: label.id },
            data: {
                totalPackages,
                qrPayload
            }
        });
    }
};

const createPackageLabelsForLot = async (tx, {
    lotId,
    quantityPerPackage,
    packageCount,
    coverLotQuantity = true,
    forceRegenerate = false,
    appendNewLabels = false,
    packOptionId = null,
    packLabel = null,
    packUnitQuantity = null,
    packContainerType = null,
    packageQuantities = null,
    userId = null
}) => {
    const source = await resolvePrintableLot(tx, lotId);
    if (!source.productId) {
        throw businessError('El lote no esta enlazado a un producto');
    }

    const existingLabels = await getActivePackageLabels(tx, source);

    if (existingLabels.length > 0 && !forceRegenerate && !appendNewLabels) {
        return {
            reused: true,
            source,
            labels: existingLabels.map(label => labelToDto(label, source))
        };
    }

    if (forceRegenerate && existingLabels.length > 0) {
        await tx.packageLabel.updateMany({
            where: {
                id: { in: existingLabels.map(label => label.id) }
            },
            data: { status: 'VOIDED' }
        });
    }

    const activeLabels = forceRegenerate ? [] : existingLabels;
    const alreadyLabelledQuantity = appendNewLabels
        ? activeLabels.reduce((sum, label) => sum + (label.quantity || 0), 0)
        : 0;
    const quantityAvailableForThisRun = appendNewLabels
        ? Math.max(0, source.currentQuantity - alreadyLabelledQuantity)
        : source.currentQuantity;

    if (quantityAvailableForThisRun <= 0) {
        throw businessError('El lote no tiene cantidad disponible para generar nuevos rotulos');
    }

    const baseQuantity = packageQuantities?.[0] || packUnitQuantity || quantityPerPackage;
    const packMeta = await resolvePackOptionForLabel(tx, {
        productId: source.productId,
        packOptionId,
        packLabel,
        packUnitQuantity: packUnitQuantity || baseQuantity,
        quantityPerPackage: quantityPerPackage || baseQuantity,
        unit: source.unit,
        containerType: packContainerType
    });

    const quantities = buildPackageQuantities({
        currentQuantity: quantityAvailableForThisRun,
        quantityPerPackage: packMeta?.quantity || packUnitQuantity || quantityPerPackage,
        packageCount,
        coverLotQuantity,
        packageQuantities
    });

    const totalPackages = appendNewLabels ? activeLabels.length + quantities.length : quantities.length;
    const sequenceOffset = appendNewLabels ? activeLabels.length : 0;

    if (appendNewLabels && activeLabels.length > 0) {
        await refreshActiveLabelTotals(tx, activeLabels, source, totalPackages);
    }

    const created = [];
    for (let index = 0; index < quantities.length; index += 1) {
        const quantity = quantities[index];
        const sequence = sequenceOffset + index + 1;
        const packageCode = await generateUniquePackageCode(tx, source);
        const packageMeta = buildPackageMetadataForQuantity(packMeta, quantity, source.unit);
        const qrPayload = buildQrString({
            packageId: packageCode,
            lotNumber: source.lotNumber,
            sku: source.sku,
            barcode: source.barcode,
            quantity,
            containerType: packageMeta.packContainerType,
            receivedAt: source.receivedAt,
            expiresAt: source.expiresAt,
            boxNumber: sequence,
            totalBoxes: totalPackages
        });

        const label = await tx.packageLabel.create({
            data: {
                packageCode,
                productId: source.productId,
                materialLotId: source.type === 'material' ? source.id : null,
                finishedLotStockId: source.type === 'finished' ? source.id : null,
                lotNumber: source.lotNumber,
                zone: source.zone,
                quantity,
                unit: source.unit || 'gramo',
                sequence,
                totalPackages,
                qrPayload,
                status: 'ACTIVE',
                receivedAt: toOptionalDate(source.receivedAt),
                expiresAt: toOptionalDate(source.expiresAt),
                createdById: userId || null,
                packOptionId: packageMeta.packOptionId,
                packLabel: packageMeta.packLabel,
                packUnitQuantity: packageMeta.packUnitQuantity,
                packContainerType: packageMeta.packContainerType
            },
            include: getLabelInclude()
        });

        created.push(label);
    }

    return {
        reused: false,
        source,
        labels: created.map(label => labelToDto(label, source))
    };
};

const registerIncomingPackageLabel = async (tx, {
    lotId,
    packageCode,
    quantity,
    receivedAt = null,
    expiresAt = null,
    packOptionId = null,
    packLabel = null,
    packUnitQuantity = null,
    packContainerType = null,
    userId = null
}) => {
    const normalizedCode = normalizeCode(packageCode);
    if (!normalizedCode) return null;

    const source = await resolvePrintableLot(tx, lotId);
    if (!source.productId) {
        throw businessError('El lote no esta enlazado a un producto');
    }

    const normalizedQuantity = toPositiveInt(quantity, 'quantity');
    const packMeta = await resolvePackOptionForLabel(tx, {
        productId: source.productId,
        packOptionId,
        packLabel,
        packUnitQuantity: packUnitQuantity || normalizedQuantity,
        quantityPerPackage: normalizedQuantity,
        unit: source.unit,
        containerType: packContainerType
    });
    const packageMeta = buildPackageMetadataForQuantity(packMeta, normalizedQuantity, source.unit);
    const activeLabels = await getActivePackageLabels(tx, source);
    const existing = await tx.packageLabel.findUnique({
        where: { packageCode: normalizedCode },
        include: getLabelInclude()
    });

    if (existing?.status === 'ACTIVE') {
        throw businessError(`El ID unico ${normalizedCode} ya esta registrado`, 409);
    }

    const sequence = activeLabels.length + 1;
    const totalPackages = sequence;
    if (activeLabels.length > 0) {
        await refreshActiveLabelTotals(tx, activeLabels, source, totalPackages);
    }
    const qrPayload = buildQrString({
        packageId: normalizedCode,
        lotNumber: source.lotNumber,
        sku: source.sku,
        barcode: source.barcode,
        quantity: normalizedQuantity,
        containerType: packageMeta.packContainerType,
        receivedAt: receivedAt || source.receivedAt,
        expiresAt: expiresAt || source.expiresAt,
        boxNumber: sequence,
        totalBoxes: totalPackages
    });
    const labelData = {
        productId: source.productId,
        materialLotId: source.type === 'material' ? source.id : null,
        finishedLotStockId: source.type === 'finished' ? source.id : null,
        lotNumber: source.lotNumber,
        zone: source.zone,
        quantity: normalizedQuantity,
        unit: source.unit || 'gramo',
        sequence,
        totalPackages,
        qrPayload,
        status: 'ACTIVE',
        printedAt: null,
        printedById: null,
        receivedAt: toOptionalDate(receivedAt || source.receivedAt),
        expiresAt: toOptionalDate(expiresAt || source.expiresAt),
        createdById: userId || null,
        packOptionId: packageMeta.packOptionId,
        packLabel: packageMeta.packLabel,
        packUnitQuantity: packageMeta.packUnitQuantity,
        packContainerType: packageMeta.packContainerType
    };

    const label = existing
        ? await tx.packageLabel.update({
            where: { id: existing.id },
            data: labelData,
            include: getLabelInclude()
        })
        : await tx.packageLabel.create({
            data: {
                packageCode: normalizedCode,
                ...labelData
            },
            include: getLabelInclude()
        });

    return labelToDto(label, source);
};

const markPackageLabelsPrinted = async (tx, {
    lotId,
    labelIds = null,
    userId = null
}) => {
    const source = await resolvePrintableLot(tx, lotId);
    const activeLabels = await getActivePackageLabels(tx, source);
    const targetIds = Array.isArray(labelIds) && labelIds.length > 0
        ? activeLabels.filter(label => labelIds.includes(label.id)).map(label => label.id)
        : activeLabels.map(label => label.id);

    if (targetIds.length === 0) {
        return { source, labels: [] };
    }

    const printedAt = new Date();

    await tx.packageLabel.updateMany({
        where: { id: { in: targetIds } },
        data: {
            printedAt,
            printedById: userId || null
        }
    });

    const labels = await tx.packageLabel.findMany({
        where: { id: { in: targetIds } },
        include: getLabelInclude(),
        orderBy: [{ sequence: 'asc' }, { createdAt: 'asc' }]
    });

    return {
        source,
        printedAt,
        labels: labels.map(label => labelToDto(label, source))
    };
};

const validateAndRecordPackageScan = async (tx, {
    packageCode,
    processType,
    processId,
    rawPayload = null,
    userId = null,
    recordScan = true
}) => {
    const normalizedCode = normalizeCode(packageCode);
    if (!normalizedCode) {
        throw businessError('packageCode es requerido');
    }

    const label = await tx.packageLabel.findFirst({
        where: {
            packageCode: normalizedCode,
            status: 'ACTIVE'
        },
        include: getLabelInclude()
    });

    if (!label) {
        throw businessError('Rotulo no encontrado o inactivo', 404);
    }

    if (!recordScan) {
        return {
            duplicate: false,
            packageLabel: labelToDto(label)
        };
    }

    if (!processType || !processId) {
        throw businessError('processType y processId son requeridos para registrar el escaneo');
    }

    try {
        await tx.packageLabelScan.create({
            data: {
                packageLabelId: label.id,
                processType: String(processType),
                processId: String(processId),
                processKey: `${processType}:${processId}`,
                quantity: label.quantity,
                rawPayload: normalizeText(rawPayload),
                scannedById: userId || null
            }
        });

        return {
            duplicate: false,
            packageLabel: labelToDto(label)
        };
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            return {
                duplicate: true,
                packageLabel: labelToDto(label)
            };
        }
        throw error;
    }
};

const voidPackageLabel = async (tx, {
    packageCode
}) => {
    const normalizedCode = normalizeCode(packageCode);
    if (!normalizedCode) {
        throw businessError('packageCode es requerido');
    }

    const label = await tx.packageLabel.findUnique({
        where: { packageCode: normalizedCode },
        include: getLabelInclude()
    });

    if (!label) {
        throw businessError('Rotulo no encontrado', 404);
    }

    const updated = await tx.packageLabel.update({
        where: { id: label.id },
        data: { status: 'VOIDED' },
        include: getLabelInclude()
    });

    return labelToDto(updated);
};

module.exports = {
    MAX_PACKAGE_LABELS_PER_PRINT,
    createPackageLabelsForLot,
    markPackageLabelsPrinted,
    registerIncomingPackageLabel,
    normalizeCode,
    validateAndRecordPackageScan,
    voidPackageLabel
};
