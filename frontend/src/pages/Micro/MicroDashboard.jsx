import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useAuth } from '../../context/AuthContext';
import {
    AlertTriangle,
    Ban,
    Building2,
    Calendar,
    CheckCircle2,
    ChevronLeft,
    ChevronRight,
    ClipboardList,
    Clock3,
    ExternalLink,
    FileText,
    FlaskConical,
    Image,
    RefreshCcw,
    ShieldAlert,
    ShieldCheck,
    Tag
} from 'lucide-react';
import MicroSampleEntry from './MicroSampleEntry';
import MicroInternalLabEntry from './MicroInternalLabEntry';
import MicroSchedulePlannerModal from './MicroSchedulePlannerModal';
import MicroDashboardWorkspaceHero from './components/MicroDashboardWorkspaceHero';
import { buildMicroLabelPayloadFromScheduleEntry, downloadMicroLabelPdf } from './microLabelUtils';
import {
    DAY_NAMES,
    LAB_COLOR,
    LAB_LABELS,
    STATUS_META,
    WORK_CONTEXT_OPTIONS,
    SHIFT_OPTIONS,
    LABORATORY_PROFILE_OPTIONS,
    buildOptionLabel,
    formatDateLabel
} from './microLabConfig';

const API = import.meta.env.VITE_API_URL;

const PENDING_EXTERNAL_ENTRY_STATUSES = new Set(['IN_PROGRESS', 'IN_PROCESS', 'AWAITING_RESULTS']);
const RESCHEDULABLE_ENTRY_STATUSES = new Set(['CANCELLED', 'NOT_PERFORMED']);
const TRACEABLE_ENTRY_STATUSES = new Set(['RESCHEDULED']);

const WORKSPACE_OPTIONS = [
    { value: 'ALL', label: 'Todo el dashboard' },
    { value: 'AGENDA', label: 'Solo agenda semanal' },
    { value: 'OPERATIONS', label: 'Control operativo' },
    { value: 'QUALITY', label: 'Calidad y cobertura' },
    { value: 'HISTORY', label: 'Historial reciente' }
];

const QUICK_ACTION_OPTIONS = [
    { value: '', label: 'Selecciona una acción rápida' },
    { value: 'CREATE_SCHEDULE', label: 'Crear nueva programación' },
    { value: 'OPEN_EXTERNAL', label: 'Registrar externo manual' },
    { value: 'OPEN_INTERNAL', label: 'Registrar interno manual' },
    { value: 'OPEN_INTERNAL_ADMIN', label: 'Abrir administración interna' },
    { value: 'OPEN_OVERVIEW', label: 'Ir a motores y cobertura' },
    { value: 'OPEN_POINTS', label: 'Ir a puntos de muestreo' },
    { value: 'REFRESH', label: 'Sincronizar dashboard' }
];

const MicroDashboard = ({
    embedded = false,
    refreshSignal = 0,
    onDataChange,
    onOpenPointsConfig,
    onOpenInternalAdmin,
    onOpenSystemOverview
}) => {
    const { token } = useAuth();
    const headers = { Authorization: `Bearer ${token}` };

    const [schedule, setSchedule] = useState(null);
    const [dashboard, setDashboard] = useState(null);
    const [loading, setLoading] = useState(true);
    const [weekOffset, setWeekOffset] = useState(0);
    const [actionError, setActionError] = useState('');
    const [entryActionId, setEntryActionId] = useState('');
    const [labelEntryId, setLabelEntryId] = useState('');
    const [showRecentSamples, setShowRecentSamples] = useState(false);
    const [workspaceMode, setWorkspaceMode] = useState('ALL');
    const [quickAction, setQuickAction] = useState('');
    const [plannerEntry, setPlannerEntry] = useState(null);
    const [plannerDate, setPlannerDate] = useState('');
    const [showPlanner, setShowPlanner] = useState(false);

    const [showExternalEntry, setShowExternalEntry] = useState(false);
    const [externalScheduleEntry, setExternalScheduleEntry] = useState(null);
    const [externalSampleId, setExternalSampleId] = useState(null);

    const [showInternalEntry, setShowInternalEntry] = useState(false);
    const [internalScheduleEntry, setInternalScheduleEntry] = useState(null);
    const [internalSampleId, setInternalSampleId] = useState(null);

    const todayIso = new Date().toISOString().split('T')[0];

    const getWeekStart = () => {
        const date = new Date();
        const day = date.getDay();
        const diff = date.getDate() - day + (day === 0 ? -6 : 1) + (weekOffset * 7);
        date.setDate(diff);
        date.setHours(0, 0, 0, 0);
        return date.toISOString().split('T')[0];
    };

    const fetchData = async () => {
        setLoading(true);
        setActionError('');
        try {
            const [scheduleResponse, dashboardResponse] = await Promise.all([
                axios.get(`${API}/api/micro/schedule`, { headers, params: { weekStart: getWeekStart() } }),
                axios.get(`${API}/api/micro/dashboard`, { headers })
            ]);
            setSchedule(scheduleResponse.data);
            setDashboard(dashboardResponse.data);
        } catch (fetchError) {
            setActionError('No fue posible cargar la programación semanal de laboratorio');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [weekOffset, refreshSignal]);

    const closePlanner = () => {
        setShowPlanner(false);
        setPlannerEntry(null);
        setPlannerDate('');
    };

    const closeExternalEntry = () => {
        setShowExternalEntry(false);
        setExternalScheduleEntry(null);
        setExternalSampleId(null);
    };

    const closeInternalEntry = () => {
        setShowInternalEntry(false);
        setInternalScheduleEntry(null);
        setInternalSampleId(null);
    };

    const handleRefresh = async () => {
        if (typeof onDataChange === 'function') {
            onDataChange();
            return;
        }
        await fetchData();
    };

    const handleQuickAction = async (value) => {
        setQuickAction(value);
        if (!value) return;

        if (value === 'CREATE_SCHEDULE') {
            openPlanner(null, getWeekStart());
        } else if (value === 'OPEN_EXTERNAL') {
            openExternal({});
        } else if (value === 'OPEN_INTERNAL') {
            openInternal({});
        } else if (value === 'OPEN_INTERNAL_ADMIN') {
            onOpenInternalAdmin?.();
        } else if (value === 'OPEN_OVERVIEW') {
            onOpenSystemOverview?.();
        } else if (value === 'OPEN_POINTS') {
            onOpenPointsConfig?.();
        } else if (value === 'REFRESH') {
            await handleRefresh();
        }

        window.setTimeout(() => {
            setQuickAction('');
        }, 0);
    };

    const handleCancelScheduleEntry = async (entry) => {
        if (!entry?.id || entry.source === 'AD_HOC' || entry.sample?.id) return;

        const confirmationMessage = `¿Cancelar la programación de ${entry.point?.code || 'este punto'} para ${entry.plannedDate}?`;
        if (!window.confirm(confirmationMessage)) return;

        const reason = window.prompt('Motivo de cancelación (opcional):', entry.statusReason || '') || '';

        setEntryActionId(entry.id);
        setActionError('');
        try {
            await axios.post(`${API}/api/micro/schedule/entries/${entry.id}/cancel`, {
                reason
            }, { headers });
            await handleRefresh();
        } catch (cancelError) {
            setActionError(cancelError.response?.data?.error || 'No fue posible cancelar la programación');
        } finally {
            setEntryActionId('');
        }
    };

    const handleGenerateEntryLabel = async (entry) => {
        if (!entry) return;

        setLabelEntryId(entry.id);
        setActionError('');

        try {
            await downloadMicroLabelPdf({
                token,
                payload: buildMicroLabelPayloadFromScheduleEntry(entry)
            });
        } catch (labelError) {
            setActionError(labelError.response?.data?.error || 'No fue posible generar la etiqueta PDF de la muestra');
        } finally {
            setLabelEntryId('');
        }
    };

    const openPlanner = (entry = null, date = '') => {
        setPlannerEntry(entry);
        setPlannerDate(date || entry?.plannedDate || getWeekStart());
        setShowPlanner(true);
    };

    const openExternal = ({ entry = null, sampleId = null } = {}) => {
        setExternalScheduleEntry(entry);
        setExternalSampleId(sampleId);
        setShowExternalEntry(true);
    };

    const openInternal = ({ entry = null, sampleId = null } = {}) => {
        setInternalScheduleEntry(entry);
        setInternalSampleId(sampleId);
        setShowInternalEntry(true);
    };

    const handleEntryAction = (entry) => {
        if (!entry) return;

        if (!entry.sample?.id && (RESCHEDULABLE_ENTRY_STATUSES.has(entry.status) || TRACEABLE_ENTRY_STATUSES.has(entry.status))) {
            openPlanner(entry, entry.plannedDate);
            return;
        }

        if (entry.sample?.workflowType === 'INTERNAL' || (!entry.sample && entry.workflowType === 'INTERNAL')) {
            openInternal({ entry, sampleId: entry.sample?.id || null });
            return;
        }

        openExternal({ entry, sampleId: entry.sample?.id || null });
    };

    const handleSampleRowClick = (sample) => {
        if (!sample) return;
        if (sample.workflowType === 'INTERNAL') {
            openInternal({ entry: sample.scheduleEntry || null, sampleId: sample.id });
            return;
        }
        openExternal({ entry: sample.scheduleEntry || null, sampleId: sample.id });
    };

    const getEntryActionLabel = (entry, fallbackLabel) => {
        const workflowType = entry.sample?.workflowType || entry.workflowType;

        if (!entry.sample?.id && RESCHEDULABLE_ENTRY_STATUSES.has(entry.status)) return 'Reagendar';
        if (!entry.sample?.id && TRACEABLE_ENTRY_STATUSES.has(entry.status)) return 'Ver trazabilidad';
        if (workflowType !== 'EXTERNAL') return fallbackLabel;

        if (!entry.sample?.id) {
            if (entry.status === 'PLANNED' || entry.status === 'DELAYED') return 'Registrar recolección';
            return fallbackLabel;
        }
        if (PENDING_EXTERNAL_ENTRY_STATUSES.has(entry.status)) return 'Cargar resultados';

        return fallbackLabel;
    };

    const getCompactEntryActionLabel = (label) => {
        if (label === 'Registrar recolección') return 'Registrar toma';
        return label;
    };

    const summaryCards = useMemo(() => {
        if (!schedule?.summary) return [];
        return [
            { label: 'Programados', value: schedule.summary.planned, tone: 'bg-slate-50 text-slate-900 border-slate-100' },
            { label: 'Retrasados', value: schedule.summary.delayed, tone: 'bg-amber-50 text-amber-900 border-amber-100' },
            { label: 'Cancelados', value: schedule.summary.cancelled, tone: 'bg-rose-50 text-rose-900 border-rose-100' },
            { label: 'No realizados', value: schedule.summary.notPerformed, tone: 'bg-red-50 text-red-900 border-red-100' },
            { label: 'En proceso', value: (schedule.summary.inProgress || 0) + (schedule.summary.awaitingResults || 0), tone: 'bg-blue-50 text-blue-900 border-blue-100' },
            { label: 'Reagendados', value: schedule.summary.rescheduled, tone: 'bg-violet-50 text-violet-900 border-violet-100' },
            { label: 'Cerrados', value: schedule.summary.completed, tone: 'bg-emerald-50 text-emerald-900 border-emerald-100' }
        ];
    }, [schedule]);

    const calendarDays = useMemo(() => schedule?.days || [], [schedule?.days]);

    const workflowSummary = dashboard?.workflowSummary || {};
    const statusSummary = dashboard?.statusSummary || {};
    const dashboardSummary = dashboard?.summary || {};
    const resultSummary = dashboard?.resultSummary || {};
    const pointInsights = dashboard?.pointInsights || [];
    const dataQualityWarnings = dashboard?.dataQualityWarnings || [];
    const recentSamples = dashboard?.recentSamples || [];
    const internalRecentSamples = useMemo(
        () => recentSamples.filter(sample => sample.workflowType === 'INTERNAL'),
        [recentSamples]
    );
    const internalStatusCards = useMemo(() => ([
        {
            label: 'Recepcionados',
            value: internalRecentSamples.filter(sample => sample.status === 'RECEIVED').length,
            tone: 'border-sky-100 bg-sky-50 text-sky-900'
        },
        {
            label: 'En seguimiento',
            value: internalRecentSamples.filter(sample => sample.status === 'IN_PROCESS').length,
            tone: 'border-cyan-100 bg-cyan-50 text-cyan-900'
        },
        {
            label: 'Resultados listos',
            value: internalRecentSamples.filter(sample => sample.status === 'RESULTS_RECORDED').length,
            tone: 'border-emerald-100 bg-emerald-50 text-emerald-900'
        },
        {
            label: 'En revisión',
            value: internalRecentSamples.filter(sample => sample.status === 'TECHNICAL_REVIEW').length,
            tone: 'border-fuchsia-100 bg-fuchsia-50 text-fuchsia-900'
        },
        {
            label: 'Rechazados',
            value: internalRecentSamples.filter(sample => sample.status === 'REJECTED').length,
            tone: 'border-rose-100 bg-rose-50 text-rose-900'
        },
        {
            label: 'Cerrados',
            value: internalRecentSamples.filter(sample => sample.status === 'CLOSED').length,
            tone: 'border-slate-100 bg-slate-50 text-slate-900'
        }
    ]), [internalRecentSamples]);
    const internalActiveCases = useMemo(
        () => internalRecentSamples
            .filter(sample => !['CLOSED', 'REJECTED'].includes(sample.status))
            .slice(0, 8),
        [internalRecentSamples]
    );
    const heroBadges = useMemo(() => ([
        {
            label: 'Semana activa',
            value: schedule?.weekStart && schedule?.weekEnd
                ? `${schedule.weekStart} a ${schedule.weekEnd}`
                : 'Sin agenda'
        },
        {
            label: 'Internos abiertos',
            value: `${internalActiveCases.length} caso(s)`
        },
        {
            label: 'Alertas',
            value: `${(dashboard?.alerts || []).length} activas`
        },
        {
            label: 'Cobertura',
            value: `${dashboardSummary.evaluationCoverageRate ?? 0}% con criterio`
        }
    ]), [dashboard?.alerts, dashboardSummary.evaluationCoverageRate, internalActiveCases.length, schedule?.weekEnd, schedule?.weekStart]);
    const topSummaryCards = useMemo(() => ([
        summaryCards[0],
        summaryCards[4],
        summaryCards[6],
        summaryCards[5]
    ].filter(Boolean)), [summaryCards]);
    const showCalendarSection = workspaceMode === 'ALL' || workspaceMode === 'AGENDA';
    const showOperationsSection = workspaceMode === 'ALL' || workspaceMode === 'OPERATIONS';
    const showQualitySection = workspaceMode === 'ALL' || workspaceMode === 'QUALITY';
    const showHistorySection = workspaceMode === 'ALL' || workspaceMode === 'HISTORY';
    const displayRecentSamples = showRecentSamples;

    useEffect(() => {
        if (workspaceMode === 'HISTORY') {
            setShowRecentSamples(true);
        }
    }, [workspaceMode]);

    if (loading && !schedule) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="flex items-center gap-3 text-gray-400">
                    <FlaskConical className="animate-pulse" size={32} />
                    Cargando programación y reportes de laboratorio...
                </div>
            </div>
        );
    }

    return (
        <div className={embedded ? 'space-y-6' : 'p-6 space-y-6 max-w-[1700px] mx-auto'}>
            <MicroDashboardWorkspaceHero
                heroBadges={heroBadges}
                summaryCards={topSummaryCards}
                workspaceMode={workspaceMode}
                workspaceOptions={WORKSPACE_OPTIONS}
                quickAction={quickAction}
                quickActionOptions={QUICK_ACTION_OPTIONS}
                onWorkspaceModeChange={setWorkspaceMode}
                onQuickActionChange={handleQuickAction}
                onCreateSchedule={() => openPlanner(null, getWeekStart())}
                onRefresh={handleRefresh}
                onOpenExternal={() => openExternal({})}
                onOpenInternal={() => openInternal({})}
                onOpenInternalAdmin={onOpenInternalAdmin}
                onOpenSystemOverview={onOpenSystemOverview}
                onOpenPointsConfig={onOpenPointsConfig}
            />

            {actionError && (
                <div className="bg-red-50 text-red-700 p-3 rounded-2xl border border-red-100 text-sm flex items-center gap-2">
                    <AlertTriangle size={16} /> {actionError}
                </div>
            )}

            {showCalendarSection && (
                <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden transition-all duration-300">
                <div className="px-5 py-4 border-b border-gray-100 bg-gradient-to-r from-slate-50 to-cyan-50 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex items-center gap-3">
                        <Calendar size={18} className="text-cyan-700" />
                        <div>
                            <h2 className="font-bold text-slate-900">Calendario operativo</h2>
                            <p className="text-xs text-slate-500 mt-1">
                                {schedule?.weekStart} a {schedule?.weekEnd} · programaciones guardadas y muestras registradas sin programación previa
                            </p>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            onClick={() => setWeekOffset(previous => previous - 1)}
                            className="p-2 rounded-xl hover:bg-slate-100 text-slate-600"
                        >
                            <ChevronLeft size={18} />
                        </button>
                        <button
                            type="button"
                            onClick={() => setWeekOffset(0)}
                            className="rounded-xl px-3 py-2 text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
                        >
                            Volver a hoy
                        </button>
                        <button
                            type="button"
                            onClick={() => setWeekOffset(previous => previous + 1)}
                            className="p-2 rounded-xl hover:bg-slate-100 text-slate-600"
                        >
                            <ChevronRight size={18} />
                        </button>
                        <button
                            type="button"
                            onClick={handleRefresh}
                            className="inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-slate-700 border border-slate-200 hover:bg-slate-50"
                        >
                            <RefreshCcw size={16} /> Sincronizar
                        </button>
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <div className="grid min-w-[1680px] grid-cols-7">
                        {calendarDays.map(day => {
                            const isToday = day.date === todayIso;
                            return (
                                <div key={day.date} className={`border-r border-gray-100 last:border-r-0 ${isToday ? 'bg-cyan-50/50' : 'bg-white'}`}>
                                    <div className={`px-4 py-4 border-b border-gray-100 ${isToday ? 'bg-cyan-100/70' : 'bg-slate-50'}`}>
                                        <div className="flex items-center justify-between gap-3">
                                            <div>
                                                <p className="text-sm font-bold text-slate-900">{DAY_NAMES[day.dayOfWeek]}.</p>
                                                <p className="text-xs text-slate-500 mt-1">{formatDateLabel(day.date)}</p>
                                            </div>
                                            {isToday && (
                                                <span className="inline-flex rounded-full bg-teal-600 px-2.5 py-1 text-[11px] font-semibold text-white">
                                                    Hoy
                                                </span>
                                            )}
                                        </div>
                                        <div className="grid grid-cols-2 gap-2 mt-3">
                                            <div className="rounded-xl bg-white border border-slate-100 px-3 py-2">
                                                <p className="text-[10px] font-bold uppercase text-slate-400">Programados</p>
                                                <p className="text-lg font-bold text-slate-900">{day.summary.planned}</p>
                                            </div>
                                            <div className="rounded-xl bg-white border border-emerald-100 px-3 py-2">
                                                <p className="text-[10px] font-bold uppercase text-emerald-600">Cerrados</p>
                                                <p className="text-lg font-bold text-emerald-900">{day.summary.completed}</p>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="p-3 min-h-[520px] space-y-3">
                                        {day.entries.length === 0 ? (
                                            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-400">
                                                Sin laboratorios programados.
                                            </div>
                                        ) : (
                                            day.entries.map(entry => {
                                                const statusMeta = STATUS_META[entry.status] || STATUS_META.PLANNED;
                                                const actionLabel = getEntryActionLabel(entry, statusMeta.actionLabel);
                                                const compactActionLabel = getCompactEntryActionLabel(actionLabel);
                                                const canCancelEntry = (
                                                    entry.source !== 'AD_HOC'
                                                    && !entry.sample?.id
                                                    && !RESCHEDULABLE_ENTRY_STATUSES.has(entry.status)
                                                    && !TRACEABLE_ENTRY_STATUSES.has(entry.status)
                                                );
                                                const canGenerateLabel = (
                                                    (entry.sample?.workflowType || entry.workflowType) === 'EXTERNAL'
                                                );
                                                const isCancellingEntry = entryActionId === entry.id;
                                                const isGeneratingLabel = labelEntryId === entry.id;
                                                const showEditButton = entry.source !== 'AD_HOC';
                                                const secondaryActionCount = Number(showEditButton) + Number(canCancelEntry);
                                                const hasTraceability = Array.isArray(entry.statusHistory) && entry.statusHistory.length > 0;
                                                return (
                                                    <div key={entry.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-cyan-200 hover:shadow-lg">
                                                        <div className="flex items-start justify-between gap-2">
                                                            <div className="min-w-0">
                                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                                <span className="text-[11px] font-bold text-cyan-800 bg-cyan-50 px-2 py-1 rounded-lg">
                                                                        {entry.point?.code}
                                                                    </span>
                                                                    {entry.point?.zoneCode && (
                                                                        <span className="text-[11px] font-bold text-slate-700 bg-slate-100 px-2 py-1 rounded-lg">
                                                                            {entry.point.zoneCode}
                                                                        </span>
                                                                    )}
                                                                    <span className="text-sm font-semibold text-slate-900 leading-tight">
                                                                        {entry.point?.name}
                                                                    </span>
                                                                </div>
                                                                <p className="text-xs text-slate-500 mt-1">{entry.zoneName || entry.point?.zoneName || 'Sin zona definida'}</p>
                                                            </div>
                                                            <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusMeta.chipClass}`}>
                                                                {statusMeta.label}
                                                            </span>
                                                        </div>

                                                        <div className="mt-3 flex flex-wrap gap-1.5">
                                                            <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${LAB_COLOR[entry.workflowType] || 'bg-slate-100 text-slate-700 border border-slate-200'}`}>
                                                                {LAB_LABELS[entry.workflowType] || entry.workflowType}
                                                            </span>
                                                            <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                                                                {buildOptionLabel(WORK_CONTEXT_OPTIONS, entry.workContext)}
                                                            </span>
                                                            <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                                                                {buildOptionLabel(LABORATORY_PROFILE_OPTIONS, entry.laboratoryProfile)}
                                                            </span>
                                                        </div>

                                                        <div className="mt-3 space-y-1.5 text-xs text-slate-500">
                                                            <p className="flex items-center gap-1.5">
                                                                <Clock3 size={12} className="text-slate-400" />
                                                                {buildOptionLabel(SHIFT_OPTIONS, entry.shift)} · {entry.plannedTime || 'Sin hora'}
                                                            </p>
                                                            <p className="flex items-center gap-1.5">
                                                                <Building2 size={12} className="text-slate-400" />
                                                                {entry.assignedLab || 'Sin laboratorio asignado'}
                                                            </p>
                                                            {entry.sample?.sampleNumber && (
                                                                <p className="flex items-center gap-1.5">
                                                                    <ClipboardList size={12} className="text-slate-400" />
                                                                    {entry.sample.sampleNumber}
                                                                </p>
                                                            )}
                                                        </div>

                                                        {entry.notes && (
                                                            <p className="mt-3 text-xs text-slate-600 rounded-xl bg-slate-50 border border-slate-100 px-3 py-2">
                                                                {entry.notes}
                                                            </p>
                                                        )}

                                                        {(entry.statusReason || hasTraceability) && (
                                                            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                                                                {entry.statusReason && (
                                                                    <p><span className="font-semibold text-slate-700">Motivo:</span> {entry.statusReason}</p>
                                                                )}
                                                                {hasTraceability && (
                                                                    <p className={entry.statusReason ? 'mt-1' : ''}>
                                                                        <span className="font-semibold text-slate-700">Trazabilidad:</span> {entry.statusHistory.length} evento(s)
                                                                    </p>
                                                                )}
                                                            </div>
                                                        )}

                                                        <div className="mt-4 space-y-2">
                                                            <button
                                                                type="button"
                                                                onClick={() => handleEntryAction(entry)}
                                                                disabled={isCancellingEntry}
                                                                title={actionLabel}
                                                                className={`flex min-h-[42px] w-full items-center justify-center rounded-xl px-3 py-2.5 text-xs font-semibold text-center leading-tight transition-colors ${statusMeta.actionClass}`}
                                                            >
                                                                {compactActionLabel}
                                                            </button>
                                                            {secondaryActionCount > 0 && (
                                                                <div className={`grid gap-2 ${secondaryActionCount > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                                                                    {showEditButton && (
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => openPlanner(entry, entry.plannedDate)}
                                                                            disabled={isCancellingEntry}
                                                                            className="min-h-[42px] rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                                                                        >
                                                                            Editar
                                                                        </button>
                                                                    )}
                                                                    {canCancelEntry && (
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => handleCancelScheduleEntry(entry)}
                                                                            disabled={isCancellingEntry}
                                                                            className="inline-flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl border border-red-200 px-3 py-2.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
                                                                        >
                                                                            {isCancellingEntry ? (
                                                                                <span className="h-3.5 w-3.5 rounded-full border-2 border-red-300 border-t-red-600 animate-spin" />
                                                                            ) : (
                                                                                <Ban size={13} />
                                                                            )}
                                                                            {isCancellingEntry ? 'Cancelando...' : 'Cancelar'}
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            )}
                                                            {canGenerateLabel && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleGenerateEntryLabel(entry)}
                                                                    disabled={isCancellingEntry || isGeneratingLabel}
                                                                    className="inline-flex min-h-[42px] w-full items-center justify-center gap-1.5 rounded-xl border border-slate-900 px-3 py-2.5 text-xs font-semibold text-slate-900 hover:bg-slate-900 hover:text-white disabled:opacity-60"
                                                                >
                                                                    {isGeneratingLabel ? (
                                                                        <span className="h-3.5 w-3.5 rounded-full border-2 border-slate-400 border-t-slate-900 animate-spin" />
                                                                    ) : (
                                                                        <Tag size={13} />
                                                                    )}
                                                                    {isGeneratingLabel ? 'Generando etiqueta...' : 'Generar etiqueta'}
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            })
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
                </div>
            )}

            {dashboard && (
                <div className="space-y-6">
                    {showOperationsSection && (
                        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-5 transition-all duration-300 hover:shadow-md">
                            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                <div>
                                    <h2 className="font-bold text-slate-900">Casos de laboratorio</h2>
                                    <p className="text-xs text-slate-500 mt-1">
                                        Estos indicadores salen de muestras realmente registradas, no de la programación semanal.
                                    </p>
                                </div>
                                <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                                    {dashboardSummary.totalSamples || 0} caso(s) en 4 semanas
                                </span>
                            </div>
                            <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-6">
                                <div className="rounded-2xl border border-orange-100 bg-orange-50 px-4 py-4 transition-all duration-300 hover:-translate-y-0.5">
                                    <p className="text-xs font-bold uppercase text-orange-700">Externos</p>
                                    <p className="text-3xl font-bold text-orange-900 mt-1">{workflowSummary.EXTERNAL || 0}</p>
                                </div>
                                <div className="rounded-2xl border border-teal-100 bg-teal-50 px-4 py-4 transition-all duration-300 hover:-translate-y-0.5">
                                    <p className="text-xs font-bold uppercase text-teal-700">Internos</p>
                                    <p className="text-3xl font-bold text-teal-900 mt-1">{workflowSummary.INTERNAL || 0}</p>
                                </div>
                                <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-4 transition-all duration-300 hover:-translate-y-0.5">
                                    <p className="text-xs font-bold uppercase text-blue-700">En proceso</p>
                                    <p className="text-3xl font-bold text-blue-900 mt-1">
                                        {(statusSummary.IN_PROCESS || 0)
                                            + (statusSummary.AWAITING_RESULTS || 0)
                                            + (statusSummary.SAMPLED || 0)
                                            + (statusSummary.RECEIVED || 0)
                                            + (statusSummary.RESULTS_RECORDED || 0)
                                            + (statusSummary.TECHNICAL_REVIEW || 0)}
                                    </p>
                                </div>
                                <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-4 transition-all duration-300 hover:-translate-y-0.5">
                                    <p className="text-xs font-bold uppercase text-emerald-700">Cerrados</p>
                                    <p className="text-3xl font-bold text-emerald-900 mt-1">{(statusSummary.CLOSED || 0) + (statusSummary.COMPLETED || 0)}</p>
                                </div>
                                <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-4 transition-all duration-300 hover:-translate-y-0.5">
                                    <p className="text-xs font-bold uppercase text-slate-500">Con PDF</p>
                                    <p className="text-3xl font-bold text-slate-900 mt-1">{dashboardSummary.totalSamplesWithReport || 0}</p>
                                </div>
                                <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-4 transition-all duration-300 hover:-translate-y-0.5">
                                    <p className="text-xs font-bold uppercase text-amber-700">Sin foto</p>
                                    <p className="text-3xl font-bold text-amber-900 mt-1">{dashboardSummary.externalSamplesWithoutPhotoEvidence || 0}</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {showOperationsSection && (
                        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-5 transition-all duration-300 hover:shadow-md">
                            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                <div>
                                    <h2 className="font-bold text-slate-900">Pulso del laboratorio interno</h2>
                                    <p className="text-xs text-slate-500 mt-1">
                                        Seguimiento por etapa del flujo interno y visibilidad rápida de los casos todavía abiertos.
                                    </p>
                                </div>
                                <span className="inline-flex items-center gap-2 rounded-full bg-teal-50 px-3 py-1 text-xs font-semibold text-teal-700">
                                    {internalRecentSamples.length} caso(s) internos en 4 semanas
                                </span>
                            </div>

                            <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-3">
                                {internalStatusCards.map(card => (
                                    <div key={card.label} className={`rounded-2xl border px-4 py-4 transition-all duration-300 hover:-translate-y-0.5 ${card.tone}`}>
                                        <p className="text-xs font-bold uppercase opacity-70">{card.label}</p>
                                        <p className="text-3xl font-bold mt-1">{card.value}</p>
                                    </div>
                                ))}
                            </div>

                            <div className="mt-5 rounded-2xl border border-slate-100 overflow-hidden">
                                <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between gap-3">
                                    <p className="text-sm font-bold text-slate-900">Casos internos activos</p>
                                    <span className="text-xs text-slate-500">Últimos 8 casos no cerrados</span>
                                </div>

                                {internalActiveCases.length === 0 ? (
                                    <div className="px-4 py-8 text-center text-sm text-slate-500">
                                        No hay casos internos activos en la ventana reciente.
                                    </div>
                                ) : (
                                    <div className="overflow-x-auto">
                                        <table className="min-w-full text-sm">
                                            <thead className="bg-white">
                                                <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                                                    <th className="px-4 py-3">Caso</th>
                                                    <th className="px-4 py-3">Punto</th>
                                                    <th className="px-4 py-3">Estado</th>
                                                    <th className="px-4 py-3">Resultados</th>
                                                    <th className="px-4 py-3">Soportes</th>
                                                    <th className="px-4 py-3">Última actividad</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {internalActiveCases.map(sample => {
                                                    const statusMeta = STATUS_META[sample.status] || STATUS_META.PLANNED;
                                                    const sampleSummary = sample.summary || {};
                                                    const latestActivity = sampleSummary.reviewedAt
                                                        || sampleSummary.resultsCapturedAt
                                                        || sampleSummary.latestLogDate
                                                        || sampleSummary.receivedAt
                                                        || sample.takenAt;

                                                    return (
                                                        <tr
                                                            key={sample.id}
                                                            className="border-t border-slate-100 cursor-pointer transition-colors hover:bg-slate-50"
                                                            onClick={() => handleSampleRowClick(sample)}
                                                        >
                                                            <td className="px-4 py-3">
                                                                <div>
                                                                    <p className="font-semibold text-slate-900">{sample.sampleNumber}</p>
                                                                    <p className="text-xs text-slate-500">{sample.reportNumber || 'Sin reporte final'}</p>
                                                                </div>
                                                            </td>
                                                            <td className="px-4 py-3 text-slate-600">
                                                                {sample.samplingPoint?.code || '—'} · {sample.samplingPoint?.name || 'Sin punto'}
                                                            </td>
                                                            <td className="px-4 py-3">
                                                                <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${statusMeta.chipClass}`}>
                                                                    {statusMeta.label}
                                                                </span>
                                                            </td>
                                                            <td className="px-4 py-3 text-slate-600">
                                                                {sampleSummary.requestedParametersCount > 0
                                                                    ? `${sampleSummary.requestedResultsRecordedCount || 0}/${sampleSummary.requestedParametersCount}`
                                                                    : sampleSummary.resultsCount || 0}
                                                            </td>
                                                            <td className="px-4 py-3 text-slate-600">
                                                                {sampleSummary.supportAttachmentsCount || 0}
                                                            </td>
                                                            <td className="px-4 py-3 text-slate-500">
                                                                {latestActivity ? new Date(latestActivity).toLocaleDateString('es-CO') : '—'}
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {showOperationsSection && (
                        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-5 transition-all duration-300 hover:shadow-md">
                            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                <div>
                                    <h2 className="font-bold text-slate-900">Evaluación microbiológica</h2>
                                    <p className="text-xs text-slate-500 mt-1">
                                        Separamos resultados medidos de resultados realmente evaluables contra criterio microbiológico.
                                    </p>
                                </div>
                                <span className="inline-flex items-center gap-2 rounded-full bg-cyan-50 px-3 py-1 text-xs font-semibold text-cyan-700">
                                    {dashboardSummary.evaluationCoverageRate ?? 0}% con criterio
                                </span>
                            </div>
                            <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
                                <div className="rounded-2xl border border-gray-100 bg-slate-50 px-4 py-4">
                                    <p className="text-xs font-bold uppercase text-gray-400">Resultados registrados</p>
                                    <p className="text-3xl font-bold text-slate-900 mt-1">{dashboardSummary.totalResultsRecorded || dashboardSummary.totalResults || 0}</p>
                                </div>
                                <div className="rounded-2xl border border-gray-100 bg-slate-50 px-4 py-4">
                                    <p className="text-xs font-bold uppercase text-gray-400">Evaluables</p>
                                    <p className="text-3xl font-bold text-slate-900 mt-1">{dashboardSummary.evaluatedResults || 0}</p>
                                </div>
                                <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-4">
                                    <p className="text-xs font-bold uppercase text-emerald-700">Cumplimiento</p>
                                    <p className="text-3xl font-bold text-slate-900 mt-1">
                                        {dashboardSummary.complianceRate !== null && dashboardSummary.complianceRate !== undefined
                                            ? `${dashboardSummary.complianceRate}%`
                                            : '—'}
                                    </p>
                                </div>
                                <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-4">
                                    <p className="text-xs font-bold uppercase text-red-700">Sin criterio</p>
                                    <p className="text-3xl font-bold text-red-900 mt-1">{dashboardSummary.resultsWithoutCriteria || 0}</p>
                                </div>
                            </div>

                            <div className="mt-4 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                                <p className="text-sm text-slate-700">
                                    {dashboardSummary.nonCompliantCount > 0
                                        ? `${dashboardSummary.nonCompliantCount} resultado(s) quedaron fuera de criterio en este período.`
                                        : 'No hay resultados marcados fuera de criterio en este período.'}
                                </p>
                                {(resultSummary.missingCriteriaParameters || []).length > 0 && (
                                    <div className="mt-3 flex flex-wrap gap-2">
                                        {(resultSummary.missingCriteriaParameters || []).map(parameter => (
                                            <span key={parameter.id} className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700">
                                                {parameter.code}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {showQualitySection && (
                        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden transition-all duration-300 hover:shadow-md">
                            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
                                <div>
                                    <h2 className="font-bold text-slate-900">Cobertura por punto</h2>
                                    <p className="text-xs text-slate-500 mt-1">Priorización real por punto, con muestras, resultados y soportes.</p>
                                </div>
                                <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                                    {pointInsights.length} punto(s)
                                </span>
                            </div>

                            {pointInsights.length === 0 ? (
                                <div className="px-5 py-10 text-center text-sm text-slate-500">
                                    Aún no hay puntos con actividad reciente.
                                </div>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="min-w-full divide-y divide-gray-100">
                                        <thead className="bg-slate-50">
                                            <tr>
                                                <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Punto</th>
                                                <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Muestras</th>
                                                <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Resultados</th>
                                                <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Cobertura</th>
                                                <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Soportes</th>
                                                <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Última</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-50">
                                            {pointInsights.slice(0, 8).map(point => (
                                                <tr key={point.id} className="transition-colors hover:bg-slate-50/70">
                                                    <td className="px-4 py-3">
                                                        <div className="flex flex-col">
                                                            <span className="text-sm font-semibold text-slate-900">{point.code}</span>
                                                            <span className="text-xs text-slate-500">{point.name}</span>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3 text-sm text-slate-700">{point.sampleCount}</td>
                                                    <td className="px-4 py-3 text-sm text-slate-700">
                                                        {point.resultCount}
                                                        <span className="ml-2 text-xs text-slate-400">/{point.evaluatedResults} evaluables</span>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <span className="inline-flex rounded-full bg-cyan-50 px-2.5 py-1 text-[11px] font-semibold text-cyan-700 border border-cyan-100">
                                                            {point.evaluationCoverageRate ?? 0}% criterio
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <div className="flex flex-wrap gap-2">
                                                            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700">
                                                                <FileText size={12} /> {point.reportCount}
                                                            </span>
                                                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700">
                                                                <Image size={12} /> {point.photoEvidenceCount}
                                                            </span>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3 text-sm text-slate-500">
                                                        {point.latestSampleAt ? new Date(point.latestSampleAt).toLocaleDateString('es-CO') : '—'}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    )}

                    {showQualitySection && (
                        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden transition-all duration-300 hover:shadow-md">
                            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                                <div>
                                    <h2 className="font-bold text-slate-900">Alertas y sugerencias</h2>
                                    <p className="text-xs text-slate-500 mt-1">Lectura técnica de resultados fuera de especificación.</p>
                                </div>
                            </div>
                            <div className="p-5 space-y-3 max-h-[420px] overflow-y-auto">
                                {(dashboard.alerts || []).length === 0 ? (
                                    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
                                        No hay alertas recientes para mostrar.
                                    </div>
                                ) : (
                                    dashboard.alerts.map((alert, index) => (
                                        <div key={`${alert.id || alert.point}-${index}`} className={`rounded-2xl border p-4 transition-all duration-300 hover:-translate-y-0.5 ${alert.severity === 'CRITICAL' ? 'bg-red-50 border-red-200 text-red-900' : 'bg-amber-50 border-amber-200 text-amber-900'}`}>
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className={`inline-flex rounded-full px-2 py-1 text-[11px] font-semibold ${alert.severity === 'CRITICAL' ? 'bg-red-200 text-red-800' : 'bg-amber-200 text-amber-800'}`}>
                                                    {alert.severity}
                                                </span>
                                                <span className="text-xs font-semibold">{alert.point}</span>
                                                {alert.parameter && <span className="text-xs">{alert.parameter}</span>}
                                                {alert.sampleNumber && <span className="text-xs opacity-70">· {alert.sampleNumber}</span>}
                                            </div>
                                            <p className="text-sm mt-2">{alert.suggestion}</p>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    )}

                    {showQualitySection && (
                        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden transition-all duration-300 hover:shadow-md">
                            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                                <div>
                                    <h2 className="font-bold text-slate-900">Calidad de datos y soportes</h2>
                                    <p className="text-xs text-slate-500 mt-1">Lectura de cobertura para que el dashboard no prometa más de lo que hoy soporta la base.</p>
                                </div>
                            </div>
                            <div className="p-5 space-y-3">
                                {dataQualityWarnings.length === 0 ? (
                                    <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-4 text-sm text-emerald-800 flex items-start gap-3">
                                        <ShieldCheck size={18} className="mt-0.5" />
                                        <div>
                                            <p className="font-semibold">Sin advertencias de cobertura</p>
                                            <p className="text-emerald-700 mt-1">La base reciente tiene criterios y soportes suficientes para la lectura automática actual.</p>
                                        </div>
                                    </div>
                                ) : (
                                    dataQualityWarnings.map(warning => (
                                        <div
                                            key={warning.id}
                                            className={`rounded-2xl border px-4 py-4 text-sm flex items-start gap-3 transition-all duration-300 hover:-translate-y-0.5 ${warning.severity === 'WARNING'
                                                ? 'border-amber-200 bg-amber-50 text-amber-900'
                                                : 'border-slate-200 bg-slate-50 text-slate-800'
                                                }`}
                                        >
                                            {warning.severity === 'WARNING' ? (
                                                <ShieldAlert size={18} className="mt-0.5" />
                                            ) : (
                                                <CheckCircle2 size={18} className="mt-0.5" />
                                            )}
                                            <div>
                                                <p className="font-semibold">{warning.title}</p>
                                                <p className={`mt-1 ${warning.severity === 'WARNING' ? 'text-amber-800' : 'text-slate-600'}`}>{warning.message}</p>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    )}

                    {showHistorySection && (
                        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden transition-all duration-300 hover:shadow-md">
                            <button
                                type="button"
                                onClick={() => setShowRecentSamples(previous => !previous)}
                                className="w-full px-5 py-4 border-b border-gray-100 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"
                            >
                                <div>
                                    <h2 className="font-bold text-slate-900">Historial reciente</h2>
                                    <p className="text-xs text-slate-500 mt-1">
                                        {displayRecentSamples ? 'Ocultar muestras recientes' : `Mostrar últimas ${dashboard.recentSamples?.length || 0} muestras`}
                                    </p>
                                </div>
                                <span className="text-sm font-semibold text-cyan-700">{displayRecentSamples ? 'Ocultar' : 'Desplegar'}</span>
                            </button>

                            {displayRecentSamples && (
                                <div className="overflow-x-auto">
                                    <table className="min-w-full divide-y divide-gray-100">
                                        <thead className="bg-slate-50">
                                            <tr>
                                                <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Muestra</th>
                                                <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Punto</th>
                                                <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Flujo</th>
                                                <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Estado</th>
                                                <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Fecha</th>
                                                <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Reporte</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-50">
                                            {(dashboard.recentSamples || []).map(sample => {
                                                const statusMeta = STATUS_META[sample.status] || STATUS_META.PLANNED;
                                                return (
                                                    <tr
                                                        key={sample.id}
                                                        className="cursor-pointer transition-colors hover:bg-slate-50/70"
                                                        onClick={() => handleSampleRowClick(sample)}
                                                    >
                                                        <td className="px-4 py-3 text-sm font-semibold text-cyan-700">{sample.sampleNumber}</td>
                                                        <td className="px-4 py-3 text-sm text-slate-700">{sample.samplingPoint?.name}</td>
                                                        <td className="px-4 py-3">
                                                            <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${LAB_COLOR[sample.workflowType] || 'bg-slate-100 text-slate-700 border border-slate-200'}`}>
                                                                {LAB_LABELS[sample.workflowType] || sample.workflowType}
                                                            </span>
                                                        </td>
                                                        <td className="px-4 py-3">
                                                            <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusMeta.chipClass}`}>
                                                                {statusMeta.label}
                                                            </span>
                                                        </td>
                                                        <td className="px-4 py-3 text-sm text-slate-500">{new Date(sample.takenAt).toLocaleDateString('es-CO')}</td>
                                                        <td className="px-4 py-3 text-sm text-slate-500">
                                                            {sample.reportUrl ? (
                                                                <span className="inline-flex items-center gap-1 text-cyan-700">
                                                                    <ExternalLink size={13} /> {sample.reportNumber || 'Disponible'}
                                                                </span>
                                                            ) : sample.reportNumber || 'Pendiente'}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {showPlanner && (
                <MicroSchedulePlannerModal
                    points={schedule?.points || []}
                    entry={plannerEntry}
                    presetDate={plannerDate}
                    onClose={closePlanner}
                    onSuccess={async () => {
                        closePlanner();
                        await handleRefresh();
                    }}
                />
            )}

            {showExternalEntry && (
                <MicroSampleEntry
                    scheduleEntry={externalScheduleEntry}
                    existingSampleId={externalSampleId}
                    onClose={closeExternalEntry}
                    onSuccess={async () => {
                        closeExternalEntry();
                        await handleRefresh();
                    }}
                />
            )}

            {showInternalEntry && (
                <MicroInternalLabEntry
                    scheduleEntry={internalScheduleEntry}
                    existingSampleId={internalSampleId}
                    onClose={closeInternalEntry}
                    onDataChange={handleRefresh}
                />
            )}
        </div>
    );
};

export default MicroDashboard;
