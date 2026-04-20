const PACK_CONTAINER_LABELS = {
    BULTO: 'Bulto',
    CAJA: 'Caja',
    CANECA: 'Caneca',
    ENVASE: 'Envase',
    SACO: 'Saco',
    BOLSA: 'Bolsa',
    TAMBOR: 'Tambor',
    GARRAFA: 'Garrafa'
};

const GRAM_UNITS = new Set(['gramo', 'gramos', 'g']);
const ML_UNITS = new Set(['mililitro', 'mililitros', 'ml']);

const businessError = (message, statusCode = 400) => {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
};

const normalizePositiveInt = (value, fieldName = 'quantity', max = null) => {
    const numeric = Number.parseInt(value, 10);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        throw businessError(`${fieldName} debe ser un entero positivo`);
    }
    if (max && numeric > max) {
        throw businessError(`${fieldName} no puede ser mayor a ${max}`);
    }
    return numeric;
};

const normalizeContainerType = (value) => {
    if (value == null || value === '') return null;
    const normalized = String(value).trim().toUpperCase();
    if (!PACK_CONTAINER_LABELS[normalized]) {
        throw businessError('containerType no es valido');
    }
    return normalized;
};

const formatPackQuantity = (quantity, unit = 'gramo') => {
    const numeric = Number(quantity) || 0;
    const normalizedUnit = String(unit || 'gramo').trim().toLowerCase();
    const formatter = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 });

    if (GRAM_UNITS.has(normalizedUnit)) {
        if (numeric >= 1000) return `${formatter.format(numeric / 1000)} kg`;
        return `${formatter.format(numeric)} g`;
    }

    if (ML_UNITS.has(normalizedUnit)) {
        if (numeric >= 1000) return `${formatter.format(numeric / 1000)} L`;
        return `${formatter.format(numeric)} ml`;
    }

    if (normalizedUnit === 'unidad' || normalizedUnit === 'unidades' || normalizedUnit === 'und') {
        return `${formatter.format(numeric)} und`;
    }

    return `${formatter.format(numeric)} ${unit}`;
};

const formatPackLabel = (quantity, unit = 'gramo', containerType = null) => {
    const container = normalizeContainerType(containerType);
    const quantityLabel = formatPackQuantity(quantity, unit);
    if (container) return `${PACK_CONTAINER_LABELS[container]} ${quantityLabel}`;
    return `Pack ${quantityLabel}`;
};

const normalizePackLabel = (label, quantity, unit, containerType) => {
    const clean = String(label || '').trim();
    if (clean) return clean;
    return formatPackLabel(quantity, unit, containerType);
};

const findProductOrThrow = async (tx, productId) => {
    const product = await tx.product.findUnique({
        where: { id: productId },
        select: {
            id: true,
            name: true,
            sku: true,
            unit: true,
            packSize: true
        }
    });

    if (!product) {
        throw businessError('Producto no encontrado', 404);
    }

    return product;
};

const ensureSingleDefaultOption = async (tx, productId, selectedId) => {
    await tx.productPackOption.updateMany({
        where: {
            productId,
            NOT: { id: selectedId }
        },
        data: { isDefault: false }
    });
};

const getPackOptionUsage = async (tx, productId) => {
    const [usageRows, activeRows] = await Promise.all([
        tx.packageLabel.groupBy({
            by: ['packOptionId'],
            where: {
                productId,
                packOptionId: { not: null }
            },
            _count: { _all: true },
            _sum: { quantity: true }
        }),
        tx.packageLabel.groupBy({
            by: ['packOptionId'],
            where: {
                productId,
                packOptionId: { not: null },
                status: 'ACTIVE'
            },
            _count: { _all: true },
            _sum: { quantity: true }
        })
    ]);

    const usageMap = new Map();
    for (const row of usageRows) {
        if (!row.packOptionId) continue;
        usageMap.set(row.packOptionId, {
            usageCount: row._count?._all || 0,
            usageQuantity: row._sum?.quantity || 0,
            activeCount: 0,
            activeQuantity: 0
        });
    }

    for (const row of activeRows) {
        if (!row.packOptionId) continue;
        const current = usageMap.get(row.packOptionId) || {
            usageCount: 0,
            usageQuantity: 0,
            activeCount: 0,
            activeQuantity: 0
        };
        usageMap.set(row.packOptionId, {
            ...current,
            activeCount: row._count?._all || 0,
            activeQuantity: row._sum?.quantity || 0
        });
    }

    return usageMap;
};

const decoratePackOption = (option, usageMap, recommendedOptionId) => {
    const usage = usageMap.get(option.id) || {
        usageCount: 0,
        usageQuantity: 0,
        activeCount: 0,
        activeQuantity: 0
    };
    return {
        ...option,
        usageCount: usage.usageCount,
        usageQuantity: usage.usageQuantity,
        activeCount: usage.activeCount,
        activeQuantity: usage.activeQuantity,
        isMostUsed: option.id === recommendedOptionId
    };
};

const findRecommendedOptionId = (options, usageMap) => {
    const activeOptions = options.filter(option => option.active !== false);
    if (activeOptions.length === 0) return null;

    let recommended = activeOptions.find(option => option.isDefault) || activeOptions[0];
    let bestUsage = usageMap.get(recommended.id)?.usageCount || 0;

    for (const option of activeOptions) {
        const usageCount = usageMap.get(option.id)?.usageCount || 0;
        if (usageCount > bestUsage) {
            recommended = option;
            bestUsage = usageCount;
        }
    }

    return recommended?.id || null;
};

const listProductPackOptions = async (tx, productId) => {
    await findProductOrThrow(tx, productId);

    const options = await tx.productPackOption.findMany({
        where: { productId },
        orderBy: [
            { isDefault: 'desc' },
            { active: 'desc' },
            { sortOrder: 'asc' },
            { quantity: 'asc' },
            { label: 'asc' }
        ]
    });

    const usageMap = await getPackOptionUsage(tx, productId);
    const recommendedOptionId = findRecommendedOptionId(options, usageMap);

    return {
        productId,
        recommendedOptionId,
        options: options
            .filter(option => option.active !== false)
            .map(option => decoratePackOption(option, usageMap, recommendedOptionId))
    };
};

const upsertDefaultProductPackOption = async (tx, {
    productId,
    quantity,
    unit = null,
    label = null,
    containerType = null,
    updateProductPackSize = true
}) => {
    const product = await findProductOrThrow(tx, productId);
    const normalizedQuantity = normalizePositiveInt(quantity, 'packSize');
    const normalizedUnit = unit || product.unit || 'gramo';
    const normalizedContainerType = normalizeContainerType(containerType);
    const resolvedLabel = normalizePackLabel(label, normalizedQuantity, normalizedUnit, normalizedContainerType);

    let option = await tx.productPackOption.findFirst({
        where: {
            productId,
            quantity: normalizedQuantity,
            unit: normalizedUnit,
            containerType: normalizedContainerType,
            active: true
        },
        orderBy: [{ isDefault: 'desc' }, { sortOrder: 'asc' }]
    });

    if (option) {
        option = await tx.productPackOption.update({
            where: { id: option.id },
            data: {
                label: resolvedLabel,
                isDefault: true,
                active: true,
                containerType: normalizedContainerType
            }
        });
    } else {
        const existingByLabel = await tx.productPackOption.findUnique({
            where: {
                productId_label: {
                    productId,
                    label: resolvedLabel
                }
            }
        });

        if (existingByLabel) {
            option = await tx.productPackOption.update({
                where: { id: existingByLabel.id },
                data: {
                    quantity: normalizedQuantity,
                    unit: normalizedUnit,
                    containerType: normalizedContainerType,
                    isDefault: true,
                    active: true
                }
            });
        } else {
            option = await tx.productPackOption.create({
                data: {
                    productId,
                    label: resolvedLabel,
                    quantity: normalizedQuantity,
                    unit: normalizedUnit,
                    containerType: normalizedContainerType,
                    isDefault: true,
                    active: true
                }
            });
        }
    }

    await ensureSingleDefaultOption(tx, productId, option.id);

    if (updateProductPackSize) {
        await tx.product.update({
            where: { id: productId },
            data: { packSize: normalizedQuantity }
        });
    }

    return option;
};

const createProductPackOption = async (tx, {
    productId,
    label = null,
    quantity,
    unit = null,
    containerType = null,
    isDefault = false,
    sortOrder = 0
}) => {
    const product = await findProductOrThrow(tx, productId);
    const normalizedQuantity = normalizePositiveInt(quantity, 'quantity');
    const normalizedUnit = unit || product.unit || 'gramo';
    const normalizedContainerType = normalizeContainerType(containerType);
    const resolvedLabel = normalizePackLabel(label, normalizedQuantity, normalizedUnit, normalizedContainerType);

    const existing = await tx.productPackOption.findUnique({
        where: {
            productId_label: {
                productId,
                label: resolvedLabel
            }
        }
    });

    let option;
    if (existing) {
        option = await tx.productPackOption.update({
            where: { id: existing.id },
            data: {
                quantity: normalizedQuantity,
                unit: normalizedUnit,
                containerType: normalizedContainerType,
                sortOrder: Number.parseInt(sortOrder, 10) || 0,
                active: true,
                isDefault: Boolean(isDefault)
            }
        });
    } else {
        if (isDefault) {
            await tx.productPackOption.updateMany({
                where: { productId, isDefault: true, active: true },
                data: { isDefault: false }
            });
        }
        option = await tx.productPackOption.create({
            data: {
                productId,
                label: resolvedLabel,
                quantity: normalizedQuantity,
                unit: normalizedUnit,
                containerType: normalizedContainerType,
                sortOrder: Number.parseInt(sortOrder, 10) || 0,
                isDefault: Boolean(isDefault),
                active: true
            }
        });
    }

    if (option.isDefault) {
        await ensureSingleDefaultOption(tx, productId, option.id);
        await tx.product.update({
            where: { id: productId },
            data: { packSize: option.quantity }
        });
    }

    return option;
};

const updateProductPackOption = async (tx, {
    packOptionId,
    label,
    quantity,
    unit,
    containerType,
    isDefault,
    sortOrder,
    active
}) => {
    const existing = await tx.productPackOption.findUnique({
        where: { id: packOptionId },
        include: {
            product: {
                select: { id: true, unit: true }
            }
        }
    });

    if (!existing) {
        throw businessError('Pack option no encontrado', 404);
    }

    const nextQuantity = quantity !== undefined
        ? normalizePositiveInt(quantity, 'quantity')
        : existing.quantity;
    const nextUnit = unit || existing.unit || existing.product?.unit || 'gramo';
    const nextContainerType = containerType !== undefined
        ? normalizeContainerType(containerType)
        : existing.containerType;
    const nextLabel = normalizePackLabel(
        label !== undefined ? label : existing.label,
        nextQuantity,
        nextUnit,
        nextContainerType
    );
    const nextDefault = isDefault !== undefined ? Boolean(isDefault) : existing.isDefault;
    const nextActive = active !== undefined ? Boolean(active) : existing.active;

    const updated = await tx.productPackOption.update({
        where: { id: packOptionId },
        data: {
            label: nextLabel,
            quantity: nextQuantity,
            unit: nextUnit,
            containerType: nextContainerType,
            isDefault: nextDefault,
            active: nextActive,
            sortOrder: sortOrder !== undefined ? Number.parseInt(sortOrder, 10) || 0 : existing.sortOrder
        }
    });

    if (updated.isDefault) {
        await ensureSingleDefaultOption(tx, updated.productId, updated.id);
        await tx.product.update({
            where: { id: updated.productId },
            data: { packSize: updated.quantity }
        });
    }

    return updated;
};

const deleteProductPackOption = async (tx, { packOptionId }) => {
    const existing = await tx.productPackOption.findUnique({
        where: { id: packOptionId }
    });

    if (!existing) {
        throw businessError('Pack option no encontrado', 404);
    }

    const deleted = await tx.productPackOption.update({
        where: { id: packOptionId },
        data: {
            active: false,
            isDefault: false
        }
    });

    if (existing.isDefault) {
        const fallback = await tx.productPackOption.findFirst({
            where: {
                productId: existing.productId,
                active: true,
                NOT: { id: existing.id }
            },
            orderBy: [{ sortOrder: 'asc' }, { quantity: 'asc' }]
        });

        if (fallback) {
            await tx.productPackOption.update({
                where: { id: fallback.id },
                data: { isDefault: true }
            });
            await ensureSingleDefaultOption(tx, existing.productId, fallback.id);
        }
    }

    return deleted;
};

const resolvePackOptionForLabel = async (tx, {
    productId,
    packOptionId = null,
    packLabel = null,
    packUnitQuantity = null,
    quantityPerPackage = null,
    unit = null,
    containerType = null
}) => {
    const product = await findProductOrThrow(tx, productId);
    const normalizedUnit = unit || product.unit || 'gramo';

    if (packOptionId) {
        const packOption = await tx.productPackOption.findFirst({
            where: {
                id: packOptionId,
                productId,
                active: true
            }
        });

        if (!packOption) {
            throw businessError('Pack option no encontrado para este producto', 404);
        }

        return packOption;
    }

    const rawQuantity = packUnitQuantity || quantityPerPackage;
    if (!rawQuantity) return null;

    const normalizedQuantity = normalizePositiveInt(rawQuantity, 'packUnitQuantity');
    const normalizedContainerType = normalizeContainerType(containerType);

    const existing = await tx.productPackOption.findFirst({
        where: {
            productId,
            quantity: normalizedQuantity,
            unit: normalizedUnit,
            containerType: normalizedContainerType,
            active: true
        },
        orderBy: [{ isDefault: 'desc' }, { sortOrder: 'asc' }]
    });

    if (existing) return existing;

    return {
        id: null,
        productId,
        label: normalizePackLabel(packLabel, normalizedQuantity, normalizedUnit, normalizedContainerType),
        quantity: normalizedQuantity,
        unit: normalizedUnit,
        containerType: normalizedContainerType
    };
};

module.exports = {
    PACK_CONTAINER_LABELS,
    createProductPackOption,
    deleteProductPackOption,
    formatPackLabel,
    formatPackQuantity,
    listProductPackOptions,
    normalizeContainerType,
    resolvePackOptionForLabel,
    updateProductPackOption,
    upsertDefaultProductPackOption
};
