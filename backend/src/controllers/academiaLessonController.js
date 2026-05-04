// academiaLessonController.js — Lecciones individuales y registro de avance
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const isAdmin = (user) => user?.role === 'ADMIN';

exports.getLesson = async (req, res) => {
  try {
    const lesson = await prisma.academiaLesson.findUnique({
      where: { id: req.params.id },
      include: { module: { include: { course: true } } },
    });
    if (!lesson || !lesson.active) return res.status(404).json({ success: false, error: 'Leccion no encontrada' });

    const myProgress = await prisma.academiaLessonProgress.findUnique({
      where: { userId_lessonId: { userId: req.user.id, lessonId: lesson.id } },
    });

    res.json({ success: true, lesson, myProgress });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.createLesson = async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ success: false, error: 'Solo admin' });
  try {
    const { moduleId, title, type, contentText, videoUrl, attachmentUrl, durationMin, sortOrder } = req.body;
    const lesson = await prisma.academiaLesson.create({
      data: { moduleId, title, type: type || 'TEXTO', contentText, videoUrl, attachmentUrl, durationMin, sortOrder: sortOrder || 0 },
    });
    res.status(201).json({ success: true, lesson });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.updateLesson = async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ success: false, error: 'Solo admin' });
  try {
    const { title, type, contentText, videoUrl, attachmentUrl, durationMin, sortOrder, active } = req.body;
    const lesson = await prisma.academiaLesson.update({
      where: { id: req.params.id },
      data: { title, type, contentText, videoUrl, attachmentUrl, durationMin, sortOrder, active },
    });
    res.json({ success: true, lesson });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.deleteLesson = async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ success: false, error: 'Solo admin' });
  try {
    await prisma.academiaLesson.update({ where: { id: req.params.id }, data: { active: false } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// El aprendiz marca leccion como vista/completada
exports.markLessonViewed = async (req, res) => {
  try {
    const lessonId = req.params.id;
    const userId = req.user.id;
    const { timeSpentSec, completed } = req.body;

    const lesson = await prisma.academiaLesson.findUnique({
      where: { id: lessonId },
      include: { module: true },
    });
    if (!lesson) return res.status(404).json({ success: false, error: 'Leccion no encontrada' });

    const progress = await prisma.academiaLessonProgress.upsert({
      where: { userId_lessonId: { userId, lessonId } },
      create: {
        userId, lessonId,
        timeSpentSec: timeSpentSec || 0,
        completedAt: completed ? new Date() : null,
      },
      update: {
        timeSpentSec: { increment: timeSpentSec || 0 },
        completedAt: completed ? new Date() : undefined,
      },
    });

    // Si se marca como completada, recalcular avance del modulo
    if (completed) {
      await recomputeModuleProgress(userId, lesson.moduleId);
    }

    res.json({ success: true, progress });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

async function recomputeModuleProgress(userId, moduleId) {
  const lessons = await prisma.academiaLesson.findMany({
    where: { moduleId, active: true },
    select: { id: true },
  });
  const totalLessons = lessons.length;
  const completedCount = await prisma.academiaLessonProgress.count({
    where: {
      userId,
      lessonId: { in: lessons.map((l) => l.id) },
      completedAt: { not: null },
    },
  });

  await prisma.academiaProgress.upsert({
    where: { userId_moduleId: { userId, moduleId } },
    create: {
      userId, moduleId,
      lessonsCompleted: completedCount,
      totalLessons,
    },
    update: {
      lessonsCompleted: completedCount,
      totalLessons,
    },
  });
}

exports.recomputeModuleProgress = recomputeModuleProgress;
