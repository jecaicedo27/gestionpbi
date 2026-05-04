// academiaCertificationController.js — Calculo de score, certificacion y bonos
const { PrismaClient } = require('@prisma/client');
const scoring = require('../services/academiaScoringService');
const prisma = new PrismaClient();

const isAdmin = (user) => user?.role === 'ADMIN';

// Cualquier aprendiz puede consultar su propio score
exports.myScore = async (req, res) => {
  try {
    const score = await scoring.computeTotalScore(req.user.id);
    res.json({ success: true, score });
  } catch (err) {
    console.error('[myScore]', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.userScore = async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ success: false, error: 'Solo admin' });
  try {
    const score = await scoring.computeTotalScore(req.params.userId);
    res.json({ success: true, score });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// Admin emite certificacion (snapshot del score actual)
exports.awardCertification = async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ success: false, error: 'Solo admin' });
  try {
    const { userId, validUntil, notes } = req.body;
    const score = await scoring.computeTotalScore(userId);
    if (!score.level) {
      return res.status(400).json({ success: false, error: 'Puntaje insuficiente para certificacion (minimo 700)' });
    }
    const cert = await prisma.academiaCertification.create({
      data: {
        userId,
        level: score.level,
        totalScore: score.total,
        scoreBreakdown: score.components,
        validUntil: validUntil ? new Date(validUntil) : null,
        notes,
      },
    });
    res.status(201).json({ success: true, certification: cert });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.listCertifications = async (req, res) => {
  try {
    const where = isAdmin(req.user) ? {} : { userId: req.user.id };
    if (req.query.userId && isAdmin(req.user)) where.userId = req.query.userId;
    const certs = await prisma.academiaCertification.findMany({
      where,
      orderBy: { awardedAt: 'desc' },
      include: { user: { select: { id: true, name: true, role: true } } },
    });
    res.json({ success: true, certifications: certs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// Ranking entre aprendices inscritos
exports.ranking = async (req, res) => {
  try {
    const enrollments = await prisma.academiaEnrollment.findMany({
      where: { status: 'ACTIVO' },
      include: { user: { select: { id: true, name: true, role: true } } },
    });

    const scores = await Promise.all(
      enrollments.map(async (e) => {
        const s = await scoring.computeTotalScore(e.userId);
        return {
          userId: e.userId,
          name: e.user.name,
          role: e.user.role,
          total: s.total,
          level: s.level,
        };
      })
    );

    scores.sort((a, b) => b.total - a.total);
    res.json({ success: true, ranking: scores });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ─── Bonos ─────────────────────────────────────────────────────────────

exports.listBonuses = async (req, res) => {
  try {
    const where = isAdmin(req.user) ? {} : { userId: req.user.id };
    if (req.query.status) where.status = req.query.status;
    const bonuses = await prisma.academiaBonus.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, name: true } },
        awardedBy: { select: { id: true, name: true } },
      },
    });
    res.json({ success: true, bonuses });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.createBonus = async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ success: false, error: 'Solo admin' });
  try {
    const { userId, reason, amountCop, periodFrom, periodTo, metricSnapshot } = req.body;
    const bonus = await prisma.academiaBonus.create({
      data: {
        userId,
        awardedById: req.user.id,
        reason,
        amountCop: Number(amountCop) || 0,
        periodFrom: periodFrom ? new Date(periodFrom) : null,
        periodTo: periodTo ? new Date(periodTo) : null,
        metricSnapshot,
      },
    });
    res.status(201).json({ success: true, bonus });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.updateBonusStatus = async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ success: false, error: 'Solo admin' });
  try {
    const { status } = req.body;
    const data = { status };
    if (status === 'PAGADO') data.paidAt = new Date();
    const bonus = await prisma.academiaBonus.update({
      where: { id: req.params.id },
      data,
    });
    res.json({ success: true, bonus });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};
