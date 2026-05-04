import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { GraduationCap, BookOpen, ChevronRight, Trophy, TrendingUp, Award } from 'lucide-react';

const PILAR_INFO = {
  TECNICO:    { label: 'Técnico de Proceso',  color: 'from-blue-500 to-cyan-500',     icon: '⚗️' },
  LIDERAZGO:  { label: 'Liderazgo y Personas', color: 'from-purple-500 to-pink-500',   icon: '👥' },
  GESTION:    { label: 'Gestión Operativa',    color: 'from-amber-500 to-orange-500',  icon: '📊' },
  ERP:        { label: 'ERP y Datos',          color: 'from-emerald-500 to-teal-500',  icon: '💻' },
};

const LEVEL_INFO = {
  BRONCE:  { label: 'Bronce', color: 'bg-orange-100 text-orange-800 border-orange-300', icon: '🥉' },
  PLATA:   { label: 'Plata',   color: 'bg-slate-100 text-slate-800 border-slate-300',    icon: '🥈' },
  ORO:     { label: 'Oro',     color: 'bg-yellow-100 text-yellow-800 border-yellow-300', icon: '🥇' },
  MAESTRO: { label: 'Maestro', color: 'bg-purple-100 text-purple-800 border-purple-300', icon: '🏆' },
};

const AcademiaCatalogo = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [courses, setCourses] = useState([]);
  const [profile, setProfile] = useState(null);
  const [score, setScore] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/academia/courses'),
      api.get('/academia/me/profile'),
      api.get('/academia/me/score'),
    ])
      .then(([c, p, s]) => {
        setCourses(c.data.courses || []);
        setProfile(p.data.profile);
        setScore(s.data.score);
      })
      .catch((err) => console.error('Error cargando academia:', err))
      .finally(() => setLoading(false));
  }, []);

  const enroll = async () => {
    try {
      await api.post('/academia/enrollments', {});
      const p = await api.get('/academia/me/profile');
      setProfile(p.data.profile);
    } catch (err) {
      alert('Error al inscribir: ' + err.message);
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-slate-500">Cargando Academia...</div>;
  }

  const isEnrolled = !!profile?.enrollment;
  const stats = profile?.stats || {};

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 rounded-2xl p-8 text-white shadow-xl">
        <div className="flex items-center gap-4 mb-4">
          <GraduationCap className="w-12 h-12" />
          <div>
            <h1 className="text-3xl font-bold">Academia Popping Boba</h1>
            <p className="text-indigo-100">Escuela de Líderes — Meta: 7 baches/turno</p>
          </div>
        </div>

        {!isEnrolled ? (
          <button
            onClick={enroll}
            className="mt-4 bg-white text-indigo-700 font-semibold px-6 py-3 rounded-lg hover:bg-indigo-50 transition shadow"
          >
            Inscribirme a la Academia
          </button>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-6">
            <StatCard
              icon={<TrendingUp className="w-5 h-5" />}
              label="Avance global"
              value={`${stats.overallProgressPct?.toFixed(1) ?? 0}%`}
            />
            <StatCard
              icon={<BookOpen className="w-5 h-5" />}
              label="Módulos completados"
              value={`${stats.completedModules ?? 0}/${stats.totalModules ?? 0}`}
            />
            <StatCard
              icon={<Trophy className="w-5 h-5" />}
              label="Puntaje"
              value={`${score?.total?.toFixed(0) ?? 0}/1000`}
            />
            <StatCard
              icon={<Award className="w-5 h-5" />}
              label="Nivel actual"
              value={score?.level ? `${LEVEL_INFO[score.level].icon} ${LEVEL_INFO[score.level].label}` : 'Sin certificar'}
            />
          </div>
        )}
      </div>

      {/* Cursos / pilares */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {courses.map((course) => {
          const info = PILAR_INFO[course.pilar] || { label: course.pilar, color: 'from-gray-500 to-gray-600', icon: '📘' };
          const moduleStatusForCourse = (profile?.moduleStatus || []).filter((m) => m.courseId === course.id);
          const completed = moduleStatusForCourse.filter((m) => m.moduleCompleted).length;
          const total = moduleStatusForCourse.length || course._count?.modules || 0;
          const pct = total > 0 ? (completed / total) * 100 : 0;

          return (
            <div
              key={course.id}
              onClick={() => navigate(`/academia/cursos/${course.id}`)}
              className="bg-white rounded-xl shadow-md hover:shadow-xl transition cursor-pointer overflow-hidden border border-slate-200"
            >
              <div className={`bg-gradient-to-r ${info.color} p-5 text-white`}>
                <div className="flex justify-between items-start">
                  <div>
                    <div className="text-3xl mb-2">{info.icon}</div>
                    <h3 className="text-xl font-bold">{course.title}</h3>
                    <p className="text-sm opacity-90 mt-1">{course.description}</p>
                  </div>
                  <ChevronRight className="w-6 h-6 opacity-80" />
                </div>
              </div>
              <div className="p-5">
                <div className="flex justify-between text-sm text-slate-600 mb-2">
                  <span>{course._count?.modules || course.modules?.length || 0} módulos</span>
                  <span className="font-semibold">{completed}/{total} completados</span>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-2.5">
                  <div
                    className={`bg-gradient-to-r ${info.color} h-2.5 rounded-full transition-all`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Acciones admin */}
      {user?.role === 'ADMIN' && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-5">
          <h3 className="font-semibold text-slate-800 mb-3">Panel Admin</h3>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => navigate('/academia/admin/seguimiento')} className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm">
              Seguimiento de Líderes
            </button>
            <button onClick={() => navigate('/academia/admin/evaluaciones')} className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm">
              Panel de Evaluación
            </button>
            <button onClick={() => navigate('/academia/admin/contenido')} className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 text-sm">
              Editor de Contenido
            </button>
            <button onClick={() => navigate('/academia/ranking')} className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 text-sm">
              Ranking
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

const StatCard = ({ icon, label, value }) => (
  <div className="bg-white/15 backdrop-blur rounded-lg p-4 border border-white/20">
    <div className="flex items-center gap-2 text-indigo-100 text-sm mb-1">
      {icon}
      <span>{label}</span>
    </div>
    <div className="text-2xl font-bold">{value}</div>
  </div>
);

export default AcademiaCatalogo;
