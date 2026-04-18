const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const RECOVERY_TAG = 'RECOVERY_20260416_GENIALITY';

const norm = (value) => (value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .toUpperCase();

const slug = (value) => norm(value)
  .replace(/[^A-Z0-9]+/g, '-')
  .replace(/^-|-$/g, '');

const processTypes = [
  { code: 'G_PESAJE', name: '(G) Pesaje Geniality', category: 'PREPARACION', icon: 'scale', color: '#2563eb' },
  { code: 'G_MEZCLADO', name: '(G) Mezclado Geniality', category: 'PREPARACION', icon: 'mix', color: '#0f766e' },
  { code: 'G_EMPAQUE', name: '(G) Empaque Geniality', category: 'TRANSFORMATION', icon: 'package', color: '#7c3aed' },
  { code: 'G_ENSAMBLE', name: '(G) Ensamble Siigo Geniality', category: 'TRANSFORMATION', icon: 'file', color: '#16a34a' },
  { code: 'GE_PREMIX', name: '(GE) Premix Seco', category: 'PREPARACION', icon: 'premix', color: '#d97706' },
  { code: 'GE_BASE_LIQUIDA', name: '(GE) Base Liquida + Incorporacion', category: 'PREPARACION', icon: 'water', color: '#0891b2' },
  { code: 'GE_COCCION', name: '(GE) Coccion y Enfriamiento', category: 'COCCION', icon: 'temp', color: '#dc2626' },
];

const knownSaborizacionYields = {
  MARACUYA: 102758,
  SANDIA: 101755,
  TAMARINDO: 103290,
  CEREZA: 100938,
  CURAZAO: 103096,
};

const baseSiropeFormula = {
  baseQuantity: 100014,
  items: [
    { name: 'AGUA', quantity: 49368, unit: 'gramo', ingredientType: 'RAW_MATERIAL' },
    { name: 'AZUCAR', quantity: 45632, unit: 'gramo', ingredientType: 'RAW_MATERIAL' },
    { name: 'AZUCAR', quantity: 5000, unit: 'gramo', ingredientType: 'RAW_MATERIAL', notes: 'Recuperado desde backend/fix_tmpl064.js' },
    { name: 'ANTIESPUMANTE TECNAS', quantity: 14, unit: 'gramo', ingredientType: 'RAW_MATERIAL' },
  ],
};

const baseEscarchadorItems = [
  { name: 'ALMIDON POLTEC GEL CREAM', quantity: 800, unit: 'gramo', ingredientType: 'RAW_MATERIAL' },
  { name: 'ALMIDON POLTEC GEL THIN', quantity: 600, unit: 'gramo', ingredientType: 'RAW_MATERIAL' },
  { name: 'GOMA XHANTAN', quantity: 260, unit: 'gramo', ingredientType: 'RAW_MATERIAL' },
  { name: 'AZUCAR', quantity: 7000, unit: 'gramo', ingredientType: 'RAW_MATERIAL' },
  { name: 'SUCRALOSA', quantity: 20, unit: 'gramo', ingredientType: 'RAW_MATERIAL' },
  { name: 'AZUCAR INVERTIDA FRUCTOSA', quantity: 85000, unit: 'gramo', ingredientType: 'RAW_MATERIAL' },
  { name: 'AGUA', quantity: 7800, unit: 'gramo', ingredientType: 'RAW_MATERIAL' },
  { name: 'SORBATO DE POTACIO', quantity: 43, unit: 'gramo', ingredientType: 'RAW_MATERIAL' },
];

function getFormulaCodeForSirope(product) {
  if (product.sku === 'GENP15') return 'FORM-ESC-360';
  if (product.sku === 'GENG15') return 'FORM-ESC-1000';
  return `GFORM-${product.sku}`;
}

function extractSiropeInfo(productName) {
  const match = productName.match(/SIROPE GENIALITY SABOR A (.+?) X\s*(\d+)\s*ML/i);
  if (!match) return null;
  return { flavor: match[1].replace(/\s+/g, ' ').trim(), size: match[2] };
}

async function findProductByName(tx, name, options = {}) {
  const select = { id: true, sku: true, name: true, active: true, accountGroup: true, unit: true };
  let candidates = await tx.product.findMany({
    where: { name: { contains: name, mode: 'insensitive' } },
    select,
  });
  const target = norm(name);
  let exact = candidates
    .filter((product) => norm(product.name) === target)
    .sort((a, b) => Number(b.active) - Number(a.active))[0];
  if (!exact) {
    const prefix = target.split(' ')[0];
    candidates = await tx.product.findMany({
      where: { name: { startsWith: prefix, mode: 'insensitive' } },
      select,
    });
    exact = candidates
      .filter((product) => norm(product.name) === target)
      .sort((a, b) => Number(b.active) - Number(a.active))[0];
  }
  if (exact) return exact;
  if (options.optional) return null;
  throw new Error(`Producto no encontrado: ${name}`);
}

async function findPackagingProducts(tx) {
  return {
    caja1000: await findProductByName(tx, 'CAJA CARTON C-790 (JARABE X1000ML)'),
    caja360: await findProductByName(tx, 'CAJA CARTON C-790 3,4 (6 UNIDADES)'),
    tarro1000: await findProductByName(tx, 'TARRO CORBATIN GENIALITY 1000 ML'),
    tapa1000: await findProductByName(tx, 'TAPA CORBATIN GENIALITY 1000 ML'),
    foil1000: await findProductByName(tx, 'FOIL TARRO 1000 ML'),
    tarro360: await findProductByName(tx, 'TARRO GENIALITY 360 ML'),
    tapa360: await findProductByName(tx, 'TAPA GENIALITY 360 ML'),
    foil360: await findProductByName(tx, 'FOIL TARRO GENIALITY 360 ML'),
  };
}

async function findLabel(tx, flavor, size, escarchador = false) {
  const labels = await tx.product.findMany({
    where: { name: { contains: 'ETIQUETA GENIALITY', mode: 'insensitive' } },
    select: { id: true, sku: true, name: true, active: true, accountGroup: true, unit: true },
  });
  const flavorNorm = norm(flavor);
  const sizeNorm = String(size);
  const scored = labels
    .filter((product) => {
      const name = norm(product.name);
      if (!name.includes(sizeNorm)) return false;
      if (escarchador) return name.includes('ESCARCHADOR');
      return name.includes(flavorNorm);
    })
    .sort((a, b) => Number(b.active) - Number(a.active) || Number(b.accountGroup === 1409) - Number(a.accountGroup === 1409));

  if (scored[0]) return scored[0];
  throw new Error(`Etiqueta no encontrada para ${flavor} ${size}ml`);
}

async function createFormula(tx, summary, definition) {
  const existing = await tx.formula.findUnique({ where: { formulaCode: definition.formulaCode } });
  if (existing) {
    summary.formulasSkipped.push(definition.formulaCode);
    return existing;
  }

  const latest = await tx.formula.findFirst({
    where: { productId: definition.productId },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  const version = (latest?.version || 0) + 1;
  const total = definition.items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);

  const formula = await tx.formula.create({
    data: {
      formulaCode: definition.formulaCode,
      formulaName: definition.formulaName,
      productId: definition.productId,
      version,
      isActive: definition.isActive ?? true,
      baseUnit: definition.baseUnit || 'gramo',
      baseQuantity: definition.baseQuantity || 1,
      expectedYieldPercentage: definition.expectedYieldPercentage || 100,
      description: definition.description,
      notes: [RECOVERY_TAG, definition.notes].filter(Boolean).join(' | '),
      items: {
        create: definition.items.map((item, index) => ({
          ingredientId: item.ingredientId,
          ingredientType: item.ingredientType || 'RAW_MATERIAL',
          quantity: item.quantity,
          unit: item.unit || 'gramo',
          percentage: total > 0 ? (item.quantity / total) * 100 : null,
          additionOrder: index + 1,
          notes: item.notes || null,
        })),
      },
    },
  });

  summary.formulasCreated.push(definition.formulaCode);
  return formula;
}

async function createTemplate(tx, summary, definition) {
  const existing = await tx.assemblyTemplate.findUnique({ where: { templateCode: definition.templateCode } });
  if (existing) {
    summary.templatesSkipped.push(definition.templateCode);
    return existing;
  }

  const latest = await tx.assemblyTemplate.findFirst({
    where: { productId: definition.productId },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  const version = (latest?.version || 0) + 1;

  const template = await tx.assemblyTemplate.create({
    data: {
      templateCode: definition.templateCode,
      templateName: definition.templateName,
      productId: definition.productId,
      version,
      isActive: definition.isActive ?? true,
      description: [RECOVERY_TAG, definition.description].filter(Boolean).join(' | '),
      totalStages: definition.stages.length,
      stages: {
        create: definition.stages.map((stage, stageIndex) => ({
          stageOrder: stageIndex + 1,
          stageName: stage.stageName,
          processTypeId: stage.processTypeId,
          processParameters: stage.processParameters || {},
          outputProductId: stage.outputProductId || null,
          outputClassification: stage.outputClassification || null,
          subTemplateId: stage.subTemplateId || null,
          specialInstructions: stage.specialInstructions || null,
          inputs: {
            create: (stage.inputs || []).map((input, inputIndex) => ({
              inputType: input.inputType || input.ingredientType || 'RAW_MATERIAL',
              productId: input.productId,
              quantityPerUnit: input.quantity,
              unit: input.unit || 'gramo',
              displayOrder: inputIndex + 1,
              aggregateOnRepeat: input.aggregateOnRepeat || false,
            })),
          },
        })),
      },
    },
  });

  summary.templatesCreated.push(definition.templateCode);
  return template;
}

async function buildItem(tx, item) {
  if (item.ingredientId) return item;
  const product = await findProductByName(tx, item.name);
  return {
    ...item,
    ingredientId: product.id,
  };
}

async function buildItems(tx, items) {
  const built = [];
  for (const item of items) built.push(await buildItem(tx, item));
  return built;
}

function formulaItemsToTemplateInputs(items) {
  return items.map((item) => ({
    productId: item.ingredientId,
    ingredientType: item.ingredientType || 'RAW_MATERIAL',
    quantity: item.quantity,
    unit: item.unit,
  }));
}

async function createProcessTypes(tx, summary) {
  for (const processType of processTypes) {
    const existing = await tx.processType.findUnique({ where: { code: processType.code } });
    if (existing) {
      summary.processTypesSkipped.push(processType.code);
      continue;
    }
    await tx.processType.create({ data: { ...processType, active: true } });
    summary.processTypesCreated.push(processType.code);
  }
}

async function main() {
  const summary = {
    processTypesCreated: [],
    processTypesSkipped: [],
    formulasCreated: [],
    formulasSkipped: [],
    templatesCreated: [],
    templatesSkipped: [],
    partialRecoveries: [],
    warnings: [],
  };

  await prisma.$transaction(async (tx) => {
    await createProcessTypes(tx, summary);

    const ptRows = await tx.processType.findMany({
      where: { code: { in: ['PESAJE', 'CONTEO', 'G_PESAJE', 'G_EMPAQUE', 'G_ENSAMBLE', 'GE_PREMIX', 'GE_BASE_LIQUIDA', 'GE_COCCION'] } },
      select: { id: true, code: true },
    });
    const pt = Object.fromEntries(ptRows.map((row) => [row.code, row.id]));
    for (const required of ['CONTEO', 'G_PESAJE', 'G_EMPAQUE', 'G_ENSAMBLE', 'GE_PREMIX', 'GE_BASE_LIQUIDA', 'GE_COCCION']) {
      if (!pt[required]) throw new Error(`ProcessType requerido no disponible: ${required}`);
    }

    const packaging = await findPackagingProducts(tx);
    const baseSirope = await findProductByName(tx, 'BASE SIROPE CLASICA');
    const baseEscarchador = await findProductByName(tx, 'BASE ESCARCHADOR');
    const batchGeniality = await findProductByName(tx, 'BATCH GENIALITY');
    const batchEscarchador = await findProductByName(tx, 'BATCH ESCARCHADOR');

    const baseSiropeItems = await buildItems(tx, baseSiropeFormula.items);
    await createFormula(tx, summary, {
      formulaCode: 'GFORM-BASE-SIROPE',
      formulaName: 'Base Sirope Clasica (recuperada)',
      productId: baseSirope.id,
      baseUnit: 'gramo',
      baseQuantity: baseSiropeFormula.baseQuantity,
      description: 'Formula recuperada desde logs PM2 y backend/fix_tmpl064.js.',
      notes: 'Confianza media-alta: baseQuantity=100014 y max AZUCAR=45632 confirmados por logs.',
      items: baseSiropeItems,
    });

    const baseEscarchadorBuiltItems = await buildItems(tx, baseEscarchadorItems);
    await createFormula(tx, summary, {
      formulaCode: 'FORM135',
      formulaName: 'Base Escarchador (recuperada)',
      productId: baseEscarchador.id,
      baseUnit: 'gramo',
      baseQuantity: baseEscarchadorBuiltItems.reduce((sum, item) => sum + item.quantity, 0),
      description: 'Formula reconstruida desde backend/src/scripts/createEscarchadoTemplate.js.',
      notes: 'Confianza alta por script local y candidato forense.',
      items: baseEscarchadorBuiltItems,
    });

    await createTemplate(tx, summary, {
      templateCode: 'TMPL064',
      templateName: 'BASE SIROPE CLASICA',
      productId: baseSirope.id,
      description: 'Subplantilla recuperada para BATCH-GENIALITY.',
      stages: [
        {
          stageName: 'Pesaje de BASE SIROPE CLASICA',
          processTypeId: pt.G_PESAJE,
          outputProductId: baseSirope.id,
          processParameters: { recovery: RECOVERY_TAG, confidence: 'media_alta' },
          inputs: formulaItemsToTemplateInputs(baseSiropeItems),
        },
        {
          stageName: '(G) Ensamble Final de BASE SIROPE CLASICA',
          processTypeId: pt.G_ENSAMBLE,
          outputProductId: baseSirope.id,
          outputClassification: 'SEMI_FINISHED',
          processParameters: { recovery: RECOVERY_TAG },
          inputs: formulaItemsToTemplateInputs(baseSiropeItems),
        },
      ],
    });

    await createTemplate(tx, summary, {
      templateCode: 'TMPL101',
      templateName: 'BASE ESCARCHADOR',
      productId: baseEscarchador.id,
      description: 'Subplantilla recuperada para BATCH-ESCARCHADOR.',
      stages: [
        {
          stageName: 'Premix Seco - Escarchado',
          processTypeId: pt.GE_PREMIX,
          processParameters: { recovery: RECOVERY_TAG },
          inputs: formulaItemsToTemplateInputs(baseEscarchadorBuiltItems.slice(0, 5)),
        },
        {
          stageName: 'Base Liquida + Incorporacion - Escarchado',
          processTypeId: pt.GE_BASE_LIQUIDA,
          processParameters: { recovery: RECOVERY_TAG, time_minutes: 20 },
          inputs: formulaItemsToTemplateInputs(baseEscarchadorBuiltItems.slice(5, 7)),
        },
        {
          stageName: 'Coccion y Enfriamiento - Escarchado',
          processTypeId: pt.GE_COCCION,
          outputProductId: baseEscarchador.id,
          processParameters: {
            recovery: RECOVERY_TAG,
            checkpoints: [
              { temp: 65, label: 'Calentamiento', action: null },
              { temp: 45, label: 'Primer Enfriamiento', action: 'Agregar sorbato de potasio' },
              { temp: 40, label: 'Enfriamiento Final', action: null },
            ],
          },
          inputs: formulaItemsToTemplateInputs(baseEscarchadorBuiltItems.slice(7)),
        },
        {
          stageName: '(G) Ensamble Final de BASE ESCARCHADOR',
          processTypeId: pt.G_ENSAMBLE,
          outputProductId: baseEscarchador.id,
          outputClassification: 'SEMI_FINISHED',
          processParameters: { recovery: RECOVERY_TAG },
          inputs: formulaItemsToTemplateInputs(baseEscarchadorBuiltItems),
        },
      ],
    });

    await createTemplate(tx, summary, {
      templateCode: 'GTPL-ESCARCHADO-v1',
      templateName: 'Plantilla Escarchado Geniality v1',
      productId: baseEscarchador.id,
      description: 'Plantilla recuperada desde script local createEscarchadoTemplate.js.',
      stages: [
        {
          stageName: 'Premix Seco - Escarchado',
          processTypeId: pt.GE_PREMIX,
          processParameters: { recovery: RECOVERY_TAG },
          inputs: formulaItemsToTemplateInputs(baseEscarchadorBuiltItems.slice(0, 5)),
        },
        {
          stageName: 'Base Liquida + Incorporacion - Escarchado',
          processTypeId: pt.GE_BASE_LIQUIDA,
          processParameters: { recovery: RECOVERY_TAG, time_minutes: 20 },
          inputs: formulaItemsToTemplateInputs(baseEscarchadorBuiltItems.slice(5, 7)),
        },
        {
          stageName: 'Coccion y Enfriamiento - Escarchado',
          processTypeId: pt.GE_COCCION,
          outputProductId: baseEscarchador.id,
          processParameters: { recovery: RECOVERY_TAG },
          inputs: formulaItemsToTemplateInputs(baseEscarchadorBuiltItems.slice(7)),
        },
        {
          stageName: 'Empaque Sirope Escarchado',
          processTypeId: pt.G_EMPAQUE,
          processParameters: { recovery: RECOVERY_TAG },
        },
        {
          stageName: 'Ensamble Siigo - Escarchado',
          processTypeId: pt.G_ENSAMBLE,
          processParameters: { recovery: RECOVERY_TAG },
        },
      ],
    });

    const allSaborizacion = await tx.product.findMany({
      where: { name: { startsWith: 'SABORIZACION' } },
      select: { id: true, sku: true, name: true, active: true },
      orderBy: { sku: 'asc' },
    });

    const templateByFlavor = new Map();
    for (const product of allSaborizacion) {
      const flavor = norm(product.name.replace(/^SABORIZACION\s*/i, ''));
      const recoveredYield = knownSaborizacionYields[flavor];
      if (!recoveredYield) {
        summary.warnings.push(`Sin rendimiento confiable para ${product.name}; no se creo formula/plantilla de saborizacion.`);
        continue;
      }
      const partialItems = [
        {
          ingredientId: baseSirope.id,
          ingredientType: 'SEMI_FINISHED',
          quantity: 100000,
          unit: 'gramo',
          notes: 'Parcial: aditivos/color/sabor no estaban completos en la evidencia recuperada.',
        },
      ];
      const formCode = `GFORM-SAB-${slug(flavor)}`;
      await createFormula(tx, summary, {
        formulaCode: formCode,
        formulaName: `${product.name} (recuperada parcial)`,
        productId: product.id,
        isActive: product.active,
        baseUnit: 'gramo',
        baseQuantity: recoveredYield,
        description: 'Formula parcial recuperada desde logs PM2 y produccion forense.',
        notes: `PARCIAL: solo se recupero BASE SIROPE=100000g con rendimiento ${recoveredYield}g. Completar aditivos/color/sabor antes de usar en produccion fina.`,
        items: partialItems,
      });
      const templateCode = product.name === 'SABORIZACION MARACUYA' ? 'TMPL065' : `GTPL-SAB-${slug(flavor)}`;
      const tmpl = await createTemplate(tx, summary, {
        templateCode,
        templateName: product.name,
        productId: product.id,
        isActive: product.active,
        description: 'Saborizacion recuperada parcial. Completar ingredientes especificos de sabor/color.',
        stages: [
          {
            stageName: `Pesaje de ${product.name}`,
            processTypeId: pt.G_PESAJE,
            outputProductId: product.id,
            processParameters: { recovery: RECOVERY_TAG, confidence: 'parcial' },
            specialInstructions: 'RECUPERACION PARCIAL: faltan aditivos/color/sabor especificos en esta plantilla.',
            inputs: partialItems.map((item) => ({ ...item, productId: item.ingredientId })),
          },
          {
            stageName: `(G) Ensamble Final de ${product.name}`,
            processTypeId: pt.G_ENSAMBLE,
            outputProductId: product.id,
            outputClassification: 'SEMI_FINISHED',
            processParameters: { recovery: RECOVERY_TAG, confidence: 'parcial' },
            inputs: partialItems.map((item) => ({ ...item, productId: item.ingredientId })),
          },
        ],
      });
      templateByFlavor.set(flavor, tmpl);
      summary.partialRecoveries.push(product.name);
    }

    const siropeProducts = await tx.product.findMany({
      where: {
        OR: [
          { name: { startsWith: 'SIROPE GENIALITY SABOR A' } },
          { name: { equals: 'SIROPE GENIALITY ESCARCHADOR X 360 ML' } },
          { name: { equals: 'SIROPE GENIALITY ESCARCHADOR X 1000 ML' } },
        ],
      },
      select: { id: true, sku: true, name: true, active: true },
      orderBy: { sku: 'asc' },
    });

    const finalTemplateByKey = new Map();
    for (const product of siropeProducts) {
      const isEscarchador = norm(product.name).includes('ESCARCHADOR');
      const info = isEscarchador
        ? { flavor: 'ESCARCHADOR', size: product.name.includes('1000') ? '1000' : '360' }
        : extractSiropeInfo(product.name);
      if (!info) {
        summary.warnings.push(`No se pudo interpretar producto final: ${product.name}`);
        continue;
      }

      const size = info.size;
      const label = await findLabel(tx, info.flavor, size, isEscarchador);
      const saborizacion = !isEscarchador
        ? await findProductByName(tx, `SABORIZACION ${info.flavor}`)
        : null;

      const items = isEscarchador
        ? (size === '1000'
          ? [
            { ingredientId: packaging.tarro1000.id, quantity: 1, unit: 'unidad', ingredientType: 'PACKAGING' },
            { ingredientId: packaging.tapa1000.id, quantity: 1, unit: 'unidad', ingredientType: 'PACKAGING' },
            { ingredientId: packaging.foil1000.id, quantity: 1, unit: 'unidad', ingredientType: 'PACKAGING' },
            { ingredientId: baseEscarchador.id, quantity: 1000, unit: 'gramo', ingredientType: 'SEMI_FINISHED' },
            { ingredientId: label.id, quantity: 1, unit: 'unidad', ingredientType: 'PACKAGING' },
          ]
          : [
            { ingredientId: packaging.tarro360.id, quantity: 1, unit: 'unidad', ingredientType: 'PACKAGING' },
            { ingredientId: packaging.tapa360.id, quantity: 1, unit: 'unidad', ingredientType: 'PACKAGING' },
            { ingredientId: packaging.foil360.id, quantity: 1, unit: 'unidad', ingredientType: 'PACKAGING' },
            { ingredientId: baseEscarchador.id, quantity: 360, unit: 'gramo', ingredientType: 'SEMI_FINISHED' },
            { ingredientId: label.id, quantity: 1, unit: 'unidad', ingredientType: 'PACKAGING' },
          ])
        : (size === '1000'
          ? [
            { ingredientId: packaging.caja1000.id, quantity: 1 / 12, unit: 'unidad', ingredientType: 'PACKAGING' },
            { ingredientId: packaging.tarro1000.id, quantity: 1, unit: 'unidad', ingredientType: 'PACKAGING' },
            { ingredientId: packaging.tapa1000.id, quantity: 1, unit: 'unidad', ingredientType: 'PACKAGING' },
            { ingredientId: packaging.foil1000.id, quantity: 1, unit: 'unidad', ingredientType: 'PACKAGING' },
            { ingredientId: saborizacion.id, quantity: 1350, unit: 'gramo', ingredientType: 'SEMI_FINISHED' },
            { ingredientId: label.id, quantity: 1, unit: 'unidad', ingredientType: 'PACKAGING' },
          ]
          : [
            { ingredientId: packaging.tarro360.id, quantity: 1, unit: 'unidad', ingredientType: 'PACKAGING' },
            { ingredientId: packaging.tapa360.id, quantity: 1, unit: 'unidad', ingredientType: 'PACKAGING' },
            { ingredientId: packaging.foil360.id, quantity: 1, unit: 'unidad', ingredientType: 'PACKAGING' },
            { ingredientId: saborizacion.id, quantity: 500, unit: 'gramo', ingredientType: 'SEMI_FINISHED' },
            { ingredientId: label.id, quantity: 1, unit: 'unidad', ingredientType: 'PACKAGING' },
            { ingredientId: packaging.caja360.id, quantity: 0.04, unit: 'unidad', ingredientType: 'PACKAGING' },
          ]);

      await createFormula(tx, summary, {
        formulaCode: getFormulaCodeForSirope(product),
        formulaName: `${product.name} (recuperada)`,
        productId: product.id,
        isActive: product.active,
        baseUnit: 'units',
        baseQuantity: 1,
        description: isEscarchador
          ? 'Formula de empaque Escarchador recuperada desde script local.'
          : 'Formula de empaque Geniality recuperada desde logs, KPI y consumos forenses.',
        notes: isEscarchador
          ? 'Confianza alta: FORM-ESC reconstruido por script local.'
          : `Confianza alta para empaque: ${size === '1000' ? '1350g' : '500g'} de saborizacion por unidad confirmado por KPI/logs.`,
        items,
      });

      const templateCode = isEscarchador
        ? (size === '1000' ? 'TMPL-ESC-1000' : 'TMPL-ESC-360')
        : (info.flavor === 'MARACUYA' && size === '1000' ? 'TMPL066'
          : info.flavor === 'MARACUYA' && size === '360' ? 'TMPL067'
            : `GTPL-${slug(info.flavor)}-${size}`);

      const template = await createTemplate(tx, summary, {
        templateCode,
        templateName: `Llenado ${product.name}`,
        productId: product.id,
        isActive: product.active,
        description: 'Llenado/empaque recuperado desde formula de producto terminado.',
        stages: [
          {
            stageName: `Empaque de ${product.name}`,
            processTypeId: pt.G_EMPAQUE,
            outputProductId: product.id,
            outputClassification: 'FINISHED_GOOD',
            processParameters: { recovery: RECOVERY_TAG, flavorRole: `empaque_${size}`, flavorDependent: true },
            inputs: formulaItemsToTemplateInputs(items),
          },
          {
            stageName: `Ensamble Siigo de ${product.name}`,
            processTypeId: pt.G_ENSAMBLE,
            outputProductId: product.id,
            outputClassification: 'FINISHED_GOOD',
            processParameters: { recovery: RECOVERY_TAG, flavorRole: `ensamble_${size}`, flavorDependent: true },
            inputs: formulaItemsToTemplateInputs(items),
          },
        ],
      });
      finalTemplateByKey.set(`${norm(info.flavor)}|${size}`, template);
    }

    const maracuya1000 = finalTemplateByKey.get('MARACUYA|1000');
    const maracuya360 = finalTemplateByKey.get('MARACUYA|360');
    const maracuyaSab = templateByFlavor.get('MARACUYA');
    const baseTemplate = await tx.assemblyTemplate.findUnique({ where: { templateCode: 'TMPL064' } });

    if (baseTemplate && maracuyaSab && maracuya1000 && maracuya360) {
      await createTemplate(tx, summary, {
        templateCode: 'BATCH-GENIALITY',
        templateName: 'Batch GENIALITY (recuperado)',
        productId: batchGeniality.id,
        description: 'Plantilla sombrilla recuperada: Base Sirope + Saborizacion + Conteo + Llenado 1000/360.',
        stages: [
          {
            stageName: 'BASE SIROPE CLASICA',
            processTypeId: pt.G_PESAJE,
            subTemplateId: baseTemplate.id,
            processParameters: { recovery: RECOVERY_TAG },
          },
          {
            stageName: 'SABORIZACION {SABOR}',
            processTypeId: pt.G_PESAJE,
            subTemplateId: maracuyaSab.id,
            processParameters: { recovery: RECOVERY_TAG },
          },
          {
            stageName: 'Conteo de Produccion por Referencia',
            processTypeId: pt.CONTEO,
            processParameters: { recovery: RECOVERY_TAG },
          },
          {
            stageName: 'LLENADO SIROPE GENIALITY SABOR A MARACUYA X 1000 ML',
            processTypeId: pt.G_PESAJE,
            subTemplateId: maracuya1000.id,
            processParameters: { recovery: RECOVERY_TAG },
          },
          {
            stageName: 'LLENADO SIROPE GENIALITY SABOR A MARACUYA X 360 ML',
            processTypeId: pt.G_PESAJE,
            subTemplateId: maracuya360.id,
            processParameters: { recovery: RECOVERY_TAG },
          },
        ],
      });
    }

    const tmpl101 = await tx.assemblyTemplate.findUnique({ where: { templateCode: 'TMPL101' } });
    const esc1000 = await tx.assemblyTemplate.findUnique({ where: { templateCode: 'TMPL-ESC-1000' } });
    const esc360 = await tx.assemblyTemplate.findUnique({ where: { templateCode: 'TMPL-ESC-360' } });
    if (tmpl101 && esc1000 && esc360) {
      await createTemplate(tx, summary, {
        templateCode: 'BATCH-ESCARCHADOR',
        templateName: 'Batch ESCARCHADOR (recuperado)',
        productId: batchEscarchador.id,
        description: 'Plantilla sombrilla recuperada para Escarchador.',
        stages: [
          {
            stageName: 'BASE ESCARCHADOR',
            processTypeId: pt.G_PESAJE,
            subTemplateId: tmpl101.id,
            processParameters: { recovery: RECOVERY_TAG },
          },
          {
            stageName: 'Conteo de Produccion por Referencia',
            processTypeId: pt.CONTEO,
            processParameters: { recovery: RECOVERY_TAG },
          },
          {
            stageName: 'LLENADO SIROPE ESCARCHADOR X 1000 ML',
            processTypeId: pt.G_PESAJE,
            subTemplateId: esc1000.id,
            processParameters: { recovery: RECOVERY_TAG },
          },
          {
            stageName: 'LLENADO SIROPE ESCARCHADOR X 360 ML',
            processTypeId: pt.G_PESAJE,
            subTemplateId: esc360.id,
            processParameters: { recovery: RECOVERY_TAG },
          },
        ],
      });
    }
  }, { timeout: 60000 });

  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
