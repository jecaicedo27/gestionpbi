// academiaQuizController.js — Cuestionarios, preguntas, intentos y calificacion automatica
const { PrismaClient } = require('@prisma/client');
const { recomputeModuleProgress } = require('./academiaLessonController');
const prisma = new PrismaClient();

const isAdmin = (user) => user?.role === 'ADMIN';

// ─── Quiz ──────────────────────────────────────────────────────────────

exports.getQuizByModule = async (req, res) => {
  try {
    const moduleId = req.params.moduleId;
    const quiz = await prisma.academiaQuiz.findUnique({
      where: { moduleId },
      include: {
        questions: {
          orderBy: { sortOrder: 'asc' },
          // El aprendiz NO debe ver la respuesta correcta antes de enviar
          select: isAdmin(req.user)
            ? { id: true, type: true, prompt: true, options: true, correctAnswer: true, explanation: true, points: true, sortOrder: true }
            : { id: true, type: true, prompt: true, options: true, points: true, sortOrder: true },
        },
      },
    });
    if (!quiz) return res.status(404).json({ success: false, error: 'Quiz no encontrado' });
    res.json({ success: true, quiz });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.createQuiz = async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ success: false, error: 'Solo admin' });
  try {
    const { moduleId, title, passingScore, timeLimitMin, maxAttempts } = req.body;
    const quiz = await prisma.academiaQuiz.create({
      data: { moduleId, title, passingScore: passingScore || 80, timeLimitMin, maxAttempts: maxAttempts || 3 },
    });
    res.status(201).json({ success: true, quiz });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.updateQuiz = async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ success: false, error: 'Solo admin' });
  try {
    const quiz = await prisma.academiaQuiz.update({
      where: { id: req.params.id },
      data: req.body,
    });
    res.json({ success: true, quiz });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ─── Preguntas ─────────────────────────────────────────────────────────

exports.createQuestion = async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ success: false, error: 'Solo admin' });
  try {
    const q = await prisma.academiaQuestion.create({ data: req.body });
    res.status(201).json({ success: true, question: q });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.updateQuestion = async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ success: false, error: 'Solo admin' });
  try {
    const q = await prisma.academiaQuestion.update({
      where: { id: req.params.id },
      data: req.body,
    });
    res.json({ success: true, question: q });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.deleteQuestion = async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ success: false, error: 'Solo admin' });
  try {
    await prisma.academiaQuestion.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ─── Intentos del aprendiz ─────────────────────────────────────────────

exports.startAttempt = async (req, res) => {
  try {
    const quizId = req.params.quizId;
    const userId = req.user.id;

    const quiz = await prisma.academiaQuiz.findUnique({ where: { id: quizId } });
    if (!quiz) return res.status(404).json({ success: false, error: 'Quiz no encontrado' });

    const previousAttempts = await prisma.academiaQuizAttempt.count({ where: { quizId, userId } });
    if (previousAttempts >= quiz.maxAttempts) {
      return res.status(400).json({ success: false, error: 'Maximo de intentos alcanzado' });
    }

    const attempt = await prisma.academiaQuizAttempt.create({
      data: { quizId, userId, attemptNo: previousAttempts + 1 },
    });
    res.status(201).json({ success: true, attempt });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// answers: { questionId: answer, ... }
exports.submitAttempt = async (req, res) => {
  try {
    const attemptId = req.params.attemptId;
    const userId = req.user.id;
    const { answers } = req.body;

    const attempt = await prisma.academiaQuizAttempt.findUnique({
      where: { id: attemptId },
      include: { quiz: { include: { questions: true } } },
    });
    if (!attempt) return res.status(404).json({ success: false, error: 'Intento no encontrado' });
    if (attempt.userId !== userId) return res.status(403).json({ success: false, error: 'No autorizado' });
    if (attempt.submittedAt) return res.status(400).json({ success: false, error: 'Intento ya enviado' });

    // Calificacion automatica
    let earned = 0;
    let possible = 0;
    const detail = [];

    for (const q of attempt.quiz.questions) {
      possible += q.points;
      const userAnswer = answers?.[q.id];
      const correct = q.correctAnswer;
      const ok = compareAnswer(q.type, userAnswer, correct);
      if (ok) earned += q.points;
      detail.push({ questionId: q.id, userAnswer, correct: ok, points: ok ? q.points : 0 });
    }

    const scorePct = possible > 0 ? (earned / possible) * 100 : 0;
    const passed = scorePct >= attempt.quiz.passingScore;

    const updated = await prisma.academiaQuizAttempt.update({
      where: { id: attemptId },
      data: {
        submittedAt: new Date(),
        answers: { detail, earned, possible },
        score: scorePct,
        passed,
      },
    });

    // Actualizar progreso del modulo
    const quiz = await prisma.academiaQuiz.findUnique({
      where: { id: attempt.quizId },
      select: { moduleId: true },
    });
    const existing = await prisma.academiaProgress.findUnique({
      where: { userId_moduleId: { userId, moduleId: quiz.moduleId } },
    });
    const bestScore = Math.max(scorePct, existing?.quizBestScore || 0);
    await prisma.academiaProgress.upsert({
      where: { userId_moduleId: { userId, moduleId: quiz.moduleId } },
      create: {
        userId, moduleId: quiz.moduleId,
        quizPassed: passed,
        quizBestScore: bestScore,
      },
      update: {
        quizPassed: passed || (existing?.quizPassed ?? false),
        quizBestScore: bestScore,
      },
    });

    await recomputeModuleProgress(userId, quiz.moduleId);

    res.json({ success: true, attempt: updated, scorePct, passed });
  } catch (err) {
    console.error('[submitAttempt]', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

function compareAnswer(type, userAnswer, correct) {
  if (userAnswer === undefined || userAnswer === null) return false;
  if (type === 'MULTIPLE_CHOICE' || type === 'TRUE_FALSE') {
    return JSON.stringify(userAnswer) === JSON.stringify(correct);
  }
  if (type === 'SHORT_ANSWER') {
    const norm = (s) => String(s || '').trim().toLowerCase();
    if (Array.isArray(correct)) return correct.some((c) => norm(c) === norm(userAnswer));
    return norm(userAnswer) === norm(correct);
  }
  return false;
}

exports.listMyAttempts = async (req, res) => {
  try {
    const quizId = req.params.quizId;
    const attempts = await prisma.academiaQuizAttempt.findMany({
      where: { quizId, userId: req.user.id },
      orderBy: { startedAt: 'desc' },
    });
    res.json({ success: true, attempts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};
