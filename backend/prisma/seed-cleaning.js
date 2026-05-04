const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const LEDDY_ID = '9f492632-3ce9-489f-bda0-3d2a48245ec5';
const DIANA_ID = 'a0000002-0000-0000-0000-000000000002';

const ZONES = [
  { code: 'CAFETIN', name: 'Cafetín', description: 'Mesas, sillas, nevera, cocina integral, cafetera, vestier', sortOrder: 1 },
  { code: 'OFICINAS_ADMIN', name: 'Oficinas Administración', description: 'Escritorios, sillas, computadores, mesas, papeleras', sortOrder: 2 },
  { code: 'BANOS_HOMBRES', name: 'Baños Hombres', description: 'Baños del personal masculino', sortOrder: 3 },
  { code: 'BANOS_MUJERES', name: 'Baños Mujeres', description: 'Baños del personal femenino', sortOrder: 4 },
  { code: 'CUARTO_ASEO', name: 'Cuarto de Aseo', description: 'Organización + control de inventario de desinfectantes', sortOrder: 5 },
  { code: 'PRODUCCION', name: 'Nave de Producción', description: 'Entrada, canecas MP, pisos, drenajes', sortOrder: 6 },
  { code: 'BODEGA_PRINCIPAL', name: 'Bodega Principal', description: 'Barrer, trapear, áreas de difícil acceso', sortOrder: 7 },
  { code: 'MEZANINE', name: 'Mezanine', description: 'Organización y limpieza', sortOrder: 8 },
  { code: 'CUARTO_MANTENIMIENTO', name: 'Cuarto de Mantenimiento', description: 'Barrer y trapear', sortOrder: 9 },
  { code: 'CUARTO_MAQUINAS', name: 'Cuarto de Máquinas', description: 'Barrer, trapear, orden', sortOrder: 10 },
  { code: 'AREAS_COMUNES', name: 'Áreas Comunes', description: 'Parqueadero y exteriores', sortOrder: 11 },
  { code: 'AREA_RESIDUOS', name: 'Área de Residuos', description: 'Cartón, canecas, costales de azúcar', sortOrder: 12 },
  { code: 'AREA_LOGISTICA', name: 'Área de Logística', description: 'Muebles, mesas, organización', sortOrder: 13 },
];

const TASKS = [
  // DIARIAS
  { zone: 'CAFETIN', title: 'Limpiar mesas, sillas y pisos del cafetín', frequency: 'DAILY', timeSlot: 'AM', estimatedMin: 30 },
  { zone: 'CAFETIN', title: 'Limpiar cocina integral, cafetera y lavar platos', frequency: 'DAILY', timeSlot: 'PM', estimatedMin: 30 },
  { zone: 'OFICINAS_ADMIN', title: 'Vaciar papeleras y limpiar escritorios', frequency: 'DAILY', timeSlot: 'AM', estimatedMin: 25 },
  { zone: 'BANOS_HOMBRES', title: 'Limpieza profunda baño hombres', frequency: 'DAILY', timeSlot: 'AM', estimatedMin: 30, requireNotes: false },
  { zone: 'BANOS_HOMBRES', title: 'Repaso de baño hombres', frequency: 'DAILY', timeSlot: 'PM', estimatedMin: 15 },
  { zone: 'BANOS_MUJERES', title: 'Limpieza profunda baño mujeres', frequency: 'DAILY', timeSlot: 'AM', estimatedMin: 30 },
  { zone: 'BANOS_MUJERES', title: 'Repaso de baño mujeres', frequency: 'DAILY', timeSlot: 'PM', estimatedMin: 15 },
  { zone: 'PRODUCCION', title: 'Cambiar agua desinfectante para botas (entrada)', frequency: 'DAILY', timeSlot: 'AM', estimatedMin: 10, instructions: 'Vaciar el agua del día anterior, limpiar el recipiente y llenar con agua + desinfectante en proporción correcta' },
  { zone: 'PRODUCCION', title: 'Reponer jabón y toallas en lavamanos entrada', frequency: 'DAILY', timeSlot: 'AM', estimatedMin: 10 },
  { zone: 'PRODUCCION', title: 'Barrer pisos y limpiar drenajes producción', frequency: 'DAILY', timeSlot: 'PM', estimatedMin: 45 },
  { zone: 'AREAS_COMUNES', title: 'Barrer parqueadero y zonas exteriores', frequency: 'DAILY', timeSlot: 'AM', estimatedMin: 30 },
  { zone: 'CUARTO_ASEO', title: 'Verificar orden y reportar insumos por terminar', frequency: 'DAILY', timeSlot: 'PM', estimatedMin: 15, instructions: 'Revisar cada desinfectante y marcar como "por terminar" los que estén bajos para enviar a comprar' },

  // 2-3 VECES POR SEMANA
  { zone: 'CAFETIN', title: 'Limpieza profunda nevera', frequency: 'WEEKLY', daysOfWeek: [1, 5], estimatedMin: 45 },
  { zone: 'PRODUCCION', title: 'Limpiar canecas de materias primas', frequency: 'WEEKLY', daysOfWeek: [2, 4], estimatedMin: 60 },
  { zone: 'BODEGA_PRINCIPAL', title: 'Barrer y trapear bodega', frequency: 'WEEKLY', daysOfWeek: [1, 3, 5], estimatedMin: 60 },
  { zone: 'CUARTO_MAQUINAS', title: 'Barrer y trapear cuarto máquinas', frequency: 'WEEKLY', daysOfWeek: [2, 4], estimatedMin: 30 },
  { zone: 'CUARTO_MANTENIMIENTO', title: 'Barrer y trapear cuarto mantenimiento', frequency: 'WEEKLY', daysOfWeek: [1, 5], estimatedMin: 30 },
  { zone: 'AREA_LOGISTICA', title: 'Limpiar muebles, mesas y organizar logística', frequency: 'WEEKLY', daysOfWeek: [1, 3, 5], estimatedMin: 40 },
  { zone: 'OFICINAS_ADMIN', title: 'Limpiar vidrios y superficies a fondo', frequency: 'WEEKLY', daysOfWeek: [2, 5], estimatedMin: 45 },
  { zone: 'CAFETIN', title: 'Limpiar vestier', frequency: 'WEEKLY', daysOfWeek: [3], estimatedMin: 30 },

  // SEMANALES
  { zone: 'CUARTO_ASEO', title: 'Organización completa + inventario insumos', frequency: 'WEEKLY', daysOfWeek: [1], estimatedMin: 60 },
  { zone: 'MEZANINE', title: 'Organización y limpieza completa', frequency: 'WEEKLY', daysOfWeek: [2], estimatedMin: 90 },
  { zone: 'AREA_RESIDUOS', title: 'Organizar cartón, canecas y costales', frequency: 'WEEKLY', daysOfWeek: [3], estimatedMin: 60 },
  { zone: 'BANOS_HOMBRES', title: 'Desinfección techos y paredes', frequency: 'WEEKLY', daysOfWeek: [6], estimatedMin: 45 },
  { zone: 'BANOS_MUJERES', title: 'Desinfección techos y paredes', frequency: 'WEEKLY', daysOfWeek: [6], estimatedMin: 45 },
  { zone: 'PRODUCCION', title: 'Limpieza profunda canecas y zonas difíciles', frequency: 'WEEKLY', daysOfWeek: [6], estimatedMin: 90 },
  { zone: 'CAFETIN', title: 'Limpieza profunda cocina integral', frequency: 'WEEKLY', daysOfWeek: [6], estimatedMin: 60 },
  { zone: 'OFICINAS_ADMIN', title: 'Aspirado profundo oficinas', frequency: 'WEEKLY', daysOfWeek: [5], estimatedMin: 45 },
  { zone: 'BODEGA_PRINCIPAL', title: 'Áreas de difícil acceso y zonas altas', frequency: 'WEEKLY', daysOfWeek: [6], estimatedMin: 60 },
  { zone: 'CAFETIN', title: 'Cafetera limpieza profunda', frequency: 'WEEKLY', daysOfWeek: [1], estimatedMin: 20 },

  // MENSUALES
  { zone: 'CAFETIN', title: 'Vestier limpieza completa', frequency: 'MONTHLY', estimatedMin: 90 },
  { zone: 'BODEGA_PRINCIPAL', title: 'Limpieza alturas y techos', frequency: 'MONTHLY', estimatedMin: 120 },
  { zone: 'PRODUCCION', title: 'Limpieza de extractores y alturas', frequency: 'MONTHLY', estimatedMin: 120 },
  { zone: 'OFICINAS_ADMIN', title: 'Cambio cortinas/persianas', frequency: 'MONTHLY', estimatedMin: 60 },
  { zone: 'AREAS_COMUNES', title: 'Limpieza profunda parqueadero', frequency: 'MONTHLY', estimatedMin: 90 },
  { zone: 'AREA_RESIDUOS', title: 'Desinfección general área residuos', frequency: 'MONTHLY', estimatedMin: 60 },
  { zone: 'CUARTO_MANTENIMIENTO', title: 'Organización profunda y descarte', frequency: 'MONTHLY', estimatedMin: 90 },
  { zone: 'MEZANINE', title: 'Limpieza alturas y reorganización', frequency: 'MONTHLY', estimatedMin: 120 },
];

const SUPPLIES = [
  { name: 'Hipoclorito de sodio', unit: 'litros', minQty: 5 },
  { name: 'Detergente líquido', unit: 'litros', minQty: 5 },
  { name: 'Desengrasante', unit: 'litros', minQty: 3 },
  { name: 'Jabón de manos', unit: 'litros', minQty: 5 },
  { name: 'Toallas papel manos', unit: 'paquetes', minQty: 4 },
  { name: 'Papel higiénico', unit: 'paquetes', minQty: 4 },
  { name: 'Bolsas basura grandes', unit: 'paquetes', minQty: 3 },
  { name: 'Bolsas basura pequeñas', unit: 'paquetes', minQty: 3 },
  { name: 'Ambientador', unit: 'unidades', minQty: 2 },
  { name: 'Trapeadores/escobas', unit: 'unidades', minQty: 2 },
];

async function main() {
  console.log('🧹 Seeding cleaning module...');

  const zoneMap = {};
  for (const z of ZONES) {
    const zone = await prisma.cleaningZone.upsert({
      where: { code: z.code },
      update: { name: z.name, description: z.description, sortOrder: z.sortOrder, active: true },
      create: z,
    });
    zoneMap[z.code] = zone.id;
  }
  console.log(`✓ ${ZONES.length} zonas creadas/actualizadas`);

  let taskCount = 0;
  for (const t of TASKS) {
    const exists = await prisma.cleaningTask.findFirst({
      where: { zoneId: zoneMap[t.zone], title: t.title },
    });
    if (!exists) {
      await prisma.cleaningTask.create({
        data: {
          zoneId: zoneMap[t.zone],
          title: t.title,
          description: t.description,
          instructions: t.instructions,
          frequency: t.frequency,
          daysOfWeek: t.daysOfWeek || [],
          timeSlot: t.timeSlot,
          estimatedMin: t.estimatedMin || 15,
          requirePhoto: t.requirePhoto || false,
          requireNotes: t.requireNotes || false,
          assignedToId: LEDDY_ID,
        },
      });
      taskCount++;
    }
  }
  console.log(`✓ ${taskCount} tareas nuevas creadas (total esperado: ${TASKS.length})`);

  let supplyCount = 0;
  for (const s of SUPPLIES) {
    const exists = await prisma.cleaningSupply.findFirst({ where: { name: s.name } });
    if (!exists) {
      await prisma.cleaningSupply.create({ data: s });
      supplyCount++;
    }
  }
  console.log(`✓ ${supplyCount} insumos nuevos creados (total esperado: ${SUPPLIES.length})`);

  await prisma.user.update({
    where: { id: LEDDY_ID },
    data: { isCleaningStaff: true },
  });
  console.log('✓ Leddy marcada como personal de aseo');

  await prisma.user.update({
    where: { id: DIANA_ID },
    data: { isCleaningSupervisor: true },
  });
  console.log('✓ Diana Marcela marcada como supervisora de aseo');

  console.log('🎉 Seed de aseo completado');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
