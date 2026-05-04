// academiaCourseController.js — CRUD de Cursos (Pilares) y Modulos de la Academia
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const isAdmin = (user) => user?.role === 'ADMIN';

exports.listCourses = async (req, res) => {
  try {
    const courses = await prisma.academiaCourse.findMany({
      where: { active: true },
      orderBy: { sortOrder: 'asc' },
      include: {
        _count: { select: { modules: true } },
        modules: {
          where: { active: true },
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true, code: true, title: true, description: true,
            estimatedHours: true, sortOrder: true,
            _count: { select: { lessons: true } },
          },
        },
      },
    });
    res.json({ success: true, courses });
  } catch (err) {
    console.error('[listCourses]', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.getCourse = async (req, res) => {
  try {
    const course = await prisma.academiaCourse.findUnique({
      where: { id: req.params.id },
      include: {
        modules: {
          where: { active: true },
          orderBy: { sortOrder: 'asc' },
          include: {
            lessons: {
              where: { active: true },
              orderBy: { sortOrder: 'asc' },
            },
            quiz: { select: { id: true, title: true, passingScore: true } },
          },
        },
      },
    });
    if (!course) return res.status(404).json({ success: false, error: 'Curso no encontrado' });
    res.json({ success: true, course });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.createCourse = async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ success: false, error: 'Solo admin' });
  try {
    const { code, pilar, title, description, sortOrder } = req.body;
    const course = await prisma.academiaCourse.create({
      data: {
        code, pilar, title, description,
        sortOrder: sortOrder || 0,
        createdById: req.user.id,
      },
    });
    res.status(201).json({ success: true, course });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.updateCourse = async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ success: false, error: 'Solo admin' });
  try {
    const { title, description, sortOrder, active } = req.body;
    const course = await prisma.academiaCourse.update({
      where: { id: req.params.id },
      data: { title, description, sortOrder, active },
    });
    res.json({ success: true, course });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ─── Modulos ───────────────────────────────────────────────────────────

exports.listModules = async (req, res) => {
  try {
    const { courseId } = req.query;
    const modules = await prisma.academiaModule.findMany({
      where: { active: true, ...(courseId ? { courseId } : {}) },
      orderBy: [{ courseId: 'asc' }, { sortOrder: 'asc' }],
      include: {
        course: { select: { id: true, title: true, pilar: true } },
        _count: { select: { lessons: true, rubrics: true } },
        quiz: { select: { id: true, title: true, passingScore: true } },
      },
    });
    res.json({ success: true, modules });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.getModule = async (req, res) => {
  try {
    const mod = await prisma.academiaModule.findUnique({
      where: { id: req.params.id },
      include: {
        course: true,
        lessons: { where: { active: true }, orderBy: { sortOrder: 'asc' } },
        rubrics: { where: { active: true }, orderBy: { sortOrder: 'asc' } },
        quiz: {
          include: {
            questions: { orderBy: { sortOrder: 'asc' } },
            _count: { select: { attempts: true } },
          },
        },
      },
    });
    if (!mod) return res.status(404).json({ success: false, error: 'Modulo no encontrado' });
    res.json({ success: true, module: mod });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.createModule = async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ success: false, error: 'Solo admin' });
  try {
    const { code, courseId, title, description, estimatedHours, sortOrder } = req.body;
    const mod = await prisma.academiaModule.create({
      data: { code, courseId, title, description, estimatedHours, sortOrder: sortOrder || 0 },
    });
    res.status(201).json({ success: true, module: mod });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.updateModule = async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ success: false, error: 'Solo admin' });
  try {
    const { title, description, estimatedHours, sortOrder, active } = req.body;
    const mod = await prisma.academiaModule.update({
      where: { id: req.params.id },
      data: { title, description, estimatedHours, sortOrder, active },
    });
    res.json({ success: true, module: mod });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};
