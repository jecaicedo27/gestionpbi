import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
    Activity,
    ArrowRight,
    Calendar,
    CheckCircle2,
    ClipboardList,
    Database,
    FileText,
    FlaskConical,
    Image,
    RefreshCcw,
    TrendingUp
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

const API = import.meta.env.VITE_API_URL;

const getCurrentWeekStart = () => {
    const date = new Date();
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1);
    date.setDate(diff);
    date.setHours(0, 0, 0, 0);
    return date.toISOString().split('T')[0];
};

const buildHealthMeta = (tone = 'healthy') => {
    if (tone === 'warning') {
        return {
            chip: 'bg-amber-50 text-amber-700 border border-amber-200',
            card: 'border-amber-100 bg-amber-50/70'
        };
    }

    if (tone === 'critical') {
        return {
            chip: 'bg-rose-50 text-rose-700 border border-rose-200',
            card: 'border-rose-100 bg-rose-50/70'
        };
    }

    return {
        chip: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
        card: 'border-emerald-100 bg-emerald-50/70'
    };
};

const MicroSystemOverview = ({
    embedded = false,
    refreshSignal = 0,
    onNavigate
}) => {
    const { token } = useAuth();
    const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

    const [dashboard, setDashboard] = useState(null);
    const [schedule, setSchedule] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const fetchOverview = async () => {
        setLoading(true);
        setError('');

        try {
            const [dashboardResponse, scheduleResponse] = await Promise.all([
                axios.get(`${API}/api/micro/dashboard`, { headers }),
                axios.get(`${API}/api/micro/schedule`, {
                    headers,
                    params: { weekStart: getCurrentWeekStart() }
                })
            ]);

            setDashboard(dashboardResponse.data);
            setSchedule(scheduleResponse.data);
        } catch (fetchError) {
            setError(fetchError.response?.data?.error || 'No fue posible cargar la lectura de motores y cobertura del módulo.');
            setDashboard(null);
            setSchedule(null);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchOverview();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [headers, refreshSignal]);

    const recentSamples = dashboard?.recentSamples || [];
    const internalRecentSamples = useMemo(
        () => recentSamples.filter(sample => sample.workflowType === 'INTERNAL'),
        [recentSamples]
    );
    const externalRecentSamples = useMemo(
        () => recentSamples.filter(sample => sample.workflowType === 'EXTERNAL'),
        [recentSamples]
    );

    const internalMissingResults = internalRecentSamples.filter(sample => (sample.summary?.missingRequestedResultsCount || 0) > 0).length;
    const internalWithoutSupports = internalRecentSamples.filter(sample => (sample.summary?.supportAttachmentsCount || 0) === 0).length;
    const internalReadyReview = internalRecentSamples.filter(sample => ['RESULTS_RECORDED', 'TECHNICAL_REVIEW'].includes(sample.status)).length;

    const scheduleSummary = schedule?.summary || {};
    const dashboardSummary = dashboard?.summary || {};
    const dataQualityWarnings = dashboard?.dataQualityWarnings || [];
    const pointInsights = dashboard?.pointInsights || [];

    const motorCards = useMemo(() => {
        const scheduleTone = (scheduleSummary.delayed || 0) + (scheduleSummary.cancelled || 0) + (scheduleSummary.notPerformed || 0) > 0
            ? 'warning'
            : 'healthy';
        const internalTone = internalMissingResults > 0 || internalReadyReview > 0 ? 'warning' : 'healthy';
        const externalTone = (dashboardSummary.externalSamplesWithoutPhotoEvidence || 0) > 0 ? 'warning' : 'healthy';
        const analyticalTone = (dashboardSummary.nonCompliantCount || 0) > 0
            ? 'critical'
            : (dashboardSummary.resultsWithoutCriteria || 0) > 0
                ? 'warning'
                : 'healthy';
        const evidenceTone = dataQualityWarnings.length > 0 ? 'warning' : 'healthy';

        return [
            {
                id: 'schedule',
                title: 'Motor de programación semanal',
                description: 'Coordina agenda operativa, reprogramaciones y toma manual.',
                icon: Calendar,
                tone: scheduleTone,
                metrics: [
                    `${scheduleSummary.planned || 0} programados`,
                    `${(scheduleSummary.inProgress || 0) + (scheduleSummary.awaitingResults || 0)} en proceso`,
                    `${scheduleSummary.completed || 0} cerrados`
                ],
                note: scheduleTone === 'healthy'
                    ? 'La agenda semanal está consistente y sin quiebres operativos relevantes.'
                    : 'Hay eventos retrasados o cancelados que conviene revisar desde la agenda.',
                navTarget: 'control',
                navLabel: 'Abrir agenda'
            },
            {
                id: 'internal',
                title: 'Motor de laboratorio interno',
                description: 'Gestiona recepción, incubación, resultados, revisión, cierre y soportes.',
                icon: ClipboardList,
                tone: internalTone,
                metrics: [
                    `${internalRecentSamples.length} casos recientes`,
                    `${internalReadyReview} listos para revisión`,
                    `${internalMissingResults} con resultados pendientes`
                ],
                note: internalTone === 'healthy'
                    ? 'El flujo interno está cubierto y la cola reciente no muestra faltantes críticos.'
                    : 'La bandeja interna aún tiene casos que necesitan resultados, revisión o soportes.',
                navTarget: 'internal',
                navLabel: 'Administrar internos'
            },
            {
                id: 'external',
                title: 'Motor de laboratorio externo',
                description: 'Conecta recolección, evidencia fotográfica, envío, resultados y reporte.',
                icon: FlaskConical,
                tone: externalTone,
                metrics: [
                    `${externalRecentSamples.length} casos recientes`,
                    `${dashboardSummary.externalSamplesWithoutPhotoEvidence || 0} sin foto`,
                    `${dashboard?.statusSummary?.AWAITING_RESULTS || 0} esperando resultado`
                ],
                note: externalTone === 'healthy'
                    ? 'El flujo externo mantiene evidencia y continuidad adecuadas en la ventana reciente.'
                    : 'Todavía hay externos sin evidencia fotográfica suficiente para trazabilidad robusta.',
                navTarget: 'control',
                navLabel: 'Ver externos'
            },
            {
                id: 'analytics',
                title: 'Motor analítico y tendencias',
                description: 'Separa datos evaluables, cobertura de criterio y lectura de tendencias.',
                icon: TrendingUp,
                tone: analyticalTone,
                metrics: [
                    `${dashboardSummary.totalResultsRecorded || 0} resultados`,
                    `${dashboardSummary.evaluatedResults || 0} evaluables`,
                    `${dashboardSummary.complianceRate ?? 0}% cumplimiento`
                ],
                note: analyticalTone === 'critical'
                    ? 'Hay resultados fuera de criterio y el tablero analítico debe revisarse con prioridad.'
                    : analyticalTone === 'warning'
                        ? 'Persisten parámetros sin criterio microbiológico completo dentro del motor analítico.'
                        : 'La lectura analítica actual está bien soportada por datos evaluables.',
                navTarget: 'trends',
                navLabel: 'Abrir tendencias'
            },
            {
                id: 'evidence',
                title: 'Motor de evidencia y trazabilidad',
                description: 'Cruza reportes, soportes, fotos y calidad de datos sobre la misma base.',
                icon: Database,
                tone: evidenceTone,
                metrics: [
                    `${dashboardSummary.totalSamplesWithReport || 0} con reporte`,
                    `${dashboardSummary.totalSamplesWithPhotoEvidence || 0} con foto`,
                    `${dataQualityWarnings.length} alerta(s) de calidad`
                ],
                note: evidenceTone === 'healthy'
                    ? 'La capa documental y la lectura de calidad están alineadas con los datos recientes.'
                    : 'Todavía hay advertencias de cobertura documental o de calidad de datos que conviene cerrar.',
                navTarget: 'control',
                navLabel: 'Ir al control'
            }
        ];
    }, [
        dashboard?.statusSummary?.AWAITING_RESULTS,
        dashboardSummary.complianceRate,
        dashboardSummary.evaluatedResults,
        dashboardSummary.externalSamplesWithoutPhotoEvidence,
        dashboardSummary.nonCompliantCount,
        dashboardSummary.resultsWithoutCriteria,
        dashboardSummary.totalResultsRecorded,
        dashboardSummary.totalSamplesWithPhotoEvidence,
        dashboardSummary.totalSamplesWithReport,
        dataQualityWarnings.length,
        externalRecentSamples.length,
        internalMissingResults,
        internalReadyReview,
        internalRecentSamples.length,
        scheduleSummary.awaitingResults,
        scheduleSummary.cancelled,
        scheduleSummary.completed,
        scheduleSummary.delayed,
        scheduleSummary.inProgress,
        scheduleSummary.notPerformed,
        scheduleSummary.planned
    ]);

    const gapItems = useMemo(() => {
        const items = [];

        if (internalMissingResults > 0) {
            items.push({
                id: 'internal-missing-results',
                title: 'Casos internos con resultados pendientes',
                message: `${internalMissingResults} caso(s) internos recientes todavía no completan todos los análisis solicitados.`,
                tone: 'warning',
                navTarget: 'internal'
            });
        }

        if (internalWithoutSupports > 0) {
            items.push({
                id: 'internal-without-supports',
                title: 'Casos internos sin soportes',
                message: `${internalWithoutSupports} caso(s) internos recientes no tienen soportes complementarios cargados.`,
                tone: 'warning',
                navTarget: 'internal'
            });
        }

        if ((dashboardSummary.externalSamplesWithoutPhotoEvidence || 0) > 0) {
            items.push({
                id: 'external-without-photo',
                title: 'Recolecciones externas sin foto suficiente',
                message: `${dashboardSummary.externalSamplesWithoutPhotoEvidence} caso(s) externos recientes quedaron sin evidencia fotográfica.`,
                tone: 'warning',
                navTarget: 'control'
            });
        }

        dataQualityWarnings.forEach(warning => {
            items.push({
                id: warning.id,
                title: warning.title,
                message: warning.message,
                tone: warning.severity === 'WARNING' ? 'warning' : 'healthy',
                navTarget: 'overview'
            });
        });

        if ((dashboardSummary.nonCompliantCount || 0) > 0) {
            items.push({
                id: 'non-compliant-results',
                title: 'Resultados fuera de criterio',
                message: `${dashboardSummary.nonCompliantCount} resultado(s) recientes quedaron fuera de especificación microbiológica.`,
                tone: 'critical',
                navTarget: 'trends'
            });
        }

        return items.slice(0, 8);
    }, [
        dashboardSummary.externalSamplesWithoutPhotoEvidence,
        dashboardSummary.nonCompliantCount,
        dataQualityWarnings,
        internalMissingResults,
        internalWithoutSupports
    ]);

    if (loading && !dashboard) {
        return (
            <div className="flex h-64 items-center justify-center text-slate-400">
                <div className="flex items-center gap-3">
                    <Activity className="animate-pulse" size={28} />
                    Cargando motores y cobertura del módulo...
                </div>
            </div>
        );
    }

    return (
        <div className={embedded ? 'space-y-6' : 'mx-auto max-w-[1680px] space-y-6 p-6'}>
            <div className="rounded-3xl border border-slate-100 bg-white shadow-sm overflow-hidden">
                <div className="bg-gradient-to-r from-slate-950 via-cyan-950 to-teal-900 px-6 py-6 text-white">
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                        <div className="flex items-start gap-4">
                            <div className="rounded-2xl border border-white/15 bg-white/10 p-3">
                                <Activity size={28} />
                            </div>
                            <div>
                                <h1 className="text-2xl font-bold">Motores y Cobertura del Sistema</h1>
                                <p className="mt-1 text-sm text-cyan-50/90">
                                    Vista ejecutiva para entender qué motores del módulo están bien resueltos, qué brechas siguen activas y desde qué submódulo conviene atacarlas.
                                </p>
                            </div>
                        </div>

                        <button
                            type="button"
                            onClick={fetchOverview}
                            className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white/10 px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/15"
                        >
                            <RefreshCcw size={16} />
                            Actualizar lectura
                        </button>
                    </div>
                </div>
            </div>

            {error && (
                <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {error}
                </div>
            )}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
                {motorCards.map(card => {
                    const Icon = card.icon;
                    const health = buildHealthMeta(card.tone);
                    return (
                        <div key={card.id} className={`rounded-3xl border px-5 py-5 shadow-sm ${health.card}`}>
                            <div className="flex items-start justify-between gap-3">
                                <div className="rounded-2xl border border-white/60 bg-white/70 p-3 text-slate-800">
                                    <Icon size={20} />
                                </div>
                                <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${health.chip}`}>
                                    {card.tone === 'healthy' ? 'Sano' : card.tone === 'critical' ? 'Crítico' : 'Atención'}
                                </span>
                            </div>
                            <h2 className="mt-4 text-base font-bold text-slate-900">{card.title}</h2>
                            <p className="mt-1 text-sm text-slate-600">{card.description}</p>

                            <div className="mt-4 space-y-1 text-sm text-slate-700">
                                {card.metrics.map(metric => (
                                    <p key={metric}>{metric}</p>
                                ))}
                            </div>

                            <p className="mt-4 text-sm text-slate-600">{card.note}</p>

                            {typeof onNavigate === 'function' && (
                                <button
                                    type="button"
                                    onClick={() => onNavigate(card.navTarget)}
                                    className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-cyan-800 hover:text-cyan-900"
                                >
                                    {card.navLabel}
                                    <ArrowRight size={14} />
                                </button>
                            )}
                        </div>
                    );
                })}
            </div>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.2fr)_420px]">
                <div className="rounded-3xl border border-slate-100 bg-white shadow-sm overflow-hidden">
                    <div className="px-5 py-4 border-b border-slate-100">
                        <h2 className="font-bold text-slate-900">Brechas detectadas por el sistema</h2>
                        <p className="mt-1 text-xs text-slate-500">
                            Son hallazgos operativos reales basados en programación, resultados, soportes y lectura de calidad de datos.
                        </p>
                    </div>

                    <div className="p-5 space-y-3">
                        {gapItems.length === 0 ? (
                            <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-4 text-sm text-emerald-800 flex items-start gap-3">
                                <CheckCircle2 size={18} className="mt-0.5" />
                                <div>
                                    <p className="font-semibold">Sin brechas relevantes en esta lectura</p>
                                    <p className="mt-1 text-emerald-700">
                                        Los motores principales están cubiertos con el estado actual de la base reciente.
                                    </p>
                                </div>
                            </div>
                        ) : (
                            gapItems.map(item => {
                                const health = buildHealthMeta(item.tone);
                                return (
                                    <div key={item.id} className={`rounded-2xl border px-4 py-4 ${health.card}`}>
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <p className="font-semibold text-slate-900">{item.title}</p>
                                                <p className="mt-1 text-sm text-slate-600">{item.message}</p>
                                            </div>
                                            {typeof onNavigate === 'function' && (
                                                <button
                                                    type="button"
                                                    onClick={() => onNavigate(item.navTarget)}
                                                    className="inline-flex items-center gap-1 rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-white"
                                                >
                                                    Ir
                                                    <ArrowRight size={12} />
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>

                <div className="space-y-6">
                    <div className="rounded-3xl border border-slate-100 bg-white shadow-sm overflow-hidden">
                        <div className="px-5 py-4 border-b border-slate-100">
                            <h2 className="font-bold text-slate-900">Cobertura visible</h2>
                            <p className="mt-1 text-xs text-slate-500">
                                Qué tanto material útil tiene hoy cada capa del módulo.
                            </p>
                        </div>
                        <div className="p-5 space-y-3">
                            <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-4">
                                <div className="flex items-center gap-2 text-slate-700">
                                    <FileText size={16} />
                                    <span className="font-semibold">Reportes disponibles</span>
                                </div>
                                <p className="mt-2 text-3xl font-bold text-slate-900">{dashboardSummary.totalSamplesWithReport || 0}</p>
                                <p className="mt-1 text-sm text-slate-500">{dashboardSummary.reportCoverageRate ?? 0}% de las muestras recientes</p>
                            </div>

                            <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-4">
                                <div className="flex items-center gap-2 text-slate-700">
                                    <Image size={16} />
                                    <span className="font-semibold">Cobertura fotográfica</span>
                                </div>
                                <p className="mt-2 text-3xl font-bold text-slate-900">{dashboardSummary.totalSamplesWithPhotoEvidence || 0}</p>
                                <p className="mt-1 text-sm text-slate-500">{dashboardSummary.photoCoverageRate ?? 0}% con evidencia foto</p>
                            </div>

                            <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-4">
                                <div className="flex items-center gap-2 text-slate-700">
                                    <TrendingUp size={16} />
                                    <span className="font-semibold">Resultados evaluables</span>
                                </div>
                                <p className="mt-2 text-3xl font-bold text-slate-900">{dashboardSummary.evaluatedResults || 0}</p>
                                <p className="mt-1 text-sm text-slate-500">{dashboardSummary.evaluationCoverageRate ?? 0}% con criterio</p>
                            </div>
                        </div>
                    </div>

                    <div className="rounded-3xl border border-slate-100 bg-white shadow-sm overflow-hidden">
                        <div className="px-5 py-4 border-b border-slate-100">
                            <h2 className="font-bold text-slate-900">Lo que aún conviene fortalecer</h2>
                            <p className="mt-1 text-xs text-slate-500">
                                Lectura práctica del siguiente tramo de mejora del módulo.
                            </p>
                        </div>
                        <div className="p-5 space-y-3 text-sm">
                            <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-4 text-amber-900">
                                <p className="font-semibold">Bandejas por responsabilidad</p>
                                <p className="mt-1 text-amber-800">
                                    El siguiente nivel es separar bandeja de ejecución, revisión técnica y cierre para no depender solo del estado del caso.
                                </p>
                            </div>

                            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-slate-800">
                                <p className="font-semibold">Cobertura normativa por método</p>
                                <p className="mt-1 text-slate-600">
                                    Sigue siendo útil enriquecer el maestro método-matriz-criterio para que el motor analítico herede más validaciones desde configuración.
                                </p>
                            </div>

                            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-slate-800">
                                <p className="font-semibold">KPIs operativos de laboratorio</p>
                                <p className="mt-1 text-slate-600">
                                    La estructura ya permite construir TAT, aging, carga por estado y cobertura documental como siguiente capa ejecutiva.
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="rounded-3xl border border-slate-100 bg-white shadow-sm overflow-hidden">
                        <div className="px-5 py-4 border-b border-slate-100">
                            <h2 className="font-bold text-slate-900">Cobertura reciente por punto</h2>
                            <p className="mt-1 text-xs text-slate-500">
                                Lectura resumida de los puntos con actividad reciente.
                            </p>
                        </div>
                        <div className="divide-y divide-slate-100">
                            {pointInsights.slice(0, 5).map(point => (
                                <div key={point.id} className="px-5 py-4">
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <p className="font-semibold text-slate-900">{point.code} · {point.name}</p>
                                            <p className="mt-1 text-xs text-slate-500">
                                                {point.sampleCount} muestra(s) · {point.resultCount} resultado(s) · {point.photoEvidenceCount} foto(s)
                                            </p>
                                        </div>
                                        <span className="inline-flex rounded-full bg-cyan-50 px-2.5 py-1 text-[11px] font-semibold text-cyan-700 border border-cyan-100">
                                            {point.evaluationCoverageRate ?? 0}% criterio
                                        </span>
                                    </div>
                                </div>
                            ))}
                            {pointInsights.length === 0 && (
                                <div className="px-5 py-8 text-sm text-slate-500">
                                    Aún no hay puntos con actividad reciente para resumir.
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default MicroSystemOverview;
