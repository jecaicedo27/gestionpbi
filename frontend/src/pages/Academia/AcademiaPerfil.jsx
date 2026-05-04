import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import { ChevronLeft, Trophy, Award, TrendingUp, Target } from 'lucide-react';

const LEVEL_INFO = {
  BRONCE:  { label: 'Bronce',  color: 'bg-orange-100 text-orange-800',   icon: '🥉', range: '700-799' },
  PLATA:   { label: 'Plata',   color: 'bg-slate-100 text-slate-800',     icon: '🥈', range: '800-879' },
  ORO:     { label: 'Oro',     color: 'bg-yellow-100 text-yellow-800',   icon: '🥇', range: '880-939' },
  MAESTRO: { label: 'Maestro', color: 'bg-purple-100 text-purple-800',   icon: '🏆', range: '940-1000' },
};

const AcademiaPerfil = () => {
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [score, setScore] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/academia/me/profile'),
      api.get('/academia/me/score'),
    ])
      .then(([p, s]) => {
        setProfile(p.data.profile);
        setScore(s.data.score);
      })
      .catch((err) => console.error(err))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-8 text-center">Cargando...</div>;
  if (!profile) return <div className="p-8 text-center text-red-600">No se pudo cargar el perfil</div>;

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <button onClick={() => navigate('/academia')} className="flex items-center gap-2 text-slate-600 hover:text-slate-900">
        <ChevronLeft className="w-5 h-5" />
        Volver al catálogo
      </button>

      {/* Score */}
      <div className="bg-gradient-to-r from-indigo-600 to-purple-600 rounded-2xl p-6 text-white">
        <div className="flex items-center gap-2 text-indigo-100"><Trophy className="w-5 h-5" /> Mi puntaje total</div>
        <div className="text-5xl font-bold mt-2">{score?.total?.toFixed(0) ?? 0}<span className="text-2xl opacity-70">/1000</span></div>
        <div className="mt-3 flex items-center gap-2">
          {score?.level ? (
            <div className="px-3 py-1 bg-white/20 rounded-full font-semibold">
              {LEVEL_INFO[score.level]?.icon} {LEVEL_INFO[score.level]?.label}
            </div>
          ) : (
            <div className="px-3 py-1 bg-white/20 rounded-full text-sm">Aún sin certificación (mínimo 700 pts)</div>
          )}
        </div>
      </div>

      {/* Componentes del puntaje */}
      <div className="bg-white rounded-xl shadow p-6 border border-slate-200">
        <h2 className="font-bold text-slate-800 mb-4">Desglose del puntaje</h2>
        <div className="space-y-3">
          {score?.components && Object.entries(score.components).map(([key, comp]) => (
            <ScoreBar key={key} label={LABELS[key] || key} score={comp.score} max={comp.max} />
          ))}
        </div>
      </div>

      {/* Niveles */}
      <div className="bg-white rounded-xl shadow p-6 border border-slate-200">
        <h2 className="font-bold text-slate-800 mb-4">Niveles de certificación</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Object.entries(LEVEL_INFO).map(([key, info]) => {
            const isCurrent = score?.level === key;
            return (
              <div key={key} className={`p-4 rounded-lg border-2 ${isCurrent ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200'}`}>
                <div className="text-3xl">{info.icon}</div>
                <div className="font-semibold mt-2">{info.label}</div>
                <div className="text-xs text-slate-500 mt-1">{info.range} pts</div>
                {isCurrent && <div className="text-xs text-indigo-600 font-semibold mt-1">Tu nivel actual</div>}
              </div>
            );
          })}
        </div>
      </div>

      {/* Certificaciones obtenidas */}
      {profile.certifications?.length > 0 && (
        <div className="bg-white rounded-xl shadow p-6 border border-slate-200">
          <h2 className="font-bold text-slate-800 mb-4">Mis certificaciones</h2>
          <div className="space-y-2">
            {profile.certifications.map((c) => (
              <div key={c.id} className="flex items-center justify-between p-3 border border-slate-100 rounded">
                <div>
                  <div className="font-semibold">{LEVEL_INFO[c.level]?.icon} {LEVEL_INFO[c.level]?.label}</div>
                  <div className="text-xs text-slate-500">Otorgada: {new Date(c.awardedAt).toLocaleDateString()}</div>
                </div>
                <div className="text-lg font-bold text-indigo-600">{c.totalScore.toFixed(0)} pts</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const LABELS = {
  quizzes: '📝 Quiz teóricos',
  practicals: '🛠️ Evaluaciones prácticas',
  kpis: '📊 KPIs reales del turno',
  finalProject: '🎓 Proyecto final',
  behavior: '👤 Comportamiento (360°)',
};

const ScoreBar = ({ label, score, max }) => {
  const pct = max > 0 ? (score / max) * 100 : 0;
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-slate-700">{label}</span>
        <span className="font-semibold">{score?.toFixed(1) ?? 0} / {max}</span>
      </div>
      <div className="w-full bg-slate-200 rounded-full h-2">
        <div className="bg-gradient-to-r from-indigo-500 to-purple-500 h-2 rounded-full" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
};

export default AcademiaPerfil;
