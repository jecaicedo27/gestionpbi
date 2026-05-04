import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../../services/api';
import { useAuth } from '../../../context/AuthContext';
import { ChevronLeft, ClipboardCheck, Plus, FileCheck } from 'lucide-react';

const AcademiaPanelEvaluacion = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [evaluations, setEvaluations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [enrollments, setEnrollments] = useState([]);
  const [modules, setModules] = useState([]);
  const [newEval, setNewEval] = useState({ userId: '', moduleId: '' });

  useEffect(() => {
    if (user?.role !== 'ADMIN') { navigate('/academia'); return; }
    loadData();
  }, [user]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [ev, en, mo] = await Promise.all([
        api.get('/academia/evaluations'),
        api.get('/academia/enrollments'),
        api.get('/academia/modules'),
      ]);
      setEvaluations(ev.data.evaluations || []);
      setEnrollments(en.data.enrollments || []);
      setModules(mo.data.modules || []);
    } finally {
      setLoading(false);
    }
  };

  const createEval = async () => {
    if (!newEval.userId || !newEval.moduleId) {
      alert('Selecciona aprendiz y módulo');
      return;
    }
    try {
      const r = await api.post('/academia/evaluations', newEval);
      setShowForm(false);
      setNewEval({ userId: '', moduleId: '' });
      navigate(`/academia/admin/evaluar/${r.data.evaluation.id}`);
    } catch (err) {
      alert('Error: ' + err.message);
    }
  };

  if (loading) return <div className="p-8 text-center">Cargando...</div>;

  return (
    <div className="max-w-5xl mx-auto p-6">
      <button onClick={() => navigate('/academia')} className="flex items-center gap-2 text-slate-600 hover:text-slate-900 mb-4">
        <ChevronLeft className="w-5 h-5" />
        Volver
      </button>

      <div className="bg-gradient-to-r from-emerald-600 to-teal-600 rounded-2xl p-6 text-white mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ClipboardCheck className="w-10 h-10" />
            <div>
              <h1 className="text-2xl font-bold">Panel de Evaluación</h1>
              <p className="text-emerald-100">Evaluaciones prácticas en planta</p>
            </div>
          </div>
          <button
            onClick={() => setShowForm(!showForm)}
            className="bg-white text-emerald-700 px-4 py-2 rounded-lg font-semibold hover:bg-emerald-50 flex items-center gap-2"
          >
            <Plus className="w-4 h-4" /> Nueva evaluación
          </button>
        </div>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl shadow p-6 mb-6 border border-slate-200">
          <h2 className="font-bold text-slate-800 mb-4">Nueva evaluación práctica</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-slate-700">Aprendiz</label>
              <select
                value={newEval.userId}
                onChange={(e) => setNewEval({ ...newEval, userId: e.target.value })}
                className="w-full mt-1 px-3 py-2 border border-slate-300 rounded"
              >
                <option value="">Seleccionar...</option>
                {enrollments.map((e) => (
                  <option key={e.id} value={e.userId}>{e.user.name} ({e.user.role})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700">Módulo</label>
              <select
                value={newEval.moduleId}
                onChange={(e) => setNewEval({ ...newEval, moduleId: e.target.value })}
                className="w-full mt-1 px-3 py-2 border border-slate-300 rounded"
              >
                <option value="">Seleccionar...</option>
                {modules.map((m) => (
                  <option key={m.id} value={m.id}>{m.code} — {m.title}</option>
                ))}
              </select>
            </div>
          </div>
          <button onClick={createEval} className="mt-4 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700">
            Crear y empezar evaluación
          </button>
        </div>
      )}

      <div className="bg-white rounded-xl shadow border border-slate-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase">
            <tr>
              <th className="p-3 text-left">Fecha</th>
              <th className="p-3 text-left">Aprendiz</th>
              <th className="p-3 text-left">Módulo</th>
              <th className="p-3 text-center">Estado</th>
              <th className="p-3 text-right">Puntaje</th>
              <th className="p-3 text-center">Acción</th>
            </tr>
          </thead>
          <tbody>
            {evaluations.length === 0 && (
              <tr><td colSpan="6" className="p-8 text-center text-slate-500">No hay evaluaciones registradas</td></tr>
            )}
            {evaluations.map((e) => (
              <tr key={e.id} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="p-3 text-sm">{new Date(e.createdAt).toLocaleDateString()}</td>
                <td className="p-3">{e.user?.name}</td>
                <td className="p-3 text-sm">{e.module?.title}</td>
                <td className="p-3 text-center">
                  <span className={`px-2 py-1 text-xs rounded ${
                    e.status === 'APROBADA' ? 'bg-emerald-100 text-emerald-700' :
                    e.status === 'RECHAZADA' ? 'bg-red-100 text-red-700' :
                    e.status === 'EN_PROCESO' ? 'bg-amber-100 text-amber-700' :
                    'bg-slate-100 text-slate-600'
                  }`}>{e.status}</span>
                </td>
                <td className="p-3 text-right font-semibold">{e.scorePct ? `${e.scorePct.toFixed(1)}%` : '—'}</td>
                <td className="p-3 text-center">
                  <button
                    onClick={() => navigate(`/academia/admin/evaluar/${e.id}`)}
                    className="px-3 py-1 text-xs bg-emerald-600 text-white rounded hover:bg-emerald-700"
                  >
                    {e.status === 'PENDIENTE' || e.status === 'EN_PROCESO' ? 'Calificar' : 'Ver'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default AcademiaPanelEvaluacion;
