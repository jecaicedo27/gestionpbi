import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../../services/api';
import { useAuth } from '../../../context/AuthContext';
import { ChevronLeft, BookOpen, Plus, ChevronDown, ChevronUp, Save, Trash2 } from 'lucide-react';

const AcademiaContenido = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [courses, setCourses] = useState([]);
  const [openModule, setOpenModule] = useState(null);
  const [moduleData, setModuleData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user?.role !== 'ADMIN') { navigate('/academia'); return; }
    api.get('/academia/courses')
      .then((r) => setCourses(r.data.courses || []))
      .finally(() => setLoading(false));
  }, [user]);

  const openMod = async (modId) => {
    if (openModule === modId) { setOpenModule(null); setModuleData(null); return; }
    const r = await api.get(`/academia/modules/${modId}`);
    setOpenModule(modId);
    setModuleData(r.data.module);
  };

  if (loading) return <div className="p-8 text-center">Cargando...</div>;

  return (
    <div className="max-w-5xl mx-auto p-6">
      <button onClick={() => navigate('/academia')} className="flex items-center gap-2 text-slate-600 hover:text-slate-900 mb-4">
        <ChevronLeft className="w-5 h-5" />
        Volver
      </button>

      <div className="bg-gradient-to-r from-purple-600 to-pink-600 rounded-2xl p-6 text-white mb-6">
        <div className="flex items-center gap-3">
          <BookOpen className="w-10 h-10" />
          <div>
            <h1 className="text-2xl font-bold">Editor de Contenido</h1>
            <p className="text-purple-100">Lecciones, quizzes y rúbricas de los módulos</p>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {courses.map((course) => (
          <div key={course.id} className="bg-white rounded-xl shadow border border-slate-200 overflow-hidden">
            <div className="p-4 bg-slate-50 border-b border-slate-200">
              <h2 className="font-bold text-slate-800">{course.title}</h2>
              <p className="text-sm text-slate-600">{course._count?.modules} módulos</p>
            </div>
            <div className="divide-y divide-slate-100">
              {course.modules.map((mod) => (
                <div key={mod.id}>
                  <button
                    onClick={() => openMod(mod.id)}
                    className="w-full p-3 flex items-center justify-between hover:bg-slate-50 text-left"
                  >
                    <div>
                      <div className="font-medium text-slate-800">{mod.title}</div>
                      <div className="text-xs text-slate-500">
                        {mod._count?.lessons || 0} lecciones · {mod.estimatedHours}h
                      </div>
                    </div>
                    {openModule === mod.id ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                  </button>

                  {openModule === mod.id && moduleData && (
                    <ModuleEditor module={moduleData} onUpdate={() => openMod(mod.id)} />
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const ModuleEditor = ({ module: mod, onUpdate }) => {
  const [tab, setTab] = useState('lessons');

  return (
    <div className="bg-slate-50 p-4 border-t border-slate-200">
      <div className="flex gap-2 mb-3 text-sm">
        <TabBtn active={tab === 'lessons'} onClick={() => setTab('lessons')}>📚 Lecciones ({mod.lessons.length})</TabBtn>
        <TabBtn active={tab === 'quiz'} onClick={() => setTab('quiz')}>📝 Quiz {mod.quiz ? '✓' : '⏳'}</TabBtn>
        <TabBtn active={tab === 'rubrics'} onClick={() => setTab('rubrics')}>🛠️ Rúbricas ({mod.rubrics.length})</TabBtn>
      </div>

      {tab === 'lessons' && <LessonsEditor module={mod} onUpdate={onUpdate} />}
      {tab === 'quiz' && <QuizEditor module={mod} onUpdate={onUpdate} />}
      {tab === 'rubrics' && <RubricsEditor module={mod} onUpdate={onUpdate} />}
    </div>
  );
};

const TabBtn = ({ active, onClick, children }) => (
  <button onClick={onClick} className={`px-3 py-1 rounded ${active ? 'bg-purple-600 text-white' : 'bg-white border border-slate-200 hover:bg-slate-50'}`}>
    {children}
  </button>
);

const LessonsEditor = ({ module: mod, onUpdate }) => {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', type: 'TEXTO', contentText: '', videoUrl: '', durationMin: '' });

  const create = async () => {
    if (!form.title) return;
    await api.post('/academia/lessons', {
      moduleId: mod.id,
      title: form.title,
      type: form.type,
      contentText: form.contentText,
      videoUrl: form.videoUrl,
      durationMin: form.durationMin ? Number(form.durationMin) : null,
      sortOrder: mod.lessons.length + 1,
    });
    setForm({ title: '', type: 'TEXTO', contentText: '', videoUrl: '', durationMin: '' });
    setShowForm(false);
    onUpdate();
  };

  return (
    <div>
      <div className="space-y-1 mb-3">
        {mod.lessons.map((l) => (
          <div key={l.id} className="p-2 bg-white border border-slate-200 rounded flex justify-between text-sm">
            <span>{l.sortOrder}. [{l.type}] {l.title}</span>
            <button onClick={async () => { await api.delete(`/academia/lessons/${l.id}`); onUpdate(); }} className="text-red-500"><Trash2 className="w-4 h-4" /></button>
          </div>
        ))}
        {mod.lessons.length === 0 && <div className="text-sm text-slate-500 italic">Sin lecciones aún</div>}
      </div>

      {!showForm ? (
        <button onClick={() => setShowForm(true)} className="px-3 py-1 bg-purple-600 text-white rounded text-sm flex items-center gap-1">
          <Plus className="w-4 h-4" /> Agregar lección
        </button>
      ) : (
        <div className="bg-white p-3 rounded border border-slate-200 space-y-2">
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Título" className="w-full px-2 py-1 border rounded text-sm" />
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="w-full px-2 py-1 border rounded text-sm">
            <option>TEXTO</option><option>VIDEO</option><option>INFOGRAFIA</option><option>CASO_ESTUDIO</option><option>PRACTICA</option>
          </select>
          <input value={form.videoUrl} onChange={(e) => setForm({ ...form, videoUrl: e.target.value })} placeholder="URL del video (opcional)" className="w-full px-2 py-1 border rounded text-sm" />
          <textarea value={form.contentText} onChange={(e) => setForm({ ...form, contentText: e.target.value })} placeholder="Contenido (texto/HTML)" rows="4" className="w-full px-2 py-1 border rounded text-sm" />
          <input type="number" value={form.durationMin} onChange={(e) => setForm({ ...form, durationMin: e.target.value })} placeholder="Duración en min" className="w-full px-2 py-1 border rounded text-sm" />
          <div className="flex gap-2">
            <button onClick={create} className="px-3 py-1 bg-emerald-600 text-white rounded text-sm">Guardar</button>
            <button onClick={() => setShowForm(false)} className="px-3 py-1 bg-slate-200 rounded text-sm">Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
};

const QuizEditor = ({ module: mod, onUpdate }) => {
  const [creating, setCreating] = useState(false);
  const [showQ, setShowQ] = useState(false);
  const [q, setQ] = useState({ prompt: '', type: 'MULTIPLE_CHOICE', options: ['', '', '', ''], correctAnswer: '', points: 10 });

  const createQuiz = async () => {
    setCreating(true);
    await api.post('/academia/quizzes', { moduleId: mod.id, title: `Quiz: ${mod.title}` });
    setCreating(false);
    onUpdate();
  };

  const addQuestion = async () => {
    const correctAnswer = q.type === 'TRUE_FALSE' ? (q.correctAnswer === 'true') : q.correctAnswer;
    await api.post('/academia/questions', {
      quizId: mod.quiz.id,
      type: q.type,
      prompt: q.prompt,
      options: q.type === 'MULTIPLE_CHOICE' ? q.options.filter(Boolean) : null,
      correctAnswer,
      points: Number(q.points),
      sortOrder: (mod.quiz.questions?.length || 0) + 1,
    });
    setQ({ prompt: '', type: 'MULTIPLE_CHOICE', options: ['', '', '', ''], correctAnswer: '', points: 10 });
    setShowQ(false);
    onUpdate();
  };

  if (!mod.quiz) {
    return (
      <div>
        <p className="text-sm text-slate-600 mb-2">Este módulo aún no tiene quiz configurado.</p>
        <button onClick={createQuiz} disabled={creating} className="px-3 py-1 bg-purple-600 text-white rounded text-sm">
          {creating ? 'Creando...' : 'Crear quiz para este módulo'}
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="text-sm text-slate-600 mb-2">
        Aprobado: <strong>{mod.quiz.passingScore}%</strong> · Intentos: <strong>{mod.quiz.maxAttempts}</strong>
      </div>
      <div className="space-y-1 mb-3">
        {(mod.quiz.questions || []).map((q, i) => (
          <div key={q.id} className="p-2 bg-white border border-slate-200 rounded text-sm">
            {i + 1}. [{q.type}] {q.prompt} ({q.points} pts)
          </div>
        ))}
        {(mod.quiz.questions || []).length === 0 && <div className="text-sm text-slate-500 italic">Sin preguntas</div>}
      </div>

      {!showQ ? (
        <button onClick={() => setShowQ(true)} className="px-3 py-1 bg-purple-600 text-white rounded text-sm">+ Agregar pregunta</button>
      ) : (
        <div className="bg-white p-3 rounded border border-slate-200 space-y-2">
          <select value={q.type} onChange={(e) => setQ({ ...q, type: e.target.value })} className="w-full px-2 py-1 border rounded text-sm">
            <option value="MULTIPLE_CHOICE">Opción múltiple</option>
            <option value="TRUE_FALSE">Verdadero/Falso</option>
            <option value="SHORT_ANSWER">Respuesta corta</option>
          </select>
          <textarea value={q.prompt} onChange={(e) => setQ({ ...q, prompt: e.target.value })} placeholder="Pregunta" rows="2" className="w-full px-2 py-1 border rounded text-sm" />

          {q.type === 'MULTIPLE_CHOICE' && (
            <div className="space-y-1">
              {q.options.map((opt, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input value={opt} onChange={(e) => { const n = [...q.options]; n[i] = e.target.value; setQ({ ...q, options: n }); }}
                    placeholder={`Opción ${i + 1}`} className="flex-1 px-2 py-1 border rounded text-sm" />
                  <input type="radio" checked={q.correctAnswer === opt} onChange={() => setQ({ ...q, correctAnswer: opt })} title="Correcta" />
                </div>
              ))}
            </div>
          )}

          {q.type === 'TRUE_FALSE' && (
            <select value={q.correctAnswer} onChange={(e) => setQ({ ...q, correctAnswer: e.target.value })} className="w-full px-2 py-1 border rounded text-sm">
              <option value="">Seleccionar correcta</option>
              <option value="true">Verdadero</option>
              <option value="false">Falso</option>
            </select>
          )}

          {q.type === 'SHORT_ANSWER' && (
            <input value={q.correctAnswer} onChange={(e) => setQ({ ...q, correctAnswer: e.target.value })} placeholder="Respuesta correcta" className="w-full px-2 py-1 border rounded text-sm" />
          )}

          <input type="number" value={q.points} onChange={(e) => setQ({ ...q, points: e.target.value })} placeholder="Puntos" className="w-full px-2 py-1 border rounded text-sm" />

          <div className="flex gap-2">
            <button onClick={addQuestion} className="px-3 py-1 bg-emerald-600 text-white rounded text-sm">Guardar</button>
            <button onClick={() => setShowQ(false)} className="px-3 py-1 bg-slate-200 rounded text-sm">Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
};

const RubricsEditor = ({ module: mod, onUpdate }) => {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ criterion: '', description: '', maxPoints: 10 });

  const add = async () => {
    if (!form.criterion) return;
    await api.post('/academia/rubrics', { moduleId: mod.id, ...form, sortOrder: mod.rubrics.length + 1 });
    setForm({ criterion: '', description: '', maxPoints: 10 });
    setShowForm(false);
    onUpdate();
  };

  return (
    <div>
      <div className="space-y-1 mb-3">
        {mod.rubrics.map((r) => (
          <div key={r.id} className="p-2 bg-white border border-slate-200 rounded text-sm">
            <div className="font-medium">{r.criterion} <span className="text-xs text-slate-500">({r.maxPoints} pts)</span></div>
            {r.description && <div className="text-xs text-slate-600">{r.description}</div>}
          </div>
        ))}
        {mod.rubrics.length === 0 && <div className="text-sm text-slate-500 italic">Sin rúbricas</div>}
      </div>

      {!showForm ? (
        <button onClick={() => setShowForm(true)} className="px-3 py-1 bg-purple-600 text-white rounded text-sm">+ Agregar rúbrica</button>
      ) : (
        <div className="bg-white p-3 rounded border border-slate-200 space-y-2">
          <input value={form.criterion} onChange={(e) => setForm({ ...form, criterion: e.target.value })} placeholder="Criterio (ej. Higiene)" className="w-full px-2 py-1 border rounded text-sm" />
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Descripción" rows="2" className="w-full px-2 py-1 border rounded text-sm" />
          <input type="number" value={form.maxPoints} onChange={(e) => setForm({ ...form, maxPoints: Number(e.target.value) })} placeholder="Puntos máximos" className="w-full px-2 py-1 border rounded text-sm" />
          <div className="flex gap-2">
            <button onClick={add} className="px-3 py-1 bg-emerald-600 text-white rounded text-sm">Guardar</button>
            <button onClick={() => setShowForm(false)} className="px-3 py-1 bg-slate-200 rounded text-sm">Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AcademiaContenido;
