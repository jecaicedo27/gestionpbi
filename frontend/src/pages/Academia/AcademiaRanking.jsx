import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import { ChevronLeft, Trophy } from 'lucide-react';

const LEVEL_INFO = {
  BRONCE:  { icon: '🥉', color: 'text-orange-700' },
  PLATA:   { icon: '🥈', color: 'text-slate-700' },
  ORO:     { icon: '🥇', color: 'text-yellow-700' },
  MAESTRO: { icon: '🏆', color: 'text-purple-700' },
};

const AcademiaRanking = () => {
  const navigate = useNavigate();
  const [ranking, setRanking] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/academia/ranking')
      .then((r) => setRanking(r.data.ranking || []))
      .catch((err) => console.error(err))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-8 text-center">Cargando...</div>;

  return (
    <div className="max-w-3xl mx-auto p-6">
      <button onClick={() => navigate('/academia')} className="flex items-center gap-2 text-slate-600 hover:text-slate-900 mb-4">
        <ChevronLeft className="w-5 h-5" />
        Volver
      </button>

      <div className="bg-gradient-to-r from-amber-500 to-orange-600 rounded-2xl p-6 text-white mb-6">
        <div className="flex items-center gap-3">
          <Trophy className="w-10 h-10" />
          <div>
            <h1 className="text-2xl font-bold">Ranking de Líderes</h1>
            <p className="text-amber-100">Quién va liderando la academia</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow border border-slate-200 overflow-hidden">
        {ranking.length === 0 ? (
          <div className="p-8 text-center text-slate-500">Aún no hay líderes inscritos</div>
        ) : (
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="p-3 text-left text-xs font-semibold text-slate-600 uppercase">Pos</th>
                <th className="p-3 text-left text-xs font-semibold text-slate-600 uppercase">Líder</th>
                <th className="p-3 text-right text-xs font-semibold text-slate-600 uppercase">Puntaje</th>
                <th className="p-3 text-center text-xs font-semibold text-slate-600 uppercase">Nivel</th>
              </tr>
            </thead>
            <tbody>
              {ranking.map((row, idx) => (
                <tr key={row.userId} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="p-3 font-semibold text-slate-700">
                    {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`}
                  </td>
                  <td className="p-3">
                    <div className="font-medium">{row.name}</div>
                    <div className="text-xs text-slate-500">{row.role}</div>
                  </td>
                  <td className="p-3 text-right font-bold text-indigo-600">{row.total?.toFixed(0)}</td>
                  <td className="p-3 text-center">
                    {row.level ? (
                      <span className={LEVEL_INFO[row.level]?.color}>
                        {LEVEL_INFO[row.level]?.icon} {row.level}
                      </span>
                    ) : (
                      <span className="text-slate-400 text-sm">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default AcademiaRanking;
