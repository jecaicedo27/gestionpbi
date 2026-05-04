import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../../services/api';
import { useAuth } from '../../../context/AuthContext';
import { ChevronLeft, Users, Award, TrendingUp } from 'lucide-react';

const LEVEL_INFO = {
  BRONCE:  '🥉', PLATA: '🥈', ORO: '🥇', MAESTRO: '🏆',
};

const AcademiaSeguimiento = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [enrollments, setEnrollments] = useState([]);
  const [scoresMap, setScoresMap] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user?.role !== 'ADMIN') {
      navigate('/academia');
      return;
    }
    loadData();
  }, [user]);

  const loadData = async () => {
    setLoading(true);
    try {
      const r = await api.get('/academia/enrollments');
      const list = r.data.enrollments || [];
      setEnrollments(list);

      const scoresEntries = await Promise.all(
        list.map(async (e) => {
          try {
            const s = await api.get(`/academia/users/${e.userId}/score`);
            return [e.userId, s.data.score];
          } catch {
            return [e.userId, null];
          }
        })
      );
      setScoresMap(Object.fromEntries(scoresEntries));
    } finally {
      setLoading(false);
    }
  };

  const certificar = async (userId) => {
    if (!confirm('¿Emitir certificación para este aprendiz con su puntaje actual?')) return;
    try {
      await api.post('/academia/certifications', { userId });
      alert('Certificación emitida');
      loadData();
    } catch (err) {
      alert('Error: ' + (err.response?.data?.error || err.message));
    }
  };

  if (loading) return <div className="p-8 text-center">Cargando...</div>;

  return (
    <div className="max-w-6xl mx-auto p-6">
      <button onClick={() => navigate('/academia')} className="flex items-center gap-2 text-slate-600 hover:text-slate-900 mb-4">
        <ChevronLeft className="w-5 h-5" />
        Volver
      </button>

      <div className="bg-gradient-to-r from-indigo-600 to-purple-600 rounded-2xl p-6 text-white mb-6">
        <div className="flex items-center gap-3">
          <Users className="w-10 h-10" />
          <div>
            <h1 className="text-2xl font-bold">Seguimiento de Líderes</h1>
            <p className="text-indigo-100">Avance, puntaje y certificaciones de tu equipo</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow border border-slate-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase">
            <tr>
              <th className="p-3 text-left">Líder</th>
              <th className="p-3 text-center">Estado</th>
              <th className="p-3 text-right">Puntaje</th>
              <th className="p-3 text-center">Nivel</th>
              <th className="p-3 text-left">KPIs</th>
              <th className="p-3 text-center">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {enrollments.length === 0 && (
              <tr><td colSpan="6" className="p-8 text-center text-slate-500">No hay líderes inscritos aún</td></tr>
            )}
            {enrollments.map((e) => {
              const s = scoresMap[e.userId];
              const kpi = s?.components?.kpis?.detail;
              return (
                <tr key={e.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="p-3">
                    <div className="font-medium">{e.user.name}</div>
                    <div className="text-xs text-slate-500">{e.user.role}</div>
                  </td>
                  <td className="p-3 text-center text-xs">
                    <span className={`px-2 py-1 rounded ${e.status === 'ACTIVO' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                      {e.status}
                    </span>
                  </td>
                  <td className="p-3 text-right font-bold text-indigo-600">{s?.total?.toFixed(0) ?? '—'}</td>
                  <td className="p-3 text-center">{s?.level ? `${LEVEL_INFO[s.level]} ${s.level}` : '—'}</td>
                  <td className="p-3 text-xs text-slate-600">
                    {kpi ? (
                      <div>
                        <div>Baches/turno: <span className="font-semibold">{kpi.avgBatchesPerShift?.toFixed(1) ?? 0}</span> / {kpi.target}</div>
                        <div className="text-slate-400">{kpi.shiftsAnalyzed} turnos · {kpi.periodDays}d</div>
                      </div>
                    ) : '—'}
                  </td>
                  <td className="p-3 text-center">
                    <div className="flex gap-1 justify-center">
                      <button
                        onClick={() => navigate(`/academia/admin/perfil/${e.userId}`)}
                        className="px-2 py-1 text-xs bg-slate-200 hover:bg-slate-300 rounded"
                      >Ver</button>
                      {s?.level && (
                        <button
                          onClick={() => certificar(e.userId)}
                          className="px-2 py-1 text-xs bg-emerald-600 text-white hover:bg-emerald-700 rounded"
                        >Certificar</button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default AcademiaSeguimiento;
