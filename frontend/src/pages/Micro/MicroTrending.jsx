import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Activity, Database, Filter, GitCompareArrows, ShieldAlert, ShieldCheck, TrendingUp } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import MicroTrendComparisonCard from './components/MicroTrendComparisonCard';
import MicroTrendSeriesCard from './components/MicroTrendSeriesCard';
import { TREND_COLORS, formatDateTimeLabel } from './microTrendUtils';

const API = import.meta.env.VITE_API_URL;

const buildLatestCapture = (items = []) => items.reduce((latest, current) => {
    if (!latest) return current?.latestCapture || null;
    if (!current?.latestCapture) return latest;
    return new Date(current.latestCapture) > new Date(latest) ? current.latestCapture : latest;
}, null);

const buildVisibleSummary = (trends = [], comparisonGroups = []) => {
    const allDataPoints = trends.flatMap(trend => trend.dataPoints || []);
    const evaluatedCount = allDataPoints.filter(dataPoint => dataPoint.isCompliant !== null).length;
    const logScaleSeriesCount = trends.filter(trend => trend.chartRecommendation?.useLogScale).length;

    return {
        seriesCount: trends.length,
        comparisonGroupCount: comparisonGroups.length,
        totalRecords: allDataPoints.length,
        pointsCovered: new Set(trends.map(trend => trend.point?.id || trend.point?.code).filter(Boolean)).size,
        quantitativeSeriesCount: trends.filter(trend => trend.dataKind === 'quantitative').length,
        qualitativeSeriesCount: trends.filter(trend => trend.dataKind === 'qualitative').length,
        criteriaReadySeriesCount: trends.filter(trend => trend.hasCriteria).length,
        resultsWithoutCriteria: allDataPoints.length - evaluatedCount,
        logScaleSeriesCount,
        latestCapture: buildLatestCapture(trends)
    };
};

const matchesVisibleFilters = (item, dataKindFilter, criteriaOnly) => {
    if (dataKindFilter !== 'all' && item.dataKind !== dataKindFilter) return false;
    if (criteriaOnly && !item.hasCriteria) return false;
    return true;
};

const MicroTrending = ({ embedded = false, refreshSignal = 0 }) => {
    const { token } = useAuth();
    const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

    const [points, setPoints] = useState([]);
    const [params, setParams] = useState([]);
    const [trends, setTrends] = useState([]);
    const [comparisonGroups, setComparisonGroups] = useState([]);
    const [engineSummary, setEngineSummary] = useState({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const [selectedPoint, setSelectedPoint] = useState('');
    const [selectedParam, setSelectedParam] = useState('');
    const [weeks, setWeeks] = useState(12);
    const [dataKindFilter, setDataKindFilter] = useState('all');
    const [criteriaOnly, setCriteriaOnly] = useState(false);

    useEffect(() => {
        const fetchConfig = async () => {
            try {
                const [pointsResponse, paramsResponse] = await Promise.all([
                    axios.get(`${API}/api/micro/sampling-points`, { headers }),
                    axios.get(`${API}/api/micro/parameters`, { headers })
                ]);

                setPoints(pointsResponse.data || []);
                setParams(paramsResponse.data || []);
            } catch (fetchError) {
                setError(fetchError.response?.data?.error || 'No fue posible cargar la configuración analítica.');
            }
        };

        fetchConfig();
    }, [headers]);

    const fetchTrends = useCallback(async () => {
        setLoading(true);
        setError('');

        try {
            const response = await axios.get(`${API}/api/micro/trends`, {
                headers,
                params: {
                    pointId: selectedPoint || undefined,
                    parameterId: selectedParam || undefined,
                    weeks
                }
            });

            setTrends(response.data.trends || []);
            setComparisonGroups(response.data.comparisonGroups || []);
            setEngineSummary(response.data.summary || {});
        } catch (fetchError) {
            setError(fetchError.response?.data?.error || 'No fue posible cargar las tendencias microbiológicas.');
            setTrends([]);
            setComparisonGroups([]);
            setEngineSummary({});
        } finally {
            setLoading(false);
        }
    }, [headers, selectedParam, selectedPoint, weeks]);

    useEffect(() => {
        fetchTrends();
    }, [fetchTrends, refreshSignal]);

    const visibleTrends = useMemo(
        () => trends.filter(trend => matchesVisibleFilters(trend, dataKindFilter, criteriaOnly)),
        [trends, dataKindFilter, criteriaOnly]
    );
    const visibleComparisonGroups = useMemo(
        () => comparisonGroups.filter(group => matchesVisibleFilters(group, dataKindFilter, criteriaOnly)),
        [comparisonGroups, dataKindFilter, criteriaOnly]
    );
    const visibleSummary = useMemo(
        () => buildVisibleSummary(visibleTrends, visibleComparisonGroups),
        [visibleTrends, visibleComparisonGroups]
    );

    return (
        <div className={embedded ? 'space-y-6' : 'mx-auto max-w-[1680px] space-y-6 p-6'}>
            <div className="rounded-3xl border border-slate-100 bg-white shadow-sm overflow-hidden">
                <div className="bg-gradient-to-r from-slate-950 via-cyan-950 to-teal-900 px-6 py-6 text-white">
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                        <div className="flex items-start gap-4">
                            <div className="rounded-2xl border border-white/15 bg-white/10 p-3">
                                <TrendingUp size={28} />
                            </div>
                            <div>
                                <h1 className="text-2xl font-bold">Tendencias Microbiológicas</h1>
                                <p className="mt-1 text-sm text-cyan-50/90">
                                    El motor separa series cuantitativas y cualitativas, arma comparativos solo cuando el dato es realmente comparable y asigna el eje correcto según su escala.
                                </p>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3 xl:min-w-[320px]">
                            <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3">
                                <p className="text-[11px] font-bold uppercase tracking-wide text-cyan-100/80">Grupos Analíticos</p>
                                <p className="mt-1 text-2xl font-bold">{engineSummary.comparisonGroupCount || 0}</p>
                            </div>
                            <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3">
                                <p className="text-[11px] font-bold uppercase tracking-wide text-cyan-100/80">Series Totales</p>
                                <p className="mt-1 text-2xl font-bold">{engineSummary.seriesCount || 0}</p>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="border-t border-slate-100 bg-slate-50/70 px-4 py-4 sm:px-6">
                    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_auto] xl:items-start">
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
                            <div>
                                <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Punto de Muestreo</label>
                                <select
                                    value={selectedPoint}
                                    onChange={(event) => setSelectedPoint(event.target.value)}
                                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-200"
                                >
                                    <option value="">Todos los puntos</option>
                                    {points.map(point => (
                                        <option key={point.id} value={point.id}>
                                            {point.code} — {point.name}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Parámetro</label>
                                <select
                                    value={selectedParam}
                                    onChange={(event) => setSelectedParam(event.target.value)}
                                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-200"
                                >
                                    <option value="">Todos los parámetros</option>
                                    {params.map(parameter => (
                                        <option key={parameter.id} value={parameter.id}>
                                            {parameter.name}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Período</label>
                                <select
                                    value={weeks}
                                    onChange={(event) => setWeeks(parseInt(event.target.value, 10))}
                                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-200"
                                >
                                    <option value={4}>Últimas 4 semanas</option>
                                    <option value={8}>Últimas 8 semanas</option>
                                    <option value={12}>Últimas 12 semanas</option>
                                    <option value={24}>Últimos 6 meses</option>
                                    <option value={52}>Último año</option>
                                </select>
                            </div>

                            <div>
                                <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Tipo de Dato</label>
                                <select
                                    value={dataKindFilter}
                                    onChange={(event) => setDataKindFilter(event.target.value)}
                                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-200"
                                >
                                    <option value="all">Todos</option>
                                    <option value="quantitative">Cuantitativo</option>
                                    <option value="qualitative">Cualitativo</option>
                                </select>
                            </div>

                            <div className="flex items-end">
                                <label className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                                    <input
                                        type="checkbox"
                                        checked={criteriaOnly}
                                        onChange={(event) => setCriteriaOnly(event.target.checked)}
                                        className="h-4 w-4 rounded border-slate-300 text-cyan-600 focus:ring-cyan-400"
                                    />
                                    Mostrar solo series con criterio microbiológico
                                </label>
                            </div>
                        </div>

                        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 xl:min-w-[250px]">
                            <div className="flex items-center gap-2 text-slate-700">
                                <Filter size={15} />
                                <span className="text-sm font-bold">Gestor Analítico</span>
                            </div>
                            <p className="mt-2 text-sm text-slate-600">
                                Comparativos visibles: {visibleSummary.comparisonGroupCount} · Series visibles: {visibleSummary.seriesCount}
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {error && (
                <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {error}
                </div>
            )}

            {!loading && visibleTrends.length > 0 && (
                <>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Series Visibles</p>
                            <p className="mt-1 text-3xl font-bold text-slate-900">{visibleSummary.seriesCount}</p>
                        </div>
                        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Comparativos Coherentes</p>
                            <p className="mt-1 text-3xl font-bold text-cyan-700">{visibleSummary.comparisonGroupCount}</p>
                        </div>
                        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Puntos Cubiertos</p>
                            <p className="mt-1 text-3xl font-bold text-slate-900">{visibleSummary.pointsCovered}</p>
                        </div>
                        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Última Captura</p>
                            <p className="mt-1 text-lg font-bold text-slate-900">{formatDateTimeLabel(visibleSummary.latestCapture)}</p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                        <div className="rounded-2xl border border-cyan-100 bg-cyan-50/70 p-4 shadow-sm">
                            <div className="flex items-center gap-2 text-cyan-800">
                                <Database size={16} />
                                <span className="text-sm font-bold">Motor Compartido</span>
                            </div>
                            <p className="mt-2 text-sm text-slate-700">
                                La base visible reúne {engineSummary.totalRecords || 0} resultado(s) trazables y solo compara series cuando comparten parámetro, unidad y tipo de dato.
                            </p>
                        </div>

                        <div className="rounded-2xl border border-amber-100 bg-amber-50/80 p-4 shadow-sm">
                            <div className="flex items-center gap-2 text-amber-800">
                                {visibleSummary.resultsWithoutCriteria > 0 ? <ShieldAlert size={16} /> : <ShieldCheck size={16} />}
                                <span className="text-sm font-bold">Cobertura Microbiológica</span>
                            </div>
                            <p className="mt-2 text-sm text-slate-700">
                                {visibleSummary.criteriaReadySeriesCount} serie(s) ya tienen criterio. {visibleSummary.resultsWithoutCriteria} registro(s) siguen visibles solo como seguimiento histórico.
                            </p>
                        </div>

                        <div className="rounded-2xl border border-emerald-100 bg-emerald-50/80 p-4 shadow-sm">
                            <div className="flex items-center gap-2 text-emerald-800">
                                <Activity size={16} />
                                <span className="text-sm font-bold">Escalas Activadas</span>
                            </div>
                            <p className="mt-2 text-sm text-slate-700">
                                {visibleSummary.logScaleSeriesCount} serie(s) usan escala log, {visibleSummary.qualitativeSeriesCount} son binarias y {Math.max(visibleSummary.quantitativeSeriesCount - visibleSummary.logScaleSeriesCount, 0)} permanecen lineales.
                            </p>
                        </div>
                    </div>
                </>
            )}

            {loading ? (
                <div className="py-14 text-center text-slate-400">Cargando tendencias...</div>
            ) : trends.length === 0 ? (
                <div className="rounded-3xl border border-slate-100 bg-white py-16 text-center shadow-sm">
                    <TrendingUp size={48} className="mx-auto mb-3 text-slate-300" />
                    <p className="font-medium text-slate-500">No hay datos de tendencias</p>
                    <p className="mt-1 text-xs text-slate-400">Registre muestras con resultados para activar el motor analítico</p>
                </div>
            ) : visibleTrends.length === 0 ? (
                <div className="rounded-3xl border border-slate-100 bg-white py-16 text-center shadow-sm">
                    <GitCompareArrows size={48} className="mx-auto mb-3 text-slate-300" />
                    <p className="font-medium text-slate-500">No hay series visibles con los filtros actuales</p>
                    <p className="mt-1 text-xs text-slate-400">Cambie el tipo de dato o desactive el filtro de criterio para volver a mostrar relaciones</p>
                </div>
            ) : (
                <div className="space-y-8">
                    <section className="space-y-4">
                        <div className="flex flex-col gap-1">
                            <h2 className="text-xl font-bold text-slate-900">Comparativos Coherentes por Parámetro</h2>
                            <p className="text-sm text-slate-500">
                                Cada panel comparte eje y gráfico solo entre series equivalentes, evitando mezclar puntos o tipos de dato que no deberían leerse juntos.
                            </p>
                        </div>

                        <div className="space-y-5">
                            {visibleComparisonGroups.map(group => (
                                <MicroTrendComparisonCard key={group.key} group={group} />
                            ))}
                        </div>
                    </section>

                    <section className="space-y-4">
                        <div className="flex flex-col gap-1">
                            <h2 className="text-xl font-bold text-slate-900">Detalle por Serie</h2>
                            <p className="text-sm text-slate-500">
                                Aquí cada tarjeta mantiene el contexto completo del punto, el criterio microbiológico y el gráfico recomendado para esa serie específica.
                            </p>
                        </div>

                        <div className="space-y-5">
                            {visibleTrends.map((trend, index) => (
                                <MicroTrendSeriesCard
                                    key={trend.key}
                                    trend={trend}
                                    color={TREND_COLORS[index % TREND_COLORS.length]}
                                />
                            ))}
                        </div>
                    </section>
                </div>
            )}
        </div>
    );
};

export default MicroTrending;
