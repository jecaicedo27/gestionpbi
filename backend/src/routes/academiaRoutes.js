// academiaRoutes.js — Modulo Academia Popping Boba (Escuela de Lideres)
// Aislado: NO interfiere con ningun modulo existente del ERP
const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');

const courseCtrl = require('../controllers/academiaCourseController');
const lessonCtrl = require('../controllers/academiaLessonController');
const quizCtrl = require('../controllers/academiaQuizController');
const enrollmentCtrl = require('../controllers/academiaEnrollmentController');
const practicalCtrl = require('../controllers/academiaPracticalEvalController');
const certCtrl = require('../controllers/academiaCertificationController');

// Todo requiere autenticacion
router.use(auth);

// ─── Cursos (pilares) ──────────────────────────────────────────────────
router.get('/courses', courseCtrl.listCourses);
router.get('/courses/:id', courseCtrl.getCourse);
router.post('/courses', courseCtrl.createCourse);
router.patch('/courses/:id', courseCtrl.updateCourse);

// ─── Modulos ───────────────────────────────────────────────────────────
router.get('/modules', courseCtrl.listModules);
router.get('/modules/:id', courseCtrl.getModule);
router.post('/modules', courseCtrl.createModule);
router.patch('/modules/:id', courseCtrl.updateModule);

// ─── Lecciones ─────────────────────────────────────────────────────────
router.get('/lessons/:id', lessonCtrl.getLesson);
router.post('/lessons', lessonCtrl.createLesson);
router.patch('/lessons/:id', lessonCtrl.updateLesson);
router.delete('/lessons/:id', lessonCtrl.deleteLesson);
router.post('/lessons/:id/viewed', lessonCtrl.markLessonViewed);

// ─── Quizzes ───────────────────────────────────────────────────────────
router.get('/modules/:moduleId/quiz', quizCtrl.getQuizByModule);
router.post('/quizzes', quizCtrl.createQuiz);
router.patch('/quizzes/:id', quizCtrl.updateQuiz);
router.post('/questions', quizCtrl.createQuestion);
router.patch('/questions/:id', quizCtrl.updateQuestion);
router.delete('/questions/:id', quizCtrl.deleteQuestion);
router.post('/quizzes/:quizId/attempts', quizCtrl.startAttempt);
router.post('/quiz-attempts/:attemptId/submit', quizCtrl.submitAttempt);
router.get('/quizzes/:quizId/my-attempts', quizCtrl.listMyAttempts);

// ─── Inscripciones y perfil del aprendiz ──────────────────────────────
router.post('/enrollments', enrollmentCtrl.enroll);
router.get('/enrollments', enrollmentCtrl.listEnrollments);
router.patch('/enrollments/:id', enrollmentCtrl.updateEnrollmentStatus);
router.get('/me/profile', enrollmentCtrl.myProfile);
router.get('/users/:userId/profile', enrollmentCtrl.userProfile);

// ─── Rubricas y evaluaciones practicas ─────────────────────────────────
router.get('/rubrics', practicalCtrl.listRubrics);
router.post('/rubrics', practicalCtrl.createRubric);
router.patch('/rubrics/:id', practicalCtrl.updateRubric);

router.get('/evaluations', practicalCtrl.listEvaluations);
router.get('/evaluations/:id', practicalCtrl.getEvaluation);
router.post('/evaluations', practicalCtrl.createEvaluation);
router.post('/evaluations/:id/submit', practicalCtrl.submitEvaluation);

// ─── Score, certificaciones, ranking, bonos ────────────────────────────
router.get('/me/score', certCtrl.myScore);
router.get('/users/:userId/score', certCtrl.userScore);
router.get('/certifications', certCtrl.listCertifications);
router.post('/certifications', certCtrl.awardCertification);
router.get('/ranking', certCtrl.ranking);

router.get('/bonuses', certCtrl.listBonuses);
router.post('/bonuses', certCtrl.createBonus);
router.patch('/bonuses/:id/status', certCtrl.updateBonusStatus);

module.exports = router;
