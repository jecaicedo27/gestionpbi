require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
    const stageId = 'ee6a32c5-5c5f-4f68-a1ae-627781ecffd0';
    const targetQty = 12151.4;

    // Formula quantities (what should display)
    const formulaQty = {
        'BASE LIQUIPOPS': 118004,
        'COLOR EN POLVO ROJO PURO 3X ARRIERO': 12.8,
        'SABOR LIQUIDO FRESA DISTRIAROMAS': 127.8,
        'SABOR LIQUIDO FRESA TECNAS': 235.8,
        'PROTONICO': 1775,
    };

    const inputs = await p.assemblyTemplateStageInput.findMany({
        where: { stageId },
        include: { product: true }
    });

    for (const input of inputs) {
        const name = input.product?.name;
        const fqty = formulaQty[name];
        if (fqty !== undefined) {
            // quantityPerUnit = formulaQty / targetQuantity
            // so that quantityPerUnit × targetQuantity = formulaQty
            const newQpu = fqty / targetQty;
            console.log(name + ': qpu ' + input.quantityPerUnit + ' -> ' + newQpu.toFixed(6) + ' (will display as ' + (newQpu * targetQty).toFixed(2) + ')');
            await p.assemblyTemplateStageInput.update({
                where: { id: input.id },
                data: { quantityPerUnit: parseFloat(newQpu.toFixed(6)) }
            });
        }
    }

    // Also need to add CONSERVANTES input to the ensamble stage template if missing
    const conservante = await p.product.findFirst({ where: { name: { contains: 'PREMEZCLA CONSERVANTES' } } });
    if (conservante) {
        const existing = inputs.find(i => i.productId === conservante.id);
        if (!existing) {
            // For 1 unidad: qpu = 1 / targetQty
            const qpu = 1 / targetQty;
            await p.assemblyTemplateStageInput.create({
                data: {
                    stageId,
                    productId: conservante.id,
                    quantityPerUnit: parseFloat(qpu.toFixed(8)),
                    unit: 'unidad',
                    displayOrder: 5
                }
            });
            console.log('Added CONSERVANTES: qpu=' + qpu.toFixed(8));
            // Shift PROTONICO to displayOrder 6
            const protoInput = inputs.find(i => i.product?.name === 'PROTONICO');
            if (protoInput) {
                await p.assemblyTemplateStageInput.update({
                    where: { id: protoInput.id },
                    data: { displayOrder: 6 }
                });
            }
        }
    }

    // Verify
    const updated = await p.assemblyTemplateStageInput.findMany({
        where: { stageId },
        include: { product: true },
        orderBy: { displayOrder: 'asc' }
    });
    console.log('\n=== VERIFIED (will display as qpu × ' + targetQty + ') ===');
    updated.forEach(i => {
        const displayed = i.quantityPerUnit * targetQty;
        console.log(i.displayOrder + '. ' + i.product?.name + ': qpu=' + i.quantityPerUnit + ' -> displays=' + displayed.toFixed(2) + ' ' + i.unit);
    });

    await p.$disconnect();
})();
