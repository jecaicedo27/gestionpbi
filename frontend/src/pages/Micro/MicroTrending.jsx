import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useAuth } from '../../context/AuthContext';
import { TrendingUp, Filter } from 'lucide-react';
import {
    Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement,
    Title, Tooltip, Legend, Filler
} from 'chart.js';
import { Line } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

const API = import.meta.env.VITE_API_URL;

const COLORS = [
    'rgb(13, 148, 136)', 'rgb(234, 88, 12)', 'rgb(139, 92, 246)',
    'rgb(220, 38, 38)', 'rgb(37, 99, 235)', 'rgb(217, 119, 6)', 'rgb(22, 163, 74)'
];

const MicroTrending = () => {
    const { token } = useAuth();
    const headers = { Authorization: `Bearer ${token}` };

    const [points, setPoints] = useState([]);
    const [params, setParams] = useState([]);
    const [trends, setTrends] = useState([]);
    const [loading, setLoading] = useState(true);

    const [selectedPoint, setSelectedPoint] = useState('');
    const [selectedParam, setSelectedParam] = useState('');
    const [weeks, setWeeks] = useState(12);

    useEffect(() => {
        const fetchConfig = async () => {
            const [pRes, parRes] = await Promise.all([
                axios.get(`${API}/api/micro/sampling-points`, { headers }),
                axios.get(`${API}/api/micro/parameters`, { headers })
            ]);
            setPoints(pRes.data);
            setParams(parRes.data);
        };
        fetchConfig();
    }, []);

    const fetchTrends = useCallback(async () => {
        setLoading(true);
        try {
            const tRes = await axios.get(`${API}/api/micro/trends`, {
                headers,
                params: { pointId: selectedPoint || undefined, parameterId: selectedParam || undefined, weeks }
            });
            setTrends(tRes.data.trends || []);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    }, [selectedPoint, selectedParam, weeks]);

    useEffect(() => { fetchTrends(); }, [fetchTrends]);

    const buildChartData = (trend) => {
        const labels = trend.dataPoints.map(dp => {
            const d = new Date(dp.date);
            return `${d.getDate()}/${d.getMonth() + 1}`;
        });
        const values = trend.dataPoints.map(dp => dp.value);

        const datasets = [{
            label: trend.parameter.name,
            data: values,
            borderColor: COLORS[0],
            backgroundColor: `${COLORS[0]}20`,
            fill: true,
            tension: 0.3,
            pointRadius: 4,
            pointHoverRadius: 6,
            pointBackgroundColor: trend.dataPoints.map(dp =>
                dp.isCompliant === false ? 'rgb(220, 38, 38)' : dp.isCompliant === true ? 'rgb(22, 163, 74)' : 'rgb(156, 163, 175)'
            ),
            pointBorderColor: '#fff',
            pointBorderWidth: 2,
        }];

        // Add spec lines
        if (trend.parameter.specMin !== null && trend.parameter.specMin !== undefined) {
            datasets.push({
                label: `Límite m (${trend.parameter.specMin})`,
                data: new Array(labels.length).fill(trend.parameter.specMin),
                borderColor: 'rgba(234, 179, 8, 0.7)',
                borderDash: [6, 4],
                borderWidth: 2,
                pointRadius: 0,
                fill: false,
            });
        }
        if (trend.parameter.specMax !== null && trend.parameter.specMax !== undefined) {
            datasets.push({
                label: `Límite M (${trend.parameter.specMax})`,
                data: new Array(labels.length).fill(trend.parameter.specMax),
                borderColor: 'rgba(220, 38, 38, 0.7)',
                borderDash: [6, 4],
                borderWidth: 2,
                pointRadius: 0,
                fill: false,
            });
        }

        return { labels, datasets };
    };

    const chartOptions = (trend) => ({
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { position: 'top', labels: { usePointStyle: true, padding: 20, font: { size: 11 } } },
            tooltip: {
                callbacks: {
                    afterLabel: (ctx) => {
                        const dp = trend.dataPoints[ctx.dataIndex];
                        if (!dp) return '';
                        const lines = [];
                        if (dp.point?.code) lines.push(`Punto: ${dp.point.code}`);
                        if (dp.sampleNumber) lines.push(`Muestra: ${dp.sampleNumber}`);
                        if (dp.isCompliant === true) lines.push('✓ Conforme');
                        if (dp.isCompliant === false) lines.push('✗ No Conforme');
                        return lines;
                    }
                }
            }
        },
        scales: {
            y: {
                beginAtZero: true,
                title: { display: true, text: trend.parameter.unit, font: { size: 11 } },
                grid: { color: 'rgba(0,0,0,0.04)' }
            },
            x: {
                title: { display: true, text: 'Fecha', font: { size: 11 } },
                grid: { display: false }
            }
        }
    });

    return (
        <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
            <div className="flex justify-between items-center">
                <div className="flex items-center gap-3">
                    <div className="p-3 bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl text-white shadow-lg shadow-violet-200">
                        <TrendingUp size={28} />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">Tendencias Microbiológicas</h1>
                        <p className="text-sm text-gray-500">Cartas de control SPC — carga bacteriana en el tiempo</p>
                    </div>
                </div>
            </div>

            {/* Filters */}
            <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
                <div className="flex items-center gap-2 mb-3">
                    <Filter size={16} className="text-violet-600" />
                    <h3 className="font-bold text-gray-700 text-sm">Filtros</h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                        <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Punto de Muestreo</label>
                        <select value={selectedPoint} onChange={e => setSelectedPoint(e.target.value)}
                            className="w-full rounded-lg border-gray-200 px-3 py-2 text-sm focus:ring-2 focus:ring-violet-400 outline-none">
                            <option value="">Todos los puntos</option>
                            {points.map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Parámetro</label>
                        <select value={selectedParam} onChange={e => setSelectedParam(e.target.value)}
                            className="w-full rounded-lg border-gray-200 px-3 py-2 text-sm focus:ring-2 focus:ring-violet-400 outline-none">
                            <option value="">Todos los parámetros</option>
                            {params.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Período</label>
                        <select value={weeks} onChange={e => setWeeks(parseInt(e.target.value))}
                            className="w-full rounded-lg border-gray-200 px-3 py-2 text-sm focus:ring-2 focus:ring-violet-400 outline-none">
                            <option value={4}>Últimas 4 semanas</option>
                            <option value={8}>Últimas 8 semanas</option>
                            <option value={12}>Últimas 12 semanas</option>
                            <option value={24}>Últimos 6 meses</option>
                            <option value={52}>Último año</option>
                        </select>
                    </div>
                </div>
            </div>

            {/* Charts */}
            {loading ? (
                <div className="text-center py-12 text-gray-400">Cargando tendencias...</div>
            ) : trends.length === 0 ? (
                <div className="text-center py-16 bg-white rounded-xl border border-gray-100">
                    <TrendingUp size={48} className="mx-auto text-gray-300 mb-3" />
                    <p className="text-gray-500 font-medium">No hay datos de tendencias</p>
                    <p className="text-xs text-gray-400 mt-1">Registre muestras con resultados para ver gráficos</p>
                </div>
            ) : (
                <div className="space-y-6">
                    {trends.map((trend, i) => (
                        <div key={i} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
                            <div className="flex items-center justify-between mb-4">
                                <div>
                                    <h3 className="font-bold text-gray-800">{trend.parameter.name}</h3>
                                    <p className="text-xs text-gray-400">{trend.parameter.unit}
                                        {trend.parameter.specMax && ` • Límite M: ${trend.parameter.specMax}`}
                                        {trend.parameter.specText && ` • ${trend.parameter.specText}`}
                                    </p>
                                </div>
                                <span className="text-xs text-gray-400">{trend.dataPoints.length} puntos</span>
                            </div>
                            <div className="h-72">
                                <Line data={buildChartData(trend)} options={chartOptions(trend)} />
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default MicroTrending;
