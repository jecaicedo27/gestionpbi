// academiaEnrollmentController.js — Inscripciones y avance global del aprendiz
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const isAdmin = (user) => user?.role === 'ADMIN';

// Aprendiz se auto-inscribe (o admin lo inscribe)
exports.enroll = async (req, res) => {
  try {
    const targetUserId = req.body.userId || req.user.id;
    if (targetUserId !== req.user.id && !isAdmin(req.user)) {
      return res.status(403).json({ success: false, error: 'Solo admin puede inscribir a otros' });
    }

    const enrollment = await prisma.academiaEnrollment.upsert({
      where: { userId: targetUserId },
      create: { userId: targetUserId, status: 'ACTIVO' },
      update: { status: 'ACTIVO' },
    });
    res.json({ success: true, enrollment });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.listEnrollments = async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ success: false, error: 'Solo admin' });
  try {
    const enrollments = await prisma.academiaEnrollment.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, name: true, email: true, role: true } },
      },
    });
    res.json({ success: true, enrollments });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.updateEnrollmentStatus = async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ success: false, error: 'Solo admin' });
  try {
    const { status, notes } = req.body;
    const enrollment = await prisma.academiaEnrollment.update({
      where: { id: req.params.id },
      data: { status, notes },
    });
    res.json({ success: true, enrollment });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// Mi perfil de academia (avance global del aprendiz)
exports.myProfile = async (req, res) => {
  try {
    const userId = req.user.id;

    const enrollment = await prisma.academiaEnrollment.findUnique({ where: { userId } });
    const allModules = await prisma.academiaModule.findMany({
      where: { active: true },
      include: { course: true },
      orderBy: [{ courseId: 'asc' }, { sortOrder: 'asc' }],
    });

    const progressByModule = await prisma.academiaProgress.findMany({ where: { userId } });
    const progressMap = new Map(progressByModule.map((p) => [p.moduleId, p]));

    const moduleStatus = allModules.map((m) => {
      const p = progressMap.get(m.id);
      return {
        moduleId: m.id,
        moduleCode: m.code,
        moduleTitle: m.title,
        courseId: m.courseId,
        coursePilar: m.course.pilar,
        lessonsCompleted: p?.lessonsCompleted || 0,
        totalLessons: p?.totalLessons || 0,
        quizPassed: p?.quizPassed || false,
        quizBestScore: p?.quizBestScore || null,
        practicalApproved: p?.practicalApproved || false,
        practicalBestScore: p?.practicalBestScore || null,
        moduleCompleted: p?.moduleCompleted || false,
      };
    });

    const certifications = await prisma.academiaCertification.findMany({
      where: { userId },
      orderBy: { awardedAt: 'desc' },
    });

    const totalModules = allModules.length;
    const completedModules = moduleStatus.filter((m) => m.moduleCompleted).length;
    const overallProgressPct = totalModules > 0 ? (completedModules / totalModules) * 100 : 0;

    res.json({
      success: true,
      profile: {
        enrollment,
        moduleStatus,
        certifications,
        stats: {
          totalModules,
          completedModules,
          overallProgressPct: Math.round(overallProgressPct * 100) / 100,
          currentLevel: certifications[0]?.level || null,
        },
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// Vista admin: avance de un aprendiz especifico
exports.userProfile = async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ success: false, error: 'Solo admin' });
  try {
    req.user = { ...req.user, id: req.params.userId };
    return exports.myProfile(req, res);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};
