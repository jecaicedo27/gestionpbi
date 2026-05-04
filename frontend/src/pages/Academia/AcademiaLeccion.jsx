import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../services/api';
import { ChevronLeft, CheckCircle, Clock, FileText, Video } from 'lucide-react';

const AcademiaLeccion = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [lesson, setLesson] = useState(null);
  const [progress, setProgress] = useState(null);
  const [loading, setLoading] = useState(true);
  const [marking, setMarking] = useState(false);

  useEffect(() => {
    api.get(`/academia/lessons/${id}`)
      .then((r) => {
        setLesson(r.data.lesson);
        setProgress(r.data.myProgress);
      })
      .catch((err) => console.error(err))
      .finally(() => setLoading(false));
  }, [id]);

  const markCompleted = async () => {
    setMarking(true);
    try {
      const r = await api.post(`/academia/lessons/${id}/viewed`, { completed: true, timeSpentSec: 0 });
      setProgress(r.data.progress);
    } catch (err) {
      alert('Error: ' + err.message);
    } finally {
      setMarking(false);
    }
  };

  if (loading) return <div className="p-8 text-center">Cargando...</div>;
  if (!lesson) return <div className="p-8 text-center text-red-600">Lección no encontrada</div>;

  const completed = !!progress?.completedAt;

  return (
    <div className="max-w-4xl mx-auto p-6">
      <button onClick={() => navigate(`/academia/cursos/${lesson.module.courseId}`)} className="flex items-center gap-2 text-slate-600 hover:text-slate-900 mb-4">
        <ChevronLeft className="w-5 h-5" />
        Volver al módulo
      </button>

      <div className="bg-white rounded-xl shadow border border-slate-200 overflow-hidden">
        <div className="bg-gradient-to-r from-indigo-600 to-purple-600 p-6 text-white">
          <div className="text-sm opacity-90">{lesson.module.course.title}</div>
          <h1 className="text-2xl font-bold mt-1">{lesson.title}</h1>
          <div className="flex gap-4 mt-3 text-sm">
            {lesson.durationMin && (
              <span className="flex items-center gap-1"><Clock className="w-4 h-4" /> {lesson.durationMin} min</span>
            )}
            <span className="flex items-center gap-1">
              {lesson.type === 'VIDEO' ? <Video className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
              {lesson.type}
            </span>
            {completed && (
              <span className="flex items-center gap-1 text-emerald-200">
                <CheckCircle className="w-4 h-4" /> Completada
              </span>
            )}
          </div>
        </div>

        <div className="p-6">
          {lesson.videoUrl && (
            <div className="aspect-video bg-black rounded-lg mb-6 overflow-hidden">
              <video src={lesson.videoUrl} controls className="w-full h-full" />
            </div>
          )}

          {lesson.contentText ? (
            <div
              className="prose prose-slate max-w-none"
              dangerouslySetInnerHTML={{ __html: lesson.contentText.replace(/\n/g, '<br/>') }}
            />
          ) : (
            <div className="p-6 bg-amber-50 border border-amber-200 rounded text-amber-800">
              ⏳ Contenido en preparación.
            </div>
          )}

          {lesson.attachmentUrl && (
            <a
              href={lesson.attachmentUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 mt-6 px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-700"
            >
              <FileText className="w-4 h-4" /> Descargar material
            </a>
          )}

          <div className="mt-8 pt-6 border-t border-slate-200">
            <button
              onClick={markCompleted}
              disabled={completed || marking}
              className={`w-full py-3 rounded-lg font-medium transition ${
                completed
                  ? 'bg-emerald-100 text-emerald-700 cursor-default'
                  : 'bg-emerald-600 text-white hover:bg-emerald-700'
              } disabled:opacity-50`}
            >
              {completed ? '✓ Lección completada' : marking ? 'Marcando...' : 'Marcar como completada'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AcademiaLeccion;
