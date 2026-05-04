const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const AUX_FLAVORS = ['LAVADO', 'PAUSA ACTIVA', 'MANTENIMIENTO', 'REUNIÓN', 'REUNION', 'CAMBIO DE AGUA'];

async function expandToRawMaterials(productId, quantity, unit, visited = new Set()) {
    if (visited.has(productId)) return [];
    visited.add(productId);

    const product = await prisma.product.findUnique({
        where: { id: productId },
        select: { id: true, name: true, sku: true, unit: true, currentStock: true, productionZoneStock: true }
    });
    if (!product) return [];

    const formula = await prisma.formula.findFirst({
        where: { productId, isActive: true },
        include: { items: { include: { ingredient: { select: { id: true, name: true, sku: true, unit: true } } } } },
        orderBy: { version: 'desc' }
    });

    if (!formula || formula.items.length === 0) {
        return [{ productId: product.id, name: product.name, sku: product.sku, unit: unit || product.unit, quantity }];
    }

    const scaleFactor = formula.baseUnit === 'units'
        ? quantity
        : quantity / formula.baseQuantity;

    const rawMaterials = [];
    for (const item of formula.items) {
        const scaledQty = item.quantity * scaleFactor;
        const children = await expandToRawMaterials(item.ingredientId, scaledQty, item.unit, new Set(visited));
        rawMaterials.push(...children);
    }
    return rawMaterials;
}

exports.forecast = async (req, res) => {
    try {
        const line = req.query.line || 'liquipops';
        const groupName = line === 'geniality' ? 'GENIALITY' : 'LIQUIPOPS';

        const pendingBatches = await prisma.productionBatch.findMany({
            where: {
                status: { notIn: ['COMPLETED', 'FAILED'] },
                flavor: { notIn: AUX_FLAVORS },
                outputTargets: { some: { product: { group: { name: groupName } } } }
            },
            include: {
                outputTargets: { include: { product: { select: { id: true, name: true, sku: true, packSize: true } } } }
            }
        });

        const flavorBatches = {};
        pendingBatches.forEach(b => {
            if (!b.flavor) return;
            if (!flavorBatches[b.flavor]) flavorBatches[b.flavor] = [];
            flavorBatches[b.flavor].push(b);
        });

        const rawTotals = {};

        for (const [flavor, batches] of Object.entries(flavorBatches)) {
            const intermediatePrefix = line === 'geniality' ? 'PROCEGENIALITY' : 'PROCELIQUIPOPS';
            const intermediates = await prisma.product.findMany({
                where: {
                    sku: { startsWith: intermediatePrefix },
                    name: { contains: flavor, mode: 'insensitive' }
                },
                select: { id: true, name: true, sku: true }
            });

            const baseProducts = await prisma.product.findMany({
                where: {
                    sku: { startsWith: intermediatePrefix },
                    name: { in: ['BASE LIQUIPOPS', 'AZUCAR INVERTIDA FRUCTOSA', 'AZUCAR INVERTER GLUCOSA', 'ALGINATO PREPARADO'] }
                },
                select: { id: true, name: true, sku: true }
            });

            const allIntermediates = [...intermediates, ...baseProducts];
            const uniqueIds = new Set();
            const deduped = allIntermediates.filter(p => {
                if (uniqueIds.has(p.id)) return false;
                uniqueIds.add(p.id);
                return true;
            });

            for (const batch of batches) {
                const batchWeightG = (batch.baseWeight || 120) * 1000;

                const compuestoProduct = deduped.find(p => p.name.includes('COMPUESTO'));
                if (compuestoProduct) {
                    const formula = await prisma.formula.findFirst({
                        where: { productId: compuestoProduct.id, isActive: true },
                        select: { baseQuantity: true }
                    });
                    const scale = formula ? batchWeightG / formula.baseQuantity : 1;
                    const raws = await expandToRawMaterials(compuestoProduct.id, batchWeightG, 'gramo');
                    raws.forEach(r => {
                        if (!rawTotals[r.productId]) rawTotals[r.productId] = { ...r, quantity: 0 };
                        rawTotals[r.productId].quantity += r.quantity;
                    });
                }

                const proteccionProduct = deduped.find(p => p.name.includes('PROTECCION'));
                if (proteccionProduct) {
                    const formula = await prisma.formula.findFirst({
                        where: { productId: proteccionProduct.id, isActive: true },
                        select: { baseQuantity: true }
                    });
                    if (formula) {
                        const protWeight = batchWeightG * 0.36;
                        const raws = await expandToRawMaterials(proteccionProduct.id, protWeight, 'gramo');
                        raws.forEach(r => {
                            if (!rawTotals[r.productId]) rawTotals[r.productId] = { ...r, quantity: 0 };
                            rawTotals[r.productId].quantity += r.quantity;
                        });
                    }
                }

                const esferasProduct = deduped.find(p => p.name.includes('ESFERAS'));
                if (esferasProduct) {
                    const formula = await prisma.formula.findFirst({
                        where: { productId: esferasProduct.id, isActive: true },
                        include: { items: { include: { ingredient: { select: { id: true, name: true, sku: true } } } } }
                    });
                    if (formula) {
                        const scale = batchWeightG / (formula.baseQuantity || 150000);
                        for (const item of formula.items) {
                            if (item.ingredient.name.includes('COMPUESTO') || item.ingredient.name.includes('PROTECCION')) continue;
                            const scaledQty = item.quantity * scale;
                            const raws = await expandToRawMaterials(item.ingredientId, scaledQty, item.unit);
                            raws.forEach(r => {
                                if (!rawTotals[r.productId]) rawTotals[r.productId] = { ...r, quantity: 0 };
                                rawTotals[r.productId].quantity += r.quantity;
                            });
                        }
                    }
                }

                // ── Packaging materials per output target (TARROS, TAPAS, ETIQUETAS, SELLOS, LINERS, CAJAS) ──
                for (const target of (batch.outputTargets || [])) {
                    const units = target.plannedUnits || 0;
                    if (units <= 0) continue;
                    const packSize = target.product?.packSize || 1;

                    // Get the assembly template for this final product (last EMPAQUE/ENSAMBLE stage has packaging items)
                    const template = await prisma.assemblyTemplate.findFirst({
                        where: { productId: target.productId },
                        include: {
                            stages: {
                                include: {
                                    inputs: { include: { product: { select: { id: true, name: true, sku: true, unit: true } } } },
                                    processType: { select: { code: true } }
                                }
                            }
                        }
                    });
                    if (!template) continue;

                    // Find packaging stage (Ensamble Siigo of final product) - has packaging materials per UNIT
                    const packagingStages = template.stages.filter(s =>
                        s.processType?.code === 'ENSAMBLE' &&
                        s.inputs.some(i => /TARRO|TAPA|ETIQUETA|SELLO|LINER|CAJA/i.test(i.product?.name || ''))
                    );

                    for (const stage of packagingStages) {
                        for (const inp of stage.inputs) {
                            const name = (inp.product?.name || '').toUpperCase();
                            if (!/TARRO|TAPA|ETIQUETA|SELLO|LINER|CAJA/i.test(name)) continue;
                            // quantityPerUnit is per 1 final unit
                            const totalQty = inp.quantityPerUnit * units;
                            const pid = inp.product.id;
                            if (!rawTotals[pid]) {
                                rawTotals[pid] = {
                                    productId: pid,
                                    name: inp.product.name,
                                    sku: inp.product.sku,
                                    unit: inp.unit || inp.product.unit || 'unidad',
                                    quantity: 0
                                };
                            }
                            rawTotals[pid].quantity += totalQty;
                        }
                    }
                }
            }
        }

        const results = [];
        for (const [pid, data] of Object.entries(rawTotals)) {
            const product = await prisma.product.findUnique({
                where: { id: pid },
                select: { id: true, name: true, sku: true, unit: true, currentStock: true, productionZoneStock: true, warehouses: true }
            });
            if (!product) continue;

            const isIntermediate = product.sku && (product.sku.startsWith('PROCELIQUIPOPS') || product.sku.startsWith('PROCEGENIALITY'));
            if (isIntermediate) continue;

            const isGrams = data.unit === 'gramo' || data.unit === 'g';
            const neededDisplay = isGrams ? Math.round(data.quantity / 1000 * 100) / 100 : Math.round(data.quantity * 100) / 100;
            const unitDisplay = isGrams ? 'kg' : data.unit;

            const siigoStock = (product.warehouses || []).reduce((s, w) => s + (w.quantity || 0), 0);
            const totalStock = siigoStock > 0 ? siigoStock : ((product.currentStock || 0) + (product.productionZoneStock || 0));
            const stockDisplay = isGrams ? Math.round(totalStock / 1000 * 100) / 100 : totalStock;

            const deficit = neededDisplay - stockDisplay;

            results.push({
                productId: product.id,
                name: product.name,
                sku: product.sku,
                needed: neededDisplay,
                stock: stockDisplay,
                deficit: Math.round(deficit * 100) / 100,
                unit: unitDisplay,
                status: deficit > 0 ? 'PEDIR' : 'OK'
            });
        }

        results.sort((a, b) => b.deficit - a.deficit);

        res.json({
            totalBatches: pendingBatches.length,
            totalFlavors: Object.keys(flavorBatches).length,
            materials: results
        });
    } catch (error) {
        console.error('MRP Forecast error:', error);
        res.status(500).json({ error: error.message });
    }
};
