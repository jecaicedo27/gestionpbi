// academiaScoringService.js — Calculo de puntaje total del aprendiz
// Combina: tests teoricos, evaluaciones practicas, KPIs reales del turno, comportamiento 360
//
// Total: 1000 puntos
//   - Quiz teoricos:      230 (23%)
//   - Eval practicas:     350 (35%)
//   - KPIs reales:        200 (20%)
//   - Proyecto final:     150 (15%)
//   - Comportamiento 360:  70 (7%)
//
// Niveles:
//   Bronce: 700-799 | Plata: 800-879 | Oro: 880-939 | Maestro: 940-1000

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const TARGET_BACHES_TURNO = 7; // meta de productividad

const WEIGHTS = {
  quizzes: 230,
  practicals: 350,
  kpis: 200,
  finalProject: 150,
  behavior: 70,
};

function levelForScore(total) {
  if (total >= 940) return 'MAESTRO';
  if (total >= 880) return 'ORO';
  if (total >= 800) return 'PLATA';
  if (total >= 700) return 'BRONCE';
  return null;
}

// ─── Componente 1: Quiz teoricos (230 pts) ─────────────────────────────
// Promedio del mejor score por modulo, ponderado por modulos cubiertos
async function quizComponent(userId) {
  const allModules = await prisma.academiaModule.findMany({
    where: { active: true },
    include: { quiz: true },
  });
  const modulesWithQuiz = allModules.filter((m) => m.quiz);
  if (modulesWithQuiz.length === 0) return { score: 0, max: WEIGHTS.quizzes, detail: 'No hay quizzes configurados' };

  const progress = await prisma.academiaProgress.findMany({
    where: { userId, moduleId: { in: modulesWithQuiz.map((m) => m.id) } },
  });

  const scores = modulesWithQuiz.map((m) => {
    const p = progress.find((x) => x.moduleId === m.id);
    return p?.quizBestScore || 0; // 0..100
  });
  const avg = scores.reduce((a, b) => a + b, 0) / modulesWithQuiz.length;
  return { score: (avg / 100) * WEIGHTS.quizzes, max: WEIGHTS.quizzes, detail: { avgPct: avg, modulesEvaluated: modulesWithQuiz.length } };
}

// ─── Componente 2: Evaluaciones practicas (350 pts) ────────────────────
async function practicalComponent(userId) {
  const allModules = await prisma.academiaModule.findMany({
    where: { active: true },
    select: { id: true },
  });
  if (allModules.length === 0) return { score: 0, max: WEIGHTS.practicals, detail: 'Sin modulos' };

  const progress = await prisma.academiaProgress.findMany({
    where: { userId, moduleId: { in: allModules.map((m) => m.id) } },
  });
  const scores = allModules.map((m) => {
    const p = progress.find((x) => x.moduleId === m.id);
    return p?.practicalBestScore || 0;
  });
  const avg = scores.reduce((a, b) => a + b, 0) / allModules.length;
  return { score: (avg / 100) * WEIGHTS.practicals, max: WEIGHTS.practicals, detail: { avgPct: avg, modules: allModules.length } };
}

// ─── Componente 3: KPIs reales del turno (200 pts) ─────────────────────
// Lee data real de production_batches del usuario en los ultimos 30 dias
// Score basado en: baches/turno promedio vs meta de 7
async function kpiComponent(userId, periodDays = 30) {
  const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);

  let avgBatchesPerShift = 0;
  let shiftsAnalyzed = 0;

  try {
    // Intentar leer de production_batches asociados al usuario
    const batches = await prisma.productionBatch.findMany({
      where: {
        OR: [
          { createdById: userId },
          { startedById: userId },
          { completedById: userId },
        ],
        startedAt: { gte: since },
      },
      select: { id: true, startedAt: true, completedAt: true, status: true },
    });

    // Agrupar por dia (proxy de turno) — refinar si hay info real de turnos del lider
    const byDay = new Map();
    for (const b of batches) {
      if (!b.completedAt) continue;
      const day = b.completedAt.toISOString().slice(0, 10);
      byDay.set(day, (byDay.get(day) || 0) + 1);
    }
    shiftsAnalyzed = byDay.size;
    if (shiftsAnalyzed > 0) {
      const total = [...byDay.values()].reduce((a, b) => a + b, 0);
      avgBatchesPerShift = total / shiftsAnalyzed;
    }
  } catch (e) {
    // Si el modelo no calza con campos esperados, devolver 0 sin romper
    console.warn('[kpiComponent] no se pudo leer batches:', e.message);
  }

  // Score lineal: 0 baches = 0, meta (7) = 100%. Sobrepasar la meta da extra hasta tope.
  const pct = Math.min((avgBatchesPerShift / TARGET_BACHES_TURNO) * 100, 110);
  const cappedPct = Math.min(pct, 100);
  const score = (cappedPct / 100) * WEIGHTS.kpis;

  return {
    score,
    max: WEIGHTS.kpis,
    detail: { avgBatchesPerShift, target: TARGET_BACHES_TURNO, shiftsAnalyzed, periodDays },
  };
}

// ─── Componente 4: Proyecto final (150 pts) ────────────────────────────
// Reservado: se computa a partir de una evaluacion practica especial cuyo modulo
// tenga el code "PROYECTO_FINAL" — por ahora retorna 0 si no existe.
async function finalProjectComponent(userId) {
  const finalModule = await prisma.academiaModule.findFirst({ where: { code: { contains: 'PROYECTO_FINAL' } } });
  if (!finalModule) return { score: 0, max: WEIGHTS.finalProject, detail: 'Proyecto final aun no configurado' };

  const progress = await prisma.academiaProgress.findUnique({
    where: { userId_moduleId: { userId, moduleId: finalModule.id } },
  });
  const pct = progress?.practicalBestScore || 0;
  return { score: (pct / 100) * WEIGHTS.finalProject, max: WEIGHTS.finalProject, detail: { pct } };
}

// ─── Componente 5: Comportamiento 360 (70 pts) ─────────────────────────
// Lee de shift_discipline si existe; si no, score base 80%
async function behaviorComponent(userId, periodDays = 90) {
  const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);
  let pct = 80; // base si no hay sistema disciplinario activo

  try {
    // Si existe modelo ShiftDisciplineRecord o similar, leer faltas
    if (prisma.shiftDisciplineRecord) {
      const records = await prisma.shiftDisciplineRecord.findMany({
        where: { userId, createdAt: { gte: since } },
      });
      // Penalizacion: cada falta resta 5%, max 50%
      const penalty = Math.min(records.length * 5, 50);
      pct = Math.max(50, 100 - penalty);
    }
  } catch (e) {
    // Modelo no existe o consulta falla — ignorar y dejar base
  }

  return { score: (pct / 100) * WEIGHTS.behavior, max: WEIGHTS.behavior, detail: { pct, periodDays } };
}

// ─── Calculo total ─────────────────────────────────────────────────────
async function computeTotalScore(userId, options = {}) {
  const [quiz, practical, kpi, finalProj, behavior] = await Promise.all([
    quizComponent(userId),
    practicalComponent(userId),
    kpiComponent(userId, options.kpiPeriodDays),
    finalProjectComponent(userId),
    behaviorComponent(userId, options.behaviorPeriodDays),
  ]);

  const total = quiz.score + practical.score + kpi.score + finalProj.score + behavior.score;
  const totalRounded = Math.round(total * 100) / 100;
  const level = levelForScore(totalRounded);

  return {
    total: totalRounded,
    max: 1000,
    level,
    components: {
      quizzes: quiz,
      practicals: practical,
      kpis: kpi,
      finalProject: finalProj,
      behavior,
    },
    weights: WEIGHTS,
  };
}

module.exports = {
  computeTotalScore,
  levelForScore,
  WEIGHTS,
  TARGET_BACHES_TURNO,
};
