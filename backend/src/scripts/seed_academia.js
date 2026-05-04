// Seed inicial de la Academia Popping Boba
// Crea los 4 pilares y los 23 modulos con su estructura
// Idempotente: usa upsert por code, se puede correr varias veces sin duplicar

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const PILARES = [
  {
    code: 'PILAR-1-TECNICO',
    pilar: 'TECNICO',
    title: 'Pilar 1 — Tecnico de Proceso',
    description: 'Dominio total de las 3 lineas: Perlas, Siropes, Cítrica',
    sortOrder: 1,
    modules: [
      { code: 'MOD-1-1', title: '1.1 Fundamentos de Popping Boba', description: 'Ciencia de la esferificacion, alginato, calcio, estandares de calidad', estimatedHours: 2, sortOrder: 1 },
      { code: 'MOD-1-2', title: '1.2 Linea Perlas: Pipeline Liquipops', description: 'Escalera de baches, marmita, esferificadora, lavado, ollas, TMPLs paso a paso', estimatedHours: 4, sortOrder: 2 },
      { code: 'MOD-1-3', title: '1.3 Linea Siropes', description: 'Receta, dosificacion, Brix, viscosidad, color, empaque', estimatedHours: 3, sortOrder: 3 },
      { code: 'MOD-1-4', title: '1.4 Linea Citrica (BASE LIQUIPOPS DIOXIDO)', description: 'Formula completa, glucosa en 2 partes, dioxido, densidad, color integrado', estimatedHours: 3, sortOrder: 4 },
      { code: 'MOD-1-5', title: '1.5 Etapas de Control', description: 'COCCION, MEDICION, FORMACION, MAESTRO_PERLAS, PROTECCION_GATE, CONTEO, IMPRESION_LOTE', estimatedHours: 2, sortOrder: 5 },
      { code: 'MOD-1-6', title: '1.6 Calidad y BPM', description: 'HACCP, trazabilidad, mermas, microbiologia, limpieza y sanitizacion', estimatedHours: 3, sortOrder: 6 },
      { code: 'MOD-1-7', title: '1.7 Manejo de Materias Primas y FEFO', description: 'FEFO bodega-produccion, lectura QR, prefijos sabor, reservas, devoluciones', estimatedHours: 2, sortOrder: 7 },
      { code: 'MOD-1-8', title: '1.8 Mantenimiento Operativo', description: 'Marmitas, esferificadoras, dosificadores, diagnostico de primera linea', estimatedHours: 2, sortOrder: 8 },
    ],
  },
  {
    code: 'PILAR-2-LIDERAZGO',
    pilar: 'LIDERAZGO',
    title: 'Pilar 2 — Liderazgo y Personas',
    description: 'Saber mandar, orientar, retroalimentar y manejar conflictos',
    sortOrder: 2,
    modules: [
      { code: 'MOD-2-1', title: '2.1 ¿Que es un lider de planta?', description: 'Diferencia entre jefe, supervisor y lider. Autoridad vs respeto', estimatedHours: 2, sortOrder: 1 },
      { code: 'MOD-2-2', title: '2.2 Comunicacion efectiva', description: 'Metodo 4C, escucha activa, stand-up de turno', estimatedHours: 3, sortOrder: 2 },
      { code: 'MOD-2-3', title: '2.3 Delegacion y seguimiento', description: 'Asignar tareas, confiar pero verificar, sin micromanagement', estimatedHours: 2, sortOrder: 3 },
      { code: 'MOD-2-4', title: '2.4 Retroalimentacion', description: 'Feedback positivo y correctivo, modelo SBI, conversaciones dificiles', estimatedHours: 3, sortOrder: 4 },
      { code: 'MOD-2-5', title: '2.5 Manejo de conflictos', description: 'Conflictos entre operarios, escalamiento, mediacion basica', estimatedHours: 2, sortOrder: 5 },
      { code: 'MOD-2-6', title: '2.6 Liderazgo situacional', description: 'Cuando mandar, ensenar, apoyar o delegar', estimatedHours: 2, sortOrder: 6 },
    ],
  },
  {
    code: 'PILAR-3-GESTION',
    pilar: 'GESTION',
    title: 'Pilar 3 — Gestion Operativa',
    description: 'KPIs, planificacion, mejora continua y seguridad industrial',
    sortOrder: 3,
    modules: [
      { code: 'MOD-3-1', title: '3.1 Indicadores de planta', description: 'OEE, mermas, cumplimiento, tiempo estandar. Meta: 7 baches/turno', estimatedHours: 3, sortOrder: 1 },
      { code: 'MOD-3-2', title: '3.2 Planificacion de turno', description: 'Production Scheduler, priorizar, plan A/B/C, coordinacion con turnos', estimatedHours: 3, sortOrder: 2 },
      { code: 'MOD-3-3', title: '3.3 Gestion de inventarios', description: 'MRP forecast, anticipar faltantes, coordinar con bodega', estimatedHours: 2, sortOrder: 3 },
      { code: 'MOD-3-4', title: '3.4 Seguridad industrial', description: 'EPP, riesgos por linea, accidentes, casi-incidentes', estimatedHours: 2, sortOrder: 4 },
      { code: 'MOD-3-5', title: '3.5 Mejora continua', description: '5S, Kaizen, 5 Por ques, Ishikawa. Como pasar de 5 a 7 baches', estimatedHours: 3, sortOrder: 5 },
    ],
  },
  {
    code: 'PILAR-4-ERP',
    pilar: 'ERP',
    title: 'Pilar 4 — ERP y Datos',
    description: 'Usar el sistema Gestion PBI como herramienta de mando',
    sortOrder: 4,
    modules: [
      { code: 'MOD-4-1', title: '4.1 Navegacion del ERP Gestion PBI', description: 'Login, perfil, roles, modulos principales', estimatedHours: 2, sortOrder: 1 },
      { code: 'MOD-4-2', title: '4.2 Operacion diaria en el ERP', description: 'Iniciar y completar baches, pesajes, lotes, mermas, Shift Handover', estimatedHours: 3, sortOrder: 2 },
      { code: 'MOD-4-3', title: '4.3 Lectura de KPIs', description: 'Dashboard del lider, comparativa entre turnos, tendencias', estimatedHours: 2, sortOrder: 3 },
      { code: 'MOD-4-4', title: '4.4 Datos para decidir', description: 'Cuando confiar en el dato, reportar errores, sugerir mejoras', estimatedHours: 2, sortOrder: 4 },
    ],
  },
];

async function main() {
  console.log('🌱 Iniciando seed de Academia...');
  let cursosCreados = 0, cursosActualizados = 0;
  let modulosCreados = 0, modulosActualizados = 0;

  for (const pilar of PILARES) {
    const cursoExistente = await prisma.academiaCourse.findUnique({ where: { code: pilar.code } });

    const curso = await prisma.academiaCourse.upsert({
      where: { code: pilar.code },
      create: {
        code: pilar.code,
        pilar: pilar.pilar,
        title: pilar.title,
        description: pilar.description,
        sortOrder: pilar.sortOrder,
        active: true,
      },
      update: {
        title: pilar.title,
        description: pilar.description,
        sortOrder: pilar.sortOrder,
      },
    });

    if (cursoExistente) cursosActualizados++; else cursosCreados++;
    console.log(`  ${cursoExistente ? '↻' : '+'} Curso: ${curso.title}`);

    for (const mod of pilar.modules) {
      const modExistente = await prisma.academiaModule.findUnique({ where: { code: mod.code } });

      await prisma.academiaModule.upsert({
        where: { code: mod.code },
        create: {
          code: mod.code,
          courseId: curso.id,
          title: mod.title,
          description: mod.description,
          estimatedHours: mod.estimatedHours,
          sortOrder: mod.sortOrder,
          active: true,
        },
        update: {
          courseId: curso.id,
          title: mod.title,
          description: mod.description,
          estimatedHours: mod.estimatedHours,
          sortOrder: mod.sortOrder,
        },
      });

      if (modExistente) modulosActualizados++; else modulosCreados++;
      console.log(`     ${modExistente ? '↻' : '+'} ${mod.title}`);
    }
  }

  console.log('');
  console.log('✅ Seed completado:');
  console.log(`   Cursos: ${cursosCreados} creados, ${cursosActualizados} actualizados`);
  console.log(`   Modulos: ${modulosCreados} creados, ${modulosActualizados} actualizados`);
}

main()
  .catch((e) => {
    console.error('❌ Error en seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
