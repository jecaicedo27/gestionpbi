const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const parseSize = (name, density = 1.0) => {
    const regex = /X\s*(\d+)\s*(ML|GR|G|L|KG)/i;
    const match = name.match(regex);
    if (!match) return { value: 0, unit: 'N/A', kgFactor: 0 };
    let value = parseFloat(match[1]);
    const unit = match[2].toUpperCase();
    let kgFactor = 0;
    if (unit === 'ML') kgFactor = (value * density) / 1000;
    else if (unit === 'GR' || unit === 'G') kgFactor = value / 1000;
    else if (unit === 'L' || unit === 'KG') kgFactor = value;
    return { value, unit, kgFactor: Math.round(kgFactor * 10000) / 10000 };
};

const DENSITY = 1.0;
const SYRUP_RATIO = 0.70;
const TARGET_WEIGHT = 120;

async function run() {
    let corrected = 0;
    try {
        const batches = await prisma.productionBatch.findMany({
            where: {
                status: 'PENDING',
                baseWeight: 120
            },
            include: {
                outputTargets: {
                   include: { product: true }
                }
            }
        });

        console.log(`Found ${batches.length} pending 120kg batches to audit.`);

        for (const b of batches) {
            let currentSyrupUsed = 0;
            const mixData = [];

            // Compute current syrup used
            for (const t of b.outputTargets) {
                const sizeInfo = parseSize(t.product.name, DENSITY);
                const kgFactor = sizeInfo.kgFactor || 0;
                const syrup = t.plannedUnits * kgFactor * SYRUP_RATIO;
                currentSyrupUsed += syrup;

                mixData.push({
                    targetId: t.id,
                    productId: t.product.id,
                    name: t.product.name,
                    plannedUnits: t.plannedUnits,
                    kgFactor: kgFactor,
                    is350: t.product.name.includes('350') || t.product.name.includes('360')
                });
            }

            // Apply adjustment ONLY if deviation is > 1.5 kg to avoid churn on perfectly okay batches
            if (Math.abs(currentSyrupUsed - TARGET_WEIGHT) > 1.5 && mixData.length > 0) {
                console.log(`\nBatch ${b.batchNumber}: Current Syrup: ${currentSyrupUsed.toFixed(2)}kg (Needs correction)`);
                let diff = TARGET_WEIGHT - currentSyrupUsed;
                
                mixData.sort((x, y) => x.kgFactor - y.kgFactor);

                let iterations = 0;
                while (Math.abs(diff) > 0.05 && iterations < 1000) {
                    iterations++;
                    if (diff > 0) {
                        const tgt = mixData.find(m => (m.kgFactor * SYRUP_RATIO) <= diff + 0.05);
                        if (tgt) {
                            tgt.plannedUnits += 1;
                            diff -= (tgt.kgFactor * SYRUP_RATIO);
                        } else break;
                    } else {
                        const sortedDesc = [...mixData].sort((x,y) => y.kgFactor - x.kgFactor);
                        const tgt = sortedDesc.find(m => m.plannedUnits > 1 && (m.kgFactor * SYRUP_RATIO) <= Math.abs(diff) + 0.05);
                        if (tgt) {
                            tgt.plannedUnits -= 1;
                            diff += (tgt.kgFactor * SYRUP_RATIO);
                        } else {
                            const fallback = mixData.find(m => m.plannedUnits > 1);
                            if (fallback) {
                                fallback.plannedUnits -= 1;
                                diff += (fallback.kgFactor * SYRUP_RATIO);
                            } else break;
                        }
                    }
                }

                // Verify what we got
                let finalSyrup = 0;
                let projectedProductW = 0;
                for (const m of mixData) {
                    finalSyrup += (m.plannedUnits * m.kgFactor * SYRUP_RATIO);
                    projectedProductW += (m.plannedUnits * m.kgFactor);
                }
                
                console.log(` --> Adjusted to ${finalSyrup.toFixed(2)}kg syrup. Updating DB...`);

                // Update DB
                await prisma.$transaction(async (tx) => {
                    for (const m of mixData) {
                        await tx.batchOutputTarget.update({
                            where: { id: m.targetId },
                            data: {
                                plannedUnits: m.plannedUnits,
                                plannedWeightKg: Math.round(m.plannedUnits * m.kgFactor * 100) / 100
                            }
                        });
                    }
                    await tx.productionBatch.update({
                        where: { id: b.id },
                        data: {
                            projectedTotalWeight: Math.round(projectedProductW * 100) / 100
                        }
                    });
                });
                corrected++;
            }
        }
        console.log(`\nSuccessfully corrected ${corrected} batches!`);

    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}
run();
