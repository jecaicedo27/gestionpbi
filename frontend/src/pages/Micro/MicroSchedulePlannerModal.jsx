import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useAuth } from '../../context/AuthContext';
import { Ban, CalendarDays, Clock3, History, Info, Layers3, Save, Trash2, X } from 'lucide-react';
import {
    DAY_NAMES,
    LABORATORY_PROFILE_OPTIONS,
    SHIFT_OPTIONS,
    SHIFT_DEFAULT_TIME,
    STATUS_META,
    WORKFLOW_OPTIONS,
    LAB_LABELS,
    SCHEDULE_MODE_OPTIONS,
    WEEKDAY_OPTIONS,
    getAllowedOptions,
    buildOptionLabel,
    buildSampleEntityContext,
    inferShiftFromTime,
    getWeekdayFromIsoDate,
    formatDateLabel
} from './microLabConfig';
import MicroWorkContextField from './components/MicroWorkContextField';
import MicroAnalysisSelector from './components/MicroAnalysisSelector';

const API = import.meta.env.VITE_API_URL;
const TRACE_ONLY_STATUSES = new Set(['RESCHEDULED']);
const CANCELLABLE_STATUSES = new Set(['PLANNED', 'DELAYED', 'NOT_PERFORMED']);
const SAME_SLOT_REACTIVATION_STATUSES = new Set(['CANCELLED', 'NOT_PERFORMED']);

const isValidIsoDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(`${value || ''}`.trim());

const parseIsoDate = (value) => {
    const normalized = `${value || ''}`.trim().slice(0, 10);
    if (!isValidIsoDate(normalized)) return null;

    const parsedDate = new Date(`${normalized}T12:00:00Z`);
    if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== normalized) {
        return null;
    }

    return parsedDate;
};

const addUtcDays = (date, days) => new Date(date.getTime() + (days * 24 * 60 * 60 * 1000));

const normalizeWeekdays = (values = []) => (
    Array.from(new Set(
        (Array.isArray(values) ? values : [])
            .map(value => Number(value))
            .filter(value => Number.isInteger(value) && value >= 0 && value <= 6)
    )).sort((left, right) => left - right)
);

const buildTargetDatesPreview = ({
    scheduleMode,
    plannedDate,
    rangeStartDate,
    rangeEndDate,
    selectedWeekdays
}) => {
    if (scheduleMode !== 'RANGE') {
        return isValidIsoDate(plannedDate) ? [`${plannedDate}`.slice(0, 10)] : [];
    }

    const parsedStartDate = parseIsoDate(rangeStartDate);
    const parsedEndDate = parseIsoDate(rangeEndDate);
    const normalizedWeekdays = normalizeWeekdays(selectedWeekdays);

    if (!parsedStartDate || !parsedEndDate || parsedEndDate < parsedStartDate || normalizedWeekdays.length === 0) {
        return [];
    }

    const dates = [];
    for (let currentDate = new Date(parsedStartDate); currentDate <= parsedEndDate; currentDate = addUtcDays(currentDate, 1)) {
        if (normalizedWeekdays.includes(currentDate.getUTCDay())) {
            dates.push(currentDate.toISOString().slice(0, 10));
        }
    }

    return dates;
};

const buildInitialPlannerState = (entry, presetDate) => {
    const today = new Date().toISOString().split('T')[0];
    const baseDate = entry?.plannedDate || presetDate || today;
    const baseShift = entry?.shift || '';

    return {
        samplingPointId: entry?.point?.id || '',
        plannedDate: baseDate,
        rangeStartDate: baseDate,
        rangeEndDate: baseDate,
        selectedWeekdays: normalizeWeekdays([getWeekdayFromIsoDate(baseDate)]),
        scheduleMode: 'SINGLE',
        plannedTime: entry?.plannedTime || SHIFT_DEFAULT_TIME[baseShift] || '06:00',
        shift: baseShift,
        workContext: entry?.workContext || '',
        workflowType: entry?.workflowType || 'EXTERNAL',
        laboratoryProfile: entry?.laboratoryProfile || '',
        requestedParameterIds: entry?.requestedParameterIds || [],
        assignedLab: entry?.assignedLab || '',
        notes: entry?.notes || '',
        statusReason: entry?.statusReason || ''
    };
};

const buildWeekdaySummary = (selectedWeekdays = []) => (
    normalizeWeekdays(selectedWeekdays)
        .map(value => DAY_NAMES[value])
        .join(', ')
);

const MicroSchedulePlannerModal = ({ points = [], entry = null, presetDate = '', onClose, onSuccess }) => {
    const { token } = useAuth();
    const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

    const isPersistedEntry = Boolean(entry?.id && !`${entry.id}`.startsWith('suggested:'));
    const hasLinkedSample = Boolean(entry?.sample?.id);

    const [samplingPointId, setSamplingPointId] = useState('');
    const [plannedDate, setPlannedDate] = useState('');
    const [rangeStartDate, setRangeStartDate] = useState('');
    const [rangeEndDate, setRangeEndDate] = useState('');
    const [selectedWeekdays, setSelectedWeekdays] = useState([]);
    const [scheduleMode, setScheduleMode] = useState('SINGLE');
    const [plannedTime, setPlannedTime] = useState('06:00');
    const [shift, setShift] = useState('');
    const [workContext, setWorkContext] = useState('');
    const [workflowType, setWorkflowType] = useState('EXTERNAL');
    const [laboratoryProfile, setLaboratoryProfile] = useState('');
    const [requestedParameterIds, setRequestedParameterIds] = useState([]);
    const [assignedLab, setAssignedLab] = useState('');
    const [notes, setNotes] = useState('');
    const [statusReason, setStatusReason] = useState('');
    const [parameters, setParameters] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const rawStatus = entry?.rawStatus || entry?.status || 'PLANNED';
    const statusMeta = STATUS_META[entry?.status] || STATUS_META[rawStatus] || STATUS_META.PLANNED;
    const isTraceOnlyEntry = isPersistedEntry && TRACE_ONLY_STATUSES.has(rawStatus);
    const canRescheduleEntry = isPersistedEntry && !hasLinkedSample && !isTraceOnlyEntry;
    const canCancelEntry = isPersistedEntry && !hasLinkedSample && CANCELLABLE_STATUSES.has(rawStatus);
    const canDeleteEntry = Boolean(entry?.canDelete) && !hasLinkedSample && !isTraceOnlyEntry;
    const isFormReadOnly = hasLinkedSample || isTraceOnlyEntry;
    const historyItems = useMemo(
        () => [...(entry?.statusHistory || [])].reverse(),
        [entry?.statusHistory]
    );

    useEffect(() => {
        const initialState = buildInitialPlannerState(entry, presetDate);

        setSamplingPointId(initialState.samplingPointId);
        setPlannedDate(initialState.plannedDate);
        setRangeStartDate(initialState.rangeStartDate);
        setRangeEndDate(initialState.rangeEndDate);
        setSelectedWeekdays(initialState.selectedWeekdays);
        setScheduleMode(initialState.scheduleMode);
        setPlannedTime(initialState.plannedTime);
        setShift(initialState.shift);
        setWorkContext(initialState.workContext);
        setWorkflowType(initialState.workflowType);
        setLaboratoryProfile(initialState.laboratoryProfile);
        setRequestedParameterIds(initialState.requestedParameterIds || []);
        setAssignedLab(initialState.assignedLab);
        setNotes(initialState.notes);
        setStatusReason(initialState.statusReason);
        setError('');
    }, [entry, presetDate]);

    useEffect(() => {
        let mounted = true;

        const fetchParameters = async () => {
            try {
                const response = await axios.get(`${API}/api/micro/parameters`, { headers });
                if (mounted) {
                    setParameters(response.data || []);
                }
            } catch (fetchError) {
                if (mounted) {
                    setError(fetchError.response?.data?.error || 'No fue posible cargar el catálogo de análisis.');
                }
            }
        };

        fetchParameters();

        return () => {
            mounted = false;
        };
    }, [headers]);

    const selectedPoint = useMemo(
        () => points.find(point => point.id === samplingPointId) || entry?.point || null,
        [entry, points, samplingPointId]
    );
    const entityContext = useMemo(
        () => buildSampleEntityContext({ point: selectedPoint, laboratoryProfile }),
        [laboratoryProfile, selectedPoint]
    );

    const allowedWorkflowOptions = useMemo(
        () => getAllowedOptions(WORKFLOW_OPTIONS, selectedPoint?.allowedWorkflowTypes || []),
        [selectedPoint]
    );
    const allowedShiftOptions = useMemo(
        () => getAllowedOptions(SHIFT_OPTIONS, selectedPoint?.allowedShifts || []),
        [selectedPoint]
    );
    const allowedProfileOptions = useMemo(
        () => getAllowedOptions(LABORATORY_PROFILE_OPTIONS, selectedPoint?.allowedLaboratoryProfiles || []),
        [selectedPoint]
    );
    const allowedShiftValues = useMemo(
        () => allowedShiftOptions.map(option => option.value),
        [allowedShiftOptions]
    );
    const selectedWeekdaySummary = useMemo(
        () => buildWeekdaySummary(selectedWeekdays),
        [selectedWeekdays]
    );
    const targetDatesPreview = useMemo(() => buildTargetDatesPreview({
        scheduleMode,
        plannedDate,
        rangeStartDate,
        rangeEndDate,
        selectedWeekdays
    }), [plannedDate, rangeEndDate, rangeStartDate, scheduleMode, selectedWeekdays]);

    const updateDefaultsFromPoint = (pointId) => {
        const point = points.find(candidate => candidate.id === pointId);
        if (!point) return;

        const nextDefaultShift = point.defaultShift || '';
        const nextWorkflowType = point.defaultWorkflowType || 'EXTERNAL';

        setShift(nextDefaultShift);
        setPlannedTime(SHIFT_DEFAULT_TIME[nextDefaultShift] || '06:00');
        setWorkContext(point.defaultWorkContext || '');
        setWorkflowType(nextWorkflowType);
        setLaboratoryProfile(point.defaultLaboratoryProfile || '');
        setRequestedParameterIds([]);
        setAssignedLab(nextWorkflowType === 'INTERNAL'
            ? 'Laboratorio Interno Planta'
            : point.defaultAssignedLab || ''
        );
    };

    useEffect(() => {
        const inferredShift = inferShiftFromTime(plannedTime);
        if (!inferredShift) return;
        if (allowedShiftValues.length > 0 && !allowedShiftValues.includes(inferredShift)) return;
        if (shift !== inferredShift) {
            setShift(inferredShift);
        }
    }, [allowedShiftValues, plannedTime, shift]);

    useEffect(() => {
        if (scheduleMode !== 'RANGE') return;
        if (selectedWeekdays.length > 0) return;

        const fallbackDate = rangeStartDate || plannedDate;
        const fallbackWeekday = getWeekdayFromIsoDate(fallbackDate);
        if (fallbackWeekday !== null) {
            setSelectedWeekdays([fallbackWeekday]);
        }
    }, [plannedDate, rangeStartDate, scheduleMode, selectedWeekdays]);

    const handleScheduleModeChange = (nextMode) => {
        if (isFormReadOnly) return;

        setScheduleMode(nextMode);
        if (nextMode === 'RANGE') {
            const seedDate = plannedDate || rangeStartDate || new Date().toISOString().split('T')[0];
            setRangeStartDate(current => current || seedDate);
            setRangeEndDate(current => current || seedDate);
            if (selectedWeekdays.length === 0) {
                const weekday = getWeekdayFromIsoDate(seedDate);
                setSelectedWeekdays(weekday === null ? [] : [weekday]);
            }
        }
    };

    const toggleWeekday = (weekday) => {
        if (isFormReadOnly) return;

        setSelectedWeekdays((current) => {
            const exists = current.includes(weekday);
            if (exists) {
                return current.filter(value => value !== weekday);
            }

            return normalizeWeekdays([...current, weekday]);
        });
    };

    const buildPayload = () => ({
        samplingPointId,
        scheduleMode,
        plannedDate,
        rangeStartDate: scheduleMode === 'RANGE' ? rangeStartDate : plannedDate,
        rangeEndDate: scheduleMode === 'RANGE' ? rangeEndDate : plannedDate,
        selectedWeekdays: scheduleMode === 'RANGE'
            ? normalizeWeekdays(selectedWeekdays)
            : normalizeWeekdays([getWeekdayFromIsoDate(plannedDate)]),
        plannedTime,
        shift,
        workContext,
        workflowType,
        laboratoryProfile,
        requestedParameterIds,
        assignedLab,
        notes,
        statusReason
    });

    const hasSchedulingChanges = useMemo(() => {
        if (!isPersistedEntry || !entry) return false;

        return (
            samplingPointId !== (entry.point?.id || '')
            || plannedTime !== (entry.plannedTime || SHIFT_DEFAULT_TIME[entry?.shift] || '06:00')
            || shift !== (entry.shift || '')
            || workContext !== (entry.workContext || '')
            || workflowType !== (entry.workflowType || 'EXTERNAL')
            || laboratoryProfile !== (entry.laboratoryProfile || '')
            || targetDatesPreview.length !== 1
            || targetDatesPreview[0] !== (entry.plannedDate || '')
        );
    }, [
        entry,
        isPersistedEntry,
        laboratoryProfile,
        plannedTime,
        samplingPointId,
        shift,
        targetDatesPreview,
        workContext,
        workflowType
    ]);

    const validatePlanningFields = () => {
        if (!samplingPointId) {
            setError('Selecciona un punto para guardar la programación');
            return false;
        }

        if (requestedParameterIds.length === 0) {
            setError('Selecciona al menos un análisis solicitado para esta programación');
            return false;
        }

        if (scheduleMode === 'SINGLE') {
            if (!plannedDate) {
                setError('Selecciona una fecha para guardar la programación');
                return false;
            }

            return true;
        }

        if (!rangeStartDate || !rangeEndDate) {
            setError('Define la fecha inicial y la fecha final del rango');
            return false;
        }

        if (normalizeWeekdays(selectedWeekdays).length === 0) {
            setError('Selecciona al menos un día de la semana para el rango');
            return false;
        }

        if (targetDatesPreview.length === 0) {
            setError('El rango seleccionado no genera fechas válidas con los días elegidos');
            return false;
        }

        return true;
    };

    const handleSave = async () => {
        if (!validatePlanningFields()) return;

        if (isTraceOnlyEntry) {
            setError('Esta programación ya fue reagendada y quedó disponible solo para consulta.');
            return;
        }

        if (isPersistedEntry && !hasLinkedSample && hasSchedulingChanges) {
            setError('Para cambiar fecha, rango, turno, contexto, punto, flujo o tipo utiliza el botón Reagendar.');
            return;
        }

        setLoading(true);
        setError('');
        try {
            if (isPersistedEntry) {
                await axios.patch(`${API}/api/micro/schedule/entries/${entry.id}`, buildPayload(), { headers });
            } else {
                await axios.post(`${API}/api/micro/schedule/entries`, buildPayload(), { headers });
            }

            onSuccess();
        } catch (saveError) {
            setError(saveError.response?.data?.error || 'Error guardando la programación');
        } finally {
            setLoading(false);
        }
    };

    const handleReschedule = async () => {
        if (!canRescheduleEntry) return;
        if (!validatePlanningFields()) return;

        if (!hasSchedulingChanges && scheduleMode === 'SINGLE' && !SAME_SLOT_REACTIVATION_STATUSES.has(rawStatus)) {
            setError('Para reagendar debe cambiar al menos la fecha, hora, turno, contexto, punto, flujo o tipo.');
            return;
        }

        setLoading(true);
        setError('');
        try {
            await axios.post(`${API}/api/micro/schedule/entries/${entry.id}/reschedule`, buildPayload(), { headers });
            onSuccess();
        } catch (rescheduleError) {
            setError(rescheduleError.response?.data?.error || 'Error reagendando la programación');
        } finally {
            setLoading(false);
        }
    };

    const handleCancelSchedule = async () => {
        if (!canCancelEntry) return;

        setLoading(true);
        setError('');
        try {
            await axios.post(`${API}/api/micro/schedule/entries/${entry.id}/cancel`, {
                statusReason
            }, { headers });
            onSuccess();
        } catch (cancelError) {
            setError(cancelError.response?.data?.error || 'Error cancelando la programación');
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async () => {
        if (!canDeleteEntry) return;
        if (!window.confirm(`¿Eliminar la programación del ${plannedDate || entry?.plannedDate || 'registro seleccionado'}?`)) return;

        setLoading(true);
        setError('');
        try {
            await axios.delete(`${API}/api/micro/schedule/entries/${entry.id}`, { headers });
            onSuccess();
        } catch (deleteError) {
            setError(deleteError.response?.data?.error || 'Error eliminando la programación');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 p-3 backdrop-blur-sm sm:p-4">
            <div className="flex min-h-full items-start justify-center py-4 sm:py-8">
                <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-5xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl sm:max-h-[calc(100vh-4rem)]">
                    <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-100 bg-gradient-to-r from-slate-900 via-blue-900 to-cyan-900 px-5 py-4 text-white sm:px-6">
                        <div>
                            <h2 className="text-lg font-bold">{isPersistedEntry ? 'Gestionar programación' : 'Nueva programación manual'}</h2>
                            <p className="mt-1 text-xs text-white/80">
                                Programa una sola fecha o un rango automático y guarda cada laboratorio como un registro separado.
                            </p>
                        </div>
                        <button onClick={onClose} className="rounded-full p-2 text-white/80 hover:bg-white/10 hover:text-white">
                            <X size={22} />
                        </button>
                    </div>

                    <div className="flex-1 space-y-5 overflow-y-auto p-4 sm:p-6">
                        {error && (
                            <div className="flex items-center gap-2 rounded-2xl border border-red-100 bg-red-50 p-3 text-sm text-red-700">
                                <Info size={16} /> {error}
                            </div>
                        )}

                        {isPersistedEntry && (
                            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${statusMeta.chipClass}`}>
                                        {statusMeta.label}
                                    </span>
                                    {entry?.statusReason && (
                                        <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600">
                                            Motivo registrado
                                        </span>
                                    )}
                                </div>
                                <p className="mt-2 text-sm text-slate-700">
                                    {isTraceOnlyEntry
                                        ? 'Esta programación ya fue reagendada. Puede revisar la trazabilidad, pero no modificar el registro histórico.'
                                        : 'Puedes guardar notas y datos operativos. Si cambias fecha, rango, turno, contexto, punto, flujo o tipo, usa Reagendar para conservar la trazabilidad.'}
                                </p>
                            </div>
                        )}

                        <div className="space-y-4 rounded-2xl border border-slate-100 bg-slate-50 p-5">
                            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                                <div>
                                    <label className="mb-1 block text-xs font-semibold uppercase text-gray-500">Punto *</label>
                                    <select
                                        value={samplingPointId}
                                        onChange={(event) => {
                                            setSamplingPointId(event.target.value);
                                            updateDefaultsFromPoint(event.target.value);
                                        }}
                                        disabled={isFormReadOnly}
                                        className={`w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-cyan-300 ${isFormReadOnly ? 'cursor-not-allowed bg-gray-100 opacity-75' : ''}`}
                                    >
                                        <option value="">Seleccionar...</option>
                                        {points.map(point => (
                                            <option key={point.id} value={point.id}>
                                                {point.code} - {point.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                {(!isPersistedEntry || canRescheduleEntry) && (
                                    <div>
                                        <label className="mb-1 block text-xs font-semibold uppercase text-gray-500">Modo de programación</label>
                                        <div className="grid grid-cols-2 gap-2">
                                            {SCHEDULE_MODE_OPTIONS.map((option) => {
                                                const isActive = scheduleMode === option.value;
                                                return (
                                                    <button
                                                        key={option.value}
                                                        type="button"
                                                        onClick={() => handleScheduleModeChange(option.value)}
                                                        disabled={isFormReadOnly}
                                                        className={`rounded-2xl border px-4 py-3 text-left transition-colors ${isActive ? 'border-cyan-300 bg-cyan-50 text-cyan-900' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'} ${isFormReadOnly ? 'cursor-not-allowed opacity-70' : ''}`}
                                                    >
                                                        <p className="text-sm font-semibold">{option.label}</p>
                                                        <p className="mt-1 text-xs opacity-75">
                                                            {option.value === 'RANGE' ? 'Crea varias fechas limpias dentro del rango.' : 'Guarda una sola fecha puntual.'}
                                                        </p>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {selectedPoint && (
                                <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 px-4 py-3">
                                    <p className="text-xs font-bold uppercase tracking-wide text-indigo-700">Ente muestreado detectado</p>
                                    <p className="mt-1 text-sm font-semibold text-indigo-900">{entityContext.entityLabel}</p>
                                    <p className="mt-1 text-xs text-indigo-800">{entityContext.helper}</p>
                                </div>
                            )}

                            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
                                {scheduleMode === 'RANGE' ? (
                                    <>
                                        <div>
                                            <label className="mb-1 block text-xs font-semibold uppercase text-gray-500">Fecha inicial *</label>
                                            <input
                                                type="date"
                                                value={rangeStartDate}
                                                onChange={(event) => setRangeStartDate(event.target.value)}
                                                disabled={isFormReadOnly}
                                                className={`w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-cyan-300 ${isFormReadOnly ? 'cursor-not-allowed bg-gray-100 opacity-75' : ''}`}
                                            />
                                        </div>
                                        <div>
                                            <label className="mb-1 block text-xs font-semibold uppercase text-gray-500">Fecha final *</label>
                                            <input
                                                type="date"
                                                value={rangeEndDate}
                                                onChange={(event) => setRangeEndDate(event.target.value)}
                                                disabled={isFormReadOnly}
                                                className={`w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-cyan-300 ${isFormReadOnly ? 'cursor-not-allowed bg-gray-100 opacity-75' : ''}`}
                                            />
                                        </div>
                                    </>
                                ) : (
                                    <div>
                                        <label className="mb-1 block text-xs font-semibold uppercase text-gray-500">Fecha *</label>
                                        <input
                                            type="date"
                                            value={plannedDate}
                                            onChange={(event) => setPlannedDate(event.target.value)}
                                            disabled={isFormReadOnly}
                                            className={`w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-cyan-300 ${isFormReadOnly ? 'cursor-not-allowed bg-gray-100 opacity-75' : ''}`}
                                        />
                                    </div>
                                )}

                                <div>
                                    <label className="mb-1 block text-xs font-semibold uppercase text-gray-500">Hora planeada</label>
                                    <input
                                        type="time"
                                        value={plannedTime}
                                        onChange={(event) => setPlannedTime(event.target.value)}
                                        disabled={isFormReadOnly}
                                        className={`w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-cyan-300 ${isFormReadOnly ? 'cursor-not-allowed bg-gray-100 opacity-75' : ''}`}
                                    />
                                    <p className="mt-1 text-[11px] text-slate-500">
                                        El turno se ajusta automáticamente según esta hora.
                                    </p>
                                </div>

                                <div>
                                    <label className="mb-1 block text-xs font-semibold uppercase text-gray-500">Turno</label>
                                    <select
                                        value={shift}
                                        onChange={(event) => {
                                            const nextShift = event.target.value;
                                            setShift(nextShift);
                                            setPlannedTime(SHIFT_DEFAULT_TIME[nextShift] || plannedTime);
                                        }}
                                        disabled={isFormReadOnly}
                                        className={`w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-cyan-300 ${isFormReadOnly ? 'cursor-not-allowed bg-gray-100 opacity-75' : ''}`}
                                    >
                                        {allowedShiftOptions.map(option => (
                                            <option key={option.value} value={option.value}>{option.label}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            {scheduleMode === 'RANGE' && (
                                <div className="rounded-2xl border border-cyan-100 bg-white p-4">
                                    <div className="flex flex-wrap items-center justify-between gap-3">
                                        <div>
                                            <p className="text-sm font-semibold text-slate-900">Días automáticos del rango</p>
                                            <p className="mt-1 text-xs text-slate-500">
                                                Cada fecha se creará como una programación independiente para mantener el calendario limpio.
                                            </p>
                                        </div>
                                        <span className="rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1 text-xs font-semibold text-cyan-700">
                                            {targetDatesPreview.length} fecha(s)
                                        </span>
                                    </div>
                                    <div className="mt-3 flex flex-wrap gap-2">
                                        {WEEKDAY_OPTIONS.map((option) => {
                                            const isActive = selectedWeekdays.includes(option.value);
                                            return (
                                                <button
                                                    key={option.value}
                                                    type="button"
                                                    onClick={() => toggleWeekday(option.value)}
                                                    disabled={isFormReadOnly}
                                                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${isActive ? 'border-cyan-300 bg-cyan-50 text-cyan-800' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'} ${isFormReadOnly ? 'cursor-not-allowed opacity-70' : ''}`}
                                                >
                                                    {option.label}
                                                </button>
                                            );
                                        })}
                                    </div>
                                    <p className="mt-3 text-xs text-slate-500">
                                        Días elegidos: {selectedWeekdaySummary || 'Sin selección'}
                                    </p>
                                </div>
                            )}

                            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                                <MicroWorkContextField
                                    label="Contexto"
                                    value={workContext}
                                    onChange={setWorkContext}
                                    allowedValues={selectedPoint?.allowedWorkContexts || []}
                                    defaultValue={selectedPoint?.defaultWorkContext || ''}
                                    disabled={isFormReadOnly}
                                    helperText="Puedes usar el contexto del punto o registrar uno específico para esta programación."
                                />

                                <div>
                                    <label className="mb-1 block text-xs font-semibold uppercase text-gray-500">Tipo de laboratorio</label>
                                    <select
                                        value={laboratoryProfile}
                                        onChange={(event) => setLaboratoryProfile(event.target.value)}
                                        disabled={isFormReadOnly}
                                        className={`w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-cyan-300 ${isFormReadOnly ? 'cursor-not-allowed bg-gray-100 opacity-75' : ''}`}
                                    >
                                        {allowedProfileOptions.map(option => (
                                            <option key={option.value} value={option.value}>{option.label}</option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="mb-1 block text-xs font-semibold uppercase text-gray-500">Flujo</label>
                                    <select
                                        value={workflowType}
                                        onChange={(event) => {
                                            const nextWorkflowType = event.target.value;
                                            setWorkflowType(nextWorkflowType);
                                            if (nextWorkflowType === 'INTERNAL') {
                                                setAssignedLab('Laboratorio Interno Planta');
                                            } else if (!assignedLab || assignedLab === 'Laboratorio Interno Planta') {
                                                setAssignedLab(selectedPoint?.defaultAssignedLab || '');
                                            }
                                        }}
                                        disabled={isFormReadOnly}
                                        className={`w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-cyan-300 ${isFormReadOnly ? 'cursor-not-allowed bg-gray-100 opacity-75' : ''}`}
                                    >
                                        {allowedWorkflowOptions.map(option => (
                                            <option key={option.value} value={option.value}>{option.label}</option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="mb-1 block text-xs font-semibold uppercase text-gray-500">Laboratorio asignado</label>
                                    <input
                                        type="text"
                                        value={assignedLab}
                                        onChange={(event) => setAssignedLab(event.target.value)}
                                        disabled={isFormReadOnly}
                                        className={`w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-cyan-300 ${isFormReadOnly ? 'cursor-not-allowed bg-gray-100 opacity-75' : ''}`}
                                    />
                                </div>
                            </div>

                            {selectedPoint && (
                                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                                    <div className="mb-3 flex flex-wrap items-center gap-2">
                                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                                            <Layers3 size={12} /> {selectedPoint.zoneName || selectedPoint.processArea || 'Sin zona'}
                                        </span>
                                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                                            <Clock3 size={12} /> {plannedTime || '--:--'}
                                        </span>
                                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                                            <CalendarDays size={12} />
                                            {scheduleMode === 'RANGE'
                                                ? `${rangeStartDate || '---'} a ${rangeEndDate || '---'}`
                                                : plannedDate || '---'}
                                        </span>
                                    </div>
                                    <p className="text-sm font-semibold text-slate-900">{selectedPoint.name}</p>
                                    <p className="mt-1 text-xs text-slate-500">
                                        Turno: {buildOptionLabel(SHIFT_OPTIONS, shift)} · Contexto: {workContext || '-'} · Flujo: {LAB_LABELS[workflowType]} · Ente: {entityContext.entityLabel}
                                    </p>
                                    <p className="mt-1 text-xs text-slate-500">
                                        Análisis solicitados: {requestedParameterIds.length}
                                    </p>
                                    {scheduleMode === 'RANGE' && targetDatesPreview.length > 0 && (
                                        <div className="mt-3 rounded-2xl border border-cyan-100 bg-cyan-50 p-3">
                                            <p className="text-xs font-semibold text-cyan-800">
                                                Se crearán {targetDatesPreview.length} programación(es) separadas
                                            </p>
                                            <div className="mt-2 flex flex-wrap gap-2">
                                                {targetDatesPreview.slice(0, 6).map((date) => (
                                                    <span key={date} className="rounded-full border border-cyan-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-cyan-700">
                                                        {DAY_NAMES[getWeekdayFromIsoDate(date)]} {formatDateLabel(date)}
                                                    </span>
                                                ))}
                                                {targetDatesPreview.length > 6 && (
                                                    <span className="rounded-full border border-cyan-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-cyan-700">
                                                        +{targetDatesPreview.length - 6} más
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        <MicroAnalysisSelector
                            parameters={parameters}
                            selectedIds={requestedParameterIds}
                            onChange={setRequestedParameterIds}
                            entityType={entityContext.entityType}
                            disabled={isFormReadOnly}
                        />

                        <div>
                            <label className="mb-1 block text-xs font-semibold uppercase text-gray-500">Notas de programación</label>
                            <textarea
                                value={notes}
                                onChange={(event) => setNotes(event.target.value)}
                                rows={4}
                                placeholder="Indicaciones operativas, restricciones de zona o detalles para esta programación..."
                                disabled={isTraceOnlyEntry}
                                className={`w-full resize-none rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-cyan-300 ${isTraceOnlyEntry ? 'cursor-not-allowed bg-gray-100 opacity-75' : ''}`}
                            />
                        </div>

                        {isPersistedEntry && (
                            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.95fr_1.05fr]">
                                <div>
                                    <label className="mb-1 block text-xs font-semibold uppercase text-gray-500">Motivo operativo / trazabilidad</label>
                                    <textarea
                                        value={statusReason}
                                        onChange={(event) => setStatusReason(event.target.value)}
                                        rows={4}
                                        disabled={isTraceOnlyEntry}
                                        placeholder="Explica la razón si cancelas, ajustas o reagendas esta programación..."
                                        className={`w-full resize-none rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-cyan-300 ${isTraceOnlyEntry ? 'cursor-not-allowed bg-gray-100 opacity-75' : ''}`}
                                    />
                                </div>

                                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                    <div className="flex items-center gap-2 text-slate-900">
                                        <History size={16} className="text-cyan-700" />
                                        <h3 className="text-sm font-bold">Historial de la programación</h3>
                                    </div>
                                    <div className="mt-3 max-h-52 space-y-3 overflow-y-auto pr-1">
                                        {historyItems.length === 0 ? (
                                            <p className="text-sm text-slate-500">Aún no hay eventos registrados.</p>
                                        ) : (
                                            historyItems.map((item, index) => (
                                                <div key={`${item.at || 'event'}-${index}`} className="rounded-xl border border-white bg-white p-3">
                                                    <p className="text-xs font-semibold text-slate-700">{item.action || 'Evento'} · {item.status || '-'}</p>
                                                    <p className="mt-1 text-[11px] text-slate-500">{item.at ? new Date(item.at).toLocaleString('es-CO') : 'Sin fecha'}</p>
                                                    {item.reason && (
                                                        <p className="mt-2 text-xs text-slate-700">{item.reason}</p>
                                                    )}
                                                    {(item.fromDate || item.toDate) && (
                                                        <p className="mt-1 text-[11px] text-slate-500">
                                                            {item.fromDate || '-'} {item.toDate ? `-> ${item.toDate}` : ''}
                                                        </p>
                                                    )}
                                                    {item.userName && (
                                                        <p className="mt-1 text-[11px] text-slate-500">Usuario: {item.userName}</p>
                                                    )}
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="sticky bottom-0 flex flex-col gap-3 border-t border-gray-100 bg-white/95 px-4 py-4 backdrop-blur sm:flex-row sm:justify-between sm:px-6">
                        <div className="flex flex-wrap gap-3">
                            {canCancelEntry && (
                                <button
                                    type="button"
                                    onClick={handleCancelSchedule}
                                    disabled={loading}
                                    className="inline-flex items-center gap-2 rounded-2xl border border-rose-200 px-4 py-2.5 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                                >
                                    <Ban size={15} /> Cancelar laboratorio
                                </button>
                            )}
                            {canDeleteEntry && (
                                <button
                                    type="button"
                                    onClick={handleDelete}
                                    disabled={loading}
                                    className="inline-flex items-center gap-2 rounded-2xl border border-red-200 px-4 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
                                >
                                    <Trash2 size={15} /> Eliminar
                                </button>
                            )}
                        </div>
                        <div className="flex flex-col-reverse gap-3 sm:flex-row">
                            <button
                                type="button"
                                onClick={onClose}
                                disabled={loading}
                                className="rounded-2xl border border-gray-200 px-5 py-2.5 font-medium text-gray-600 hover:bg-gray-50"
                            >
                                Cancelar
                            </button>
                            {canRescheduleEntry && (
                                <button
                                    type="button"
                                    onClick={handleReschedule}
                                    disabled={loading}
                                    className="inline-flex items-center gap-2 rounded-2xl border border-violet-200 bg-violet-50 px-5 py-2.5 text-sm font-semibold text-violet-700 hover:bg-violet-100 disabled:opacity-60"
                                >
                                    <History size={16} />
                                    {scheduleMode === 'RANGE' ? 'Reagendar por rango' : 'Reagendar'}
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={handleSave}
                                disabled={loading || isTraceOnlyEntry}
                                className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-600 to-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-cyan-200 disabled:opacity-60"
                            >
                                {loading ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : <Save size={16} />}
                                {isPersistedEntry ? 'Guardar cambios' : scheduleMode === 'RANGE' ? 'Crear programaciones' : 'Guardar programación'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default MicroSchedulePlannerModal;
