import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../../services/api';
import { ChevronLeft, Save } from 'lucide-react';

const AcademiaEvaluar = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [evaluation, setEvaluation] = useState(null);
  const [scores, setScores] = useState({});
  const [observations, setObservations] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get(`/academia/evaluations/${id}`)
      .then((r) => {
        setEvaluation(r.data.evaluation);
        setObservations(r.data.evaluation.observations || '');
        const existing = (r.data.evaluation.scoreDetail || []).reduce((acc, s) => {
          acc[s.rubricId] = { points: s.points, observation: s.observation || '' };
          return acc;
        }, {});
        setScores(existing);
      })
      .catch((err) => console.error(err))
      .finally(() => setLoading(false));
  }, [id]);

  const submit = async (status) => {
    setSaving(true);
    try {
      const scoreDetail = Object.entries(scores).map(([rubricId, v]) => ({ rubricId, ...v }));
      await api.post(`/academia/evaluations/${id}/submit`, {
        scoreDetail,
        observations,
        status,
      });
      alert('Evaluación guardada');
      navigate('/academia/admin/evaluaciones');
    } catch (err) {
      alert('Error: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-8 text-center">Cargando...</div>;
  if (!evaluation) return <div className="p-8 text-center text-red-600">No encontrada</div>;

  const rubrics = evaluation.module?.rubrics || [];
  const totalPoints = Object.values(scores).reduce((sum, v) => sum + (Number(v.points) || 0), 0);
  const maxPoints = rubrics.reduce((sum, r) => sum + r.maxPoints, 0);
  const pct = maxPoints > 0 ? (totalPoints / maxPoints) * 100 : 0;

  return (
    <div className="max-w-3xl mx-auto p-6">
      <button onClick={() => navigate('/academia/admin/evaluaciones')} className="flex items-center gap-2 text-slate-600 hover:text-slate-900 mb-4">
        <ChevronLeft className="w-5 h-5" />
        Volver
      </button>

      <div className="bg-white rounded-xl shadow p-6 border border-slate-200 mb-4">
        <div className="text-xs text-emerald-600 font-medium uppercase">Evaluación práctica</div>
        <h1 className="text-xl font-bold mt-1">{evaluation.module?.title}</h1>
        <div className="flex gap-4 mt-2 text-sm text-slate-600">
          <span>Aprendiz: <strong>{evaluation.user?.name}</strong></span>
          <span>Estado: <strong>{evaluation.status}</strong></span>
        </div>
      </div>

      {rubrics.length === 0 ? (
        <div className="p-6 bg-amber-50 border border-amber-200 rounded text-amber-800">
          Este módulo aún no tiene rúbricas configuradas. Crea rúbricas en el editor de contenido antes de evaluar.
        </div>
      ) : (
        <div className="space-y-3">
          {rubrics.map((r) => {
            const v = scores[r.id] || { points: 0, observation: '' };
            return (
              <div key={r.id} className="bg-white rounded-lg shadow-sm border border-slate-200 p-4">
                <div className="flex justify-between items-start gap-4">
                  <div className="flex-1">
                    <div className="font-semibold text-slate-800">{r.criterion}</div>
                    {r.description && <div className="text-sm text-slate-600 mt-1">{r.description}</div>}
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="0"
                      max={r.maxPoints}
                      value={v.points}
                      onChange={(e) => setScores({ ...scores, [r.id]: { ...v, points: Number(e.target.value) } })}
                      className="w-20 px-2 py-1 border border-slate-300 rounded text-right"
                    />
                    <span className="text-slate-500 text-sm">/ {r.maxPoints}</span>
                  </div>
                </div>
                <textarea
                  value={v.observation}
                  onChange={(e) => setScores({ ...scores, [r.id]: { ...v, observation: e.target.value } })}
                  placeholder="Observación (opcional)..."
                  className="w-full mt-2 px-2 py-1 text-sm border border-slate-200 rounded"
                  rows="2"
                />
              </div>
            );
          })}
        </div>
      )}

      <div className="bg-white rounded-xl shadow p-4 border border-slate-200 mt-4">
        <label className="text-sm font-medium text-slate-700">Observaciones generales</label>
        <textarea
          value={observations}
          onChange={(e) => setObservations(e.target.value)}
          rows="3"
          className="w-full mt-1 px-3 py-2 border border-slate-300 rounded"
        />
      </div>

      <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 mt-4">
        <div className="flex justify-between items-center">
          <span className="font-semibold text-indigo-800">Puntaje actual:</span>
          <span className="text-2xl font-bold text-indigo-700">{totalPoints} / {maxPoints} ({pct.toFixed(1)}%)</span>
        </div>
      </div>

      <div className="flex gap-2 mt-6">
        <button
          onClick={() => submit('APROBADA')}
          disabled={saving || rubrics.length === 0}
          className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white rounded-lg font-medium flex items-center justify-center gap-2"
        >
          <Save className="w-4 h-4" /> Aprobar evaluación
        </button>
        <button
          onClick={() => submit('RECHAZADA')}
          disabled={saving || rubrics.length === 0}
          className="flex-1 py-3 bg-red-600 hover:bg-red-700 disabled:bg-slate-300 text-white rounded-lg font-medium"
        >
          Rechazar
        </button>
      </div>
    </div>
  );
};

export default AcademiaEvaluar;
