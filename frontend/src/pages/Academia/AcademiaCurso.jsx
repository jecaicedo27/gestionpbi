import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../services/api';
import { ChevronLeft, BookOpen, CheckCircle, Circle, Clock, FileText, Video, Image, Award } from 'lucide-react';

const LESSON_ICONS = {
  VIDEO:      <Video className="w-4 h-4" />,
  TEXTO:      <FileText className="w-4 h-4" />,
  INFOGRAFIA: <Image className="w-4 h-4" />,
  CASO_ESTUDIO: <BookOpen className="w-4 h-4" />,
  PRACTICA:   <Award className="w-4 h-4" />,
};

const AcademiaCurso = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [course, setCourse] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get(`/academia/courses/${id}`),
      api.get('/academia/me/profile'),
    ])
      .then(([c, p]) => {
        setCourse(c.data.course);
        setProfile(p.data.profile);
      })
      .catch((err) => console.error(err))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="p-8 text-center">Cargando...</div>;
  if (!course) return <div className="p-8 text-center text-red-600">Curso no encontrado</div>;

  const moduleStatusMap = new Map((profile?.moduleStatus || []).map((m) => [m.moduleId, m]));

  return (
    <div className="max-w-5xl mx-auto p-6">
      <button onClick={() => navigate('/academia')} className="flex items-center gap-2 text-slate-600 hover:text-slate-900 mb-4">
        <ChevronLeft className="w-5 h-5" />
        Volver al catálogo
      </button>

      <div className="bg-white rounded-xl shadow p-6 mb-6 border border-slate-200">
        <div className="text-sm text-indigo-600 font-medium uppercase tracking-wide">{course.pilar}</div>
        <h1 className="text-3xl font-bold text-slate-800 mt-1">{course.title}</h1>
        <p className="text-slate-600 mt-2">{course.description}</p>
      </div>

      <div className="space-y-3">
        {course.modules.map((mod, idx) => {
          const status = moduleStatusMap.get(mod.id) || {};
          const lessonsTotal = mod.lessons?.length || 0;
          const lessonsDone = status.lessonsCompleted || 0;
          const isCompleted = status.moduleCompleted;

          return (
            <div key={mod.id} className={`bg-white rounded-xl shadow-sm border ${isCompleted ? 'border-emerald-300' : 'border-slate-200'}`}>
              <div className="p-5">
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 mt-1">
                    {isCompleted ? <CheckCircle className="w-6 h-6 text-emerald-500" /> : <Circle className="w-6 h-6 text-slate-300" />}
                  </div>
                  <div className="flex-1">
                    <div className="flex justify-between items-start">
                      <div>
                        <h3 className="font-semibold text-slate-800">{mod.title}</h3>
                        <p className="text-sm text-slate-600 mt-1">{mod.description}</p>
                        <div className="flex gap-4 mt-2 text-xs text-slate-500">
                          <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {mod.estimatedHours}h estimadas</span>
                          <span>{lessonsTotal} lecciones</span>
                          {mod.quiz && <span className="text-purple-600">📝 Quiz disponible</span>}
                          {status.quizPassed && <span className="text-emerald-600">✓ Quiz aprobado ({status.quizBestScore?.toFixed(0)}%)</span>}
                          {status.practicalApproved && <span className="text-emerald-600">✓ Práctica aprobada</span>}
                        </div>
                      </div>
                    </div>

                    {lessonsTotal > 0 && (
                      <div className="mt-3">
                        <div className="w-full bg-slate-200 rounded-full h-1.5">
                          <div
                            className="bg-indigo-500 h-1.5 rounded-full transition-all"
                            style={{ width: `${(lessonsDone / lessonsTotal) * 100}%` }}
                          />
                        </div>
                        <div className="text-xs text-slate-500 mt-1">{lessonsDone}/{lessonsTotal} lecciones completadas</div>
                      </div>
                    )}

                    {/* Lista de lecciones */}
                    {mod.lessons?.length > 0 ? (
                      <div className="mt-3 space-y-1">
                        {mod.lessons.map((lesson) => (
                          <button
                            key={lesson.id}
                            onClick={() => navigate(`/academia/lecciones/${lesson.id}`)}
                            className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-slate-50 text-left text-sm border border-slate-100"
                          >
                            {LESSON_ICONS[lesson.type] || <FileText className="w-4 h-4" />}
                            <span className="flex-1 text-slate-700">{lesson.title}</span>
                            {lesson.durationMin && <span className="text-xs text-slate-400">{lesson.durationMin} min</span>}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded text-sm text-amber-700">
                        ⏳ Contenido en preparación. El admin debe agregar lecciones a este módulo.
                      </div>
                    )}

                    {mod.quiz && (
                      <button
                        onClick={() => navigate(`/academia/modulos/${mod.id}/quiz`)}
                        className="mt-3 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 text-sm font-medium"
                      >
                        {status.quizPassed ? 'Repetir cuestionario' : 'Iniciar cuestionario'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default AcademiaCurso;
