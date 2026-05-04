import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Building2, CalendarRange, Clock3, Download, FileLock2, Loader2, LockOpen, Moon, Save, Sun, Trash2, Users, WalletCards,
} from 'lucide-react';
import api from '../services/api';

const todayISO = () => new Date().toISOString().split('T')[0];
const monthStart = () => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().split('T')[0];
};

function getCurrentFortnightRange(anchor = new Date()) {
    const date = new Date(anchor);
    const year = date.getFullYear();
    const month = date.getMonth();
    const day = date.getDate();

    if (day <= 15) {
        return {
            from: new Date(year, month, 1).toISOString().split('T')[0],
            to: new Date(year, month, 15).toISOString().split('T')[0],
        };
    }

    return {
        from: new Date(year, month, 16).toISOString().split('T')[0],
        to: new Date(year, month + 1, 0).toISOString().split('T')[0],
    };
}

function Card({ children, className = '' }) {
    return <div className={`bg-white border border-neutral-200 rounded-2xl shadow-sm ${className}`}>{children}</div>;
}

function KpiCard({ icon: Icon, label, value, sub }) {
    return (
        <Card className="p-5">
            <div className="flex items-start gap-3">
                <div className="p-3 rounded-xl bg-neutral-100 text-primary-600">
                    <Icon size={20} />
                </div>
                <div>
                    <p className="text-2xl font-bold text-neutral-900">{value}</p>
                    <p className="text-sm text-neutral-500">{label}</p>
                    {sub ? <p className="text-xs text-neutral-400 mt-1">{sub}</p> : null}
                </div>
            </div>
        </Card>
    );
}

function formatHours(value) {
    return `${Number(value || 0).toFixed(2)}h`;
}

function formatPct(value) {
    return `${Number(value || 0).toFixed(1)}%`;
}

function sumBy(rows, field) {
    return rows.reduce((sum, row) => sum + Number(row[field] || 0), 0);
}

function fmtDate(value) {
    if (!value) return '—';
    return new Date(value).toLocaleDateString('es-CO');
}

export default function LaborManagementPage() {
    const [periodType, setPeriodType] = useState('fortnight');
    const [anchorDate, setAnchorDate] = useState(todayISO());
    const currentFortnight = getCurrentFortnightRange(new Date());
    const [from, setFrom] = useState(currentFortnight.from);
    const [to, setTo] = useState(currentFortnight.to);
    const [area, setArea] = useState('');
    const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
    const [data, setData] = useState(null);
    const [detail, setDetail] = useState(null);
    const [loading, setLoading] = useState(false);
    const [detailLoading, setDetailLoading] = useState(false);
    const [error, setError] = useState('');
    const [employees, setEmployees] = useState([]);
    const [payrollConfig, setPayrollConfig] = useState({
        dayStart: '06:00',
        nightStart: '21:00',
        fortnightCutoffDay: 15,
    });
    const [configSaving, setConfigSaving] = useState(false);
    const [novelties, setNovelties] = useState([]);
    const [noveltyTypes, setNoveltyTypes] = useState([]);
    const [noveltyLoading, setNoveltyLoading] = useState(false);
    const [noveltySaving, setNoveltySaving] = useState(false);
    const [noveltyForm, setNoveltyForm] = useState({
        employeeId: '',
        type: 'AUSENCIA',
        startDate: todayISO(),
        endDate: todayISO(),
        notes: '',
        replacedBy: '',
    });
    const [overtimeForm, setOvertimeForm] = useState({
        employeeId: '',
        date: todayISO(),
        dayHours: '',
        nightHours: '',
        reason: '',
    });
    const [overtimeSaving, setOvertimeSaving] = useState(false);
    const [overtimes, setOvertimes] = useState([]);
    const [overtimeLoading, setOvertimeLoading] = useState(false);

    const [closureNotes, setClosureNotes] = useState('');
    const [closureSaving, setClosureSaving] = useState(false);
    const [closures, setClosures] = useState([]);
    const [closureLoading, setClosureLoading] = useState(false);
    const [selectedClosureId, setSelectedClosureId] = useState('');
    const [selectedClosure, setSelectedClosure] = useState(null);
    const [selectedClosureLoading, setSelectedClosureLoading] = useState(false);
    const [exportingClosure, setExportingClosure] = useState(false);
    const [reopenReason, setReopenReason] = useState('');
    const [reopenNotes, setReopenNotes] = useState('');
    const [reopeningClosure, setReopeningClosure] = useState(false);

    useEffect(() => {
        api.get('/attendance/employees')
            .then((response) => setEmployees(response.data || []))
            .catch(() => setEmployees([]));
    }, []);

    const loadPayrollConfig = useCallback(async () => {
        try {
            const response = await api.get('/attendance/payroll-config');
            setPayrollConfig(response.data || {});
        } catch {
            // silent fallback
        }
    }, []);

    const loadNovelties = useCallback(async () => {
        setNoveltyLoading(true);
        try {
            const params = periodType === 'custom'
                ? { from, to }
                : data?.period
                    ? { from: data.period.from, to: data.period.to }
                    : {};
            const response = await api.get('/attendance/labor-novelties', { params });
            setNovelties(response.data?.novelties || []);
            setNoveltyTypes(response.data?.types || []);
        } catch {
            setNovelties([]);
        } finally {
            setNoveltyLoading(false);
        }
    }, [data?.period, from, periodType, to]);

    const loadClosures = useCallback(async () => {
        setClosureLoading(true);
        try {
            const response = await api.get('/attendance/payroll-closures');
            setClosures(response.data || []);
        } catch {
            setClosures([]);
        } finally {
            setClosureLoading(false);
        }
    }, []);

    const loadClosureDetail = useCallback(async (closureId) => {
        if (!closureId) {
            setSelectedClosure(null);
            return;
        }
        setSelectedClosureLoading(true);
        try {
            const response = await api.get(`/attendance/payroll-closures/${closureId}`);
            setSelectedClosure(response.data || null);
        } catch (err) {
            setError(err.response?.data?.error || 'No fue posible cargar el cierre seleccionado.');
            setSelectedClosure(null);
        } finally {
            setSelectedClosureLoading(false);
        }
    }, []);

    const areas = useMemo(() => (
        [...new Set((employees || []).map((employee) => employee.area).filter(Boolean))].sort()
    ), [employees]);

    const loadSummary = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const params = {
                periodType,
                area: area || undefined,
            };
            if (periodType === 'custom') {
                params.from = from;
                params.to = to;
            } else {
                params.anchorDate = anchorDate;
            }

            const response = await api.get('/attendance/payroll-summary', { params });
            setData(response.data);
        } catch (err) {
            setError(err.response?.data?.error || 'No fue posible cargar el resumen laboral.');
            setData(null);
        } finally {
            setLoading(false);
        }
    }, [anchorDate, area, from, periodType, to]);

    const loadDetail = useCallback(async (employeeId) => {
        if (!employeeId) {
            setDetail(null);
            return;
        }

        setDetailLoading(true);
        try {
            const params = {
                periodType,
                employeeId,
            };
            if (periodType === 'custom') {
                params.from = from;
                params.to = to;
            } else {
                params.anchorDate = anchorDate;
            }

            const response = await api.get('/attendance/payroll-summary', { params });
            setDetail(response.data?.detail || null);
        } catch (err) {
            setError(err.response?.data?.error || 'No fue posible cargar el detalle del colaborador.');
            setDetail(null);
        } finally {
            setDetailLoading(false);
        }
    }, [anchorDate, from, periodType, to]);

    useEffect(() => {
        loadSummary();
    }, [loadSummary]);

    useEffect(() => {
        loadPayrollConfig();
    }, [loadPayrollConfig]);

    useEffect(() => {
        loadClosures();
    }, [loadClosures]);

    useEffect(() => {
        if (!selectedEmployeeId) {
            setDetail(null);
            return;
        }
        loadDetail(selectedEmployeeId);
    }, [loadDetail, selectedEmployeeId]);

    useEffect(() => {
        loadNovelties();
    }, [loadNovelties]);

    useEffect(() => {
        if (!selectedClosureId) {
            setSelectedClosure(null);
            return;
        }
        loadClosureDetail(selectedClosureId);
    }, [loadClosureDetail, selectedClosureId]);

    const summaryRows = data?.summary || [];
    const totals = useMemo(() => ({
        employees: summaryRows.length,
        scheduledHours: sumBy(summaryRows, 'scheduledHours'),
        workedHours: sumBy(summaryRows, 'workedHours'),
        overtimeHours: sumBy(summaryRows, 'overtimeHours'),
    }), [summaryRows]);

    const averageWorkedPct = summaryRows.length
        ? summaryRows.reduce((sum, row) => sum + Number(row.workedPct || 0), 0) / summaryRows.length
        : 0;

    const savePayrollConfig = async () => {
        setConfigSaving(true);
        setError('');
        try {
            const response = await api.put('/attendance/payroll-config', payrollConfig);
            setPayrollConfig(response.data || payrollConfig);
            await loadSummary();
        } catch (err) {
            setError(err.response?.data?.error || 'No fue posible guardar la configuración laboral.');
        } finally {
            setConfigSaving(false);
        }
    };

    const prepareCurrentFortnight = () => {
        const today = new Date();
        const range = getCurrentFortnightRange(today);
        setPeriodType('fortnight');
        setAnchorDate(today.toISOString().split('T')[0]);
        setFrom(range.from);
        setTo(range.to);
        setSelectedClosure(null);
        setSelectedClosureId('');
        setClosureNotes(`Cierre operativo de quincena ${range.from} a ${range.to}`);
        setNoveltyForm((prev) => ({
            ...prev,
            startDate: range.from,
            endDate: range.to,
        }));
    };

    const saveNovelty = async () => {
        if (!noveltyForm.employeeId) {
            setError('Selecciona un colaborador para registrar la novedad.');
            return;
        }

        setNoveltySaving(true);
        setError('');
        try {
            await api.post('/attendance/labor-novelties', noveltyForm);
            setNoveltyForm({
                employeeId: '',
                type: noveltyTypes[0] || 'AUSENCIA',
                startDate: todayISO(),
                endDate: todayISO(),
                notes: '',
                replacedBy: '',
            });
            await Promise.all([loadNovelties(), loadSummary()]);
            if (selectedEmployeeId) await loadDetail(selectedEmployeeId);
        } catch (err) {
            setError(err.response?.data?.error || 'No fue posible guardar la novedad laboral.');
        } finally {
            setNoveltySaving(false);
        }
    };

    const deleteNovelty = async (id) => {
        try {
            await api.delete(`/attendance/labor-novelties/${id}`);
            await Promise.all([loadNovelties(), loadSummary()]);
            if (selectedEmployeeId) await loadDetail(selectedEmployeeId);
        } catch (err) {
            setError(err.response?.data?.error || 'No fue posible eliminar la novedad laboral.');
        }
    };

    const loadOvertimes = useCallback(async () => {
        setOvertimeLoading(true);
        try {
            const params = periodType === 'custom'
                ? { from, to }
                : data?.period
                    ? { from: data.period.from, to: data.period.to }
                    : {};
            const response = await api.get('/attendance/overtime-approvals', { params });
            setOvertimes(response.data?.items || []);
        } catch {
            setOvertimes([]);
        } finally {
            setOvertimeLoading(false);
        }
    }, [data?.period, from, periodType, to]);

    useEffect(() => {
        loadOvertimes();
    }, [loadOvertimes]);

    const saveOvertime = async () => {
        if (!overtimeForm.employeeId) {
            setError('Selecciona un colaborador para aprobar horas extra.');
            return;
        }
        const day = parseFloat(overtimeForm.dayHours) || 0;
        const night = parseFloat(overtimeForm.nightHours) || 0;
        if (day === 0 && night === 0) {
            setError('Indica al menos una hora (día o noche).');
            return;
        }
        if (!overtimeForm.reason || overtimeForm.reason.trim().length < 3) {
            setError('Indica el motivo de la aprobación.');
            return;
        }
        setOvertimeSaving(true);
        setError('');
        try {
            const response = await api.post('/attendance/overtime-approvals', {
                employeeId: overtimeForm.employeeId,
                date: overtimeForm.date,
                dayHours: day,
                nightHours: night,
                reason: overtimeForm.reason.trim(),
            });
            if (response.data?.warning) alert(response.data.warning);
            setOvertimeForm({ employeeId: '', date: todayISO(), dayHours: '', nightHours: '', reason: '' });
            await Promise.all([loadOvertimes(), loadSummary()]);
            if (selectedEmployeeId) await loadDetail(selectedEmployeeId);
        } catch (err) {
            setError(err.response?.data?.error || 'No fue posible guardar la aprobación de horas extra.');
        } finally {
            setOvertimeSaving(false);
        }
    };

    const deleteOvertime = async (id) => {
        if (!confirm('¿Eliminar esta aprobación de horas extra?')) return;
        try {
            await api.delete(`/attendance/overtime-approvals/${id}`);
            await Promise.all([loadOvertimes(), loadSummary()]);
            if (selectedEmployeeId) await loadDetail(selectedEmployeeId);
        } catch (err) {
            setError(err.response?.data?.error || 'No fue posible eliminar la aprobación.');
        }
    };

    const closeCurrentPeriod = async () => {
        setClosureSaving(true);
        setError('');
        try {
            const payload = {
                periodType,
                area: area || undefined,
                notes: closureNotes,
            };
            if (periodType === 'custom') {
                payload.from = from;
                payload.to = to;
            } else {
                payload.anchorDate = anchorDate;
            }

            const response = await api.post('/attendance/payroll-closures/close', payload);
            setClosureNotes('');
            await loadClosures();
            setSelectedClosureId(response.data.id);
        } catch (err) {
            setError(err.response?.data?.error || 'No fue posible cerrar el periodo.');
        } finally {
            setClosureSaving(false);
        }
    };

    const exportClosure = async () => {
        if (!selectedClosureId) return;
        setExportingClosure(true);
        setError('');
        try {
            const response = await api.get(`/attendance/payroll-closures/${selectedClosureId}/export`, {
                responseType: 'blob',
            });

            const blob = new Blob([response.data], { type: 'text/csv;charset=utf-8;' });
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            const disposition = response.headers['content-disposition'] || '';
            const matched = disposition.match(/filename="([^"]+)"/);
            link.href = url;
            link.setAttribute('download', matched?.[1] || 'nomina.csv');
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
        } catch (err) {
            setError(err.response?.data?.error || 'No fue posible exportar el cierre.');
        } finally {
            setExportingClosure(false);
        }
    };

    const reopenClosure = async () => {
        if (!selectedClosureId) return;
        if (!reopenReason.trim()) {
            setError('Escribe el motivo de la reapertura.');
            return;
        }
        setReopeningClosure(true);
        setError('');
        try {
            await api.post(`/attendance/payroll-closures/${selectedClosureId}/reopen`, {
                reason: reopenReason,
                notes: reopenNotes,
            });
            setReopenReason('');
            setReopenNotes('');
            await Promise.all([loadClosures(), loadClosureDetail(selectedClosureId)]);
        } catch (err) {
            setError(err.response?.data?.error || 'No fue posible reabrir el cierre.');
        } finally {
            setReopeningClosure(false);
        }
    };

    return (
        <div className="p-6 max-w-7xl mx-auto space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-neutral-900 flex items-center gap-2">
                        <WalletCards className="text-primary-600" size={24} />
                        Gestión Laboral
                    </h1>
                    <p className="text-sm text-neutral-400 mt-1">
                        Módulo independiente para quincena y mes, usando empleados, turnos y asistencias ya existentes.
                    </p>
                </div>
                <Card className="px-4 py-3">
                    <p className="text-xs uppercase tracking-wide text-neutral-400">Franja extra</p>
                    <p className="text-sm font-semibold text-neutral-700 mt-1 flex items-center gap-2">
                        <Sun size={14} className="text-amber-500" />
                        Día desde {data?.config?.dayStart || payrollConfig.dayStart || '06:00'}
                        <Moon size={14} className="text-violet-500 ml-2" />
                        Noche desde {data?.config?.nightStart || payrollConfig.nightStart || '21:00'}
                    </p>
                </Card>
            </div>

            <Card className="p-5">
                <div className="flex items-center justify-between gap-3 mb-4">
                    <div>
                        <h2 className="font-semibold text-neutral-800">Reglas de liquidación</h2>
                        <p className="text-sm text-neutral-500">Estas reglas controlan cómo el sistema separa horas extra diurnas y nocturnas, y cómo define la quincena.</p>
                    </div>
                    <button
                        onClick={savePayrollConfig}
                        disabled={configSaving}
                        className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-semibold hover:bg-primary-700 disabled:opacity-50 flex items-center gap-2"
                    >
                        <Save size={14} />
                        {configSaving ? 'Guardando...' : 'Guardar reglas'}
                    </button>
                </div>
                <div className="grid md:grid-cols-3 gap-4">
                    <div>
                        <label className="block text-xs text-neutral-500 mb-1">Inicio jornada diurna</label>
                        <input
                            type="time"
                            value={payrollConfig.dayStart || '06:00'}
                            onChange={(event) => setPayrollConfig((prev) => ({ ...prev, dayStart: event.target.value }))}
                            className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm"
                        />
                    </div>
                    <div>
                        <label className="block text-xs text-neutral-500 mb-1">Inicio jornada nocturna</label>
                        <input
                            type="time"
                            value={payrollConfig.nightStart || '21:00'}
                            onChange={(event) => setPayrollConfig((prev) => ({ ...prev, nightStart: event.target.value }))}
                            className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm"
                        />
                    </div>
                    <div>
                        <label className="block text-xs text-neutral-500 mb-1">Día de corte quincenal</label>
                        <input
                            type="number"
                            min="1"
                            max="28"
                            value={payrollConfig.fortnightCutoffDay || 15}
                            onChange={(event) => setPayrollConfig((prev) => ({ ...prev, fortnightCutoffDay: event.target.value }))}
                            className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm"
                        />
                    </div>
                </div>
            </Card>

            <Card className="p-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h2 className="font-semibold text-neutral-800">Periodo de trabajo</h2>
                        <p className="text-sm text-neutral-500">Deja lista la quincena actual para revisar horarios del cuadro de turnos, novedades y cierre.</p>
                    </div>
                    <button
                        onClick={prepareCurrentFortnight}
                        className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700"
                    >
                        Preparar quincena actual
                    </button>
                </div>
                <div className="flex flex-wrap gap-2 mb-4">
                    {[
                        { id: 'fortnight', label: 'Quincena' },
                        { id: 'month', label: 'Mes' },
                        { id: 'custom', label: 'Personalizado' },
                    ].map((option) => (
                        <button
                            key={option.id}
                            onClick={() => setPeriodType(option.id)}
                            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
                                periodType === option.id
                                    ? 'bg-primary-600 text-white shadow-sm'
                                    : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                            }`}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>

                <div className="flex flex-wrap gap-3 items-end">
                    {periodType === 'custom' ? (
                        <>
                            <div>
                                <label className="block text-xs text-neutral-500 mb-1">Desde</label>
                                <input
                                    type="date"
                                    value={from}
                                    onChange={(event) => setFrom(event.target.value)}
                                    className="px-3 py-2 border border-neutral-200 rounded-lg text-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-neutral-500 mb-1">Hasta</label>
                                <input
                                    type="date"
                                    value={to}
                                    onChange={(event) => setTo(event.target.value)}
                                    className="px-3 py-2 border border-neutral-200 rounded-lg text-sm"
                                />
                            </div>
                        </>
                    ) : (
                        <div>
                            <label className="block text-xs text-neutral-500 mb-1">Fecha ancla</label>
                            <input
                                type="date"
                                value={anchorDate}
                                onChange={(event) => setAnchorDate(event.target.value)}
                                className="px-3 py-2 border border-neutral-200 rounded-lg text-sm"
                            />
                        </div>
                    )}

                    <div>
                        <label className="block text-xs text-neutral-500 mb-1">Área</label>
                        <select
                            value={area}
                            onChange={(event) => setArea(event.target.value)}
                            className="px-3 py-2 border border-neutral-200 rounded-lg text-sm min-w-[180px]"
                        >
                            <option value="">Todas</option>
                            {areas.map((item) => <option key={item} value={item}>{item}</option>)}
                        </select>
                    </div>

                    <button
                        onClick={loadSummary}
                        disabled={loading}
                        className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-semibold hover:bg-primary-700 disabled:opacity-50"
                    >
                        {loading ? 'Calculando...' : 'Actualizar resumen'}
                    </button>
                </div>

                {data?.period ? (
                    <div className="mt-4 text-sm text-neutral-500 flex items-center gap-2">
                        <CalendarRange size={15} className="text-primary-500" />
                        {data.period.label} · {data.period.from} a {data.period.to}
                    </div>
                ) : null}
                {periodType === 'fortnight' && data?.summary?.length ? (
                    <div className="mt-4 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-sm text-emerald-800">
                        Esta pantalla ya está leyendo la quincena actual desde el cuadro de turnos. Aquí puedes registrar novedades, revisar horas extra y luego cerrar el periodo para nómina.
                    </div>
                ) : null}
            </Card>

            {error ? (
                <Card className="p-4 text-sm text-red-600 bg-red-50 border-red-200">
                    {error}
                </Card>
            ) : null}

            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                <KpiCard icon={Users} label="Colaboradores" value={totals.employees} />
                <KpiCard icon={Clock3} label="Horas programadas" value={formatHours(totals.scheduledHours)} />
                <KpiCard icon={Building2} label="Horas trabajadas" value={formatHours(totals.workedHours)} />
                <KpiCard icon={Sun} label="Horas extra" value={formatHours(totals.overtimeHours)} />
                <KpiCard icon={CalendarRange} label="% trabajado promedio" value={formatPct(averageWorkedPct)} />
            </div>

            <Card className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
                    <div>
                        <h2 className="font-semibold text-neutral-800 flex items-center gap-2">
                            <FileLock2 size={18} className="text-primary-600" />
                            Cierre de periodo
                        </h2>
                        <p className="text-sm text-neutral-500">
                            Congela la quincena o el mes actual para que nómina trabaje sobre un snapshot fijo.
                        </p>
                    </div>
                    <button
                        onClick={closeCurrentPeriod}
                        disabled={closureSaving || !data?.period}
                        className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50"
                    >
                        {closureSaving ? 'Cerrando...' : 'Cerrar este periodo'}
                    </button>
                </div>
                <textarea
                    value={closureNotes}
                    onChange={(event) => setClosureNotes(event.target.value)}
                    rows={3}
                    className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm"
                    placeholder="Notas de cierre para nómina, observaciones, aclaraciones del periodo..."
                />
                {data?.period ? (
                    <p className="text-xs text-neutral-400 mt-2">
                        Se cerrará: {data.period.label} · {data.period.from} a {data.period.to}
                    </p>
                ) : null}
            </Card>

            <Card className="overflow-hidden">
                <div className="p-4 border-b border-neutral-100">
                    <h2 className="font-semibold text-neutral-800">Resumen por colaborador</h2>
                </div>
                {loading ? (
                    <div className="flex justify-center py-12">
                        <Loader2 size={22} className="animate-spin text-primary-500" />
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-neutral-50 border-b border-neutral-100">
                                <tr>
                                    {[
                                        'Empleado',
                                        'Área',
                                        'Días prog.',
                                        'Días presentes',
                                        'Ausencias',
                                        'Horas prog.',
                                        'Horas trabajadas',
                                        'Extra día',
                                        'Extra noche',
                                        '% trabajado',
                                    ].map((header) => (
                                        <th key={header} className="px-4 py-3 text-left text-xs font-bold uppercase text-neutral-500">
                                            {header}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-neutral-100">
                                {summaryRows.map((row) => (
                                    <tr
                                        key={row.employee.id}
                                        onClick={() => setSelectedEmployeeId(row.employee.id)}
                                        className={`cursor-pointer hover:bg-neutral-50 ${
                                            selectedEmployeeId === row.employee.id ? 'bg-primary-50' : ''
                                        }`}
                                    >
                                        <td className="px-4 py-3 font-medium text-neutral-800">{row.employee.name}</td>
                                        <td className="px-4 py-3 text-neutral-500">{row.employee.area}</td>
                                        <td className="px-4 py-3">{row.scheduledDays}</td>
                                        <td className="px-4 py-3">{row.presentDays}</td>
                                        <td className="px-4 py-3">{row.absenceDays}</td>
                                        <td className="px-4 py-3">{formatHours(row.scheduledHours)}</td>
                                        <td className="px-4 py-3">{formatHours(row.workedHours)}</td>
                                        <td className="px-4 py-3 text-amber-700">{formatHours(row.overtimeDayHours)}</td>
                                        <td className="px-4 py-3 text-violet-700">{formatHours(row.overtimeNightHours)}</td>
                                        <td className="px-4 py-3 font-semibold">{formatPct(row.workedPct)}</td>
                                    </tr>
                                ))}
                                {summaryRows.length === 0 ? (
                                    <tr>
                                        <td colSpan={10} className="px-4 py-12 text-center text-neutral-400">
                                            No hay colaboradores para este filtro.
                                        </td>
                                    </tr>
                                ) : null}
                            </tbody>
                        </table>
                    </div>
                )}
            </Card>

            <div className="grid xl:grid-cols-2 gap-6">
                <Card className="p-5">
                    <div className="flex items-center justify-between gap-3 mb-4">
                        <div>
                            <h2 className="font-semibold text-neutral-800">Registrar novedad laboral</h2>
                            <p className="text-sm text-neutral-500">Úsalo para incapacidades, permisos, ausencias y otras novedades que afecten la quincena.</p>
                        </div>
                    </div>
                    <div className="grid md:grid-cols-2 gap-4">
                        <div className="md:col-span-2">
                            <label className="block text-xs text-neutral-500 mb-1">Colaborador</label>
                            <select
                                value={noveltyForm.employeeId}
                                onChange={(event) => setNoveltyForm((prev) => ({ ...prev, employeeId: event.target.value }))}
                                className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm"
                            >
                                <option value="">Seleccione...</option>
                                {employees.filter((employee) => !employee.pending).map((employee) => (
                                    <option key={employee.id} value={employee.id}>
                                        {employee.name} · {employee.area}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs text-neutral-500 mb-1">Tipo</label>
                            <select
                                value={noveltyForm.type}
                                onChange={(event) => setNoveltyForm((prev) => ({ ...prev, type: event.target.value }))}
                                className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm"
                            >
                                {(noveltyTypes.length ? noveltyTypes : ['AUSENCIA']).map((type) => (
                                    <option key={type} value={type}>{type}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs text-neutral-500 mb-1">Reemplaza a</label>
                            <input
                                type="text"
                                value={noveltyForm.replacedBy}
                                onChange={(event) => setNoveltyForm((prev) => ({ ...prev, replacedBy: event.target.value }))}
                                className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm"
                                placeholder="Opcional"
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-neutral-500 mb-1">Desde</label>
                            <input
                                type="date"
                                value={noveltyForm.startDate}
                                onChange={(event) => setNoveltyForm((prev) => ({ ...prev, startDate: event.target.value }))}
                                className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-neutral-500 mb-1">Hasta</label>
                            <input
                                type="date"
                                value={noveltyForm.endDate}
                                onChange={(event) => setNoveltyForm((prev) => ({ ...prev, endDate: event.target.value }))}
                                className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm"
                            />
                        </div>
                        <div className="md:col-span-2">
                            <label className="block text-xs text-neutral-500 mb-1">Notas</label>
                            <textarea
                                value={noveltyForm.notes}
                                onChange={(event) => setNoveltyForm((prev) => ({ ...prev, notes: event.target.value }))}
                                rows={3}
                                className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm"
                                placeholder="Ej: incapacidad EPS, permiso personal, soporte pendiente..."
                            />
                        </div>
                    </div>
                    <div className="mt-4">
                        <button
                            onClick={saveNovelty}
                            disabled={noveltySaving}
                            className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-semibold hover:bg-primary-700 disabled:opacity-50"
                        >
                            {noveltySaving ? 'Guardando...' : 'Registrar novedad'}
                        </button>
                    </div>
                </Card>

                <Card className="overflow-hidden">
                    <div className="p-4 border-b border-neutral-100">
                        <h2 className="font-semibold text-neutral-800">Novedades registradas</h2>
                    </div>
                    {noveltyLoading ? (
                        <div className="flex justify-center py-12">
                            <Loader2 size={22} className="animate-spin text-primary-500" />
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-neutral-50 border-b border-neutral-100">
                                    <tr>
                                        {['Empleado', 'Tipo', 'Desde', 'Hasta', 'Notas', ''].map((header) => (
                                            <th key={header} className="px-4 py-3 text-left text-xs font-bold uppercase text-neutral-500">
                                                {header}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-neutral-100">
                                    {novelties.map((novelty) => (
                                        <tr key={novelty.id}>
                                            <td className="px-4 py-3">
                                                <div className="font-medium text-neutral-800">{novelty.employee?.name}</div>
                                                <div className="text-xs text-neutral-400">{novelty.employee?.area}</div>
                                            </td>
                                            <td className="px-4 py-3">{novelty.reason}</td>
                                            <td className="px-4 py-3">{fmtDate(novelty.startDate)}</td>
                                            <td className="px-4 py-3">{fmtDate(novelty.endDate)}</td>
                                            <td className="px-4 py-3 text-neutral-500 max-w-[280px]">{novelty.notes || '—'}</td>
                                            <td className="px-4 py-3 text-right">
                                                <button
                                                    onClick={() => deleteNovelty(novelty.id)}
                                                    className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                                                    title="Eliminar novedad"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                    {novelties.length === 0 ? (
                                        <tr>
                                            <td colSpan={6} className="px-4 py-10 text-center text-neutral-400">
                                                No hay novedades en el rango consultado.
                                            </td>
                                        </tr>
                                    ) : null}
                                </tbody>
                            </table>
                        </div>
                    )}
                </Card>
            </div>

            {/* ── Horas extra autorizadas ────────────────────────────────── */}
            <div className="grid xl:grid-cols-2 gap-6">
                <Card className="p-5">
                    <div className="flex items-center justify-between gap-3 mb-4">
                        <div>
                            <h2 className="font-semibold text-neutral-800">Aprobar horas extra</h2>
                            <p className="text-sm text-neutral-500">Registra horas extra autorizadas que se sumarán al reporte de la quincena.</p>
                        </div>
                    </div>
                    <div className="grid md:grid-cols-2 gap-4">
                        <div className="md:col-span-2">
                            <label className="block text-xs text-neutral-500 mb-1">Colaborador</label>
                            <select
                                value={overtimeForm.employeeId}
                                onChange={(event) => setOvertimeForm((prev) => ({ ...prev, employeeId: event.target.value }))}
                                className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm"
                            >
                                <option value="">Seleccione...</option>
                                {employees.filter((employee) => !employee.pending).map((employee) => (
                                    <option key={employee.id} value={employee.id}>
                                        {employee.name} · {employee.area}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs text-neutral-500 mb-1">Fecha</label>
                            <input
                                type="date"
                                value={overtimeForm.date}
                                onChange={(event) => setOvertimeForm((prev) => ({ ...prev, date: event.target.value }))}
                                className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm"
                            />
                        </div>
                        <div></div>
                        <div>
                            <label className="block text-xs text-neutral-500 mb-1">Horas extra día</label>
                            <input
                                type="number"
                                min="0" max="24" step="0.25"
                                value={overtimeForm.dayHours}
                                onChange={(event) => setOvertimeForm((prev) => ({ ...prev, dayHours: event.target.value }))}
                                placeholder="0"
                                className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-neutral-500 mb-1">Horas extra noche</label>
                            <input
                                type="number"
                                min="0" max="24" step="0.25"
                                value={overtimeForm.nightHours}
                                onChange={(event) => setOvertimeForm((prev) => ({ ...prev, nightHours: event.target.value }))}
                                placeholder="0"
                                className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm"
                            />
                        </div>
                        <div className="md:col-span-2">
                            <label className="block text-xs text-neutral-500 mb-1">Motivo</label>
                            <textarea
                                value={overtimeForm.reason}
                                onChange={(event) => setOvertimeForm((prev) => ({ ...prev, reason: event.target.value }))}
                                rows={2}
                                className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm"
                                placeholder="Ej: terminó pedido urgente, soporte de mantenimiento, cubrió ausencia..."
                            />
                        </div>
                    </div>
                    <div className="mt-4">
                        <button
                            onClick={saveOvertime}
                            disabled={overtimeSaving}
                            className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-semibold hover:bg-primary-700 disabled:opacity-50"
                        >
                            {overtimeSaving ? 'Guardando...' : 'Aprobar y registrar'}
                        </button>
                    </div>
                </Card>

                <Card className="overflow-hidden">
                    <div className="p-4 border-b border-neutral-100">
                        <h2 className="font-semibold text-neutral-800">Horas extra aprobadas</h2>
                    </div>
                    {overtimeLoading ? (
                        <div className="flex justify-center py-12">
                            <Loader2 size={22} className="animate-spin text-primary-500" />
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-neutral-50 border-b border-neutral-100">
                                    <tr>
                                        {['Fecha', 'Colaborador', 'Día', 'Noche', 'Motivo', 'Aprobó', ''].map((h) => (
                                            <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-neutral-500 uppercase">{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-neutral-100">
                                    {overtimes.map((row) => (
                                        <tr key={row.id} className="hover:bg-neutral-50">
                                            <td className="px-4 py-3 whitespace-nowrap">{new Date(row.date).toLocaleDateString('es-CO')}</td>
                                            <td className="px-4 py-3">
                                                <div className="font-medium text-neutral-800">{row.employee?.name}</div>
                                                <div className="text-xs text-neutral-400">{row.employee?.area}</div>
                                            </td>
                                            <td className="px-4 py-3 font-mono">{(+row.dayHours).toFixed(2)}h</td>
                                            <td className="px-4 py-3 font-mono">{(+row.nightHours).toFixed(2)}h</td>
                                            <td className="px-4 py-3 text-xs text-neutral-600 max-w-xs truncate" title={row.reason}>{row.reason}</td>
                                            <td className="px-4 py-3 text-xs text-neutral-500">{row.approvedBy?.name}</td>
                                            <td className="px-4 py-3 text-right">
                                                <button
                                                    onClick={() => deleteOvertime(row.id)}
                                                    className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                                                    title="Eliminar aprobación"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                    {overtimes.length === 0 ? (
                                        <tr>
                                            <td colSpan={7} className="px-4 py-10 text-center text-neutral-400">
                                                No hay aprobaciones de horas extra en el rango.
                                            </td>
                                        </tr>
                                    ) : null}
                                </tbody>
                            </table>
                        </div>
                    )}
                </Card>
            </div>

            <div className="grid xl:grid-cols-2 gap-6">
                <Card className="overflow-hidden">
                    <div className="p-4 border-b border-neutral-100">
                        <h2 className="font-semibold text-neutral-800">Cierres guardados</h2>
                    </div>
                    {closureLoading ? (
                        <div className="flex justify-center py-12">
                            <Loader2 size={22} className="animate-spin text-primary-500" />
                        </div>
                    ) : (
                        <div className="divide-y divide-neutral-100">
                            {closures.map((closure) => (
                                <button
                                    key={closure.id}
                                    onClick={() => setSelectedClosureId(closure.id)}
                                    className={`w-full text-left px-4 py-3 hover:bg-neutral-50 ${
                                        selectedClosureId === closure.id ? 'bg-primary-50' : ''
                                    }`}
                                >
                                    <div className="flex items-center justify-between gap-3">
                                        <div>
                                            <p className="font-medium text-neutral-800">{closure.period?.label || closure.key}</p>
                                            <p className="text-xs text-neutral-400">
                                                {closure.period?.from} a {closure.period?.to} · {closure.employees} colaboradores
                                            </p>
                                            <p className="text-xs mt-1">
                                                <span className={`inline-flex px-2 py-0.5 rounded-full font-semibold ${
                                                    closure.status === 'REOPENED'
                                                        ? 'bg-amber-100 text-amber-700'
                                                        : closure.status === 'RECLOSED'
                                                            ? 'bg-blue-100 text-blue-700'
                                                            : 'bg-emerald-100 text-emerald-700'
                                                }`}>
                                                    {closure.status}
                                                </span>
                                            </p>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-xs text-neutral-500">{fmtDate(closure.closedAt)}</p>
                                            <p className="text-xs text-neutral-400">{closure.closedBy?.name || 'Sistema'}</p>
                                        </div>
                                    </div>
                                </button>
                            ))}
                            {closures.length === 0 ? (
                                <div className="px-4 py-10 text-center text-neutral-400 text-sm">
                                    Aún no hay cierres guardados.
                                </div>
                            ) : null}
                        </div>
                    )}
                </Card>

                <Card className="p-5">
                    <div className="flex items-center justify-between gap-3 mb-4">
                        <h2 className="font-semibold text-neutral-800">Detalle del cierre</h2>
                        <button
                            onClick={exportClosure}
                            disabled={!selectedClosureId || exportingClosure}
                            className="px-3 py-2 bg-primary-600 text-white rounded-lg text-sm font-semibold hover:bg-primary-700 disabled:opacity-50 flex items-center gap-2"
                        >
                            <Download size={14} />
                            {exportingClosure ? 'Exportando...' : 'Exportar CSV'}
                        </button>
                    </div>
                    {selectedClosureLoading ? (
                        <div className="flex justify-center py-12">
                            <Loader2 size={22} className="animate-spin text-primary-500" />
                        </div>
                    ) : selectedClosure ? (
                        <div className="space-y-4">
                            <div className="text-sm text-neutral-500">
                                <p><span className="font-medium text-neutral-700">Periodo:</span> {selectedClosure.period?.label}</p>
                                <p><span className="font-medium text-neutral-700">Rango:</span> {selectedClosure.period?.from} a {selectedClosure.period?.to}</p>
                                <p><span className="font-medium text-neutral-700">Cerrado por:</span> {selectedClosure.closedBy?.name || 'Sistema'}</p>
                                <p><span className="font-medium text-neutral-700">Estado:</span> {selectedClosure.status || 'CLOSED'}</p>
                                <p><span className="font-medium text-neutral-700">Reabierto por:</span> {selectedClosure.reopenedBy?.name || '—'}</p>
                                <p><span className="font-medium text-neutral-700">Motivo reapertura:</span> {selectedClosure.reopenReason || '—'}</p>
                                <p><span className="font-medium text-neutral-700">Notas:</span> {selectedClosure.notes || '—'}</p>
                            </div>
                            {selectedClosure.status !== 'REOPENED' ? (
                                <div className="border border-amber-200 bg-amber-50 rounded-xl p-4 space-y-3">
                                    <div className="flex items-center gap-2 text-amber-800 font-semibold">
                                        <LockOpen size={16} />
                                        Reabrir cierre
                                    </div>
                                    <input
                                        type="text"
                                        value={reopenReason}
                                        onChange={(event) => setReopenReason(event.target.value)}
                                        className="w-full px-3 py-2 border border-amber-200 rounded-lg text-sm"
                                        placeholder="Motivo obligatorio de la reapertura"
                                    />
                                    <textarea
                                        value={reopenNotes}
                                        onChange={(event) => setReopenNotes(event.target.value)}
                                        rows={2}
                                        className="w-full px-3 py-2 border border-amber-200 rounded-lg text-sm"
                                        placeholder="Notas adicionales"
                                    />
                                    <button
                                        onClick={reopenClosure}
                                        disabled={reopeningClosure}
                                        className="px-3 py-2 bg-amber-600 text-white rounded-lg text-sm font-semibold hover:bg-amber-700 disabled:opacity-50"
                                    >
                                        {reopeningClosure ? 'Reabriendo...' : 'Reabrir cierre'}
                                    </button>
                                </div>
                            ) : (
                                <div className="border border-blue-200 bg-blue-50 rounded-xl p-4 text-sm text-blue-700">
                                    Este cierre está reabierto. Puedes corregir novedades o asistencia y luego volver a usar `Cerrar este periodo` para generar el recierre oficial.
                                </div>
                            )}
                            {Array.isArray(selectedClosure.history) && selectedClosure.history.length > 0 ? (
                                <div>
                                    <h3 className="font-semibold text-neutral-800 mb-2">Historial</h3>
                                    <div className="space-y-2">
                                        {selectedClosure.history.map((entry, index) => (
                                            <div key={`${entry.type}-${entry.at}-${index}`} className="text-xs text-neutral-500 border border-neutral-200 rounded-lg px-3 py-2">
                                                <span className="font-semibold text-neutral-700">{entry.type}</span> · {fmtDate(entry.at)} · {entry.by?.name || 'Sistema'}
                                                {entry.reason ? ` · ${entry.reason}` : ''}
                                                {entry.notes ? ` · ${entry.notes}` : ''}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ) : null}
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead className="bg-neutral-50 border-b border-neutral-100">
                                        <tr>
                                            {['Empleado', 'Horas trabajadas', 'Extra día', 'Extra noche', '% trabajado'].map((header) => (
                                                <th key={header} className="px-4 py-3 text-left text-xs font-bold uppercase text-neutral-500">
                                                    {header}
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-neutral-100">
                                        {(selectedClosure.summary || []).map((row) => (
                                            <tr key={row.employee.id}>
                                                <td className="px-4 py-3 font-medium text-neutral-800">{row.employee.name}</td>
                                                <td className="px-4 py-3">{formatHours(row.workedHours)}</td>
                                                <td className="px-4 py-3 text-amber-700">{formatHours(row.overtimeDayHours)}</td>
                                                <td className="px-4 py-3 text-violet-700">{formatHours(row.overtimeNightHours)}</td>
                                                <td className="px-4 py-3">{formatPct(row.workedPct)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    ) : (
                        <p className="text-sm text-neutral-400">Selecciona un cierre para revisar el snapshot congelado.</p>
                    )}
                </Card>
            </div>

            <Card className="p-5">
                <div className="flex flex-wrap gap-3 items-end mb-4">
                    <div>
                        <label className="block text-xs text-neutral-500 mb-1">Detalle de colaborador</label>
                        <select
                            value={selectedEmployeeId}
                            onChange={(event) => setSelectedEmployeeId(event.target.value)}
                            className="px-3 py-2 border border-neutral-200 rounded-lg text-sm min-w-[280px]"
                        >
                            <option value="">Seleccione...</option>
                            {summaryRows.map((row) => (
                                <option key={row.employee.id} value={row.employee.id}>
                                    {row.employee.name} · {row.employee.area}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>

                {detailLoading ? (
                    <div className="flex justify-center py-12">
                        <Loader2 size={22} className="animate-spin text-primary-500" />
                    </div>
                ) : detail ? (
                    <div className="space-y-5">
                        <div className="grid md:grid-cols-4 gap-4">
                            <KpiCard icon={Clock3} label="Horas programadas" value={formatHours(detail.scheduledHours)} />
                            <KpiCard icon={Building2} label="Horas trabajadas" value={formatHours(detail.workedHours)} />
                            <KpiCard icon={Sun} label="Extra diurna" value={formatHours(detail.overtimeDayHours)} />
                            <KpiCard icon={Moon} label="Extra nocturna" value={formatHours(detail.overtimeNightHours)} />
                        </div>

                        <div className="text-sm text-neutral-500">
                            {detail.employee.name} · {detail.employee.area} · {detail.employee.cedula || 'Sin cédula'}
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-neutral-50 border-b border-neutral-100">
                                    <tr>
                                        {[
                                            'Fecha',
                                            'Turno',
                                            'Horas prog.',
                                            'Horas trabajadas',
                                            'Horas ordinarias',
                                            'Extra día',
                                            'Extra noche',
                                            'Ausencia',
                                        ].map((header) => (
                                            <th key={header} className="px-4 py-3 text-left text-xs font-bold uppercase text-neutral-500">
                                                {header}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-neutral-100">
                                    {detail.days.map((day) => (
                                        <tr key={day.date}>
                                            <td className="px-4 py-3">{day.date}</td>
                                            <td className="px-4 py-3">{day.shiftCode || '—'}</td>
                                            <td className="px-4 py-3">{formatHours(day.scheduledHours)}</td>
                                            <td className="px-4 py-3">{formatHours(day.workedHours)}</td>
                                            <td className="px-4 py-3">{formatHours(day.ordinaryHours)}</td>
                                            <td className="px-4 py-3 text-amber-700">{formatHours(day.overtimeDayHours)}</td>
                                            <td className="px-4 py-3 text-violet-700">{formatHours(day.overtimeNightHours)}</td>
                                            <td className="px-4 py-3">{day.absenceReason || '—'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                ) : (
                    <p className="text-sm text-neutral-400">Selecciona un colaborador para ver su quincena o mes detallado.</p>
                )}
            </Card>
        </div>
    );
}
