// academiaPracticalEvalController.js — Evaluaciones practicas en planta + rubricas
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const isAdmin = (user) => user?.role === 'ADMIN';

// ─── Rubricas (criterios de evaluacion practica) ───────────────────────

exports.listRubrics = async (req, res) => {
  try {
    const { moduleId } = req.query;
    const rubrics = await prisma.academiaRubric.findMany({
      where: { active: true, ...(moduleId ? { moduleId } : {}) },
      orderBy: [{ moduleId: 'asc' }, { sortOrder: 'asc' }],
    });
    res.json({ success: true, rubrics });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.createRubric = async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ success: false, error: 'Solo admin' });
  try {
    const r = await prisma.academiaRubric.create({ data: req.body });
    res.status(201).json({ success: true, rubric: r });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.updateRubric = async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ success: false, error: 'Solo admin' });
  try {
    const r = await prisma.academiaRubric.update({
      where: { id: req.params.id },
      data: req.body,
    });
    res.json({ success: true, rubric: r });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ─── Evaluaciones practicas ────────────────────────────────────────────

// Iniciar una evaluacion (admin convoca al aprendiz a planta)
exports.createEvaluation = async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ success: false, error: 'Solo admin' });
  try {
    const { userId, moduleId } = req.body;
    const ev = await prisma.academiaPracticalEval.create({
      data: {
        userId, moduleId,
        evaluatorId: req.user.id,
        status: 'EN_PROCESO',
      },
    });
    res.status(201).json({ success: true, evaluation: ev });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// Admin envia las puntuaciones de la rubrica
// scoreDetail: [{ rubricId, points, observation }]
exports.submitEvaluation = async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ success: false, error: 'Solo admin' });
  try {
    const evalId = req.params.id;
    const { scoreDetail, observations, evidenceUrl, status } = req.body;

    const evaluation = await prisma.academiaPracticalEval.findUnique({
      where: { id: evalId },
      include: { module: { include: { rubrics: { where: { active: true } } } } },
    });
    if (!evaluation) return res.status(404).json({ success: false, error: 'Evaluacion no encontrada' });

    let scoreTotal = 0, scoreMax = 0;
    for (const item of scoreDetail || []) {
      const rubric = evaluation.module.rubrics.find((r) => r.id === item.rubricId);
      if (!rubric) continue;
      const points = Math.min(Math.max(0, Number(item.points) || 0), rubric.maxPoints);
      scoreTotal += points;
      scoreMax += rubric.maxPoints;
    }

    const scorePct = scoreMax > 0 ? (scoreTotal / scoreMax) * 100 : 0;
    const finalStatus = status || (scorePct >= 70 ? 'APROBADA' : 'RECHAZADA');

    const updated = await prisma.academiaPracticalEval.update({
      where: { id: evalId },
      data: {
        scoreDetail, observations, evidenceUrl,
        scoreTotal, scoreMax, scorePct,
        status: finalStatus,
        evaluatedAt: new Date(),
      },
    });

    // Actualizar progreso del modulo
    const existing = await prisma.academiaProgress.findUnique({
      where: { userId_moduleId: { userId: evaluation.userId, moduleId: evaluation.moduleId } },
    });
    const bestPctPractical = Math.max(scorePct, existing?.practicalBestScore || 0);
    const approved = finalStatus === 'APROBADA' || (existing?.practicalApproved ?? false);

    const progress = await prisma.academiaProgress.upsert({
      where: { userId_moduleId: { userId: evaluation.userId, moduleId: evaluation.moduleId } },
      create: {
        userId: evaluation.userId, moduleId: evaluation.moduleId,
        practicalApproved: finalStatus === 'APROBADA',
        practicalBestScore: scorePct,
      },
      update: {
        practicalApproved: approved,
        practicalBestScore: bestPctPractical,
      },
    });

    // Marcar modulo como completado si pasa quiz Y practica
    if (progress.quizPassed && approved) {
      await prisma.academiaProgress.update({
        where: { id: progress.id },
        data: { moduleCompleted: true, completedAt: new Date() },
      });
    }

    res.json({ success: true, evaluation: updated });
  } catch (err) {
    console.error('[submitEvaluation]', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.listEvaluations = async (req, res) => {
  try {
    const where = isAdmin(req.user) ? {} : { userId: req.user.id };
    if (req.query.status) where.status = req.query.status;
    if (req.query.userId && isAdmin(req.user)) where.userId = req.query.userId;

    const evaluations = await prisma.academiaPracticalEval.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, name: true } },
        evaluator: { select: { id: true, name: true } },
        module: { select: { id: true, code: true, title: true } },
      },
    });
    res.json({ success: true, evaluations });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.getEvaluation = async (req, res) => {
  try {
    const ev = await prisma.academiaPracticalEval.findUnique({
      where: { id: req.params.id },
      include: {
        user: { select: { id: true, name: true } },
        evaluator: { select: { id: true, name: true } },
        module: {
          include: {
            rubrics: { where: { active: true }, orderBy: { sortOrder: 'asc' } },
          },
        },
      },
    });
    if (!ev) return res.status(404).json({ success: false, error: 'Evaluacion no encontrada' });
    if (!isAdmin(req.user) && ev.userId !== req.user.id) {
      return res.status(403).json({ success: false, error: 'No autorizado' });
    }
    res.json({ success: true, evaluation: ev });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};
