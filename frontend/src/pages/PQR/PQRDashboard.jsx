import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    PieChart, Pie, Cell, Legend,
    AreaChart, Area
} from 'recharts';
import { Activity, Package, AlertTriangle, Clock, TrendingUp, Search, ChevronDown, ChevronRight, Eye, X, Image as ImageIcon, ShieldAlert, Download, Calendar, ArrowUpDown } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL;

const COLORS = ['#3b82f6', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316', '#84cc16', '#6366f1'];
const STAGE_COLORS = {
    'Revisión Calidad': '#3b82f6',
    'Nota Crédito': '#f59e0b',
    'Facturación': '#818cf8',
    'Logística': '#a855f7',
    'Completado': '#10b981',
    'Rechazado': '#ef4444'
};

const TYPE_LABELS = {
    CALIDAD: 'Calidad', FALTANTE: 'Faltante', SOBRANTE: 'Sobrante', TROCADO: 'Trocado',
    AVERIA_TRANSPORTE: 'Avería Transporte', CALCIFICACION: 'Calcificación', INFLADO: 'Inflado',
    ELEMENTO_EXTRANO: 'Elemento Extraño', SABOR_DIFERENTE: 'Sabor Diferente',
    MAL_SELLADO: 'Mal Sellado', MAL_ETIQUETADO: 'Mal Etiquetado', TARRO_VACIO: 'Tarro Vacío',
    VENCIDO: 'Vencido', CONTAMINADO: 'Contaminado', OTRO: 'Otro'
};
const RECALL_UNITS_THRESHOLD = 10;
const normalizePresentationSize = (size) => {
    const digits = String(size || '').replace(/[^\d]/g, '');
    if (!digits) return 'sin-tamano';
    const asNumber = parseInt(digits, 10);
    if (!Number.isFinite(asNumber)) return 'sin-tamano';
    if (asNumber === 1100) return '1150g';
    return `${asNumber}g`;
};
const matchesLastReportBucket = (daysSinceLast, bucket) => {
    if (bucket === 'NO_DATA') return daysSinceLast === null;
    if (daysSinceLast === null) return false;
    if (bucket === '0_7') return daysSinceLast <= 7;
    if (bucket === '8_14') return daysSinceLast >= 8 && daysSinceLast <= 14;
    if (bucket === '15_30') return daysSinceLast >= 15 && daysSinceLast <= 30;
    if (bucket === '31_PLUS') return daysSinceLast >= 31;
    return false;
};
const LOT_SORT_OPTIONS = [
    { value: 'days', label: 'Días (asc)' },
    { value: 'recent', label: 'Más recientes' },
    { value: 'count', label: 'Reclamos' },
    { value: 'quantity', label: 'Unidades' }
];
const SEVERITY_FILTER_OPTIONS = [
    { value: 'recall', label: 'Recall' },
    { value: 'critical', label: 'Crítico' },
    { value: 'warning', label: 'Atención' },
    { value: 'review', label: 'Revisión' },
    { value: 'normal', label: 'Normal' }
];
const FOLLOW_UP_FILTER_OPTIONS = [
    { value: 'continua', label: 'Sigue reportándose' },
    { value: 'nuevo', label: 'Nuevo en observación' },
    { value: 'observacion', label: 'En observación' },
    { value: 'enfriando', label: 'Enfriando' },
    { value: 'detenida', label: 'Detenida' },
    { value: 'sin_datos', label: 'Sin datos' }
];
const PREDICTION_FILTER_OPTIONS = [
    { value: 'todo_lote', label: 'Casi todo el lote' },
    { value: 'parcial_alta', label: 'Parcial alto' },
    { value: 'parcial_baja', label: 'Parcial bajo' },
    { value: 'sin_proyeccion', label: 'Sin proyección' }
];
const LAST_REPORT_BUCKET_OPTIONS = [
    { value: '0_7', label: '0-7 días' },
    { value: '8_14', label: '8-14 días' },
    { value: '15_30', label: '15-30 días' },
    { value: '31_PLUS', label: '31+ días' },
    { value: 'NO_DATA', label: 'Sin dato' }
];

const KPICard = ({ icon: Icon, label, value, sub, color }) => (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm hover:shadow-md transition-shadow">
        <div className="flex items-center gap-3 mb-2">
            <div className={`p-2 rounded-xl ${color}`}>
                <Icon size={20} className="text-white" />
            </div>
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">{label}</span>
        </div>
        <p className="text-3xl font-black text-gray-900">{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
);

const ChartCard = ({ title, children, className = '' }) => (
    <div className={`bg-white rounded-2xl border border-gray-100 p-5 shadow-sm ${className}`}>
        <h3 className="font-bold text-gray-800 text-sm uppercase tracking-wider mb-4">{title}</h3>
        {children}
    </div>
);

const FilterChipGroup = ({ title, options, selectedValues, onToggle }) => (
    <div className="space-y-2">
        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{title}</p>
        <div className="flex flex-wrap gap-2">
            {options.map((option) => {
                const isActive = selectedValues.includes(option.value);
                return (
                    <button
                        key={option.value}
                        type="button"
                        onClick={() => onToggle(option.value)}
                        className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${isActive
                            ? 'border-blue-600 bg-blue-600 text-white shadow-sm'
                            : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
                            }`}
                    >
                        {option.label}
                    </button>
                );
            })}
        </div>
    </div>
);

const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
        <div className="bg-gray-900 text-white text-xs rounded-lg px-3 py-2 shadow-xl">
            <p className="font-bold mb-1">{label}</p>
            {payload.map((p, i) => (
                <p key={i} style={{ color: p.color }}>
                    {p.name}: <strong>{p.value?.toLocaleString()}</strong>
                </p>
            ))}
        </div>
    );
};

const PQRDashboard = () => {
    const { token } = useAuth();
    const navigate = useNavigate();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [selectedDistributorId, setSelectedDistributorId] = useState('ALL');
    const [distributorOptions, setDistributorOptions] = useState([]);
    const [lotSearch, setLotSearch] = useState('');
    const [expandedLots, setExpandedLots] = useState({});
    const [selectedImage, setSelectedImage] = useState(null);
    const [downloadingReport, setDownloadingReport] = useState(false);
    const [lotSort, setLotSort] = useState('days');
    const [selectedSeverities, setSelectedSeverities] = useState([]);
    const [selectedFollowUpStatuses, setSelectedFollowUpStatuses] = useState([]);
    const [selectedPredictionOutcomes, setSelectedPredictionOutcomes] = useState([]);
    const [selectedLastReportBuckets, setSelectedLastReportBuckets] = useState([]);
    const [selectedPresentations, setSelectedPresentations] = useState([]);
    const [onlyWithMissingUnits, setOnlyWithMissingUnits] = useState(false);
    const [showLotFilters, setShowLotFilters] = useState(false);
    const [lastSyncAt, setLastSyncAt] = useState(null);

    useEffect(() => {
        if (!token) return;
        fetchAnalytics(selectedDistributorId);
    }, [selectedDistributorId, token]);

    const fetchAnalytics = async (distributorId = 'ALL', options = {}) => {
        const { showLoader = true } = options;
        if (!token) return;
        if (showLoader) setLoading(true);
        try {
            const res = await axios.get(`${API_URL}/api/pqr/analytics`, {
                headers: { Authorization: `Bearer ${token}` },
                params: distributorId !== 'ALL' ? { distributorId } : undefined
            });
            setData(res.data);
            setLastSyncAt(new Date());

            if (distributorId === 'ALL') {
                const options = (res.data?.byDistributor || [])
                    .filter((row) => row.distributorId)
                    .map((row) => ({
                        id: row.distributorId,
                        name: row.distributor,
                        count: row.count
                    }));
                setDistributorOptions(options);
            }
        } catch (err) {
            console.error('Error fetching PQR analytics:', err);
        } finally {
            if (showLoader) setLoading(false);
        }
    };

    if (loading) return (
        <div className="flex items-center justify-center h-96">
            <div className="animate-spin w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full"></div>
        </div>
    );
    if (!data) return <div className="p-6 text-red-500">Error al cargar analíticas</div>;

    const toUnitsNumber = (value) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
    };
    const getDaysSinceLastReport = (lot) => {
        const n = Number(lot?.followUp?.timeline?.daysSinceLastReport);
        return Number.isFinite(n) && n >= 0 ? n : null;
    };
    const toggleMultiFilter = (setter, value) => {
        setter((prev) => (
            prev.includes(value)
                ? prev.filter((entry) => entry !== value)
                : [...prev, value]
        ));
    };
    const presentationFilterOptions = (() => {
        const values = new Set();
        (data.byLot || []).forEach((lot) => {
            if (Array.isArray(lot.presentationCounts) && lot.presentationCounts.length > 0) {
                lot.presentationCounts.forEach((entry) => values.add(normalizePresentationSize(entry?.size)));
                return;
            }
            (lot.items || []).forEach((item) => values.add(normalizePresentationSize(item?.size)));
        });
        return Array.from(values)
            .filter(Boolean)
            .sort((a, b) => {
                const aNum = parseInt(String(a).replace(/[^\d]/g, ''), 10);
                const bNum = parseInt(String(b).replace(/[^\d]/g, ''), 10);
                const aHasNum = Number.isFinite(aNum);
                const bHasNum = Number.isFinite(bNum);
                if (aHasNum && bHasNum) return bNum - aNum;
                if (aHasNum) return -1;
                if (bHasNum) return 1;
                return String(a).localeCompare(String(b));
            })
            .map((value) => ({
                value,
                label: value === 'sin-tamano' ? 'Sin tamaño' : value
            }));
    })();
    const clearLotFilters = () => {
        setLotSearch('');
        setLotSort('days');
        setSelectedSeverities([]);
        setSelectedFollowUpStatuses([]);
        setSelectedPredictionOutcomes([]);
        setSelectedLastReportBuckets([]);
        setSelectedPresentations([]);
        setOnlyWithMissingUnits(false);
    };
    const filteredLots = (() => {
        const searchValue = lotSearch.trim().toLowerCase();
        const source = data.byLot || [];

        return source.filter((lot) => {
            if (searchValue) {
                const matchesSearch = (
                    String(lot.lot || '').toLowerCase().includes(searchValue)
                    || (lot.products || []).some((product) => String(product || '').toLowerCase().includes(searchValue))
                    || (lot.flavors || []).some((flavor) => String(flavor || '').toLowerCase().includes(searchValue))
                    || (lot.distributors || []).some((distributor) => String(distributor || '').toLowerCase().includes(searchValue))
                );
                if (!matchesSearch) return false;
            }

            const severity = lot.severity || 'normal';
            if (selectedSeverities.length > 0 && !selectedSeverities.includes(severity)) return false;

            const followUpStatus = lot?.followUp?.status || 'sin_datos';
            if (selectedFollowUpStatuses.length > 0 && !selectedFollowUpStatuses.includes(followUpStatus)) return false;

            const rawPredictionOutcome = lot?.followUp?.prediction?.predictedOutcome;
            const predictionOutcome = rawPredictionOutcome && rawPredictionOutcome !== 'indeterminado'
                ? rawPredictionOutcome
                : 'sin_proyeccion';
            if (selectedPredictionOutcomes.length > 0 && !selectedPredictionOutcomes.includes(predictionOutcome)) return false;

            const daysSinceLast = getDaysSinceLastReport(lot);
            if (selectedLastReportBuckets.length > 0) {
                const hasBucketMatch = selectedLastReportBuckets.some((bucket) => matchesLastReportBucket(daysSinceLast, bucket));
                if (!hasBucketMatch) return false;
            }

            if (selectedPresentations.length > 0) {
                const lotPresentationValues = new Set(
                    (lot.presentationCounts || []).map((entry) => normalizePresentationSize(entry?.size))
                );
                if (lotPresentationValues.size === 0) {
                    (lot.items || []).forEach((item) => lotPresentationValues.add(normalizePresentationSize(item?.size)));
                }
                const hasPresentationMatch = selectedPresentations.some((size) => lotPresentationValues.has(size));
                if (!hasPresentationMatch) return false;
            }

            if (onlyWithMissingUnits) {
                const producedUnitsTotal = toUnitsNumber(
                    lot?.productionVsReported?.producedUnitsTotal ?? lot?.producedUnits?.total
                );
                if (producedUnitsTotal <= 0) return false;
                const reportedUnitsTotal = toUnitsNumber(
                    lot?.productionVsReported?.reportedUnitsTotal ?? lot?.quantity
                );
                const missingUnitsToReport = Math.max(producedUnitsTotal - reportedUnitsTotal, 0);
                if (missingUnitsToReport <= 0) return false;
            }

            return true;
        }).sort((a, b) => {
            if (lotSort === 'days') {
                const da = a.daysToReport ?? 9999;
                const db = b.daysToReport ?? 9999;
                return da - db;
            }
            if (lotSort === 'recent') {
                const da = a.lastReportDate || a.firstReportDate || a.productionDate || '';
                const db = b.lastReportDate || b.firstReportDate || b.productionDate || '';
                return String(db).localeCompare(String(da));
            }
            if (lotSort === 'quantity') {
                return toUnitsNumber(b.quantity) - toUnitsNumber(a.quantity);
            }
            return toUnitsNumber(b.count) - toUnitsNumber(a.count);
        });
    })();

    const ageInfo = data.lotAgeAnalysis;
    const selectedDistributorName = selectedDistributorId === 'ALL'
        ? 'Todos los distribuidores'
        : (distributorOptions.find((option) => option.id === selectedDistributorId)?.name
            || data.byDistributor?.[0]?.distributor
            || 'Distribuidor seleccionado');

    const getPresentationReportedUnits = (presentation) => toUnitsNumber(
        presentation?.reportedUnits ?? presentation?.quantity
    );

    const getPresentationCounts = (lot) => {
        if (Array.isArray(lot.presentationCounts) && lot.presentationCounts.length > 0) {
            return lot.presentationCounts.map((p) => ({
                ...p,
                itemCount: toUnitsNumber(p.itemCount ?? p.count),
                reportedUnits: getPresentationReportedUnits(p),
                quantity: getPresentationReportedUnits(p)
            }));
        }

        const map = {};
        (lot.items || []).forEach((item) => {
            const size = item.size || 'Sin tamaño';
            const qty = toUnitsNumber(item.quantity);
            if (!map[size]) map[size] = { size, count: 0, itemCount: 0, quantity: 0, reportedUnits: 0 };
            map[size].count += 1;
            map[size].itemCount += 1;
            map[size].quantity += qty;
            map[size].reportedUnits += qty;
        });

        return Object.values(map).sort((a, b) => {
            const aNum = parseInt(String(a.size || '').replace(/[^\d]/g, ''), 10);
            const bNum = parseInt(String(b.size || '').replace(/[^\d]/g, ''), 10);
            const aHasNum = !isNaN(aNum);
            const bHasNum = !isNaN(bNum);
            if (aHasNum && bHasNum) return bNum - aNum;
            if (aHasNum) return -1;
            if (bHasNum) return 1;
            return String(a.size || '').localeCompare(String(b.size || ''));
        });
    };

    const normalizePresentationForCross = (size) => normalizePresentationSize(size);

    const getProducedUnitsTotal = (lot) => toUnitsNumber(
        lot?.productionVsReported?.producedUnitsTotal ?? lot?.producedUnits?.total
    );

    const getReportedUnitsTotal = (lot) => toUnitsNumber(
        lot?.productionVsReported?.reportedUnitsTotal ?? lot?.quantity
    );

    const getMissingUnitsToReport = (lot) => {
        const producedUnitsTotal = getProducedUnitsTotal(lot);
        if (producedUnitsTotal <= 0) return null;
        return Math.max(producedUnitsTotal - getReportedUnitsTotal(lot), 0);
    };

    const getProductionCrossByPresentation = (lot) => {
        if (Array.isArray(lot?.productionVsReported?.byPresentation) && lot.productionVsReported.byPresentation.length > 0) {
            return lot.productionVsReported.byPresentation;
        }

        const producedByPresentation = {
            '3400g': toUnitsNumber(lot?.producedUnits?.['3400g']),
            '1150g': toUnitsNumber(lot?.producedUnits?.['1150g']),
            '350g': toUnitsNumber(lot?.producedUnits?.['350g'])
        };
        const reportedByPresentation = { '3400g': 0, '1150g': 0, '350g': 0 };

        getPresentationCounts(lot).forEach((p) => {
            const normalized = normalizePresentationForCross(p.size);
            if (!Object.prototype.hasOwnProperty.call(reportedByPresentation, normalized)) return;
            reportedByPresentation[normalized] += toUnitsNumber(getPresentationReportedUnits(p));
        });

        return ['3400g', '1150g', '350g']
            .map((size) => {
                const producedUnits = producedByPresentation[size];
                const reportedUnits = reportedByPresentation[size];
                return {
                    size,
                    producedUnits,
                    reportedUnits,
                    missingUnits: producedUnits > 0 ? Math.max(producedUnits - reportedUnits, 0) : 0
                };
            })
            .filter((entry) => entry.producedUnits > 0 || entry.reportedUnits > 0);
    };

    const lotStatusIndicators = (() => {
        const sourceLots = data.byLot || [];
        const criticalLots = sourceLots.filter((lot) => lot.severity === 'critical');
        const recallLots = sourceLots.filter((lot) => lot.severity === 'recall');
        const severeLots = sourceLots.filter((lot) => lot.severity === 'critical' || lot.severity === 'recall');

        const criticalReportedUnits = criticalLots.reduce((sum, lot) => sum + getReportedUnitsTotal(lot), 0);
        const criticalMissingUnitsToReport = criticalLots.reduce(
            (sum, lot) => sum + (getMissingUnitsToReport(lot) || 0),
            0
        );
        const criticalLotsPendingReport = criticalLots.filter((lot) => (getMissingUnitsToReport(lot) || 0) > 0).length;
        const recallReportedUnits = recallLots.reduce((sum, lot) => sum + getReportedUnitsTotal(lot), 0);
        const severeProducedUnits = severeLots.reduce((sum, lot) => sum + getProducedUnitsTotal(lot), 0);
        const severeReportedUnits = severeLots.reduce((sum, lot) => sum + getReportedUnitsTotal(lot), 0);
        const severeMissingUnitsToReport = severeLots.reduce((sum, lot) => sum + (getMissingUnitsToReport(lot) || 0), 0);
        const severeLotsWithProductionCross = severeLots.filter((lot) => getProducedUnitsTotal(lot) > 0).length;

        return {
            criticalLots: criticalLots.length,
            criticalReportedUnits,
            criticalMissingUnitsToReport,
            criticalLotsPendingReport,
            recallLots: recallLots.length,
            recallReportedUnits,
            severeProducedUnits,
            severeReportedUnits,
            severeMissingUnitsToReport,
            severeLotsWithProductionCross
        };
    })();
    const reportTemperature = data.reportTemperature || null;
    const lotFollowUpSummary = data.lotFollowUpSummary || null;
    const defectFollowUpProjection = data.defectFollowUpProjection
        || lotFollowUpSummary?.defectFollowUpProjection
        || [];
    const calmLight = reportTemperature?.calmLight || lotFollowUpSummary?.calmLight || null;

    const getFollowUpStatusMeta = (status) => {
        if (status === 'continua') return { label: 'Sigue reportándose', className: 'bg-red-100 text-red-700' };
        if (status === 'nuevo') return { label: 'Nuevo en observación', className: 'bg-purple-100 text-purple-700' };
        if (status === 'observacion') return { label: 'En observación', className: 'bg-amber-100 text-amber-700' };
        if (status === 'enfriando') return { label: 'Enfriando', className: 'bg-cyan-100 text-cyan-700' };
        if (status === 'detenida') return { label: 'No se volvió a reportar', className: 'bg-emerald-100 text-emerald-700' };
        return { label: 'Sin datos', className: 'bg-gray-100 text-gray-600' };
    };

    const getPredictionMeta = (prediction) => {
        const outcome = prediction?.predictedOutcome;
        if (outcome === 'todo_lote') return { label: 'Casi todo el lote', className: 'bg-red-100 text-red-700' };
        if (outcome === 'parcial_alta') return { label: 'Parcial alto', className: 'bg-orange-100 text-orange-700' };
        if (outcome === 'parcial_baja') return { label: 'Parcial bajo', className: 'bg-blue-100 text-blue-700' };
        return { label: 'Sin proyección', className: 'bg-gray-100 text-gray-600' };
    };

    const getTemperatureMeta = (level) => {
        if (level === 'alta') return { label: 'Alta', className: 'bg-red-100 text-red-700 border-red-200' };
        if (level === 'baja') return { label: 'Baja', className: 'bg-emerald-100 text-emerald-700 border-emerald-200' };
        if (level === 'sin_reportes') return { label: 'Sin Reportes', className: 'bg-slate-100 text-slate-700 border-slate-200' };
        return { label: 'Media', className: 'bg-amber-100 text-amber-700 border-amber-200' };
    };
    const getCalmLightMeta = (state) => {
        if (state === 'calma_alta') return { label: 'Calma alta', className: 'bg-emerald-100 text-emerald-700 border-emerald-200' };
        if (state === 'calma_moderada') return { label: 'Calma moderada', className: 'bg-lime-100 text-lime-700 border-lime-200' };
        if (state === 'datos_insuficientes') return { label: 'Datos insuficientes', className: 'bg-slate-100 text-slate-700 border-slate-200' };
        return { label: 'Sin calma', className: 'bg-amber-100 text-amber-700 border-amber-200' };
    };

    const formatSignedPct = (value) => {
        const n = Number(value);
        if (!Number.isFinite(n)) return '0%';
        if (n > 0) return `+${n}%`;
        return `${n}%`;
    };
    const temperatureMeta = getTemperatureMeta(reportTemperature?.level);
    const calmLightMeta = getCalmLightMeta(calmLight?.state);
    const activeLotFilterCount = [
        lotSearch.trim() !== '' ? 1 : 0,
        selectedSeverities.length > 0 ? 1 : 0,
        selectedFollowUpStatuses.length > 0 ? 1 : 0,
        selectedPredictionOutcomes.length > 0 ? 1 : 0,
        selectedLastReportBuckets.length > 0 ? 1 : 0,
        selectedPresentations.length > 0 ? 1 : 0,
        onlyWithMissingUnits ? 1 : 0
    ].reduce((sum, value) => sum + value, 0);
    const hasActiveLotFilters = activeLotFilterCount > 0;

    return (
        <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
            {/* Header */}
            <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-black text-gray-900">Dashboard PQR</h1>
                    <p className="text-gray-500 text-sm">Análisis de calidad, tendencias y lotes problemáticos</p>
                </div>
                <div className="w-full lg:w-auto">
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Filtrar por Distribuidor</label>
                    <select
                        value={selectedDistributorId}
                        onChange={(e) => {
                            setSelectedDistributorId(e.target.value);
                            setExpandedLots({});
                        }}
                        className="w-full lg:w-[320px] px-3 py-2 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                        <option value="ALL">Todos los distribuidores</option>
                        {distributorOptions.map((option) => (
                            <option key={option.id} value={option.id}>
                                {option.name} ({option.count})
                            </option>
                        ))}
                    </select>
                    {lastSyncAt && (
                        <p className="mt-1 text-[11px] text-gray-400">
                            Actualizado: {new Date(lastSyncAt).toLocaleTimeString('es-CO')}
                        </p>
                    )}
                </div>
            </div>
            {selectedDistributorId !== 'ALL' && (
                <div className="bg-blue-50 border border-blue-100 text-blue-800 rounded-xl px-4 py-2 text-sm font-medium">
                    Mostrando PQR reportadas por <strong>{selectedDistributorName}</strong>.
                </div>
            )}

            {/* KPI Row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <KPICard icon={AlertTriangle} label="Total PQRs" value={data.kpis.totalPQRs} color="bg-blue-500" />
                <KPICard icon={Package} label="Unidades Afectadas" value={data.kpis.totalUnitsAffected.toLocaleString()} color="bg-amber-500" />
                <KPICard icon={TrendingUp} label="Tasa Resolución" value={`${data.kpis.resolutionRate}%`} color="bg-emerald-500" />
                <KPICard icon={Clock} label="Tiempo Promedio" value={`${data.kpis.avgResolutionDays}d`} sub="días para resolver" color="bg-purple-500" />
                {ageInfo && ageInfo.avgDaysFiltered !== null && (
                    <KPICard icon={Calendar} label="Vida Útil Prom." value={`${ageInfo.avgDaysFiltered}d`}
                        sub={`Mediana ${ageInfo.medianDays}d · σ ${ageInfo.stdDev}d · ${ageInfo.filteredSize} lotes (${ageInfo.outliersRemoved} outliers)`}
                        color="bg-cyan-500" />
                )}
            </div>

            {/* Row 2: Defects by Type + Monthly Trend */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <ChartCard title="Defectos por Tipo">
                    <ResponsiveContainer width="100%" height={260}>
                        <PieChart>
                            <Pie data={data.byType} dataKey="count" nameKey="label" cx="50%" cy="50%" outerRadius={90} innerRadius={50} paddingAngle={3} label={({ label, count }) => `${label}: ${count}`} labelLine={false}>
                                {data.byType.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                            </Pie>
                            <Tooltip content={<CustomTooltip />} />
                            <Legend iconType="circle" wrapperStyle={{ fontSize: '12px' }} />
                        </PieChart>
                    </ResponsiveContainer>
                </ChartCard>

                <ChartCard title="Tendencia Mensual">
                    <ResponsiveContainer width="100%" height={260}>
                        <AreaChart data={data.byMonth}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                            <YAxis tick={{ fontSize: 11 }} />
                            <Tooltip content={<CustomTooltip />} />
                            <Area type="monotone" dataKey="count" name="PQRs" stroke="#3b82f6" fill="#3b82f680" strokeWidth={2} />
                            <Area type="monotone" dataKey="quantity" name="Unidades" stroke="#f59e0b" fill="#f59e0b40" strokeWidth={2} />
                        </AreaChart>
                    </ResponsiveContainer>
                </ChartCard>
            </div>

            {/* Row 3: Top Products + By Flavor */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <ChartCard title="Top Productos Afectados">
                    <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={data.byProduct.slice(0, 10)} layout="vertical" margin={{ left: 10 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                            <XAxis type="number" tick={{ fontSize: 11 }} />
                            <YAxis dataKey="name" type="category" width={180} tick={{ fontSize: 10 }} />
                            <Tooltip content={<CustomTooltip />} />
                            <Bar dataKey="count" name="Reclamos" fill="#3b82f6" radius={[0, 6, 6, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </ChartCard>

                <ChartCard title="PQRs por Sabor">
                    <ResponsiveContainer width="100%" height={300}>
                        <PieChart>
                            <Pie data={data.byFlavor} dataKey="count" nameKey="flavor" cx="50%" cy="50%" outerRadius={100} innerRadius={45} paddingAngle={2}>
                                {data.byFlavor.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                            </Pie>
                            <Tooltip content={<CustomTooltip />} />
                            <Legend iconType="circle" wrapperStyle={{ fontSize: '11px' }} />
                        </PieChart>
                    </ResponsiveContainer>
                </ChartCard>
            </div>

            {/* Row 4: By Size + By Distributor */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <ChartCard title="PQRs por Tamaño">
                    <ResponsiveContainer width="100%" height={260}>
                        <BarChart data={data.bySize}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                            <XAxis dataKey="size" tick={{ fontSize: 11 }} />
                            <YAxis tick={{ fontSize: 11 }} />
                            <Tooltip content={<CustomTooltip />} />
                            <Bar dataKey="count" name="Reclamos" fill="#8b5cf6" radius={[6, 6, 0, 0]} />
                            <Bar dataKey="quantity" name="Unidades" fill="#c4b5fd" radius={[6, 6, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </ChartCard>

                <ChartCard title="PQRs por Distribuidor">
                    <ResponsiveContainer width="100%" height={260}>
                        <BarChart data={data.byDistributor} layout="vertical" margin={{ left: 10 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                            <XAxis type="number" tick={{ fontSize: 11 }} />
                            <YAxis dataKey="distributor" type="category" width={160} tick={{ fontSize: 10 }} />
                            <Tooltip content={<CustomTooltip />} />
                            <Bar dataKey="count" name="PQRs" fill="#ec4899" radius={[0, 6, 6, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </ChartCard>
            </div>

            {/* Row 5: Pipeline + Refund Method + Keywords */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <ChartCard title="Pipeline por Etapa">
                    <ResponsiveContainer width="100%" height={220}>
                        <BarChart data={data.byStage}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                            <XAxis dataKey="label" tick={{ fontSize: 9 }} angle={-20} textAnchor="end" height={50} />
                            <YAxis tick={{ fontSize: 11 }} />
                            <Tooltip content={<CustomTooltip />} />
                            <Bar dataKey="count" name="PQRs" radius={[6, 6, 0, 0]}>
                                {data.byStage.map((entry, i) => (
                                    <Cell key={i} fill={STAGE_COLORS[entry.label] || COLORS[i]} />
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </ChartCard>

                <ChartCard title="Método de Reembolso">
                    <ResponsiveContainer width="100%" height={220}>
                        <PieChart>
                            <Pie data={data.byRefundMethod} dataKey="count" nameKey="label" cx="50%" cy="50%" outerRadius={75} innerRadius={40} paddingAngle={4}>
                                {data.byRefundMethod.map((_, i) => <Cell key={i} fill={COLORS[i + 2]} />)}
                            </Pie>
                            <Tooltip content={<CustomTooltip />} />
                            <Legend iconType="circle" wrapperStyle={{ fontSize: '11px' }} />
                        </PieChart>
                    </ResponsiveContainer>
                </ChartCard>

                <ChartCard title="Causas Detectadas (Keywords)">
                    {data.defectKeywords.length > 0 ? (
                        <div className="space-y-2">
                            {data.defectKeywords.map((kw, i) => (
                                <div key={i} className="flex items-center gap-2">
                                    <div className="flex-1">
                                        <div className="flex justify-between text-xs mb-0.5">
                                            <span className="font-medium text-gray-700">{kw.keyword}</span>
                                            <span className="text-gray-500">{kw.count}</span>
                                        </div>
                                        <div className="w-full bg-gray-100 rounded-full h-2">
                                            <div className="bg-gradient-to-r from-red-400 to-red-600 h-2 rounded-full transition-all"
                                                style={{ width: `${Math.min((kw.count / (data.defectKeywords[0]?.count || 1)) * 100, 100)}%` }} />
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-gray-400 text-sm text-center py-8">Sin datos de causas</p>
                    )}
                </ChartCard>
            </div>

            {/* Row 6: Lot Tracking Table */}
            <ChartCard title="🔍 Seguimiento de Lotes Problemáticos (Consolidado por Sabor)" className="!p-0">
                <div className="p-5 pb-3 grid grid-cols-2 lg:grid-cols-5 gap-3">
                    <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-2">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-red-500">Lotes Críticos</p>
                        <p className="text-xl font-black text-red-700">{lotStatusIndicators.criticalLots.toLocaleString('es-CO')}</p>
                        <p className="text-[11px] text-red-600">{lotStatusIndicators.criticalLotsPendingReport.toLocaleString('es-CO')} con faltantes por reportar</p>
                    </div>
                    <div className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-amber-500">Tarros Críticos Reportados</p>
                        <p className="text-xl font-black text-amber-700">{lotStatusIndicators.criticalReportedUnits.toLocaleString('es-CO')}</p>
                        <p className="text-[11px] text-amber-600">estado crítico</p>
                    </div>
                    <div className="rounded-xl border border-orange-100 bg-orange-50 px-3 py-2">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-orange-500">Faltan p/Reportar (Críticos)</p>
                        <p className="text-xl font-black text-orange-700">{lotStatusIndicators.criticalMissingUnitsToReport.toLocaleString('es-CO')}</p>
                        <p className="text-[11px] text-orange-600">cruce lote/sabor/presentación</p>
                    </div>
                    <div className="rounded-xl border border-red-200 bg-red-100 px-3 py-2">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-red-600">Lotes Recall</p>
                        <p className="text-xl font-black text-red-800">{lotStatusIndicators.recallLots.toLocaleString('es-CO')}</p>
                        <p className="text-[11px] text-red-700">{lotStatusIndicators.recallReportedUnits.toLocaleString('es-CO')} tarros reportados</p>
                    </div>
                    <div className="rounded-xl border border-cyan-100 bg-cyan-50 px-3 py-2">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-cyan-500">Faltan p/Reportar (Crit+Recall)</p>
                        <p className="text-xl font-black text-cyan-700">{lotStatusIndicators.severeMissingUnitsToReport.toLocaleString('es-CO')}</p>
                        <p className="text-[11px] text-cyan-600">
                            prod {lotStatusIndicators.severeProducedUnits.toLocaleString('es-CO')} · rep {lotStatusIndicators.severeReportedUnits.toLocaleString('es-CO')} ({lotStatusIndicators.severeLotsWithProductionCross.toLocaleString('es-CO')} lotes)
                        </p>
                    </div>
                </div>
                {reportTemperature && (
                    <div className="px-5 pb-3 space-y-3">
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                            <div className={`rounded-xl border px-3 py-2 ${temperatureMeta.className}`}>
                                <p className="text-[10px] font-bold uppercase tracking-wide">Temperatura Reportes</p>
                                <p className="text-xl font-black">{temperatureMeta.label}</p>
                                <p className="text-[11px]">{reportTemperature.levelLabel}</p>
                            </div>
                            <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2">
                                <p className="text-[10px] font-bold uppercase tracking-wide text-indigo-500">Tendencia 14d vs 14d</p>
                                <p className={`text-xl font-black ${reportTemperature.trendDirection === 'up' ? 'text-red-700' : reportTemperature.trendDirection === 'down' ? 'text-emerald-700' : 'text-indigo-700'}`}>
                                    {reportTemperature.trendDirection === 'up' ? 'Subiendo' : reportTemperature.trendDirection === 'down' ? 'Bajando' : 'Estable'}
                                </p>
                                <p className="text-[11px] text-indigo-600">
                                    Unidades {formatSignedPct(reportTemperature.unitsTrendPct)} · Reportes {formatSignedPct(reportTemperature.reportsTrendPct)}
                                </p>
                            </div>
                            <div className="rounded-xl border border-violet-100 bg-violet-50 px-3 py-2">
                                <p className="text-[10px] font-bold uppercase tracking-wide text-violet-500">Nuevos vs Rezagos</p>
                                <p className="text-xl font-black text-violet-700">{reportTemperature.sourceMix?.label || 'Sin datos'}</p>
                                <p className="text-[11px] text-violet-600">
                                    Nuevos activos {toUnitsNumber(reportTemperature.sourceMix?.newLotsActive).toLocaleString('es-CO')} · Rezagos {toUnitsNumber(reportTemperature.sourceMix?.residualLotsActive).toLocaleString('es-CO')}
                                </p>
                            </div>
                            <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Atención PQR</p>
                                <p className="text-xl font-black text-slate-700">
                                    {reportTemperature.reportsExhausted ? 'Reportes agotados' : reportTemperature.hasManyReports ? 'Alta demanda' : 'Demanda controlada'}
                                </p>
                                <p className="text-[11px] text-slate-600">
                                    {reportTemperature.attentionHint}
                                </p>
                            </div>
                        </div>
                        {calmLight && (
                            <div className={`rounded-xl border px-3 py-2 ${calmLightMeta.className}`}>
                                <p className="text-[10px] font-bold uppercase tracking-wide">Luz de Calma</p>
                                <p className="text-xl font-black">{calmLightMeta.label}</p>
                                <p className="text-[11px] mt-0.5">{calmLight.label} · score {toUnitsNumber(calmLight.score).toLocaleString('es-CO')}</p>
                                <p className="text-[11px] mt-0.5">
                                    Umbral corto ≤ {toUnitsNumber(calmLight.shortDaysThreshold).toLocaleString('es-CO')}d ·
                                    nuevos cortos recientes {toUnitsNumber(calmLight.newShortLots?.recentCount).toLocaleString('es-CO')} ·
                                    activos {toUnitsNumber(calmLight.newShortLots?.activeCount).toLocaleString('es-CO')}
                                </p>
                                <p className="text-[11px] mt-0.5">{calmLight.hint}</p>
                            </div>
                        )}
                        {reportTemperature.predictionModel && (
                            <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                                <span className="font-black uppercase tracking-wide text-[10px]">Validación del Modelo</span>
                                <p className="mt-1">
                                    {reportTemperature.predictionModel.trained ? 'Modelo entrenado' : 'Fallback heurístico'} ·
                                    muestras {toUnitsNumber(reportTemperature.predictionModel.trainingSamples).toLocaleString('es-CO')} ·
                                    F1 {reportTemperature.predictionModel.validation?.f1 ?? '—'} ·
                                    AUC {reportTemperature.predictionModel.validation?.aucRoc ?? '—'} ·
                                    Brier {reportTemperature.predictionModel.validation?.brier ?? '—'}
                                </p>
                                {reportTemperature.predictionModel.qualityGate && (
                                    <p className="mt-0.5">
                                        Gate calidad {reportTemperature.predictionModel.qualityGate.passed ? 'aprobado' : 'rechazado'} ·
                                        umbral {reportTemperature.predictionModel.decisionThreshold ?? '—'} ·
                                        folds {toUnitsNumber(reportTemperature.predictionModel.validation?.folds).toLocaleString('es-CO')}
                                    </p>
                                )}
                                {reportTemperature.predictionModel.calibration?.isCalibrated && (
                                    <p className="mt-0.5">
                                        Calibración cobertura: γ {reportTemperature.predictionModel.calibration.gamma} ·
                                        mse {reportTemperature.predictionModel.calibration.mse} (base {reportTemperature.predictionModel.calibration.baselineMse})
                                    </p>
                                )}
                            </div>
                        )}
                    </div>
                )}
                {lotFollowUpSummary && (
                    <div className="px-5 pb-3">
                        <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                            Seguimiento global: {toUnitsNumber(lotFollowUpSummary.totalLotsAnalyzed).toLocaleString('es-CO')} lotes analizados ·
                            {` `}Siguen reportándose {toUnitsNumber(lotFollowUpSummary.lotsStillReporting).toLocaleString('es-CO')} ·
                            {` `}No se volvieron a reportar {toUnitsNumber(lotFollowUpSummary.lotsStoppedReporting).toLocaleString('es-CO')} ·
                            {` `}Nuevos con riesgo de continuidad {toUnitsNumber(lotFollowUpSummary.newLotsLikelyContinue).toLocaleString('es-CO')}
                        </div>
                    </div>
                )}
                {defectFollowUpProjection.length > 0 && (
                    <div className="px-5 pb-3">
                        <div className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-3">
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 mb-2">
                                <p className="text-[10px] font-black uppercase tracking-wide text-rose-700">
                                    Continuidad Proyectada por Defecto
                                </p>
                                <p className="text-[11px] text-rose-600">
                                    {toUnitsNumber(defectFollowUpProjection.reduce((sum, row) => sum + toUnitsNumber(row.defectiveUnits), 0)).toLocaleString('es-CO')} envases defectuosos evaluados
                                </p>
                            </div>
                            <ResponsiveContainer width="100%" height={260}>
                                <BarChart data={defectFollowUpProjection} layout="vertical" margin={{ left: 14, right: 14 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#fecdd3" />
                                    <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} tickFormatter={(value) => `${value}%`} />
                                    <YAxis type="category" dataKey="defectLabel" width={130} tick={{ fontSize: 10 }} />
                                    <Tooltip
                                        formatter={(value, name) => [`${toUnitsNumber(value).toLocaleString('es-CO')}%`, name]}
                                        labelFormatter={(label, payload) => {
                                            const row = payload?.[0]?.payload;
                                            if (!row) return label;
                                            return `${label} · ${toUnitsNumber(row.defectiveUnits).toLocaleString('es-CO')} env defectuosos · tasa ${row.defectRateVsGoodPct ?? '—'}% vs buenos · alerta ${row.alertLevel || 'normal'}`;
                                        }}
                                    />
                                    <Legend wrapperStyle={{ fontSize: '11px' }} />
                                    <Bar dataKey="continueLikelyPct" stackId="projection" name="Seguiran reportes" fill="#ef4444" />
                                    <Bar dataKey="uncertainPct" stackId="projection" name="Incierto" fill="#f59e0b" />
                                    <Bar dataKey="stopLikelyPct" stackId="projection" name="Bajaran/pararan" fill="#10b981" radius={[0, 6, 6, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                            <p className="mt-2 text-[11px] text-rose-700">
                                Barra apilada por defecto en porcentaje de envases: combina probabilidad, confianza y validacion contra envases buenos para evitar sobrealertas en defectos de revision.
                            </p>
                        </div>
                    </div>
                )}
                <div className="px-5 pb-3 space-y-3">
                    <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 space-y-4">
                        <div className="flex flex-col xl:flex-row xl:items-center gap-3">
                            <div className="relative flex-1">
                                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                <input
                                    type="text"
                                    placeholder="Buscar por lote, sabor, producto o distribuidor..."
                                    value={lotSearch}
                                    onChange={(e) => setLotSearch(e.target.value)}
                                    className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                />
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => setShowLotFilters((prev) => !prev)}
                                    className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-100"
                                >
                                    {showLotFilters ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                    {showLotFilters ? 'Ocultar filtros' : 'Mostrar filtros'}
                                </button>
                                {filteredLots.some((l) => l.severity === 'recall') && (
                                    <button
                                        onClick={async (e) => {
                                            e.stopPropagation();
                                            setDownloadingReport(true);
                                            try {
                                                const recallReportUrl = new URL(`${API_URL}/api/pqr/analytics/recall-report`);
                                                if (selectedDistributorId !== 'ALL') {
                                                    recallReportUrl.searchParams.set('distributorId', selectedDistributorId);
                                                }
                                                const res = await fetch(recallReportUrl.toString(), {
                                                    headers: { Authorization: `Bearer ${token}` }
                                                });
                                                if (!res.ok) {
                                                    const err = await res.json().catch(() => ({}));
                                                    alert(err.error || 'Error al generar informe');
                                                    return;
                                                }
                                                const blob = await res.blob();
                                                const url = URL.createObjectURL(blob);
                                                const a = document.createElement('a');
                                                a.href = url;
                                                a.download = `RECALL_LIQUIPOPS_${new Date().toISOString().slice(0, 10)}.pdf`;
                                                a.click();
                                                URL.revokeObjectURL(url);
                                            } catch (err) {
                                                console.error('Download error:', err);
                                                alert('Error al descargar el informe');
                                            } finally {
                                                setDownloadingReport(false);
                                            }
                                        }}
                                        disabled={downloadingReport}
                                        className="flex items-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white text-xs font-bold rounded-xl shadow-md transition-all whitespace-nowrap"
                                    >
                                        <Download size={15} className={downloadingReport ? 'animate-bounce' : ''} />
                                        {downloadingReport ? 'Generando...' : 'Descargar Recall'}
                                    </button>
                                )}
                            </div>
                        </div>

                        {showLotFilters && (
                            <div className="space-y-4">
                                <div className="flex flex-wrap items-center gap-2">
                                    <div className="relative">
                                        <ArrowUpDown size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
                                        <select
                                            value={lotSort}
                                            onChange={(e) => setLotSort(e.target.value)}
                                            className="pl-8 pr-8 py-2.5 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                        >
                                            {LOT_SORT_OPTIONS.map((option) => (
                                                <option key={option.value} value={option.value}>{option.label}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <label className="inline-flex items-center gap-2 px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700">
                                        <input
                                            type="checkbox"
                                            checked={onlyWithMissingUnits}
                                            onChange={(e) => setOnlyWithMissingUnits(e.target.checked)}
                                            className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                        />
                                        Solo con faltantes
                                    </label>
                                    {hasActiveLotFilters && (
                                        <button
                                            type="button"
                                            onClick={clearLotFilters}
                                            className="px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-600 hover:bg-slate-100"
                                        >
                                            Limpiar filtros
                                        </button>
                                    )}
                                </div>

                                <div className="grid gap-4 xl:grid-cols-2">
                                    <FilterChipGroup
                                        title="Severidad"
                                        options={SEVERITY_FILTER_OPTIONS}
                                        selectedValues={selectedSeverities}
                                        onToggle={(value) => toggleMultiFilter(setSelectedSeverities, value)}
                                    />
                                    <FilterChipGroup
                                        title="Seguimiento"
                                        options={FOLLOW_UP_FILTER_OPTIONS}
                                        selectedValues={selectedFollowUpStatuses}
                                        onToggle={(value) => toggleMultiFilter(setSelectedFollowUpStatuses, value)}
                                    />
                                    <FilterChipGroup
                                        title="Predicción"
                                        options={PREDICTION_FILTER_OPTIONS}
                                        selectedValues={selectedPredictionOutcomes}
                                        onToggle={(value) => toggleMultiFilter(setSelectedPredictionOutcomes, value)}
                                    />
                                    <FilterChipGroup
                                        title="Último Reporte"
                                        options={LAST_REPORT_BUCKET_OPTIONS}
                                        selectedValues={selectedLastReportBuckets}
                                        onToggle={(value) => toggleMultiFilter(setSelectedLastReportBuckets, value)}
                                    />
                                </div>

                                {presentationFilterOptions.length > 0 && (
                                    <FilterChipGroup
                                        title="Presentación"
                                        options={presentationFilterOptions}
                                        selectedValues={selectedPresentations}
                                        onToggle={(value) => toggleMultiFilter(setSelectedPresentations, value)}
                                    />
                                )}
                            </div>
                        )}

                        {!showLotFilters && hasActiveLotFilters && (
                            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                                Hay filtros avanzados activos ({activeLotFilterCount}). Puede mostrarlos para editarlos o limpiarlos.
                            </div>
                        )}
                    </div>
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                        <p className="text-[11px] text-gray-500">
                            Lotes visibles: <strong>{filteredLots.length.toLocaleString('es-CO')}</strong> de{' '}
                            <strong>{(data.byLot?.length || 0).toLocaleString('es-CO')}</strong>
                        </p>
                        {hasActiveLotFilters && (
                            <p className="text-[11px] text-slate-500">
                                Filtros activos: <strong>{activeLotFilterCount}</strong>
                            </p>
                        )}
                    </div>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-gray-50 border-y border-gray-100">
                                <th className="px-5 py-3 text-left text-xs font-bold text-gray-500 uppercase">Severidad</th>
                                <th className="px-5 py-3 text-left text-xs font-bold text-gray-500 uppercase">Lote</th>
                                <th className="px-5 py-3 text-left text-xs font-bold text-gray-500 uppercase">Sabor</th>
                                <th className="px-5 py-3 text-left text-xs font-bold text-gray-500 uppercase">Presentaciones</th>
                                <th className="px-5 py-3 text-left text-xs font-bold text-gray-500 uppercase">Distribuidores</th>
                                <th className="px-5 py-3 text-center text-xs font-bold text-gray-500 uppercase cursor-pointer hover:text-cyan-600" onClick={() => setLotSort(prev => prev === 'days' ? 'recent' : 'days')}>
                                    Días {lotSort === 'days' && '↑'}
                                </th>
                                <th className="px-5 py-3 text-center text-xs font-bold text-gray-500 uppercase">Reclamos</th>
                                <th className="px-5 py-3 text-center text-xs font-bold text-gray-500 uppercase">Unidades</th>
                                <th className="px-5 py-3 text-center text-xs font-bold text-gray-500 uppercase">Faltan p/Reportar</th>
                                <th className="px-5 py-3 text-center text-xs font-bold text-gray-500 uppercase">Seguimiento</th>
                                <th className="px-5 py-3 text-center text-xs font-bold text-gray-500 uppercase">Predicción</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {filteredLots.length > 0 ? filteredLots.map((lot, i) => {
                                const missingUnitsToReport = getMissingUnitsToReport(lot);
                                const producedUnitsTotal = getProducedUnitsTotal(lot);
                                const reportedUnitsTotal = getReportedUnitsTotal(lot);
                                const coveragePct = lot?.productionVsReported?.coveragePct ?? (
                                    producedUnitsTotal > 0
                                        ? Math.round((reportedUnitsTotal / producedUnitsTotal) * 10000) / 100
                                        : null
                                );
                                const byPresentationCross = getProductionCrossByPresentation(lot);
                                const followUp = lot.followUp || null;
                                const followUpStatusMeta = getFollowUpStatusMeta(followUp?.status);
                                const predictionMeta = getPredictionMeta(followUp?.prediction);
                                const continueProb = toUnitsNumber(followUp?.prediction?.continueReportingProbabilityPct);
                                const expectedCoverage = followUp?.prediction?.expectedFinalCoveragePct;
                                const daysSinceLastReport = followUp?.timeline?.daysSinceLastReport;
                                return (
                                <React.Fragment key={i}>
                                    <tr
                                        className={`hover:bg-gray-50 transition-colors cursor-pointer ${lot.severity === 'recall' ? 'bg-red-100 animate-pulse' : lot.severity === 'critical' ? 'bg-red-50/50' : lot.severity === 'warning' ? 'bg-amber-50/30' : lot.severity === 'review' ? 'bg-sky-50/35' : ''}`}
                                        onClick={() => setExpandedLots(prev => ({ ...prev, [lot.lot]: !prev[lot.lot] }))}
                                    >
                                        <td className="px-5 py-3">
                                            <div className="flex items-center gap-2">
                                                {expandedLots[lot.lot] ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
                                                {lot.severity === 'recall' && <span className="px-2 py-1 rounded-full text-xs font-bold bg-red-600 text-white shadow-md">🚨 RECALL</span>}
                                                {lot.severity === 'critical' && <span className="px-2 py-1 rounded-full text-xs font-bold bg-red-100 text-red-700">🔴 Crítico</span>}
                                                {lot.severity === 'warning' && <span className="px-2 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-700">🟡 Atención</span>}
                                                {lot.severity === 'review' && <span className="px-2 py-1 rounded-full text-xs font-bold bg-sky-100 text-sky-700">Revisión</span>}
                                                {lot.severity === 'normal' && <span className="px-2 py-1 rounded-full text-xs font-bold bg-gray-100 text-gray-600">⚪ Normal</span>}
                                            </div>
                                        </td>
                                        <td className="px-5 py-3 font-mono font-bold text-gray-900">{lot.lot}</td>
                                        <td className="px-5 py-3 text-xs text-gray-600">
                                            {(lot.flavors || []).map((f, j) => (
                                                <span key={j} className="inline-block bg-purple-50 text-purple-700 px-2 py-0.5 rounded-md mr-1 mb-1 font-medium">{f}</span>
                                            ))}
                                        </td>
                                        <td className="px-5 py-3 text-xs text-gray-600">
                                            <div className="flex flex-wrap gap-1.5">
                                                {getPresentationCounts(lot).map((p, j) => (
                                                    <span key={j} className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 px-2 py-0.5 rounded-md font-semibold">
                                                        <span>{p.size}</span>
                                                        <span className="text-[10px] bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded-full">
                                                            {getPresentationReportedUnits(p).toLocaleString('es-CO')}
                                                        </span>
                                                    </span>
                                                ))}
                                            </div>
                                        </td>
                                        <td className="px-5 py-3 text-xs text-gray-600">
                                            {lot.distributors.join(', ')}
                                        </td>
                                        <td className="px-5 py-3 text-center">
                                            {lot.daysToReport !== null && lot.daysToReport !== undefined ? (
                                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${lot.daysToReport <= 15 ? 'bg-red-100 text-red-700' :
                                                    lot.daysToReport <= 30 ? 'bg-amber-100 text-amber-700' :
                                                        'bg-green-100 text-green-700'
                                                    }`}>
                                                    {lot.daysToReport}d
                                                </span>
                                            ) : (
                                                <span className="text-gray-300 text-xs">—</span>
                                            )}
                                        </td>
                                        <td className="px-5 py-3 text-center font-bold text-gray-900">{lot.count}</td>
                                        <td className="px-5 py-3 text-center font-bold text-gray-900">{lot.quantity.toLocaleString()}</td>
                                        <td className="px-5 py-3 text-center">
                                            {producedUnitsTotal > 0 ? (
                                                (missingUnitsToReport || 0) > 0 ? (
                                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-orange-100 text-orange-700">
                                                        {(missingUnitsToReport || 0).toLocaleString('es-CO')} tarros
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700">
                                                        0 (completo)
                                                    </span>
                                                )
                                            ) : (lot.severity === 'critical' || lot.severity === 'recall') ? (
                                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700">
                                                    Sin cruce prod.
                                                </span>
                                            ) : (
                                                <span className="text-gray-300 text-xs">—</span>
                                            )}
                                        </td>
                                        <td className="px-5 py-3 text-center">
                                            <div className="flex flex-col items-center gap-1">
                                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${followUpStatusMeta.className}`}>
                                                    {followUpStatusMeta.label}
                                                </span>
                                                {daysSinceLastReport !== null && daysSinceLastReport !== undefined && (
                                                    <span className="text-[10px] text-gray-500">Últ. reporte {daysSinceLastReport}d</span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-5 py-3 text-center">
                                            <div className="flex flex-col items-center gap-1">
                                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${predictionMeta.className}`}>
                                                    {predictionMeta.label}
                                                </span>
                                                <span className="text-[10px] text-gray-500">
                                                    {continueProb > 0 ? `${continueProb}% seguirá reportándose` : 'Sin probabilidad'}
                                                </span>
                                                {expectedCoverage !== null && expectedCoverage !== undefined && (
                                                    <span className="text-[10px] text-gray-500">Cobertura final estimada {expectedCoverage}%</span>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                    {expandedLots[lot.lot] && (
                                        <tr>
                                            <td colSpan="11" className="px-5 py-0 bg-gray-50/80">
                                                <div className="py-4 px-4">
                                                    {lot.isAliasMerged && Array.isArray(lot.mergedFromLots) && lot.mergedFromLots.length > 0 && (
                                                        <div className="mb-4 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-800">
                                                            Lote agrupado con alias reportados: <strong>{lot.mergedFromLots.join(', ')}</strong>. Se enlazó al lote con mejor cruce de producción.
                                                        </div>
                                                    )}
                                                    {lot.severity === 'recall' && (
                                                        <div className="mb-4 bg-red-600 text-white rounded-xl p-4 flex items-start gap-3 shadow-lg">
                                                            <ShieldAlert size={24} className="flex-shrink-0 mt-0.5" />
                                                            <div>
                                                                <p className="font-black text-sm">⚠️ ALERTA DE RECALL — ACCIÓN INMEDIATA REQUERIDA</p>
                                                                <p className="text-xs mt-1 text-red-100">
                                                                    Este lote supera las <strong>{RECALL_UNITS_THRESHOLD} unidades</strong> afectadas ({lot.quantity} uds). Se debe iniciar proceso de recall e informar a los distribuidores que <strong>detengan la venta</strong> de este producto de inmediato.
                                                                </p>
                                                            </div>
                                                        </div>
                                                    )}
                                                    {(lot.severity === 'critical' || lot.severity === 'recall') && producedUnitsTotal > 0 && (
                                                        <div className={`mb-4 rounded-xl p-4 border ${(missingUnitsToReport || 0) > 0
                                                            ? 'bg-orange-100 text-orange-900 border-orange-200'
                                                            : 'bg-emerald-100 text-emerald-900 border-emerald-200'
                                                            }`}>
                                                            <p className="font-black text-sm">Cruce lote/sabor/presentación</p>
                                                            <p className="text-xs mt-1">
                                                                Producidos: <strong>{producedUnitsTotal.toLocaleString('es-CO')}</strong> ·
                                                                Reportados: <strong>{reportedUnitsTotal.toLocaleString('es-CO')}</strong> ·
                                                                Faltan por reportar: <strong>{(missingUnitsToReport || 0).toLocaleString('es-CO')}</strong>
                                                                {coveragePct !== null && <> · Cobertura: <strong>{coveragePct}%</strong></>}
                                                            </p>
                                                            {byPresentationCross.length > 0 && (
                                                                <div className="mt-2 flex flex-wrap gap-1.5">
                                                                    {byPresentationCross.map((entry) => (
                                                                        <span key={entry.size} className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold bg-white/70 border border-current/15">
                                                                            {entry.size}: prod {toUnitsNumber(entry.producedUnits).toLocaleString('es-CO')} · rep {toUnitsNumber(entry.reportedUnits).toLocaleString('es-CO')} · faltan {toUnitsNumber(entry.missingUnits).toLocaleString('es-CO')}
                                                                        </span>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                    {lot.followUp && (
                                                        <div className="mb-4 bg-slate-100 text-slate-800 rounded-xl p-4 border border-slate-200">
                                                            <p className="font-black text-sm">Seguimiento y predicción de reporte</p>
                                                            <p className="text-xs mt-1">
                                                                Estado: <strong>{lot.followUp.statusLabel || 'Sin datos'}</strong> ·
                                                                Probabilidad de seguir reportando: <strong>{lot.followUp.prediction?.continueReportingProbabilityPct ?? '—'}%</strong> ·
                                                                Confianza: <strong>{lot.followUp.prediction?.confidenceScore ?? '—'}%</strong>
                                                            </p>
                                                            <p className="text-xs mt-1">
                                                                Resultado estimado: <strong>{lot.followUp.prediction?.predictedOutcomeLabel || 'Sin proyección'}</strong>
                                                                {lot.followUp.prediction?.expectedAdditionalUnitsToReport !== null && lot.followUp.prediction?.expectedAdditionalUnitsToReport !== undefined && (
                                                                    <> · Unidades adicionales probables: <strong>{toUnitsNumber(lot.followUp.prediction.expectedAdditionalUnitsToReport).toLocaleString('es-CO')}</strong></>
                                                                )}
                                                            </p>
                                                            <p className="text-xs mt-1">
                                                                Defecto dominante: <strong>{lot.followUp.prediction?.defectLabel || lot.defectSummary?.primaryDefectLabel || 'OTRO'}</strong> ·
                                                                Ajuste defecto: <strong>{lot.followUp.prediction?.defectAdjustmentPct ?? 0}%</strong> ·
                                                                Perfil: <strong>{lot.followUp.prediction?.defectRiskBand || 'neutral'}</strong> ·
                                                                Modo: <strong>{lot.followUp.prediction?.defectPolicyMode === 'revision' ? 'Revisión' : 'Grave'}</strong>
                                                                {lot.followUp.prediction?.defectVsGoodPct !== null && lot.followUp.prediction?.defectVsGoodPct !== undefined && (
                                                                    <> · Tasa vs buenos: <strong>{lot.followUp.prediction.defectVsGoodPct}%</strong></>
                                                                )}
                                                            </p>
                                                            <p className="text-xs mt-1">
                                                                Ventana reciente: <strong>{toUnitsNumber(lot.followUp.timeline?.reportsLast14d).toLocaleString('es-CO')}</strong> reportes en 14d ·
                                                                Último reporte: <strong>{lot.followUp.timeline?.daysSinceLastReport ?? '—'} días</strong> ·
                                                                {lot.followUp.timeline?.isNewLot ? ' Lote nuevo' : ' Lote rezagado'}
                                                            </p>
                                                        </div>
                                                    )}

                                                    {/* ── Animated Lot Timeline Gauge ── */}
                                                    {lot.daysToReport !== null && lot.daysToReport !== undefined && (
                                                        <div className="mb-5 bg-white rounded-xl border border-gray-100 p-5 shadow-sm overflow-hidden">
                                                            <div className="flex items-center justify-between mb-3">
                                                                <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                                                                    <Calendar size={13} /> Línea de Tiempo del Lote
                                                                </h4>
                                                                <span className={`px-3 py-1 rounded-full text-sm font-black ${lot.daysToReport <= 15 ? 'bg-red-100 text-red-700' :
                                                                    lot.daysToReport <= 30 ? 'bg-amber-100 text-amber-700' :
                                                                        'bg-emerald-100 text-emerald-700'
                                                                    }`}>
                                                                    {lot.daysToReport} días
                                                                </span>
                                                            </div>

                                                            {/* Animated gauge bar */}
                                                            <div className="relative h-8 bg-gray-100 rounded-full overflow-hidden mb-4">
                                                                <div
                                                                    className={`absolute inset-y-0 left-0 rounded-full transition-all duration-[1500ms] ease-out ${lot.daysToReport <= 15
                                                                        ? 'bg-gradient-to-r from-red-500 via-red-400 to-red-300'
                                                                        : lot.daysToReport <= 30
                                                                            ? 'bg-gradient-to-r from-amber-500 via-amber-400 to-yellow-300'
                                                                            : 'bg-gradient-to-r from-emerald-500 via-green-400 to-lime-300'
                                                                        }`}
                                                                    style={{
                                                                        width: `${Math.min(Math.max((lot.daysToReport / 60) * 100, 8), 100)}%`,
                                                                        animation: 'gaugeExpand 1.2s ease-out forwards'
                                                                    }}
                                                                />
                                                                {/* Pulsing dot at the report point */}
                                                                <div
                                                                    className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-10"
                                                                    style={{ left: `${Math.min(Math.max((lot.daysToReport / 60) * 100, 8), 100)}%` }}
                                                                >
                                                                    <div className={`w-5 h-5 rounded-full border-[3px] border-white shadow-lg ${lot.daysToReport <= 15 ? 'bg-red-600' :
                                                                        lot.daysToReport <= 30 ? 'bg-amber-500' :
                                                                            'bg-emerald-500'
                                                                        }`}>
                                                                        <div className={`w-full h-full rounded-full animate-ping opacity-40 ${lot.daysToReport <= 15 ? 'bg-red-400' :
                                                                            lot.daysToReport <= 30 ? 'bg-amber-400' :
                                                                                'bg-emerald-400'
                                                                            }`} />
                                                                    </div>
                                                                </div>
                                                                {/* Scale markers */}
                                                                {[15, 30, 45].map(mark => (
                                                                    <div key={mark} className="absolute top-0 bottom-0 border-l border-dashed border-gray-300/60" style={{ left: `${(mark / 60) * 100}%` }}>
                                                                        <span className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[9px] text-gray-400 font-mono">{mark}d</span>
                                                                    </div>
                                                                ))}
                                                            </div>

                                                            {/* Info cards row */}
                                                            <div className="grid grid-cols-3 gap-3 mt-6">
                                                                <div className="bg-blue-50 rounded-lg p-3 text-center border border-blue-100">
                                                                    <p className="text-[10px] font-bold text-blue-400 uppercase tracking-wide">Fabricación</p>
                                                                    <p className="text-sm font-black text-blue-800 mt-0.5">
                                                                        {lot.productionDate ? new Date(lot.productionDate).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                                                                    </p>
                                                                </div>
                                                                <div className={`rounded-lg p-3 text-center border ${lot.daysToReport <= 15 ? 'bg-red-50 border-red-100' :
                                                                    lot.daysToReport <= 30 ? 'bg-amber-50 border-amber-100' :
                                                                        'bg-emerald-50 border-emerald-100'
                                                                    }`}>
                                                                    <p className={`text-[10px] font-bold uppercase tracking-wide ${lot.daysToReport <= 15 ? 'text-red-400' :
                                                                        lot.daysToReport <= 30 ? 'text-amber-400' :
                                                                            'text-emerald-400'
                                                                        }`}>Primer Reporte</p>
                                                                    <p className={`text-sm font-black mt-0.5 ${lot.daysToReport <= 15 ? 'text-red-800' :
                                                                        lot.daysToReport <= 30 ? 'text-amber-800' :
                                                                            'text-emerald-800'
                                                                        }`}>
                                                                        {lot.firstReportDate ? new Date(lot.firstReportDate).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                                                                    </p>
                                                                </div>
                                                                <div className="bg-purple-50 rounded-lg p-3 text-center border border-purple-100">
                                                                    <p className="text-[10px] font-bold text-purple-400 uppercase tracking-wide">Producido</p>
                                                                    {lot.producedUnits ? (
                                                                        <div className="mt-1 space-y-0.5">
                                                                            <p className="text-sm font-black text-purple-800">{lot.producedUnits.total.toLocaleString()} uds</p>
                                                                            <div className="flex justify-center gap-2 text-[9px] text-purple-500">
                                                                                {lot.producedUnits['3400g'] > 0 && <span>3400g: {lot.producedUnits['3400g']}</span>}
                                                                                {lot.producedUnits['1150g'] > 0 && <span>1150g: {lot.producedUnits['1150g']}</span>}
                                                                                {lot.producedUnits['350g'] > 0 && <span>350g: {lot.producedUnits['350g']}</span>}
                                                                            </div>
                                                                        </div>
                                                                    ) : (
                                                                        <p className="text-sm font-black text-purple-800 mt-0.5">—</p>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )}
                                                    <p className="text-xs font-bold text-gray-500 uppercase mb-3">Detalle de productos en lote {lot.lot}</p>
                                                    <div className="space-y-4">
                                                        {(lot.items || []).map((item, k) => (
                                                            <div key={k} className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
                                                                <div className="flex items-start justify-between gap-4">
                                                                    <div className="flex-1 min-w-0">
                                                                        <div className="flex items-center gap-2 flex-wrap">
                                                                            <h4 className="font-bold text-gray-900 text-sm">{item.product}</h4>
                                                                            <span className="bg-blue-50 text-blue-700 text-[10px] px-1.5 py-0.5 rounded font-medium">{item.size}</span>
                                                                            {item.type && (
                                                                                <span className="bg-red-50 text-red-700 text-[10px] px-1.5 py-0.5 rounded font-medium">
                                                                                    {TYPE_LABELS[item.type] || item.type}
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                        <div className="flex items-center gap-4 mt-1.5 text-xs text-gray-500">
                                                                            <span className="font-bold text-gray-800">{item.quantity} {item.unit}</span>
                                                                            <span>• {item.distributor}</span>
                                                                            <span>• {item.date ? new Date(item.date).toLocaleDateString() : '-'}</span>
                                                                        </div>
                                                                        {item.description && (
                                                                            <p className="mt-2 text-xs text-gray-500 italic bg-gray-50 rounded-lg px-3 py-2 border-l-2 border-gray-200">
                                                                                "{item.description}"
                                                                            </p>
                                                                        )}
                                                                    </div>
                                                                </div>

                                                                {/* Evidence Images */}
                                                                {item.evidence && item.evidence.length > 0 && (
                                                                    <div className="mt-3 pt-3 border-t border-gray-100">
                                                                        <p className="text-[10px] font-bold text-gray-400 uppercase mb-2 flex items-center gap-1">
                                                                            <ImageIcon size={11} /> Evidencia ({item.evidence.length})
                                                                        </p>
                                                                        <div className="flex gap-2 overflow-x-auto pb-1">
                                                                            {item.evidence.filter(e => e.type === 'IMAGE').map((ev, j) => (
                                                                                <div
                                                                                    key={j}
                                                                                    onClick={(e) => { e.stopPropagation(); setSelectedImage(ev); }}
                                                                                    className="w-20 h-20 rounded-lg bg-gray-200 flex-shrink-0 cursor-pointer overflow-hidden border-2 border-gray-200 hover:border-blue-400 group relative transition-all"
                                                                                >
                                                                                    <img
                                                                                        src={`${API_URL}${ev.url}`}
                                                                                        alt="Evidencia"
                                                                                        className="w-full h-full object-cover"
                                                                                        loading="lazy"
                                                                                    />
                                                                                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all flex items-center justify-center">
                                                                                        <Eye size={16} className="text-white opacity-0 group-hover:opacity-100 drop-shadow-lg" />
                                                                                    </div>
                                                                                </div>
                                                                            ))}
                                                                            {item.evidence.filter(e => e.type === 'VIDEO').map((ev, j) => (
                                                                                <a key={`v${j}`} href={`${API_URL}${ev.url}`} target="_blank" rel="noopener noreferrer"
                                                                                    className="w-20 h-20 rounded-lg bg-gray-800 flex-shrink-0 flex items-center justify-center text-white text-xs font-bold border-2 border-gray-300 hover:border-blue-400 transition-all"
                                                                                    onClick={e => e.stopPropagation()}>
                                                                                    🎥 Video
                                                                                </a>
                                                                            ))}
                                                                        </div>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            );
                            }) : (
                                <tr>
                                    <td colSpan="11" className="px-5 py-8 text-center text-gray-400">
                                        {lotSearch ? 'Sin resultados para la búsqueda' : 'No hay datos de lotes'}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </ChartCard>

            <div className="flex justify-end">
                <button
                    onClick={() => navigate('/pqr/advanced-validation')}
                    className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-slate-900 hover:bg-black text-white font-bold text-sm shadow-md transition-colors"
                >
                    Validación Avanzada
                </button>
            </div>

            {/* Image Lightbox */}
            {selectedImage && (
                <div className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center p-4 backdrop-blur-sm" onClick={() => setSelectedImage(null)}>
                    <button onClick={() => setSelectedImage(null)}
                        className="absolute top-4 right-4 text-white/70 hover:text-white bg-white/10 hover:bg-white/20 rounded-full p-2 transition-colors z-10">
                        <X size={28} />
                    </button>
                    <img
                        src={`${API_URL}${selectedImage.url}`}
                        alt="Evidencia PQR"
                        className="max-h-[85vh] max-w-[90vw] object-contain rounded-lg shadow-2xl"
                        onClick={e => e.stopPropagation()}
                    />
                </div>
            )}
        </div>
    );
};



export default PQRDashboard;
