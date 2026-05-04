import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../services/api';
import { ChevronLeft, CheckCircle, XCircle, Trophy } from 'lucide-react';

const AcademiaQuiz = () => {
  const { moduleId } = useParams();
  const navigate = useNavigate();
  const [quiz, setQuiz] = useState(null);
  const [attempts, setAttempts] = useState([]);
  const [currentAttempt, setCurrentAttempt] = useState(null);
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.get(`/academia/modules/${moduleId}/quiz`)
      .then((r) => {
        setQuiz(r.data.quiz);
        return api.get(`/academia/quizzes/${r.data.quiz.id}/my-attempts`);
      })
      .then((r) => setAttempts(r.data.attempts || []))
      .catch((err) => console.error(err))
      .finally(() => setLoading(false));
  }, [moduleId]);

  const startAttempt = async () => {
    try {
      const r = await api.post(`/academia/quizzes/${quiz.id}/attempts`, {});
      setCurrentAttempt(r.data.attempt);
      setAnswers({});
      setResult(null);
    } catch (err) {
      alert('Error: ' + (err.response?.data?.error || err.message));
    }
  };

  const submitQuiz = async () => {
    setSubmitting(true);
    try {
      const r = await api.post(`/academia/quiz-attempts/${currentAttempt.id}/submit`, { answers });
      setResult(r.data);
      const att = await api.get(`/academia/quizzes/${quiz.id}/my-attempts`);
      setAttempts(att.data.attempts || []);
    } catch (err) {
      alert('Error: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="p-8 text-center">Cargando...</div>;
  if (!quiz) return <div className="p-8 text-center text-amber-600">No hay quiz configurado para este módulo aún.</div>;

  const passedAttempt = attempts.find((a) => a.passed);
  const remaining = quiz.maxAttempts - attempts.length;

  return (
    <div className="max-w-3xl mx-auto p-6">
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-slate-600 hover:text-slate-900 mb-4">
        <ChevronLeft className="w-5 h-5" />
        Volver
      </button>

      <div className="bg-white rounded-xl shadow border border-slate-200 overflow-hidden">
        <div className="bg-gradient-to-r from-purple-600 to-pink-600 p-6 text-white">
          <h1 className="text-2xl font-bold">{quiz.title}</h1>
          <div className="flex gap-4 mt-2 text-sm">
            <span>{quiz.questions?.length || 0} preguntas</span>
            <span>Aprobado: {quiz.passingScore}%</span>
            <span>Intentos restantes: {remaining}</span>
          </div>
        </div>

        <div className="p-6">
          {result ? (
            <ResultView result={result} onClose={() => { setCurrentAttempt(null); setResult(null); }} passingScore={quiz.passingScore} />
          ) : currentAttempt ? (
            <QuestionsView
              questions={quiz.questions}
              answers={answers}
              setAnswers={setAnswers}
              onSubmit={submitQuiz}
              submitting={submitting}
            />
          ) : (
            <StartView
              passedAttempt={passedAttempt}
              attempts={attempts}
              onStart={startAttempt}
              canStart={remaining > 0}
            />
          )}
        </div>
      </div>
    </div>
  );
};

const StartView = ({ passedAttempt, attempts, onStart, canStart }) => (
  <div>
    {passedAttempt && (
      <div className="mb-4 p-4 bg-emerald-50 border border-emerald-300 rounded text-emerald-800 flex items-center gap-2">
        <Trophy className="w-5 h-5" />
        <div>
          <div className="font-semibold">¡Quiz aprobado!</div>
          <div className="text-sm">Tu mejor puntaje: {passedAttempt.score?.toFixed(1)}%</div>
        </div>
      </div>
    )}

    {attempts.length > 0 && (
      <div className="mb-4">
        <h3 className="font-semibold text-slate-700 mb-2">Mis intentos previos</h3>
        <div className="space-y-1">
          {attempts.map((a) => (
            <div key={a.id} className="flex items-center justify-between text-sm p-2 border border-slate-200 rounded">
              <span>Intento #{a.attemptNo} — {new Date(a.startedAt).toLocaleString()}</span>
              <span className={a.passed ? 'text-emerald-600 font-semibold' : 'text-red-500'}>
                {a.score?.toFixed(1)}% {a.passed ? '✓' : '✗'}
              </span>
            </div>
          ))}
        </div>
      </div>
    )}

    <button
      onClick={onStart}
      disabled={!canStart}
      className="w-full py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-slate-300 text-white rounded-lg font-medium"
    >
      {canStart ? 'Iniciar intento' : 'No quedan intentos'}
    </button>
  </div>
);

const QuestionsView = ({ questions, answers, setAnswers, onSubmit, submitting }) => (
  <div className="space-y-6">
    {questions.map((q, idx) => (
      <div key={q.id} className="p-4 border border-slate-200 rounded-lg">
        <div className="font-semibold text-slate-800 mb-3">
          {idx + 1}. {q.prompt}
        </div>

        {q.type === 'MULTIPLE_CHOICE' && Array.isArray(q.options) && (
          <div className="space-y-2">
            {q.options.map((opt, i) => (
              <label key={i} className="flex items-center gap-2 p-2 border border-slate-100 rounded cursor-pointer hover:bg-slate-50">
                <input
                  type="radio"
                  name={`q-${q.id}`}
                  checked={answers[q.id] === opt}
                  onChange={() => setAnswers({ ...answers, [q.id]: opt })}
                />
                <span>{opt}</span>
              </label>
            ))}
          </div>
        )}

        {q.type === 'TRUE_FALSE' && (
          <div className="flex gap-2">
            {[true, false].map((v) => (
              <button
                key={String(v)}
                onClick={() => setAnswers({ ...answers, [q.id]: v })}
                className={`flex-1 py-2 rounded border ${
                  answers[q.id] === v ? 'bg-purple-100 border-purple-400' : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                {v ? 'Verdadero' : 'Falso'}
              </button>
            ))}
          </div>
        )}

        {q.type === 'SHORT_ANSWER' && (
          <input
            type="text"
            value={answers[q.id] || ''}
            onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
            className="w-full px-3 py-2 border border-slate-300 rounded"
            placeholder="Tu respuesta..."
          />
        )}
      </div>
    ))}

    <button
      onClick={onSubmit}
      disabled={submitting}
      className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white rounded-lg font-medium"
    >
      {submitting ? 'Enviando...' : 'Enviar respuestas'}
    </button>
  </div>
);

const ResultView = ({ result, onClose, passingScore }) => (
  <div className="text-center">
    {result.passed ? (
      <div>
        <CheckCircle className="w-20 h-20 text-emerald-500 mx-auto mb-3" />
        <h2 className="text-2xl font-bold text-emerald-700">¡Aprobado!</h2>
        <p className="text-slate-600 mt-2">Obtuviste {result.scorePct?.toFixed(1)}%</p>
      </div>
    ) : (
      <div>
        <XCircle className="w-20 h-20 text-red-500 mx-auto mb-3" />
        <h2 className="text-2xl font-bold text-red-700">No alcanzaste el puntaje</h2>
        <p className="text-slate-600 mt-2">Obtuviste {result.scorePct?.toFixed(1)}% (mínimo: {passingScore}%)</p>
      </div>
    )}
    <button onClick={onClose} className="mt-6 px-6 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-800">
      Cerrar
    </button>
  </div>
);

export default AcademiaQuiz;
