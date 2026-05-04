const { PrismaClient } = require('@prisma/client');
const {
    createPackageLabelsForLot,
    markPackageLabelsPrinted,
    normalizeCode,
    registerIncomingPackageLabel,
    validateAndRecordPackageScan,
    voidPackageLabel
} = require('../services/packageLabelService');
const {
    createProductPackOption: createProductPackOptionService,
    deleteProductPackOption: deleteProductPackOptionService,
    listProductPackOptions,
    updateProductPackOption: updateProductPackOptionService
} = require('../services/productPackOptionService');

const prisma = new PrismaClient();

const FINISHED_GROUPS = new Set(['LIQUIPOPS', 'GENIALITY']);
const FINISHED_PRODUCT_TYPES = new Set(['PERLA_EXPLOSIVA', 'SYRUP', 'BASE_CITRICA']);
const MATERIAL_ZONE_OPTIONS = [
    { value: 'WAREHOUSE', label: 'Bodega principal', description: 'Ingreso físico disponible para almacenamiento general' },
    { value: 'PRODUCTION', label: 'Produccion', description: 'Materia prima liberada para proceso' },
    { value: 'CUARENTENA', label: 'Cuarentena', description: 'Pendiente de revisión o liberación' },
    { value: 'NO_CONFORME', label: 'No conforme', description: 'Separado por novedad o rechazo' },
    { value: 'MAQUILA', label: 'Maquila', description: 'Material reservado o enviado a tercero' }
];
const MATERIAL_ZONE_ALIASES = new Map([
    ['WAREHOUSE', 'WAREHOUSE'],
    ['BODEGA', 'WAREHOUSE'],
    ['PRODUCTION', 'PRODUCTION'],
    ['PRODUCCION', 'PRODUCTION'],
    ['CUARENTENA', 'CUARENTENA'],
    ['NO_CONFORME', 'NO_CONFORME'],
    ['MAQUILA', 'MAQUILA']
]);
const FINISHED_ZONES = new Set(['PRODUCCION', 'PRODUCTO_TERMINADO', 'NO_CONFORME', 'MAQUILA', 'CUARENTENA', 'BODEGA', 'PUBLICIDAD']);
const FINISHED_INGRESS_ZONE_OPTIONS = [
    { value: 'PRODUCCION', label: 'Produccion', description: 'Disponible para alistamiento o consumo inmediato' },
    { value: 'PRODUCTO_TERMINADO', label: 'Producto terminado', description: 'Stock liberado de producto terminado' },
    { value: 'CUARENTENA', label: 'Cuarentena', description: 'Pendiente de revisión o liberación' },
    { value: 'NO_CONFORME', label: 'No conforme', description: 'Separado por novedad o rechazo' },
    { value: 'MAQUILA', label: 'Maquila', description: 'Producto reservado o enviado a tercero' },
    { value: 'PUBLICIDAD', label: 'Publicidad', description: 'Material separado para uso promocional' }
];
const FINISHED_INGRESS_ZONES = new Set(FINISHED_INGRESS_ZONE_OPTIONS.map(option => option.value));

const normalizeText = (value) => {
    if (value == null) return null;
    const clean = String(value).trim();
    return clean || null;
};

const parseOptionalDate = (value) => {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const parsePositiveInt = (value, fieldName = 'quantity') => {
    const numeric = Number.parseInt(value, 10);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        const error = new Error(`${fieldName} debe ser mayor a 0`);
        error.statusCode = 400;
        throw error;
    }
    return numeric;
};

const normalizeMaterialZone = (value) => {
    const normalized = String(value || '').trim().toUpperCase();
    return MATERIAL_ZONE_ALIASES.get(normalized) || 'WAREHOUSE';
};

const normalizeFinishedZone = (value) => {
    const normalized = String(value || '')
        .trim()
        .toUpperCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, '_');

    if (normalized === 'PRODUCTION') return 'PRODUCCION';
    return FINISHED_ZONES.has(normalized) ? normalized : 'PRODUCCION';
};

const normalizeFinishedIngressZone = (value) => {
    const normalized = normalizeFinishedZone(value);
    return FINISHED_INGRESS_ZONES.has(normalized) ? normalized : 'PRODUCTO_TERMINADO';
};

const isFinishedProduct = (product) => {
    const classification = String(product?.classification || '').toUpperCase();
    const groupName = String(product?.group?.name || '').toUpperCase();
    if (classification === 'MATERIA_PRIMA') return false;
    return (
        classification === 'PRODUCTO_TERMINADO' ||
        FINISHED_PRODUCT_TYPES.has(String(product?.type || '').toUpperCase()) ||
        FINISHED_GROUPS.has(groupName)
    );
};

const parseProductWarehouses = (warehouses) => {
    if (!warehouses) return [];

    let parsed = warehouses;
    if (typeof warehouses === 'string') {
        try {
            parsed = JSON.parse(warehouses);
        } catch (_error) {
            return [];
        }
    }

    if (!Array.isArray(parsed)) return [];

    return parsed
        .map((warehouse, index) => ({
            id: warehouse?.id ?? index,
            name: String(warehouse?.name || '').trim(),
            quantity: Number(warehouse?.quantity || 0)
        }))
        .filter(warehouse => warehouse.name)
        .sort((left, right) => {
            const leftUnassigned = left.name.toUpperCase().includes('SIN ASIGNAR');
            const rightUnassigned = right.name.toUpperCase().includes('SIN ASIGNAR');
            if (leftUnassigned && !rightUnassigned) return -1;
            if (!leftUnassigned && rightUnassigned) return 1;
            return right.quantity - left.quantity;
        });
};

const normalizeWarehouseName = (value) => String(value || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');

const getWarehouseQuantityByName = (warehouses, sourceWarehouseName = 'Sin asignar') => {
    const normalizedSource = normalizeWarehouseName(sourceWarehouseName);
    const sourceList = parseProductWarehouses(warehouses);

    return sourceList.reduce((total, warehouse) => {
        const normalizedWarehouse = normalizeWarehouseName(warehouse.name);
        const matches = normalizedSource.includes('SIN ASIGNAR')
            ? normalizedWarehouse.includes('SIN ASIGNAR')
            : normalizedWarehouse === normalizedSource;

        return matches ? total + Number(warehouse.quantity || 0) : total;
    }, 0);
};

const getBulkIngressProductState = async (tx, productIds = [], sourceWarehouseName = 'Sin asignar') => {
    const [products, materialAssigned, finishedAssigned] = await Promise.all([
        tx.product.findMany({
            where: {
                id: { in: productIds },
                active: true
            },
            select: {
                id: true,
                sku: true,
                barcode: true,
                name: true,
                unit: true,
                warehouses: true,
                classification: true,
                type: true,
                accountGroup: true,
                group: { select: { name: true } }
            }
        }),
        tx.materialLot.groupBy({
            by: ['productId'],
            where: {
                productId: { in: productIds },
                currentQuantity: { gt: 0 }
            },
            _sum: { currentQuantity: true }
        }),
        tx.finishedLotStock.groupBy({
            by: ['productId'],
            where: {
                productId: { in: productIds },
                currentQuantity: { gt: 0 }
            },
            _sum: { currentQuantity: true }
        })
    ]);

    const productMap = new Map(products.map(product => [product.id, product]));
    const assignedMap = new Map();

    materialAssigned.forEach(entry => {
        assignedMap.set(
            entry.productId,
            (assignedMap.get(entry.productId) || 0) + Number(entry._sum.currentQuantity || 0)
        );
    });

    finishedAssigned.forEach(entry => {
        assignedMap.set(
            entry.productId,
            (assignedMap.get(entry.productId) || 0) + Number(entry._sum.currentQuantity || 0)
        );
    });

    const availabilityRows = products.map(product => {
        const siigoSourceQuantity = Math.floor(getWarehouseQuantityByName(product.warehouses, sourceWarehouseName));
        const alreadyAssignedQuantity = Math.floor(assignedMap.get(product.id) || 0);
        const availableBefore = Math.max(0, siigoSourceQuantity - alreadyAssignedQuantity);

        return {
            productId: product.id,
            productName: product.name,
            sku: product.sku,
            unit: product.unit || 'und',
            sourceWarehouseName,
            siigoSourceQuantity,
            alreadyAssignedQuantity,
            availableBefore
        };
    });

    const availabilityMap = new Map(availabilityRows.map(row => [row.productId, row]));

    return {
        products,
        productMap,
        assignedMap,
        availabilityRows,
        availabilityMap
    };
};

const isFinishedProductStrict = (product) => {
    const classification = String(product?.classification || '').toUpperCase();
    return classification === 'PRODUCTO_TERMINADO';
};

const resolveBulkIngressZone = (product, requestedZone) => {
    if (isFinishedProductStrict(product)) {
        return normalizeFinishedIngressZone(requestedZone);
    }

    const normalizedFinishedZone = normalizeFinishedZone(requestedZone);
    if (normalizedFinishedZone === 'PRODUCCION') return 'PRODUCTION';
    if (normalizedFinishedZone === 'CUARENTENA') return 'CUARENTENA';
    if (normalizedFinishedZone === 'NO_CONFORME') return 'NO_CONFORME';
    if (normalizedFinishedZone === 'MAQUILA') return 'MAQUILA';
    return 'WAREHOUSE';
};

const deriveExpirationFromLotNumber = (lotNumber) => {
    const cleanLotNumber = String(lotNumber || '').trim().toUpperCase();
    const match = cleanLotNumber.match(/^(\d{2})(\d{2})(\d{2})/);
    if (!match) return null;

    const year = 2000 + Number.parseInt(match[1], 10);
    const month = Number.parseInt(match[2], 10) - 1;
    const day = Number.parseInt(match[3], 10);
    const manufacturingDate = new Date(Date.UTC(year, month, day));

    if (
        manufacturingDate.getUTCFullYear() !== year ||
        manufacturingDate.getUTCMonth() !== month ||
        manufacturingDate.getUTCDate() !== day
    ) {
        return null;
    }

    const expiresAt = new Date(manufacturingDate);
    expiresAt.setUTCFullYear(expiresAt.getUTCFullYear() + 1);
    return expiresAt;
};

const handleControllerError = (res, error) => {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({ error: error.message || 'Error inesperado' });
};

const lotController = {
    /**
     * GET /lots?sku=XXX — list lots for a product (with available balance)
     */
    getLots: async (req, res) => {
        try {
            const { sku, productId, status, zone } = req.query;
            const where = {};
            if (sku) where.siigoProductCode = sku;
            if (productId) where.productId = productId;
            if (zone) where.zone = zone;
            if (status) {
                where.status = { in: status.split(',') };
            } else {
                where.status = { in: ['AVAILABLE', 'LOW_STOCK'] };
            }

            const lots = await prisma.materialLot.findMany({
                where,
                orderBy: [{ expiresAt: 'asc' }, { receivedAt: 'desc' }],
                include: {
                    product: { select: { id: true, name: true, sku: true, unit: true, currentStock: true, warehouses: true, accountGroup: true } },
                    _count: { select: { consumptions: true } }
                }
            });

            res.json(lots);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },

    /**
     * POST /lots — register a new lot manually
     */
    createLot: async (req, res) => {
        try {
            const {
                productId,
                lotNumber,
                quantity,
                unit,
                expiresAt,
                receivedAt,
                zone,
                enforceUnassignedStock = true,
                packageCode = null,
                packOptionId = null
            } = req.body;

            if (!productId || !lotNumber || !quantity) {
                return res.status(400).json({ error: 'productId, lotNumber y quantity son requeridos' });
            }

            const qty = parsePositiveInt(quantity);
            const cleanLotNumber = String(lotNumber).trim().toUpperCase();
            const parsedExpiresAt = parseOptionalDate(expiresAt);
            const parsedReceivedAt = parseOptionalDate(receivedAt);

            if (!parsedExpiresAt) {
                return res.status(400).json({ error: 'expiresAt es requerido y debe ser una fecha valida' });
            }

            const product = await prisma.product.findUnique({
                where: { id: productId },
                select: {
                    id: true,
                    sku: true,
                    name: true,
                    unit: true,
                    type: true,
                    classification: true,
                    currentStock: true,
                    accountGroup: true,
                    group: { select: { name: true } }
                }
            });
            if (!product) return res.status(404).json({ error: 'Producto no encontrado' });

            if (isFinishedProduct(product)) {
                const targetZone = normalizeFinishedIngressZone(zone);
                const { lot: finishedLot, packageLabel } = await prisma.$transaction(async (tx) => {
                    const existing = await tx.finishedLotStock.findFirst({
                        where: { productId, lotNumber: cleanLotNumber, zone: targetZone }
                    });

                    const lot = existing
                        ? await tx.finishedLotStock.update({
                            where: { id: existing.id },
                            data: {
                                initialQuantity: { increment: qty },
                                currentQuantity: { increment: qty },
                                status: 'AVAILABLE',
                                expiresAt: parsedExpiresAt || existing.expiresAt || null
                            },
                            include: { product: { select: { id: true, name: true, sku: true } } }
                        })
                        : await tx.finishedLotStock.create({
                            data: {
                                productId,
                                lotNumber: cleanLotNumber,
                                zone: targetZone,
                                initialQuantity: qty,
                                currentQuantity: qty,
                                status: 'AVAILABLE',
                                expiresAt: parsedExpiresAt
                            },
                            include: { product: { select: { id: true, name: true, sku: true } } }
                        });

                    const incomingPackageLabel = packageCode
                        ? await registerIncomingPackageLabel(tx, {
                            lotId: lot.id,
                            packageCode,
                            quantity: qty,
                            receivedAt: parsedReceivedAt || lot.createdAt,
                            expiresAt: parsedExpiresAt || lot.expiresAt || null,
                            packOptionId,
                            userId: req.user?.id || null
                        })
                        : null;

                    return { lot, packageLabel: incomingPackageLabel };
                });

                return res.status(201).json({
                    ...finishedLot,
                    assignedZone: targetZone,
                    _type: 'FinishedLotStock',
                    packageLabel
                });
            }

            const existingLots = await prisma.materialLot.findMany({
                where: { productId, currentQuantity: { gt: 0 } },
                select: { currentQuantity: true }
            });
            const totalAssigned = existingLots.reduce((sum, l) => sum + l.currentQuantity, 0);
            const siigoStock = product.currentStock || 0;
            const available = Math.max(0, siigoStock - totalAssigned);

            if (qty > available) {
                if (enforceUnassignedStock) {
                    return res.status(400).json({
                        error: `Cantidad excede stock disponible sin asignar. Disponible: ${available}, solicitado: ${qty}`
                    });
                }
                console.warn(`Lote excede stock disponible: ${qty} > ${available} (Siigo: ${siigoStock}, asignado: ${totalAssigned}) - producto: ${product.name}`);
            }

            const targetZone = normalizeMaterialZone(zone);
            const { lot, packageLabel } = await prisma.$transaction(async (tx) => {
                const existing = await tx.materialLot.findFirst({
                    where: {
                        productId,
                        lotNumber: cleanLotNumber,
                        zone: targetZone
                    },
                    orderBy: { receivedAt: 'desc' }
                });

                const materialLot = existing
                    ? await tx.materialLot.update({
                        where: { id: existing.id },
                        data: {
                            initialQuantity: { increment: qty },
                            currentQuantity: { increment: qty },
                            unit: product.unit || unit || existing.unit || 'gramo',
                            receivedAt: parsedReceivedAt || existing.receivedAt,
                            expiresAt: parsedExpiresAt || existing.expiresAt || null,
                            status: 'AVAILABLE'
                        },
                        include: {
                            product: { select: { id: true, name: true, sku: true } }
                        }
                    })
                    : await tx.materialLot.create({
                        data: {
                            productId,
                            siigoProductCode: product.sku,
                            siigoProductName: product.name,
                            lotNumber: cleanLotNumber,
                            initialQuantity: qty,
                            currentQuantity: qty,
                            unit: product.unit || unit || 'gramo',
                            receivedAt: parsedReceivedAt || undefined,
                            expiresAt: parsedExpiresAt,
                            status: 'AVAILABLE',
                            zone: targetZone
                        },
                        include: {
                            product: { select: { id: true, name: true, sku: true } }
                        }
                    });

                const incomingPackageLabel = packageCode
                    ? await registerIncomingPackageLabel(tx, {
                        lotId: materialLot.id,
                        packageCode,
                        quantity: qty,
                        receivedAt: parsedReceivedAt || materialLot.receivedAt,
                        expiresAt: parsedExpiresAt || materialLot.expiresAt || null,
                        packOptionId,
                        userId: req.user?.id || null
                    })
                    : null;

                if (targetZone === 'PRODUCTION') {
                    await tx.product.update({
                        where: { id: productId },
                        data: {
                            currentStock: { decrement: qty },
                            productionZoneStock: { increment: qty }
                        }
                    });

                    await tx.zoneTransfer.create({
                        data: {
                            productId,
                            materialLotId: materialLot.id,
                            direction: 'IN',
                            quantity: qty,
                            unit: product.unit || unit || 'unidad',
                            lotNumber: cleanLotNumber,
                            transferredById: req.user.id,
                            observations: 'Ingreso directo a zona de produccion desde inventario'
                        }
                    });
                }

                return { lot: materialLot, packageLabel: incomingPackageLabel };
            });

            res.status(201).json({ ...lot, assignedZone: targetZone, packageLabel });
        } catch (error) {
            handleControllerError(res, error);
        }
    },

    getProductLotContext: async (req, res) => {
        try {
            const product = await prisma.product.findUnique({
                where: { id: req.params.productId },
                select: {
                    id: true,
                    name: true,
                    sku: true,
                    type: true,
                    classification: true,
                    warehouses: true,
                    group: { select: { name: true } }
                }
            });

            if (!product) {
                return res.status(404).json({ error: 'Producto no encontrado' });
            }

            const finished = isFinishedProduct(product);
            const sourceWarehouses = parseProductWarehouses(product.warehouses);

            return res.json({
                productId: product.id,
                productName: product.name,
                sku: product.sku,
                isFinishedProduct: finished,
                defaultZone: finished ? 'PRODUCCION' : 'WAREHOUSE',
                destinationZones: finished ? FINISHED_INGRESS_ZONE_OPTIONS : MATERIAL_ZONE_OPTIONS,
                sourceWarehouses
            });
        } catch (error) {
            return handleControllerError(res, error);
        }
    },

    getBulkIngressAvailability: async (req, res) => {
        try {
            const rawProductIds = String(req.query.productIds || '');
            const productIds = rawProductIds
                .split(',')
                .map(value => normalizeText(value))
                .filter(Boolean);

            if (productIds.length === 0) {
                return res.json({ products: [] });
            }

            const normalizedSourceWarehouseName = normalizeText(req.query.sourceWarehouseName) || 'Sin asignar';
            const data = await prisma.$transaction((tx) => getBulkIngressProductState(tx, productIds, normalizedSourceWarehouseName));

            return res.json({
                sourceWarehouseName: normalizedSourceWarehouseName,
                products: data.availabilityRows
            });
        } catch (error) {
            return handleControllerError(res, error);
        }
    },

    bulkIngressUnassigned: async (req, res) => {
        try {
            const {
                groupName = null,
                sourceWarehouseName = 'Sin asignar',
                targetZone = 'PRODUCTO_TERMINADO',
                lines = []
            } = req.body || {};

            if (!Array.isArray(lines) || lines.length === 0) {
                return res.status(400).json({ error: 'Debes enviar al menos una linea para registrar.' });
            }

            const normalizedGroupName = normalizeText(groupName)?.toUpperCase() || null;
            const normalizedSourceWarehouseName = normalizeText(sourceWarehouseName) || 'Sin asignar';
            const productIds = [...new Set(lines.map(line => normalizeText(line?.productId)).filter(Boolean))];

            if (productIds.length === 0) {
                return res.status(400).json({ error: 'No se recibieron productos validos para registrar.' });
            }

            const result = await prisma.$transaction(async (tx) => {
                const { productMap, availabilityMap } = await getBulkIngressProductState(
                    tx,
                    productIds,
                    normalizedSourceWarehouseName
                );

                const normalizedLines = lines.map((line, index) => {
                    const productId = normalizeText(line?.productId);
                    const cleanLotNumber = normalizeText(line?.lotNumber)?.toUpperCase();
                    const unitCount = parsePositiveInt(line?.unitCount || line?.units || 1, `lines[${index}].unitCount`);
                    const quantityPerUnit = normalizeText(line?.quantityPerUnit)
                        ? parsePositiveInt(line.quantityPerUnit, `lines[${index}].quantityPerUnit`)
                        : Math.max(1, Math.round(parsePositiveInt(line?.quantity, `lines[${index}].quantity`) / unitCount));
                    const quantity = unitCount * quantityPerUnit;
                    const product = productMap.get(productId);

                    if (!product) {
                        const error = new Error(`El producto de la linea ${index + 1} no existe o no esta activo.`);
                        error.statusCode = 404;
                        throw error;
                    }

                    if (normalizedGroupName) {
                        const productGroupName = String(product.group?.name || '').toUpperCase();
                        if (productGroupName !== normalizedGroupName) {
                            const error = new Error(`El producto ${product.name} no pertenece a ${groupName}.`);
                            error.statusCode = 400;
                            throw error;
                        }
                    }

                    if (!cleanLotNumber) {
                        const error = new Error(`La linea ${index + 1} requiere numero de lote.`);
                        error.statusCode = 400;
                        throw error;
                    }

                    const parsedReceivedAt = parseOptionalDate(line?.receivedAt) || new Date();
                    const parsedExpiresAt = parseOptionalDate(line?.expiresAt) || deriveExpirationFromLotNumber(cleanLotNumber);

                    if (!parsedExpiresAt) {
                        const error = new Error(`La linea ${index + 1} requiere fecha de vencimiento valida o un lote con fecha AAMMDD al inicio.`);
                        error.statusCode = 400;
                        throw error;
                    }

                    return {
                        productId,
                        product,
                        lotNumber: cleanLotNumber,
                        quantity,
                        unitCount,
                        quantityPerUnit,
                        receivedAt: parsedReceivedAt,
                        expiresAt: parsedExpiresAt,
                        zone: resolveBulkIngressZone(product, targetZone)
                    };
                });

                const requestedByProduct = new Map();
                normalizedLines.forEach(line => {
                    requestedByProduct.set(
                        line.productId,
                        (requestedByProduct.get(line.productId) || 0) + line.quantity
                    );
                });

                const comparisons = [];
                requestedByProduct.forEach((plannedQuantity, productId) => {
                    const product = productMap.get(productId);
                    const availability = availabilityMap.get(productId) || {
                        siigoSourceQuantity: 0,
                        alreadyAssignedQuantity: 0,
                        availableBefore: 0
                    };
                    const siigoSourceQuantity = availability.siigoSourceQuantity;
                    const alreadyAssignedQuantity = availability.alreadyAssignedQuantity;
                    const availableBefore = availability.availableBefore;
                    const availableAfter = availableBefore - plannedQuantity;

                    if (plannedQuantity > availableBefore) {
                        const error = new Error(
                            `${product.name} excede el disponible en ${normalizedSourceWarehouseName}. Planeado: ${plannedQuantity}. Disponible real: ${availableBefore}.`
                        );
                        error.statusCode = 400;
                        throw error;
                    }

                    comparisons.push({
                        productId,
                        productName: product.name,
                        sku: product.sku,
                        sourceWarehouseName: normalizedSourceWarehouseName,
                        siigoSourceQuantity,
                        alreadyAssignedQuantity,
                        plannedQuantity,
                        availableBefore,
                        availableAfter,
                        difference: availableAfter
                    });
                });

                const aggregatedLotsMap = new Map();
                normalizedLines.forEach(line => {
                    const key = `${line.productId}::${line.lotNumber}::${line.zone}`;
                    const existing = aggregatedLotsMap.get(key);
                    if (existing) {
                        existing.quantity += line.quantity;
                        existing.unitCount += line.unitCount;
                        existing.receivedAt = existing.receivedAt < line.receivedAt ? existing.receivedAt : line.receivedAt;
                        existing.expiresAt = existing.expiresAt > line.expiresAt ? existing.expiresAt : line.expiresAt;
                    } else {
                        aggregatedLotsMap.set(key, { ...line });
                    }
                });

                const persistedLots = [];
                for (const aggregatedLine of aggregatedLotsMap.values()) {
                    const {
                        product,
                        productId,
                        lotNumber,
                        quantity,
                        unitCount,
                        quantityPerUnit,
                        receivedAt,
                        expiresAt,
                        zone
                    } = aggregatedLine;

                    if (isFinishedProductStrict(product)) {
                        const existingLot = await tx.finishedLotStock.findUnique({
                            where: {
                                productId_lotNumber_zone: {
                                    productId,
                                    lotNumber,
                                    zone
                                }
                            }
                        });

                        const lot = existingLot
                            ? await tx.finishedLotStock.update({
                                where: { id: existingLot.id },
                                data: {
                                    initialQuantity: { increment: quantity },
                                    currentQuantity: { increment: quantity },
                                    status: 'AVAILABLE',
                                    expiresAt
                                }
                            })
                            : await tx.finishedLotStock.create({
                                data: {
                                    productId,
                                    lotNumber,
                                    zone,
                                    initialQuantity: quantity,
                                    currentQuantity: quantity,
                                    expiresAt,
                                    status: 'AVAILABLE'
                                }
                            });

                        persistedLots.push({
                            id: lot.id,
                            productId,
                            productName: product.name,
                            sku: product.sku,
                            lotNumber,
                            quantity,
                            unitCount,
                            quantityPerUnit,
                            unit: product.unit || 'gramo',
                            zone,
                            type: 'FinishedLotStock',
                            receivedAt,
                            expiresAt
                        });
                        continue;
                    }

                    const existingLot = await tx.materialLot.findFirst({
                        where: {
                            productId,
                            lotNumber,
                            zone
                        }
                    });

                    const lot = existingLot
                        ? await tx.materialLot.update({
                            where: { id: existingLot.id },
                            data: {
                                initialQuantity: { increment: quantity },
                                currentQuantity: { increment: quantity },
                                status: 'AVAILABLE',
                                expiresAt,
                                receivedAt
                            }
                        })
                        : await tx.materialLot.create({
                            data: {
                                productId,
                                siigoProductCode: product.sku || '',
                                siigoProductName: product.name || '',
                                lotNumber,
                                initialQuantity: quantity,
                                currentQuantity: quantity,
                                unit: product.unit || 'gramo',
                                zone,
                                receivedAt,
                                expiresAt,
                                status: 'AVAILABLE'
                            }
                        });

                    persistedLots.push({
                        id: lot.id,
                        productId,
                        productName: product.name,
                        sku: product.sku,
                        lotNumber,
                        quantity,
                        unitCount,
                        quantityPerUnit,
                        unit: product.unit || 'gramo',
                        zone,
                        type: 'MaterialLot',
                        receivedAt,
                        expiresAt
                    });
                }

                return {
                    sourceWarehouseName: normalizedSourceWarehouseName,
                    requestedTargetZone: targetZone,
                    totals: {
                        lines: normalizedLines.length,
                        products: requestedByProduct.size,
                        lots: persistedLots.length,
                        units: normalizedLines.reduce((sum, line) => sum + line.unitCount, 0),
                        quantity: normalizedLines.reduce((sum, line) => sum + line.quantity, 0)
                    },
                    comparisons,
                    lots: persistedLots
                };
            });

            return res.status(201).json(result);
        } catch (error) {
            return handleControllerError(res, error);
        }
    },

    getProductPackOptions: async (req, res) => {
        try {
            const data = await prisma.$transaction((tx) => listProductPackOptions(tx, req.params.productId));
            res.json(data);
        } catch (error) {
            handleControllerError(res, error);
        }
    },

    createProductPackOption: async (req, res) => {
        try {
            const packOption = await prisma.$transaction((tx) => createProductPackOptionService(tx, {
                productId: req.params.productId,
                ...req.body
            }));
            res.status(201).json(packOption);
        } catch (error) {
            handleControllerError(res, error);
        }
    },

    updateProductPackOption: async (req, res) => {
        try {
            const packOption = await prisma.$transaction((tx) => updateProductPackOptionService(tx, {
                packOptionId: req.params.packOptionId,
                ...req.body
            }));
            res.json(packOption);
        } catch (error) {
            handleControllerError(res, error);
        }
    },

    deleteProductPackOption: async (req, res) => {
        try {
            const packOption = await prisma.$transaction((tx) => deleteProductPackOptionService(tx, {
                packOptionId: req.params.packOptionId
            }));
            res.json(packOption);
        } catch (error) {
            handleControllerError(res, error);
        }
    },

    preparePackageLabels: async (req, res) => {
        try {
            const result = await prisma.$transaction((tx) => createPackageLabelsForLot(tx, {
                lotId: req.params.id,
                ...req.body,
                userId: req.user?.id || req.body.userId || null
            }));
            res.json(result);
        } catch (error) {
            handleControllerError(res, error);
        }
    },

    markLabelPrinted: async (req, res) => {
        try {
            const result = await prisma.$transaction(async (tx) => {
                const printed = await markPackageLabelsPrinted(tx, {
                    lotId: req.params.id,
                    labelIds: req.body.labelIds || null,
                    userId: req.user?.id || req.body.userId || null
                });

                const printedAt = printed.printedAt || new Date();
                const materialLot = await tx.materialLot.findUnique({ where: { id: req.params.id }, select: { id: true } });
                if (materialLot) {
                    await tx.materialLot.update({
                        where: { id: materialLot.id },
                        data: {
                            labelPrinted: true,
                            labelPrintedAt: printedAt
                        }
                    });
                } else {
                    const finishedLot = await tx.finishedLotStock.findUnique({ where: { id: req.params.id }, select: { id: true } });
                    if (finishedLot) {
                        await tx.finishedLotStock.update({
                            where: { id: finishedLot.id },
                            data: {
                                labelPrinted: true,
                                labelPrintedAt: printedAt
                            }
                        });
                    }
                }

                return printed;
            });

            res.json(result);
        } catch (error) {
            handleControllerError(res, error);
        }
    },

    validatePackageScan: async (req, res) => {
        try {
            const result = await prisma.$transaction((tx) => validateAndRecordPackageScan(tx, {
                packageCode: normalizeCode(req.body.packageCode || req.body.packageId),
                processType: normalizeText(req.body.processType),
                processId: normalizeText(req.body.processId),
                rawPayload: req.body.rawPayload || null,
                userId: req.user?.id || req.body.userId || null,
                recordScan: req.body.recordScan !== false
            }));

            if (result.duplicate) {
                return res.status(409).json(result);
            }

            return res.json(result);
        } catch (error) {
            handleControllerError(res, error);
        }
    },

    voidPackageLabel: async (req, res) => {
        try {
            const result = await prisma.$transaction((tx) => voidPackageLabel(tx, {
                packageCode: req.params.packageCode
            }));
            res.json(result);
        } catch (error) {
            handleControllerError(res, error);
        }
    },


    /**
     * POST /lots/:id/consume — register partial consumption
     */
    consumeLot: async (req, res) => {
        try {
            const { id } = req.params;
            const { quantity, assemblyNoteId, observations } = req.body;
            const userId = req.body.userId || req.user?.id;

            if (!quantity || quantity <= 0) {
                return res.status(400).json({ error: 'quantity debe ser mayor a 0' });
            }
            if (!userId) {
                return res.status(400).json({ error: 'userId es requerido' });
            }

            const lot = await prisma.materialLot.findUnique({ where: { id } });
            if (!lot) return res.status(404).json({ error: 'Lote no encontrado' });
            if (lot.currentQuantity < quantity) {
                return res.status(400).json({
                    error: `Cantidad insuficiente. Disponible: ${lot.currentQuantity}g, solicitado: ${quantity}g`
                });
            }

            const [consumption, updatedLot] = await prisma.$transaction([
                prisma.lotConsumption.create({
                    data: {
                        materialLotId: id,
                        quantityUsed: parseInt(quantity),
                        usedById: userId,
                        assemblyNoteId: assemblyNoteId || null,
                        observations: observations || null
                    }
                }),
                prisma.materialLot.update({
                    where: { id },
                    data: {
                        currentQuantity: { decrement: parseInt(quantity) },
                        status: (lot.currentQuantity - quantity) <= 0 ? 'DEPLETED'
                            : (lot.currentQuantity - quantity) < lot.initialQuantity * 0.1 ? 'LOW_STOCK'
                                : 'AVAILABLE'
                    }
                })
            ]);

            res.json({ consumption, lot: updatedLot });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },

    /**
     * GET /lots/traceability — admin audit panel (consumptions + productions)
     */
    getTraceability: async (req, res) => {
        try {
            const { sku, productId, startDate, endDate, userId, limit, zone } = req.query;
            const maxRows = parseInt(limit) || 200;

            // ── 1. Consumptions (negative) ────────────────────────
            const consumptionWhere = {};
            if (sku) consumptionWhere.materialLot = { siigoProductCode: sku };
            if (productId) consumptionWhere.materialLot = { ...consumptionWhere.materialLot, productId };
            if (userId) consumptionWhere.usedById = userId;
            if (startDate || endDate) {
                consumptionWhere.usedAt = {};
                if (startDate) consumptionWhere.usedAt.gte = new Date(startDate);
                if (endDate) consumptionWhere.usedAt.lte = new Date(endDate + 'T23:59:59');
            }

            const consumptions = await prisma.lotConsumption.findMany({
                where: consumptionWhere,
                orderBy: { usedAt: 'desc' },
                take: maxRows,
                include: {
                    materialLot: {
                        select: {
                            lotNumber: true,
                            siigoProductCode: true,
                            siigoProductName: true,
                            initialQuantity: true,
                            currentQuantity: true,
                            unit: true,
                            zone: true,
                            product: { select: { name: true } }
                        }
                    },
                    usedBy: { select: { id: true, name: true, role: true } }
                }
            });

            // Resolve assembly note info
            const noteIds = [...new Set(consumptions.filter(c => c.assemblyNoteId).map(c => c.assemblyNoteId))];
            const notes = noteIds.length > 0 ? await prisma.assemblyNote.findMany({
                where: { id: { in: noteIds } },
                select: { id: true, noteNumber: true, stageName: true, productionBatch: { select: { batchNumber: true } } }
            }) : [];
            const noteMap = {};
            notes.forEach(n => { noteMap[n.id] = n; });

            const consumptionRows = consumptions.map(c => {
                // Prefer linked product name over raw siigoProductName for display
                const displayName = c.materialLot?.product?.name || c.materialLot?.siigoProductName;
                return {
                    ...c,
                    materialLot: c.materialLot ? { ...c.materialLot, siigoProductName: displayName } : c.materialLot,
                    type: 'CONSUMPTION',
                    date: c.usedAt,
                    quantity: -c.quantityUsed,
                    unit: c.materialLot?.unit || 'gramo',
                    zone: c.materialLot?.zone || null,
                    processInfo: c.assemblyNoteId ? noteMap[c.assemblyNoteId] || null : null
                };
            });

            // ── 2. MaterialLot entries (positive — from production OR PO ingress) ──
            const lotWhere = {};
            if (sku) lotWhere.siigoProductCode = sku;
            if (productId) lotWhere.productId = productId;
            if (startDate || endDate) {
                lotWhere.receivedAt = {};
                if (startDate) lotWhere.receivedAt.gte = new Date(startDate);
                if (endDate) lotWhere.receivedAt.lte = new Date(endDate + 'T23:59:59');
            }
            lotWhere.lotNumber = { not: '' };

            const materialLots = await prisma.materialLot.findMany({
                where: lotWhere,
                orderBy: { receivedAt: 'desc' },
                take: maxRows,
                select: {
                    id: true,
                    lotNumber: true,
                    siigoProductCode: true,
                    siigoProductName: true,
                    initialQuantity: true,
                    currentQuantity: true,
                    unit: true,
                    zone: true,
                    receivedAt: true,
                    purchaseOrderItemId: true,
                    purchaseOrderItem: {
                        select: {
                            purchaseOrder: {
                                select: { orderNumber: true, supplierName: true }
                            }
                        }
                    },
                    product: { select: { id: true, name: true } }
                }
            });

            const lotRows = materialLots.map(p => {
                const isPO = !!p.purchaseOrderItemId;
                const poInfo = p.purchaseOrderItem?.purchaseOrder;
                // Lots always originate in WAREHOUSE (PO or manual). Only production-output lots start in PRODUCTION.
                const originZone = isPO ? 'WAREHOUSE' : (p.zone || 'PRODUCTION');
                return {
                    id: `${isPO ? 'ingress' : 'prod'}-${p.id}`,
                    type: isPO ? 'INGRESS' : 'PRODUCTION',
                    date: p.receivedAt,
                    quantity: p.initialQuantity,
                    unit: p.unit || 'gramo',
                    zone: originZone,
                    materialLot: {
                        id: p.id,
                        lotNumber: p.lotNumber,
                        siigoProductCode: p.siigoProductCode,
                        siigoProductName: p.siigoProductName,
                        initialQuantity: p.initialQuantity,
                        currentQuantity: p.currentQuantity,
                        unit: p.unit,
                        zone: p.zone
                    },
                    materialLotId: p.id,
                    usedBy: null,
                    processInfo: isPO ? { stageName: `OC ${poInfo?.orderNumber || ''}`, productionBatch: null } : null,
                    observations: isPO ? `Compra — ${poInfo?.supplierName || 'Proveedor'}` : 'Producción'
                };
            });

            // ── 3. Zone Transfers (bidirectional — each transfer creates egress + ingress) ──
            const ztWhere = {};
            if (productId) ztWhere.productId = productId;
            if (sku) ztWhere.materialLot = { siigoProductCode: sku };
            if (startDate || endDate) {
                ztWhere.createdAt = {};
                if (startDate) ztWhere.createdAt.gte = new Date(startDate);
                if (endDate) ztWhere.createdAt.lte = new Date(endDate + 'T23:59:59');
            }

            const zoneTransfers = await prisma.zoneTransfer.findMany({
                where: ztWhere,
                orderBy: { createdAt: 'desc' },
                take: maxRows,
                include: {
                    materialLot: {
                        select: {
                            id: true,
                            lotNumber: true,
                            siigoProductCode: true,
                            siigoProductName: true,
                            initialQuantity: true,
                            currentQuantity: true,
                            unit: true,
                            zone: true
                        }
                    },
                    transferredBy: { select: { id: true, name: true, role: true } }
                }
            });

            const transferRows = [];
            zoneTransfers.forEach(zt => {
                // direction: IN = bodega→producción, OUT = producción→bodega
                const fromZone = zt.direction === 'IN' ? 'WAREHOUSE' : 'PRODUCTION';
                const toZone = zt.direction === 'IN' ? 'PRODUCTION' : 'WAREHOUSE';
                const lotData = zt.materialLot ? {
                    id: zt.materialLot.id,
                    lotNumber: zt.materialLot.lotNumber,
                    siigoProductCode: zt.materialLot.siigoProductCode,
                    siigoProductName: zt.materialLot.siigoProductName,
                    initialQuantity: zt.materialLot.initialQuantity,
                    currentQuantity: zt.materialLot.currentQuantity,
                    unit: zt.materialLot.unit,
                    zone: zt.materialLot.zone
                } : null;

                const destLot = zt.materialLot ? materialLots.find(l => 
                    l.siigoProductCode === zt.materialLot.siigoProductCode && 
                    l.lotNumber === zt.materialLot.lotNumber && 
                    l.zone === toZone
                ) : null;

                const destLotData = destLot ? {
                    id: destLot.id,
                    lotNumber: destLot.lotNumber,
                    siigoProductCode: destLot.siigoProductCode,
                    siigoProductName: destLot.siigoProductName,
                    initialQuantity: destLot.initialQuantity,
                    currentQuantity: destLot.currentQuantity,
                    unit: destLot.unit,
                    zone: toZone
                } : (zt.materialLot ? { ...lotData, currentQuantity: 0, zone: toZone } : null);

                // Row 1: EGRESS from source zone
                transferRows.push({
                    id: `zt-out-${zt.id}`,
                    type: 'TRANSFER_OUT',
                    date: zt.createdAt,
                    quantity: -zt.quantity,
                    unit: zt.unit || 'gramo',
                    zone: fromZone,
                    materialLot: lotData,
                    materialLotId: zt.materialLotId,
                    usedBy: zt.transferredBy,
                    processInfo: null,
                    observations: `Traslado → ${toZone === 'PRODUCTION' ? 'Producción' : 'Bodega'}`
                });
                // Row 2: INGRESS to destination zone
                transferRows.push({
                    id: `zt-in-${zt.id}`,
                    type: 'TRANSFER_IN',
                    date: zt.createdAt,
                    quantity: zt.quantity,
                    unit: zt.unit || 'gramo',
                    zone: toZone,
                    materialLot: destLotData || lotData,
                    materialLotId: destLot ? destLot.id : zt.materialLotId,
                    usedBy: zt.transferredBy,
                    processInfo: null,
                    observations: `Traslado ← ${fromZone === 'WAREHOUSE' ? 'Bodega' : 'Producción'}`
                });
            });

            // ── 4. FinishedLotTransfer (finished product zone transfers: PROD→PT, PROD→NC) ──
            const fltWhere = {};
            if (startDate || endDate) {
                fltWhere.createdAt = {};
                if (startDate) fltWhere.createdAt.gte = new Date(startDate);
                if (endDate) fltWhere.createdAt.lte = new Date(endDate + 'T23:59:59');
            }

            const finishedTransfers = await prisma.finishedLotTransfer.findMany({
                where: fltWhere,
                orderBy: { createdAt: 'desc' },
                take: maxRows,
                include: {
                    product: { select: { id: true, name: true, sku: true, unit: true } },
                    transferredBy: { select: { id: true, name: true, role: true } },
                },
            });

            const finishedTransferRows = [];
            if (finishedTransfers.length > 0) {
                // Query actual current stock in PRODUCCION for accurate "remaining" display
                const fltProductIds = [...new Set(finishedTransfers.filter(ft => ft.fromZone !== ft.toZone).map(ft => ft.productId))];
                const fltLotNumbers = [...new Set(finishedTransfers.filter(ft => ft.fromZone !== ft.toZone).map(ft => ft.lotNumber))];
                const currentStocks = fltProductIds.length > 0 ? await prisma.finishedLotStock.findMany({
                    where: { productId: { in: fltProductIds }, lotNumber: { in: fltLotNumbers }, zone: 'PRODUCCION' },
                    select: { productId: true, lotNumber: true, currentQuantity: true, initialQuantity: true },
                }) : [];
                const stockMap = {};
                currentStocks.forEach(s => { stockMap[`${s.productId}_${s.lotNumber}`] = s; });

                finishedTransfers.forEach(ft => {
                    if (ft.fromZone === ft.toZone) return; // skip ingestion records
                    const prodName = ft.product?.name || '';
                    const stockKey = `${ft.productId}_${ft.lotNumber}`;
                    const actualStock = stockMap[stockKey];
                    const lotData = {
                        id: `flt-${ft.id}`,
                        lotNumber: ft.lotNumber,
                        siigoProductCode: ft.product?.sku || '',
                        siigoProductName: prodName,
                        initialQuantity: actualStock?.initialQuantity ?? ft.quantity,
                        currentQuantity: actualStock?.currentQuantity ?? 0,
                        unit: ft.product?.unit || 'unidad',
                        zone: 'PRODUCTION',
                    };
                    const zoneName = (z) => z === 'PRODUCCION' ? 'Producción' : z === 'PRODUCTO_TERMINADO' ? 'Producto Terminado' : z === 'NO_CONFORME' ? 'No Conforme' : z === 'BODEGA' ? 'Bodega' : z === 'CUARENTENA' ? 'Cuarentena' : z === 'MAQUILA' ? 'Maquila' : z;
                    // Egress from source zone
                    finishedTransferRows.push({
                        id: `flt-out-${ft.id}`,
                        type: 'TRANSFER_OUT',
                        date: ft.createdAt,
                        quantity: -ft.quantity,
                        unit: ft.product?.unit || 'unidad',
                        zone: 'PRODUCTION',
                        materialLot: lotData,
                        materialLotId: `flt-${ft.id}`,
                        usedBy: ft.transferredBy,
                        processInfo: null,
                        observations: `${zoneName(ft.fromZone)} → ${zoneName(ft.toZone)}`,
                    });
                    // Ingress to destination zone
                    finishedTransferRows.push({
                        id: `flt-in-${ft.id}`,
                        type: 'TRANSFER_IN',
                        date: ft.createdAt,
                        quantity: ft.quantity,
                        unit: ft.product?.unit || 'unidad',
                        zone: ft.toZone === 'PRODUCTO_TERMINADO' ? 'WAREHOUSE' : 'PRODUCTION',
                        materialLot: lotData,
                        materialLotId: `flt-${ft.id}`,
                        usedBy: ft.transferredBy,
                        processInfo: null,
                        observations: `${zoneName(ft.fromZone)} → ${zoneName(ft.toZone)}`,
                    });
                });
            }

            // ── 5. Merge & sort by date desc ──
            let all = [...consumptionRows, ...lotRows, ...transferRows, ...finishedTransferRows]
                .sort((a, b) => new Date(b.date) - new Date(a.date));

            // ── 5. Optional zone filter (BEFORE slice to avoid losing older entries) ──
            if (zone) {
                all = all.filter(r => r.zone === zone);
            }
            all = all.slice(0, maxRows);

            res.json(all);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },

    /**
     * GET /lots/:id/history — consumption history for a specific lot
     */
    getLotHistory: async (req, res) => {
        try {
            const { id } = req.params;
            // Try MaterialLot first
            const lot = await prisma.materialLot.findUnique({
                where: { id },
                include: {
                    product: { select: { id: true, name: true, sku: true } },
                    consumptions: {
                        orderBy: { usedAt: 'desc' },
                        include: {
                            usedBy: { select: { id: true, name: true } }
                        }
                    }
                }
            });
            if (lot) return res.json(lot);

            // Fallback: try FinishedLotStock (from finished zone)
            const fls = await prisma.finishedLotStock.findUnique({
                where: { id },
                include: {
                    product: { select: { id: true, name: true, sku: true } },
                    transfers: {
                        orderBy: { createdAt: 'desc' },
                        include: {
                            transferredBy: { select: { id: true, name: true } }
                        }
                    }
                }
            });
            if (!fls) return res.status(404).json({ error: 'Lote no encontrado' });

            // Map transfers to same shape as consumptions for frontend compatibility
            const consumptions = fls.transfers.map(t => ({
                id: t.id,
                quantityUsed: t.quantity,
                usedAt: t.createdAt,
                usedBy: t.transferredBy,
                observations: `${t.fromZone} → ${t.toZone}${t.reason ? ': ' + t.reason : ''}`,
            }));
            res.json({ ...fls, consumptions });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },

    /**
     * DELETE /lots/:id — delete a lot (only if no consumptions)
     */
    deleteLot: async (req, res) => {
        try {
            const { id } = req.params;
            // Try MaterialLot first
            const lot = await prisma.materialLot.findUnique({
                where: { id },
                include: { _count: { select: { consumptions: true, zoneTransfers: true } } }
            });
            if (lot) {
                if (lot._count.consumptions > 0) {
                    return res.status(400).json({ error: 'No se puede eliminar un lote con consumos registrados' });
                }
                if (lot._count.zoneTransfers > 0) {
                    return res.status(400).json({ error: 'No se puede eliminar un lote con transferencias registradas' });
                }
                await prisma.materialLot.delete({ where: { id } });
                return res.json({ success: true });
            }

            // Fallback: try FinishedLotStock
            const fls = await prisma.finishedLotStock.findUnique({
                where: { id },
                include: { _count: { select: { transfers: true } } }
            });
            if (!fls) return res.status(404).json({ error: 'Lote no encontrado' });
            if (fls._count.transfers > 0) {
                return res.status(400).json({ error: 'No se puede eliminar un lote con transferencias registradas' });
            }
            await prisma.finishedLotStock.delete({ where: { id } });
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },

    /**
     * GET /lots/stock-by-zone — aggregated stock per product per zone
     */
    getStockByZone: async (req, res) => {
        try {
            const { search } = req.query;

            // Get all lots with stock, grouped by zone + product
            const lotWhere = {
                currentQuantity: { gt: 0 },
                status: { in: ['AVAILABLE', 'LOW_STOCK'] }
            };

            const lots = await prisma.materialLot.findMany({
                where: lotWhere,
                select: {
                    id: true,
                    lotNumber: true,
                    currentQuantity: true,
                    initialQuantity: true,
                    unit: true,
                    zone: true,
                    status: true,
                    receivedAt: true,
                    expiresAt: true,
                    productId: true,
                    siigoProductName: true,
                    product: { select: { id: true, name: true, sku: true, unit: true } }
                },
                orderBy: { receivedAt: 'desc' }
            });

            // Get last consumption per product (for "last activity")
            const lastConsumptions = await prisma.$queryRaw`
                SELECT ml."productId", MAX(lc."usedAt") as last_consumed, ml.zone
                FROM lot_consumptions lc
                JOIN material_lots ml ON ml.id = lc."materialLotId"
                GROUP BY ml."productId", ml.zone`;
            const lastConsumedMap = {};
            lastConsumptions.forEach(r => {
                const key = `${r.productId}_${r.zone}`;
                lastConsumedMap[key] = r.last_consumed;
            });

            // Group by zone → product
            const grouped = {};
            for (const lot of lots) {
                const zone = lot.zone || 'WAREHOUSE';
                const pid = lot.productId || `unlinked_${lot.id}`;
                const key = `${zone}_${pid}`;
                const isUnlinked = !lot.productId;

                if (!grouped[key]) {
                    grouped[key] = {
                        zone,
                        productId: lot.productId || null,
                        productName: lot.product?.name || lot.siigoProductName || '(Sin producto)',
                        sku: lot.product?.sku || '',
                        unit: lot.unit || lot.product?.unit || 'gramo',
                        totalStock: 0,
                        lotCount: 0,
                        unlinked: isUnlinked,
                        lots: [],
                        lastReceived: null,
                        lastConsumed: lastConsumedMap[`${lot.productId}_${zone}`] || null
                    };
                }

                grouped[key].totalStock += lot.currentQuantity;
                grouped[key].lotCount++;
                grouped[key].lots.push({
                    id: lot.id,
                    lotNumber: lot.lotNumber,
                    currentQuantity: lot.currentQuantity,
                    initialQuantity: lot.initialQuantity,
                    siigoProductName: lot.siigoProductName || '',
                    status: lot.status,
                    receivedAt: lot.receivedAt,
                    expiresAt: lot.expiresAt
                });
                if (!grouped[key].lastReceived || lot.receivedAt > grouped[key].lastReceived) {
                    grouped[key].lastReceived = lot.receivedAt;
                }
            }

            // Convert to arrays per zone
            let allItems = Object.values(grouped);

            // Apply search filter
            if (search) {
                const s = search.toLowerCase();
                allItems = allItems.filter(i =>
                    i.productName.toLowerCase().includes(s) ||
                    i.sku?.toLowerCase().includes(s) ||
                    i.lots.some(l => l.lotNumber?.toLowerCase().includes(s) || l.siigoProductName?.toLowerCase().includes(s))
                );
            }

            // Sort by product name within each zone
            allItems.sort((a, b) => a.productName.localeCompare(b.productName));

            const result = {
                WAREHOUSE: allItems.filter(i => i.zone === 'WAREHOUSE'),
                PRODUCTION: allItems.filter(i => i.zone === 'PRODUCTION')
            };

            res.json(result);
        } catch (error) {
            console.error('getStockByZone error:', error.message);
            res.status(500).json({ error: error.message });
        }
    },

    /**
     * PATCH /lots/:id/link — link an orphaned lot to a product
     */
    linkLot: async (req, res) => {
        try {
            const { id } = req.params;
            const { productId } = req.body;
            if (!productId) return res.status(400).json({ error: 'productId es requerido' });

            const lot = await prisma.materialLot.findUnique({ where: { id } });
            if (!lot) return res.status(404).json({ error: 'Lote no encontrado' });

            const product = await prisma.product.findUnique({ where: { id: productId }, select: { id: true, name: true, sku: true } });
            if (!product) return res.status(404).json({ error: 'Producto no encontrado' });

            const updated = await prisma.materialLot.update({
                where: { id },
                data: {
                    productId,
                    siigoProductCode: product.sku || lot.siigoProductCode,
                    siigoProductName: product.name || lot.siigoProductName
                }
            });

            res.json({ success: true, lot: updated });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },

    /**
     * GET /lots/products-without-lots — products with stock but no active lots
     */
    getProductsWithoutLots: async (req, res) => {
        try {
            const { search } = req.query;

            const where = {
                currentStock: { gt: 0 },
                active: true
            };
            if (search) {
                where.OR = [
                    { name: { contains: search, mode: 'insensitive' } },
                    { sku: { contains: search, mode: 'insensitive' } }
                ];
            }

            const products = await prisma.product.findMany({
                where,
                select: {
                    id: true,
                    name: true,
                    sku: true,
                    type: true,
                    currentStock: true,
                    unit: true,
                    group: { select: { id: true, name: true } },
                    materialLots: {
                        where: { currentQuantity: { gt: 0 }, status: { in: ['AVAILABLE', 'LOW_STOCK'] } },
                        select: { id: true, currentQuantity: true }
                    }
                },
                orderBy: { name: 'asc' }
            });

            // Include products with NO lots OR with unassigned stock (siigo > sum of lots)
            const result = products
                .map(p => {
                    const assignedStock = p.materialLots.reduce((sum, l) => sum + l.currentQuantity, 0);
                    const unassigned = p.currentStock - assignedStock;
                    return {
                        id: p.id,
                        name: p.name,
                        sku: p.sku,
                        type: p.type,
                        groupId: p.group?.id || null,
                        groupName: p.group?.name || 'Sin Grupo',
                        siigoStock: p.currentStock,
                        assignedStock,
                        unassignedStock: Math.max(0, unassigned),
                        activeLots: p.materialLots.length,
                        unit: p.unit,
                        status: p.materialLots.length === 0 ? 'sin_lotes' : 'parcial'
                    };
                })
                .filter(p => p.activeLots === 0 || p.unassignedStock > 0);

            res.json(result);
        } catch (error) {
            console.error('getProductsWithoutLots error:', error.message);
            res.status(500).json({ error: error.message });
        }
    },

    async transferZone(req, res) {
        try {
            const { lotId, lotType, targetZone, quantity, fefoOverride } = req.body;
            if (!lotId || !targetZone || !quantity || quantity <= 0) {
                return res.status(400).json({ error: 'lotId, targetZone y quantity son requeridos' });
            }

            const isMaterial = lotType === 'MaterialLot';

            const result = await prisma.$transaction(async (tx) => {
                if (isMaterial) {
                    const lot = await tx.materialLot.findUnique({ where: { id: lotId } });
                    if (!lot) throw new Error('Lote no encontrado');
                    if (lot.currentQuantity < quantity) throw new Error(`Cantidad insuficiente. Disponible: ${lot.currentQuantity}`);
                    if (lot.zone === targetZone) throw new Error('La zona destino es igual a la actual');

                    // ── FEFO GUARD: bodega → producción ──
                    // Solo el lote con la fecha de vencimiento más temprana puede pasar a producción.
                    // Lotes sin fecha de vencimiento están bloqueados. Admin puede pasar fefoOverride=true.
                    if (lot.zone === 'WAREHOUSE' && targetZone === 'PRODUCTION') {
                        const isAdmin = req.user?.role === 'ADMIN';
                        const overrideActive = isAdmin && fefoOverride === true;

                        if (!overrideActive) {
                            if (!lot.expiresAt) {
                                throw new Error('Este lote no tiene fecha de vencimiento registrada. Edite el lote y registre la fecha antes de pasarlo a Producción.');
                            }
                            const candidates = await tx.materialLot.findMany({
                                where: {
                                    productId: lot.productId,
                                    zone: 'WAREHOUSE',
                                    currentQuantity: { gt: 0 },
                                    expiresAt: { not: null }
                                },
                                orderBy: { expiresAt: 'asc' }
                            });
                            if (candidates.length > 0) {
                                const earliestDay = new Date(candidates[0].expiresAt);
                                earliestDay.setHours(0, 0, 0, 0);
                                const lotDay = new Date(lot.expiresAt);
                                lotDay.setHours(0, 0, 0, 0);
                                if (lotDay.getTime() !== earliestDay.getTime()) {
                                    const earliestLot = candidates[0];
                                    const expStr = earliestDay.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
                                    throw new Error(`FEFO: Debe pasar primero a Producción el lote ${earliestLot.lotNumber} (vence ${expStr}).`);
                                }
                            }
                        }
                    }

                    const sourceZone = lot.zone;
                    const roundedQty = Math.round(quantity);

                    if (roundedQty >= lot.currentQuantity) {
                        const existing = await tx.materialLot.findFirst({
                            where: { lotNumber: lot.lotNumber, productId: lot.productId, zone: targetZone, currentQuantity: { gt: 0 } }
                        });
                        if (existing) {
                            await tx.materialLot.update({ where: { id: existing.id }, data: { currentQuantity: { increment: lot.currentQuantity } } });
                            await tx.materialLot.update({ where: { id: lotId }, data: { currentQuantity: 0, status: 'DEPLETED' } });
                        } else {
                            await tx.materialLot.update({ where: { id: lotId }, data: { zone: targetZone } });
                        }
                    } else {
                        await tx.materialLot.update({ where: { id: lotId }, data: { currentQuantity: lot.currentQuantity - roundedQty } });
                        const existing = await tx.materialLot.findFirst({
                            where: { lotNumber: lot.lotNumber, productId: lot.productId, zone: targetZone, currentQuantity: { gt: 0 } }
                        });
                        if (existing) {
                            await tx.materialLot.update({ where: { id: existing.id }, data: { currentQuantity: { increment: roundedQty } } });
                        } else {
                            await tx.materialLot.create({
                                data: {
                                    productId: lot.productId,
                                    siigoProductCode: lot.siigoProductCode,
                                    siigoProductName: lot.siigoProductName,
                                    lotNumber: lot.lotNumber,
                                    initialQuantity: roundedQty,
                                    currentQuantity: roundedQty,
                                    unit: lot.unit,
                                    receivedAt: lot.receivedAt,
                                    expiresAt: lot.expiresAt,
                                    status: 'AVAILABLE',
                                    zone: targetZone,
                                    purchaseOrderItemId: lot.purchaseOrderItemId,
                                }
                            });
                        }
                    }

                    if (lot.productId) {
                        const stockUpdates = {};
                        if (sourceZone === 'WAREHOUSE' && targetZone === 'PRODUCTION') {
                            stockUpdates.currentStock = { decrement: roundedQty };
                            stockUpdates.productionZoneStock = { increment: roundedQty };
                        } else if (sourceZone === 'PRODUCTION' && targetZone === 'WAREHOUSE') {
                            stockUpdates.currentStock = { increment: roundedQty };
                            stockUpdates.productionZoneStock = { decrement: roundedQty };
                        }
                        if (Object.keys(stockUpdates).length > 0) {
                            await tx.product.update({ where: { id: lot.productId }, data: stockUpdates });
                        }

                        await tx.zoneTransfer.create({
                            data: {
                                productId: lot.productId,
                                materialLotId: lotId,
                                direction: targetZone === 'PRODUCTION' ? 'IN' : 'OUT',
                                quantity: roundedQty,
                                unit: lot.unit || 'gramo',
                                lotNumber: lot.lotNumber,
                                transferredById: req.user.id,
                                observations: `Transferencia de ${sourceZone} a ${targetZone}`,
                            }
                        });
                    }

                    return { lotNumber: lot.lotNumber, from: sourceZone, to: targetZone, quantity: roundedQty };
                } else {
                    const lot = await tx.finishedLotStock.findUnique({ where: { id: lotId } });
                    if (!lot) throw new Error('Lote PT no encontrado');
                    if (lot.currentQuantity < quantity) throw new Error(`Cantidad insuficiente. Disponible: ${lot.currentQuantity}`);
                    if (lot.zone === targetZone) throw new Error('La zona destino es igual a la actual');

                    const sourceZone = lot.zone;
                    const roundedQty = Math.round(quantity);

                    let survivingLotId = lotId;

                    if (roundedQty >= lot.currentQuantity) {
                        const existing = await tx.finishedLotStock.findUnique({
                            where: { productId_lotNumber_zone: { productId: lot.productId, lotNumber: lot.lotNumber, zone: targetZone } }
                        });
                        if (existing) {
                            await tx.finishedLotStock.update({ where: { id: existing.id }, data: { currentQuantity: { increment: lot.currentQuantity } } });
                            await tx.finishedLotStock.delete({ where: { id: lotId } });
                            survivingLotId = existing.id;
                        } else {
                            await tx.finishedLotStock.update({ where: { id: lotId }, data: { zone: targetZone } });
                        }
                    } else {
                        await tx.finishedLotStock.update({ where: { id: lotId }, data: { currentQuantity: lot.currentQuantity - roundedQty } });
                        const existing = await tx.finishedLotStock.findUnique({
                            where: { productId_lotNumber_zone: { productId: lot.productId, lotNumber: lot.lotNumber, zone: targetZone } }
                        });
                        if (existing) {
                            await tx.finishedLotStock.update({ where: { id: existing.id }, data: { currentQuantity: { increment: roundedQty } } });
                        } else {
                            await tx.finishedLotStock.create({
                                data: {
                                    productId: lot.productId,
                                    lotNumber: lot.lotNumber,
                                    initialQuantity: roundedQty,
                                    currentQuantity: roundedQty,
                                    zone: targetZone,
                                    batchId: lot.batchId,
                                }
                            });
                        }
                    }

                    if (lot.productId) {
                        await tx.finishedLotTransfer.create({
                            data: {
                                finishedLotStockId: survivingLotId,
                                productId: lot.productId,
                                lotNumber: lot.lotNumber,
                                fromZone: sourceZone,
                                toZone: targetZone,
                                quantity: roundedQty,
                                transferredById: req.user.id,
                                observations: `Transferencia de ${sourceZone} a ${targetZone}`,
                            }
                        });
                    }

                    return { lotNumber: lot.lotNumber, from: sourceZone, to: targetZone, quantity: roundedQty };
                }
            });

            console.log(`📦 Lot Transfer: ${result.quantity} × ${result.lotNumber} from ${result.from} → ${result.to}`);
            res.json(result);
        } catch (error) {
            console.error('transferZone error:', error.message);
            res.status(400).json({ error: error.message });
        }
    }
};

module.exports = lotController;
