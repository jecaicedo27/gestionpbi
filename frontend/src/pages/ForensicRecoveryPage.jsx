import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    AlertTriangle,
    ChevronLeft,
    ChevronRight,
    ClipboardCheck,
    Database,
    FileJson,
    PackageCheck,
    RefreshCw,
    Search,
} from 'lucide-react';
import api from '../services/api';

const DEFAULT_DATASET = 'completed_notes';

const fmtNumber = (value, decimals = 0) => {
    if (value === null || value === undefined || value === '') return '-';
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value);
    return n.toLocaleString('es-CO', { maximumFractionDigits: decimals });
};

const fmtDateTime = (value) => {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString('es-CO', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
    });
};

const getRowTitle = (row) => row.productName || row.fileName || row.stageName || row.lotNumber || row.noteId || `Registro ${row.id}`;

const getRowSubtitle = (row) => {
    if (row.path) return row.path;
    return [row.stageName, row.lotNumber, row.noteId].filter(Boolean).join(' | ') || row.source || '-';
};

const ForensicRecoveryPage = () => {
    const [summary, setSummary] = useState(null);
    const [rows, setRows] = useState([]);
    const [pagination, setPagination] = useState({ page: 1, total: 0, totalPages: 1, limit: 50 });
    const [dataset, setDataset] = useState(DEFAULT_DATASET);
    const [search, setSearch] = useState('');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [selectedRow, setSelectedRow] = useState(null);
    const [loadingSummary, setLoadingSummary] = useState(true);
    const [loadingRows, setLoadingRows] = useState(true);
    const [error, setError] = useState(null);

    const datasets = summary?.datasets || [];
    const currentDataset = useMemo(
        () => datasets.find((item) => item.key === dataset),
        [datasets, dataset]
    );

    const fetchSummary = useCallback(async () => {
        setLoadingSummary(true);
        setError(null);
        try {
            const response = await api.get('/forensic-recovery/summary');
            setSummary(response.data);
        } catch (err) {
            console.error('Error cargando resumen forense:', err);
            setError(err.response?.data?.error || 'No se pudo cargar la base forense.');
        } finally {
            setLoadingSummary(false);
        }
    }, []);

    const fetchRows = useCallback(async (page = 1) => {
        setLoadingRows(true);
        setError(null);
        try {
            const params = new URLSearchParams({
                dataset,
                page: String(page),
                limit: '50',
            });
            if (search.trim()) params.set('search', search.trim());
            if (dateFrom) params.set('dateFrom', dateFrom);
            if (dateTo) params.set('dateTo', dateTo);

            const response = await api.get(`/forensic-recovery/records?${params.toString()}`);
            setRows(response.data.rows || []);
            setPagination(response.data.pagination || { page, total: 0, totalPages: 1, limit: 50 });
            setSelectedRow((response.data.rows || [])[0] || null);
        } catch (err) {
            console.error('Error cargando registros forenses:', err);
            setRows([]);
            setSelectedRow(null);
            setError(err.response?.data?.error || 'No se pudieron cargar los registros forenses.');
        } finally {
            setLoadingRows(false);
        }
    }, [dataset, search, dateFrom, dateTo]);

    useEffect(() => {
        fetchSummary();
    }, [fetchSummary]);

    useEffect(() => {
        fetchRows(1);
    }, [fetchRows]);

    const refreshAll = () => {
        fetchSummary();
        fetchRows(pagination.page);
    };

    const totalEvidence = summary?.counts
        ? Object.values(summary.counts).reduce((acc, count) => acc + Number(count || 0), 0)
        : 0;

    return (
        <div className="min-h-full bg-neutral-50">
            <div className="border-b border-neutral-200 bg-white">
                <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                        <div>
                            <div className="inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
                                <AlertTriangle size={14} />
                                Solo lectura, sin afectar inventario
                            </div>
                            <h1 className="mt-3 text-2xl font-bold text-neutral-900">
                                Validacion de recuperacion forense
                            </h1>
                            <p className="mt-1 max-w-3xl text-sm text-neutral-600">
                                Datos cargados desde gestionpbi_forensic_rebuild_20260416 para revisar notas, lotes,
                                consumos y archivos encontrados antes de restaurar en produccion.
                            </p>
                        </div>

                        <button
                            type="button"
                            onClick={refreshAll}
                            className="inline-flex items-center justify-center gap-2 rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold text-neutral-700 transition-colors hover:bg-neutral-100 disabled:opacity-60"
                            disabled={loadingSummary || loadingRows}
                        >
                            <RefreshCw size={16} className={loadingSummary || loadingRows ? 'animate-spin' : ''} />
                            Actualizar
                        </button>
                    </div>
                </div>
            </div>

            <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
                {error && (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                        {error}
                    </div>
                )}

                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <div className="rounded-lg border border-neutral-200 bg-white p-5">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm font-medium text-neutral-500">Evidencias cargadas</p>
                                <p className="mt-1 text-3xl font-bold text-neutral-900">{fmtNumber(totalEvidence)}</p>
                            </div>
                            <Database className="text-indigo-600" size={30} />
                        </div>
                    </div>

                    <div className="rounded-lg border border-neutral-200 bg-white p-5">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm font-medium text-neutral-500">Notas completadas</p>
                                <p className="mt-1 text-3xl font-bold text-neutral-900">
                                    {fmtNumber(summary?.counts?.completed_notes)}
                                </p>
                            </div>
                            <ClipboardCheck className="text-emerald-600" size={30} />
                        </div>
                    </div>

                    <div className="rounded-lg border border-neutral-200 bg-white p-5">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm font-medium text-neutral-500">Lotes producidos</p>
                                <p className="mt-1 text-3xl font-bold text-neutral-900">
                                    {fmtNumber(summary?.counts?.produced_lots)}
                                </p>
                            </div>
                            <PackageCheck className="text-sky-600" size={30} />
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
                    <section className="space-y-4">
                        <div className="rounded-lg border border-neutral-200 bg-white p-4">
                            <div className="flex flex-wrap gap-2">
                                {loadingSummary && !datasets.length ? (
                                    <span className="text-sm text-neutral-500">Cargando origenes forenses...</span>
                                ) : datasets.map((item) => (
                                    <button
                                        key={item.key}
                                        type="button"
                                        onClick={() => setDataset(item.key)}
                                        className={`rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
                                            dataset === item.key
                                                ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                                                : 'border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50'
                                        }`}
                                    >
                                        {item.label}
                                        <span className="ml-2 rounded-md bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-600">
                                            {fmtNumber(item.count)}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="rounded-lg border border-neutral-200 bg-white p-4">
                            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_150px_150px_auto]">
                                <label className="relative block">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" size={17} />
                                    <input
                                        type="text"
                                        value={search}
                                        onChange={(event) => setSearch(event.target.value)}
                                        placeholder="Buscar producto, lote, nota, fuente o archivo..."
                                        className="w-full rounded-lg border border-neutral-300 py-2 pl-10 pr-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                                    />
                                </label>
                                <input
                                    type="date"
                                    value={dateFrom}
                                    onChange={(event) => setDateFrom(event.target.value)}
                                    className="rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                                />
                                <input
                                    type="date"
                                    value={dateTo}
                                    onChange={(event) => setDateTo(event.target.value)}
                                    className="rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                                />
                                <button
                                    type="button"
                                    onClick={() => fetchRows(1)}
                                    className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-neutral-700"
                                >
                                    Validar
                                </button>
                            </div>
                        </div>

                        <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
                            <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
                                <div>
                                    <h2 className="text-sm font-bold text-neutral-900">
                                        {currentDataset?.label || 'Registros forenses'}
                                    </h2>
                                    <p className="text-xs text-neutral-500">
                                        {fmtNumber(pagination.total)} registros encontrados
                                    </p>
                                </div>
                                <div className="flex items-center gap-2 text-sm text-neutral-500">
                                    <button
                                        type="button"
                                        onClick={() => fetchRows(Math.max(1, pagination.page - 1))}
                                        disabled={loadingRows || pagination.page <= 1}
                                        className="rounded-lg border border-neutral-200 p-2 disabled:opacity-40"
                                    >
                                        <ChevronLeft size={16} />
                                    </button>
                                    <span>
                                        {pagination.page} / {pagination.totalPages}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => fetchRows(Math.min(pagination.totalPages, pagination.page + 1))}
                                        disabled={loadingRows || pagination.page >= pagination.totalPages}
                                        className="rounded-lg border border-neutral-200 p-2 disabled:opacity-40"
                                    >
                                        <ChevronRight size={16} />
                                    </button>
                                </div>
                            </div>

                            <div className="overflow-x-auto">
                                <table className="min-w-full divide-y divide-neutral-200 text-left text-sm">
                                    <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
                                        <tr>
                                            <th className="px-4 py-3 font-semibold">Fecha</th>
                                            <th className="px-4 py-3 font-semibold">Producto / archivo</th>
                                            <th className="px-4 py-3 font-semibold">Proceso</th>
                                            <th className="px-4 py-3 font-semibold">Lote</th>
                                            <th className="px-4 py-3 text-right font-semibold">Cantidad</th>
                                            <th className="px-4 py-3 font-semibold">Fuente</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-neutral-100">
                                        {loadingRows ? (
                                            <tr>
                                                <td colSpan="6" className="px-4 py-12 text-center text-neutral-500">
                                                    <RefreshCw className="mx-auto mb-2 animate-spin text-indigo-500" size={24} />
                                                    Cargando datos forenses...
                                                </td>
                                            </tr>
                                        ) : rows.length === 0 ? (
                                            <tr>
                                                <td colSpan="6" className="px-4 py-12 text-center text-neutral-500">
                                                    No hay registros con los filtros actuales.
                                                </td>
                                            </tr>
                                        ) : rows.map((row) => (
                                            <tr
                                                key={row.id}
                                                onClick={() => setSelectedRow(row)}
                                                className={`cursor-pointer transition-colors hover:bg-neutral-50 ${
                                                    selectedRow?.id === row.id ? 'bg-indigo-50/70' : ''
                                                }`}
                                            >
                                                <td className="whitespace-nowrap px-4 py-3 text-neutral-600">
                                                    <div className="font-medium text-neutral-800">{fmtDateTime(row.ts)}</div>
                                                    <div className="text-xs text-neutral-400">{row.localDay || '-'}</div>
                                                </td>
                                                <td className="max-w-[360px] px-4 py-3">
                                                    <div className="truncate font-semibold text-neutral-900">{getRowTitle(row)}</div>
                                                    <div className="truncate text-xs text-neutral-500">{getRowSubtitle(row)}</div>
                                                </td>
                                                <td className="px-4 py-3">
                                                    {row.processType ? (
                                                        <span className="rounded-md bg-neutral-100 px-2 py-1 text-xs font-semibold text-neutral-700">
                                                            {row.processType}
                                                        </span>
                                                    ) : (
                                                        <span className="text-neutral-400">-</span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-3 font-medium text-neutral-700">{row.lotNumber || '-'}</td>
                                                <td className="px-4 py-3 text-right font-semibold text-neutral-800">
                                                    {fmtNumber(row.quantity ?? row.sizeBytes, row.sizeBytes ? 0 : 2)}
                                                </td>
                                                <td className="max-w-[260px] px-4 py-3">
                                                    <div className="truncate text-xs text-neutral-500">
                                                        {row.source || row.path || row.evidence || '-'}
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </section>

                    <aside className="space-y-4">
                        <div className="rounded-lg border border-neutral-200 bg-white p-4">
                            <h2 className="flex items-center gap-2 text-sm font-bold text-neutral-900">
                                <FileJson size={17} />
                                Detalle para validar
                            </h2>
                            <p className="mt-1 text-xs text-neutral-500">
                                Selecciona una fila para ver la evidencia completa encontrada en logs, temporales o archivos.
                            </p>

                            {selectedRow ? (
                                <pre className="mt-4 max-h-[560px] overflow-auto rounded-lg bg-neutral-950 p-4 text-xs leading-relaxed text-neutral-100">
                                    {JSON.stringify(selectedRow.raw || selectedRow, null, 2)}
                                </pre>
                            ) : (
                                <div className="mt-4 rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500">
                                    Sin registro seleccionado.
                                </div>
                            )}
                        </div>

                        <div className="rounded-lg border border-neutral-200 bg-white p-4">
                            <h2 className="text-sm font-bold text-neutral-900">Ultimos dias reconstruidos</h2>
                            <div className="mt-3 space-y-2">
                                {(summary?.completedByDay || []).slice(0, 8).map((item) => (
                                    <div key={item.day || 'empty'} className="flex items-center justify-between text-sm">
                                        <span className="text-neutral-600">{item.day || 'Sin fecha'}</span>
                                        <span className="font-bold text-neutral-900">{fmtNumber(item.count)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="rounded-lg border border-neutral-200 bg-white p-4">
                            <h2 className="text-sm font-bold text-neutral-900">Productos con lotes recuperados</h2>
                            <div className="mt-3 space-y-3">
                                {(summary?.producedByProduct || []).slice(0, 8).map((item) => (
                                    <div key={item.productName}>
                                        <div className="flex items-start justify-between gap-3 text-sm">
                                            <span className="font-medium text-neutral-700">{item.productName}</span>
                                            <span className="shrink-0 font-bold text-neutral-900">{fmtNumber(item.lots)}</span>
                                        </div>
                                        <p className="text-xs text-neutral-500">{fmtNumber(item.quantity, 2)} unidades / gramos segun evidencia</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </aside>
                </div>
            </div>
        </div>
    );
};

export default ForensicRecoveryPage;
