const assert = require('assert');

let notes = [
  { processType: { code: 'CONTEO' }, processParameters: { conteo: { 'A': { actual: 46 }, 'B': { actual: 73 } } } },
  { processType: { code: 'EMPAQUE' }, productId: 'A', targetQuantity: 46, processParameters: { empaque: { defective: 2 } } },
  { processType: { code: 'EMPAQUE' }, productId: 'B', targetQuantity: 73, processParameters: { empaque: { defective: 3 } } }
];

let unitsPlanned = 0, unitsActual = 0, totalDefective = 0;
const actualsByProduct = {};

for (const n of notes) {
    if (n.processType?.code === 'CONTEO' && n.processParameters?.conteo) {
        for (const [prodId, data] of Object.entries(n.processParameters.conteo)) {
            actualsByProduct[prodId] = data.actual || 0;
            // Planned is handled by output targets anyway, let's just use it
            unitsPlanned += data.planned || 0;
        }
    }
    if (n.processType?.code === 'EMPAQUE') {
        const emp = n.processParameters?.empaque || {};
        totalDefective += emp.defective_qty || emp.defective || 0;
        if (n.productId) {
            actualsByProduct[n.productId] = n.targetQuantity || 0;
        }
    }
}

unitsActual = Object.values(actualsByProduct).reduce((a, b) => a + b, 0);

console.log({ unitsActual, totalDefective });
