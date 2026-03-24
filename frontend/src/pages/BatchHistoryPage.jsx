import React, { useState, useEffect, useCallback } from 'react';
import { Search, ChevronLeft, ChevronRight, Filter, X, Clock, User, Package, FlaskConical, AlertTriangle, CheckCircle2, Circle, ArrowLeft, Layers, BarChart2, Calendar, Printer } from 'lucide-react';

const API = (import.meta.env.VITE_API_URL || '').replace(/\/api\/?$/, '').replace(/\/$/, '') + '/api';

/* ════════════════════════════════════════════════════════════════════════════
   Helper functions
   ════════════════════════════════════════════════════════════════════════════ */
const fmt = (v, dec = 0) =>
    v != null ? Number(v).toLocaleString('es-CO', { maximumFractionDigits: dec }) : '—';

const fmtDate = (d) => {
    if (!d) return '—';
    const dt = new Date(d);
    return dt.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
};
const fmtTime = (d) => {
    if (!d) return '';
    return new Date(d).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
};
const fmtDateTime = (d) => d ? `${fmtDate(d)} ${fmtTime(d)}` : '—';

const fmtDuration = (mins) => {
    if (!mins && mins !== 0) return '—';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

const statusColors = {
    PENDING: 'bg-slate-100 text-slate-600',
    STAGE_1_BASE: 'bg-amber-100 text-amber-700',
    STAGE_2_COMPUESTO: 'bg-blue-100 text-blue-700',
    STAGE_3_ESFERAS: 'bg-purple-100 text-purple-700',
    STAGE_4_ENSAMBLE: 'bg-cyan-100 text-cyan-700',
    EXECUTING: 'bg-blue-100 text-blue-700',
    COMPLETED: 'bg-emerald-100 text-emerald-700',
    FAILED: 'bg-red-100 text-red-700'
};

const noteStatusIcon = (status) => {
    if (status === 'COMPLETED') return <CheckCircle2 size={18} className="text-emerald-500" />;
    if (status === 'EXECUTING') return <Clock size={18} className="text-blue-500 animate-pulse" />;
    return <Circle size={18} className="text-slate-300" />;
};

/* ════════════════════════════════════════════════════════════════════════════
   Main Component
   ════════════════════════════════════════════════════════════════════════════ */
const BatchHistoryPage = () => {
    const [batches, setBatches] = useState([]);
    const [pagination, setPagination] = useState({ page: 1, total: 0, totalPages: 0, limit: 20 });
    const [loading, setLoading] = useState(false);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [showFilters, setShowFilters] = useState(false);

    // Detail view
    const [selectedBatch, setSelectedBatch] = useState(null);
    const [detail, setDetail] = useState(null);
    const [detailLoading, setDetailLoading] = useState(false);

    // ── Fetch list ──
    const fetchBatches = useCallback(async (page = 1) => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ page, limit: 20 });
            if (search) params.set('search', search);
            if (statusFilter) params.set('status', statusFilter);
            if (dateFrom) params.set('dateFrom', dateFrom);
            if (dateTo) params.set('dateTo', dateTo);
            const res = await fetch(`${API}/batch-history?${params}`);
            const json = await res.json();
            setBatches(json.data || []);
            setPagination(json.pagination || { page: 1, total: 0, totalPages: 0, limit: 20 });
        } catch (err) {
            console.error('Error fetching batch history:', err);
        } finally {
            setLoading(false);
        }
    }, [search, statusFilter, dateFrom, dateTo]);

    useEffect(() => { fetchBatches(1); }, [fetchBatches]);

    // ── Fetch detail ──
    const openDetail = async (batchId) => {
        setSelectedBatch(batchId);
        setDetailLoading(true);
        try {
            const res = await fetch(`${API}/batch-history/${batchId}`);
            const json = await res.json();
            setDetail(json);
        } catch (err) {
            console.error('Error fetching batch detail:', err);
        } finally {
            setDetailLoading(false);
        }
    };

    // ── Print Audit Sheet ──
    const handlePrintAudit = () => {
        if (!detail) return;
        const d = detail;
        const now = new Date().toLocaleString('es-CO', { dateStyle: 'long', timeStyle: 'short' });

        const stagesHtml = (d.timeline || []).map((s, idx) => {
            const ingredientsRows = (s.ingredients || []).map(ing => `
                <tr>
                    <td style="padding:4px 8px;border:1px solid #d1d5db;font-size:11px">${ing.name}</td>
                    <td style="padding:4px 8px;border:1px solid #d1d5db;font-size:11px;text-align:right">${fmt(ing.plannedQuantity)} ${ing.unit}</td>
                    <td style="padding:4px 8px;border:1px solid #d1d5db;font-size:11px;text-align:right;font-weight:bold">${ing.actualQuantity ? `${fmt(ing.actualQuantity)} ${ing.unit}` : '—'}</td>
                    <td style="padding:4px 8px;border:1px solid #d1d5db;font-size:11px">${ing.lotNumber || '—'}</td>
                    <td style="padding:4px 8px;border:1px solid #d1d5db;font-size:11px;text-align:center">${
                        ing.actualQuantity && ing.plannedQuantity
                            ? `${(((ing.actualQuantity - ing.plannedQuantity) / ing.plannedQuantity) * 100).toFixed(1)}%`
                            : '—'
                    }</td>
                </tr>
            `).join('');

            const lotsRows = (s.lotConsumptions || []).map(lc => `
                <tr>
                    <td style="padding:4px 8px;border:1px solid #d1d5db;font-size:11px">${lc.product}</td>
                    <td style="padding:4px 8px;border:1px solid #d1d5db;font-size:11px">${lc.lotNumber}</td>
                    <td style="padding:4px 8px;border:1px solid #d1d5db;font-size:11px;text-align:right;font-weight:bold">${fmt(lc.quantityUsed)} g</td>
                    <td style="padding:4px 8px;border:1px solid #d1d5db;font-size:11px">${lc.expiresAt ? fmtDate(lc.expiresAt) : '—'}</td>
                </tr>
            `).join('');

            const pvRows = (s.processVariables || []).map(pv => `
                <span style="display:inline-block;background:#eef2ff;border:1px solid #c7d2fe;border-radius:6px;padding:2px 8px;margin:2px;font-size:10px;font-weight:bold;color:#4338ca">${pv.name}: ${pv.value} ${pv.unit || ''}</span>
            `).join('');

            const qcRows = (s.qualityChecks || []).map(qc => `
                <tr>
                    <td style="padding:4px 8px;border:1px solid #d1d5db;font-size:11px">${qc.parameterName}</td>
                    <td style="padding:4px 8px;border:1px solid #d1d5db;font-size:11px;text-align:center;font-weight:bold">${qc.value} ${qc.unit || ''}</td>
                    <td style="padding:4px 8px;border:1px solid #d1d5db;font-size:11px;text-align:center">${qc.passed ? '✅ PASA' : '❌ NO PASA'}</td>
                </tr>
            `).join('');

            // Empaque / Conteo data
            let empaqueHtml = '';
            if (s.processType === 'EMPAQUE' && s.processParameters?.empaque) {
                const emp = s.processParameters.empaque;
                empaqueHtml = `
                    <div style="margin-top:6px;display:flex;gap:12px">
                        <div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;padding:6px 12px;text-align:center;flex:1">
                            <div style="font-size:10px;color:#6b7280">Conteo</div><div style="font-size:16px;font-weight:900;color:#059669">${fmt(emp.conteo_qty)}</div>
                        </div>
                        <div style="background:#fff1f2;border:1px solid #fecdd3;border-radius:8px;padding:6px 12px;text-align:center;flex:1">
                            <div style="font-size:10px;color:#6b7280">Defectuosos</div><div style="font-size:16px;font-weight:900;color:#e11d48">${fmt(emp.defective)}</div>
                        </div>
                        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:6px 12px;text-align:center;flex:1">
                            <div style="font-size:10px;color:#6b7280">Aprobados</div><div style="font-size:16px;font-weight:900;color:#2563eb">${fmt(emp.approved)}</div>
                        </div>
                    </div>
                `;
            }
            if (s.processType === 'CONTEO' && s.processParameters?.conteo) {
                const rows = Object.entries(s.processParameters.conteo).map(([name, data]) => `
                    <tr>
                        <td style="padding:4px 8px;border:1px solid #d1d5db;font-size:11px">${name}</td>
                        <td style="padding:4px 8px;border:1px solid #d1d5db;font-size:11px;text-align:right">${fmt(data.planned)}</td>
                        <td style="padding:4px 8px;border:1px solid #d1d5db;font-size:11px;text-align:right;font-weight:bold">${fmt(data.actual)}</td>
                    </tr>
                `).join('');
                empaqueHtml = `
                    <div style="margin-top:6px">
                        <div style="font-size:10px;font-weight:bold;color:#6b7280;text-transform:uppercase;margin-bottom:4px">Conteo por Referencia</div>
                        <table style="width:100%;border-collapse:collapse">
                            <thead><tr style="background:#ecfeff">
                                <th style="padding:4px 8px;border:1px solid #d1d5db;font-size:10px;text-align:left">Producto</th>
                                <th style="padding:4px 8px;border:1px solid #d1d5db;font-size:10px;text-align:right">Plan</th>
                                <th style="padding:4px 8px;border:1px solid #d1d5db;font-size:10px;text-align:right">Real</th>
                            </tr></thead><tbody>${rows}</tbody>
                        </table>
                    </div>
                `;
            }

            return `
                <div style="border:1px solid #e5e7eb;border-radius:8px;margin-bottom:12px;overflow:hidden;page-break-inside:avoid">
                    <div style="background:#f8fafc;padding:8px 12px;border-bottom:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center">
                        <div>
                            <span style="font-size:11px;font-weight:900;color:#94a3b8;margin-right:8px">${s.stageOrder}.</span>
                            <span style="font-size:13px;font-weight:800;color:#1e293b">${s.stageName}</span>
                            <span style="font-size:11px;color:#64748b;margin-left:8px">${s.processTypeName || ''}</span>
                        </div>
                        <div style="display:flex;gap:12px;font-size:10px;color:#64748b">
                            ${s.operator ? `<span>👤 ${s.operator}</span>` : ''}
                            ${s.durationMinutes != null ? `<span>⏱ ${fmtDuration(s.durationMinutes)}</span>` : ''}
                            <span style="font-size:10px;font-weight:bold;padding:2px 8px;border-radius:10px;${s.status === 'COMPLETED' ? 'background:#dcfce7;color:#16a34a' : s.status === 'EXECUTING' ? 'background:#dbeafe;color:#2563eb' : 'background:#f1f5f9;color:#64748b'}">${s.status}</span>
                        </div>
                    </div>
                    <div style="padding:10px 12px">
                        <div style="display:flex;gap:16px;font-size:10px;color:#64748b;margin-bottom:8px">
                            ${s.startedAt ? `<span>📍 Inicio: <strong>${fmtDateTime(s.startedAt)}</strong></span>` : ''}
                            ${s.completedAt ? `<span>🏁 Fin: <strong>${fmtDateTime(s.completedAt)}</strong></span>` : ''}
                            ${s.targetQuantity > 0 ? `<span>🎯 Meta: <strong>${fmt(s.targetQuantity)}</strong></span>` : ''}
                            ${s.actualQuantity > 0 ? `<span>✅ Real: <strong>${fmt(s.actualQuantity)}</strong></span>` : ''}
                        </div>
                        ${ingredientsRows ? `
                            <div style="font-size:10px;font-weight:bold;color:#6b7280;text-transform:uppercase;margin-bottom:4px">Ingredientes</div>
                            <table style="width:100%;border-collapse:collapse;margin-bottom:8px">
                                <thead><tr style="background:#f5f3ff">
                                    <th style="padding:4px 8px;border:1px solid #d1d5db;font-size:10px;text-align:left">Material</th>
                                    <th style="padding:4px 8px;border:1px solid #d1d5db;font-size:10px;text-align:right">Planificado</th>
                                    <th style="padding:4px 8px;border:1px solid #d1d5db;font-size:10px;text-align:right">Real</th>
                                    <th style="padding:4px 8px;border:1px solid #d1d5db;font-size:10px;text-align:left">Lote</th>
                                    <th style="padding:4px 8px;border:1px solid #d1d5db;font-size:10px;text-align:center">Desv.</th>
                                </tr></thead><tbody>${ingredientsRows}</tbody>
                            </table>
                        ` : ''}
                        ${lotsRows ? `
                            <div style="font-size:10px;font-weight:bold;color:#6b7280;text-transform:uppercase;margin-bottom:4px">Consumo de Lotes</div>
                            <table style="width:100%;border-collapse:collapse;margin-bottom:8px">
                                <thead><tr style="background:#fffbeb">
                                    <th style="padding:4px 8px;border:1px solid #d1d5db;font-size:10px;text-align:left">Producto</th>
                                    <th style="padding:4px 8px;border:1px solid #d1d5db;font-size:10px;text-align:left">Lote</th>
                                    <th style="padding:4px 8px;border:1px solid #d1d5db;font-size:10px;text-align:right">Consumido</th>
                                    <th style="padding:4px 8px;border:1px solid #d1d5db;font-size:10px;text-align:left">Vence</th>
                                </tr></thead><tbody>${lotsRows}</tbody>
                            </table>
                        ` : ''}
                        ${pvRows ? `<div style="font-size:10px;font-weight:bold;color:#6b7280;text-transform:uppercase;margin-bottom:4px">Variables de Proceso</div><div style="margin-bottom:8px">${pvRows}</div>` : ''}
                        ${qcRows ? `
                            <div style="font-size:10px;font-weight:bold;color:#6b7280;text-transform:uppercase;margin-bottom:4px">Control de Calidad</div>
                            <table style="width:100%;border-collapse:collapse;margin-bottom:8px">
                                <thead><tr style="background:#f0fdf4">
                                    <th style="padding:4px 8px;border:1px solid #d1d5db;font-size:10px;text-align:left">Parámetro</th>
                                    <th style="padding:4px 8px;border:1px solid #d1d5db;font-size:10px;text-align:center">Valor</th>
                                    <th style="padding:4px 8px;border:1px solid #d1d5db;font-size:10px;text-align:center">Resultado</th>
                                </tr></thead><tbody>${qcRows}</tbody>
                            </table>
                        ` : ''}
                        ${empaqueHtml}
                        ${s.observations ? `<div style="font-size:11px;color:#475569;background:#f8fafc;padding:6px 10px;border-radius:6px;border:1px solid #e2e8f0;margin-top:6px">💬 ${s.observations}</div>` : ''}
                    </div>
                </div>
            `;
        }).join('');

        // Output targets
        const outputTargetsHtml = (d.outputTargets || []).map(t => `
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:8px 12px;flex:1">
                <div style="font-weight:bold;font-size:12px;color:#334155">${t.product}</div>
                <div style="font-size:11px;color:#64748b">${t.plannedUnits > 0 ? `${fmt(t.plannedUnits)} uds` : ''}${t.plannedWeightKg > 0 ? ` · ${fmt(t.plannedWeightKg, 1)} kg` : ''}</div>
            </div>
        `).join('');

        // Production lots
        const prodLotsHtml = (d.productionLots || []).map(lot => `
            <tr>
                <td style="padding:4px 8px;border:1px solid #d1d5db;font-size:11px">${lot.product}</td>
                <td style="padding:4px 8px;border:1px solid #d1d5db;font-size:11px;font-family:monospace;font-weight:bold">${lot.lotNumber}</td>
                <td style="padding:4px 8px;border:1px solid #d1d5db;font-size:11px;text-align:right;font-weight:bold;color:#059669">${fmt(lot.initialQuantity)} g</td>
                <td style="padding:4px 8px;border:1px solid #d1d5db;font-size:11px">${lot.expiresAt ? fmtDate(lot.expiresAt) : '—'}</td>
            </tr>
        `).join('');

        const printWindow = window.open('', '_blank');
        printWindow.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Auditoría Lote ${d.batchNumber}</title>
                <style>
                    @page { size: A4; margin: 12mm 15mm; }
                    * { margin: 0; padding: 0; box-sizing: border-box; }
                    body { font-family: -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; color: #1e293b; font-size: 12px; line-height: 1.4; }
                    @media print {
                        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                    }
                </style>
            </head>
            <body>
                <!-- Header -->
                <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #6366f1;padding-bottom:12px;margin-bottom:16px">
                    <div>
                        <div style="font-size:22px;font-weight:900;color:#6366f1;letter-spacing:-0.5px">LIQUIPOPS</div>
                        <div style="font-size:10px;color:#94a3b8;margin-top:2px">Sistema de Gestión de Producción</div>
                    </div>
                    <div style="text-align:right">
                        <div style="font-size:16px;font-weight:900;color:#1e293b">HOJA DE AUDITORÍA DE LOTE</div>
                        <div style="font-size:10px;color:#94a3b8">Impreso: ${now}</div>
                    </div>
                </div>

                <!-- Batch Summary -->
                <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 16px;margin-bottom:16px">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                        <div style="font-size:18px;font-weight:900;color:#1e293b">${d.batchNumber}</div>
                        <span style="font-size:11px;font-weight:bold;padding:4px 12px;border-radius:12px;${d.status === 'COMPLETED' ? 'background:#dcfce7;color:#16a34a' : 'background:#fef3c7;color:#d97706'}">${d.status}</span>
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:12px;font-size:11px">
                        <div><span style="color:#64748b">Producto:</span><br/><strong>${d.product || '—'}</strong></div>
                        <div><span style="color:#64748b">Sabor:</span><br/><strong>${d.flavor || '—'}</strong></div>
                        <div><span style="color:#64748b">Plantilla:</span><br/><strong>${d.template || '—'}</strong></div>
                        <div><span style="color:#64748b">Duración:</span><br/><strong>${fmtDuration(d.durationMinutes)}</strong></div>
                        <div><span style="color:#64748b">Creado:</span><br/><strong>${fmtDateTime(d.createdAt)}</strong></div>
                        <div><span style="color:#64748b">Inicio:</span><br/><strong>${fmtDateTime(d.startedAt)}</strong></div>
                        <div><span style="color:#64748b">Fin:</span><br/><strong>${fmtDateTime(d.completedAt)}</strong></div>
                        <div><span style="color:#64748b">Etapas:</span><br/><strong>${d.kpis?.stagesCompleted ?? 0}/${d.kpis?.stagesTotal ?? 0}</strong></div>
                    </div>
                </div>

                <!-- KPIs -->
                <div style="display:flex;gap:8px;margin-bottom:16px">
                    <div style="flex:1;text-align:center;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:8px">
                        <div style="font-size:9px;font-weight:bold;color:#3b82f6;text-transform:uppercase">Producido</div>
                        <div style="font-size:18px;font-weight:900;color:#1e40af">${fmt(d.actualOutput || d.expectedOutput)} g</div>
                    </div>
                    <div style="flex:1;text-align:center;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;padding:8px">
                        <div style="font-size:9px;font-weight:bold;color:#10b981;text-transform:uppercase">Uds Conteo</div>
                        <div style="font-size:18px;font-weight:900;color:#047857">${fmt(d.kpis?.unitsActual)}</div>
                    </div>
                    <div style="flex:1;text-align:center;background:#fff1f2;border:1px solid #fecdd3;border-radius:8px;padding:8px">
                        <div style="font-size:9px;font-weight:bold;color:#f43f5e;text-transform:uppercase">Defectuosas</div>
                        <div style="font-size:18px;font-weight:900;color:#be123c">${fmt(d.kpis?.unitsDefective)}</div>
                    </div>
                    <div style="flex:1;text-align:center;background:${(d.kpis?.effectiveness ?? 0) >= 95 ? '#ecfdf5' : (d.kpis?.effectiveness ?? 0) >= 80 ? '#fffbeb' : '#fff1f2'};border:1px solid ${(d.kpis?.effectiveness ?? 0) >= 95 ? '#a7f3d0' : (d.kpis?.effectiveness ?? 0) >= 80 ? '#fde68a' : '#fecdd3'};border-radius:8px;padding:8px">
                        <div style="font-size:9px;font-weight:bold;color:#6b7280;text-transform:uppercase">Efectividad</div>
                        <div style="font-size:18px;font-weight:900;color:${(d.kpis?.effectiveness ?? 0) >= 95 ? '#047857' : (d.kpis?.effectiveness ?? 0) >= 80 ? '#d97706' : '#be123c'}">${d.kpis?.effectiveness != null ? `${d.kpis.effectiveness}%` : '—'}</div>
                    </div>
                </div>

                ${outputTargetsHtml ? `
                    <div style="margin-bottom:16px">
                        <div style="font-size:11px;font-weight:bold;color:#64748b;text-transform:uppercase;margin-bottom:6px">Productos de Salida</div>
                        <div style="display:flex;gap:8px">${outputTargetsHtml}</div>
                    </div>
                ` : ''}

                <!-- Timeline -->
                <div style="margin-bottom:16px">
                    <div style="font-size:13px;font-weight:800;color:#334155;margin-bottom:10px;border-bottom:2px solid #e2e8f0;padding-bottom:6px">📋 DETALLE POR ETAPA</div>
                    ${stagesHtml}
                </div>

                ${prodLotsHtml ? `
                    <div style="margin-bottom:20px;page-break-inside:avoid">
                        <div style="font-size:11px;font-weight:bold;color:#64748b;text-transform:uppercase;margin-bottom:6px">Lotes Producidos</div>
                        <table style="width:100%;border-collapse:collapse">
                            <thead><tr style="background:#ecfdf5">
                                <th style="padding:4px 8px;border:1px solid #d1d5db;font-size:10px;text-align:left">Producto</th>
                                <th style="padding:4px 8px;border:1px solid #d1d5db;font-size:10px;text-align:left">Lote</th>
                                <th style="padding:4px 8px;border:1px solid #d1d5db;font-size:10px;text-align:right">Cantidad</th>
                                <th style="padding:4px 8px;border:1px solid #d1d5db;font-size:10px;text-align:left">Vence</th>
                            </tr></thead><tbody>${prodLotsHtml}</tbody>
                        </table>
                    </div>
                ` : ''}

                <!-- Signatures -->
                <div style="display:flex;gap:40px;margin-top:32px;page-break-inside:avoid">
                    <div style="flex:1;text-align:center">
                        <div style="border-top:2px solid #1e293b;padding-top:8px;margin-top:48px">
                            <div style="font-size:11px;font-weight:bold;color:#1e293b">Jefe de Producción</div>
                            <div style="font-size:10px;color:#94a3b8">Firma / Fecha</div>
                        </div>
                    </div>
                    <div style="flex:1;text-align:center">
                        <div style="border-top:2px solid #1e293b;padding-top:8px;margin-top:48px">
                            <div style="font-size:11px;font-weight:bold;color:#1e293b">Control de Calidad</div>
                            <div style="font-size:10px;color:#94a3b8">Firma / Fecha</div>
                        </div>
                    </div>
                    <div style="flex:1;text-align:center">
                        <div style="border-top:2px solid #1e293b;padding-top:8px;margin-top:48px">
                            <div style="font-size:11px;font-weight:bold;color:#1e293b">Director de Planta</div>
                            <div style="font-size:10px;color:#94a3b8">Firma / Fecha</div>
                        </div>
                    </div>
                </div>

                <div style="text-align:center;margin-top:20px;font-size:9px;color:#94a3b8">Documento generado automáticamente por GestionPBI — LIQUIPOPS S.A.S · ${now}</div>
            </body>
            </html>
        `);
        printWindow.document.close();
        setTimeout(() => { printWindow.print(); }, 400);
    };

    // ── DETAIL VIEW ──
    if (selectedBatch) {
        return (
            <div className="min-h-screen bg-slate-50 pb-20">
                {/* Header */}
                <div className="bg-white border-b border-slate-200 sticky top-0 z-10">
                    <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-4">
                        <button onClick={() => { setSelectedBatch(null); setDetail(null); }}
                            className="flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-800 transition-colors">
                            <ArrowLeft size={18} /> Volver
                        </button>
                        {detail && (
                            <button onClick={handlePrintAudit}
                                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold bg-indigo-600 text-white hover:bg-indigo-700 active:scale-95 transition-all shadow-md">
                                <Printer size={16} /> Imprimir Auditoría
                            </button>
                        )}
                        {detail && (
                            <div className="flex-1 flex items-center justify-between">
                                <div>
                                    <h1 className="text-lg font-black text-slate-800">{detail.batchNumber}</h1>
                                    <span className="text-sm text-slate-400">{detail.flavor} · {detail.product}</span>
                                </div>
                                <span className={`text-xs font-bold px-3 py-1.5 rounded-full ${statusColors[detail.status] || statusColors.PENDING}`}>
                                    {detail.status}
                                </span>
                            </div>
                        )}
                    </div>
                </div>

                {detailLoading ? (
                    <div className="flex justify-center items-center py-32">
                        <div className="animate-spin rounded-full h-10 w-10 border-4 border-blue-500 border-t-transparent"></div>
                    </div>
                ) : detail ? (
                    <div className="max-w-7xl mx-auto px-4 pt-6 space-y-6">
                        {/* KPI cards */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                            <KpiCard label="Duración" value={fmtDuration(detail.durationMinutes)} icon={<Clock size={16} />} color="blue" />
                            <KpiCard label="Etapas" value={`${detail.kpis?.stagesCompleted ?? 0}/${detail.kpis?.stagesTotal ?? 0}`} icon={<Layers size={16} />} color="indigo" />
                            <KpiCard label="Producido" value={`${fmt(detail.actualOutput || detail.expectedOutput)} g`} icon={<Package size={16} />} color="emerald" />
                            <KpiCard label="Uds Conteo" value={fmt(detail.kpis?.unitsActual)} icon={<BarChart2 size={16} />} color="cyan" />
                            <KpiCard label="Defectuosas" value={fmt(detail.kpis?.unitsDefective)} icon={<AlertTriangle size={16} />} color="rose" />
                            <KpiCard label="Efectividad" value={detail.kpis?.effectiveness != null ? `${detail.kpis.effectiveness}%` : '—'} icon={<CheckCircle2 size={16} />}
                                color={detail.kpis?.effectiveness >= 95 ? 'emerald' : detail.kpis?.effectiveness >= 80 ? 'amber' : 'rose'} />
                        </div>

                        {/* Dates row */}
                        <div className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-wrap gap-6">
                            <InfoItem label="Creado" value={fmtDateTime(detail.createdAt)} />
                            <InfoItem label="Inicio Producción" value={fmtDateTime(detail.startedAt)} />
                            <InfoItem label="Fin Producción" value={fmtDateTime(detail.completedAt)} />
                            <InfoItem label="Sabor" value={detail.flavor || '—'} />
                            <InfoItem label="Plantilla" value={detail.template || '—'} />
                        </div>

                        {/* Output targets */}
                        {detail.outputTargets?.length > 0 && (
                            <div className="bg-white rounded-2xl border border-slate-200 p-4">
                                <h3 className="text-xs font-bold text-slate-400 uppercase mb-3">Productos de Salida</h3>
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                    {detail.outputTargets.map((t, i) => (
                                        <div key={i} className="bg-slate-50 rounded-xl p-3 border border-slate-100">
                                            <div className="font-bold text-sm text-slate-700">{t.product}</div>
                                            <div className="text-xs text-slate-400 mt-1">
                                                {t.plannedUnits > 0 ? `${fmt(t.plannedUnits)} uds` : ''}
                                                {t.plannedWeightKg > 0 ? ` · ${fmt(t.plannedWeightKg, 1)} kg` : ''}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* ── TIMELINE ── */}
                        <div>
                            <h2 className="text-sm font-bold text-slate-400 uppercase mb-4 flex items-center gap-2">
                                <Clock size={16} /> Timeline del Proceso
                            </h2>
                            <div className="relative pl-8 space-y-4">
                                {/* Vertical line */}
                                <div className="absolute left-[15px] top-2 bottom-2 w-0.5 bg-gradient-to-b from-blue-300 via-emerald-300 to-slate-200" />

                                {detail.timeline?.map((stage, idx) => (
                                    <TimelineCard key={stage.id} stage={stage} index={idx} />
                                ))}
                            </div>
                        </div>

                        {/* Production lots */}
                        {detail.productionLots?.length > 0 && (
                            <div className="bg-white rounded-2xl border border-slate-200 p-4">
                                <h3 className="text-xs font-bold text-slate-400 uppercase mb-3">Lotes Producidos</h3>
                                <div className="space-y-2">
                                    {detail.productionLots.map((lot, i) => (
                                        <div key={i} className="flex justify-between items-center bg-emerald-50 rounded-xl p-3 border border-emerald-100">
                                            <div>
                                                <div className="font-bold text-sm text-slate-700">{lot.product}</div>
                                                <div className="text-xs text-slate-400 font-mono">{lot.lotNumber}</div>
                                            </div>
                                            <div className="text-right">
                                                <div className="font-bold text-sm text-emerald-600">{fmt(lot.initialQuantity)} g</div>
                                                <div className="text-xs text-slate-400">
                                                    {lot.expiresAt ? `Vence: ${fmtDate(lot.expiresAt)}` : ''}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                ) : null}
            </div>
        );
    }

    // ── LIST VIEW ──
    return (
        <div className="min-h-screen bg-slate-50">
            {/* Header */}
            <div className="bg-white border-b border-slate-200 sticky top-0 z-10">
                <div className="max-w-7xl mx-auto px-4 py-4">
                    <div className="flex items-center justify-between mb-3">
                        <div>
                            <h1 className="text-xl font-black text-slate-800">Historial de Batches</h1>
                            <p className="text-sm text-slate-400">Auditoría de producción · {fmt(pagination.total)} registros</p>
                        </div>
                        <button onClick={() => setShowFilters(!showFilters)}
                            className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium border transition-colors ${showFilters ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                            <Filter size={16} /> Filtros
                        </button>
                    </div>

                    {/* Search bar */}
                    <div className="relative">
                        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            type="text"
                            placeholder="Buscar por lote o sabor..."
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400"
                        />
                        {search && (
                            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                                <X size={16} />
                            </button>
                        )}
                    </div>

                    {/* Filters row */}
                    {showFilters && (
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3 animate-in slide-in-from-top-2 duration-200">
                            <div>
                                <label className="text-xs font-bold text-slate-400 uppercase mb-1 block">Estado</label>
                                <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
                                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                                    <option value="">Todos</option>
                                    <option value="PENDING">Pendiente</option>
                                    <option value="STAGE_1_BASE">Etapa 1 — Base</option>
                                    <option value="STAGE_2_COMPUESTO">Etapa 2 — Compuesto</option>
                                    <option value="STAGE_3_ESFERAS">Etapa 3 — Esferas</option>
                                    <option value="STAGE_4_ENSAMBLE">Etapa 4 — Ensamble</option>
                                    <option value="COMPLETED">Completado</option>
                                </select>
                            </div>
                            <div>
                                <label className="text-xs font-bold text-slate-400 uppercase mb-1 block">Desde</label>
                                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                            </div>
                            <div>
                                <label className="text-xs font-bold text-slate-400 uppercase mb-1 block">Hasta</label>
                                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Table */}
            <div className="max-w-7xl mx-auto px-4 pt-4 pb-20">
                {loading ? (
                    <div className="flex justify-center py-20">
                        <div className="animate-spin rounded-full h-10 w-10 border-4 border-blue-500 border-t-transparent"></div>
                    </div>
                ) : batches.length === 0 ? (
                    <div className="text-center py-20 text-slate-400">
                        <Package size={48} className="mx-auto mb-3 opacity-30" />
                        <p className="font-bold">No se encontraron batches</p>
                        <p className="text-sm">Ajusta los filtros o busca por otro término</p>
                    </div>
                ) : (
                    <>
                        {/* Desktop table */}
                        <div className="hidden lg:block bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="bg-slate-50 text-xs font-bold text-slate-400 uppercase">
                                        <th className="text-left px-4 py-3">Lote</th>
                                        <th className="text-left px-4 py-3">Sabor</th>
                                        <th className="text-center px-4 py-3">Estado</th>
                                        <th className="text-center px-4 py-3">Inicio</th>
                                        <th className="text-center px-4 py-3">Duración</th>
                                        <th className="text-right px-4 py-3">Producido</th>
                                        <th className="text-center px-4 py-3">Uds</th>
                                        <th className="text-center px-4 py-3">Defect.</th>
                                        <th className="text-center px-4 py-3">Efect.</th>
                                        <th className="text-center px-4 py-3">Etapas</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {batches.map(b => (
                                        <tr key={b.id} onClick={() => openDetail(b.id)}
                                            className="hover:bg-blue-50/50 cursor-pointer transition-colors">
                                            <td className="px-4 py-3 font-bold text-blue-600 whitespace-nowrap">{b.batchNumber}</td>
                                            <td className="px-4 py-3 text-slate-700">{b.flavor || '—'}</td>
                                            <td className="px-4 py-3 text-center">
                                                <span className={`text-xs font-bold px-2.5 py-1 rounded-full whitespace-nowrap ${statusColors[b.status] || statusColors.PENDING}`}>
                                                    {b.status?.replace(/_/g, ' ')}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-center text-slate-500 whitespace-nowrap">{fmtDate(b.startedAt)}</td>
                                            <td className="px-4 py-3 text-center text-slate-500">{fmtDuration(b.durationMinutes)}</td>
                                            <td className="px-4 py-3 text-right font-bold text-slate-700">{fmt(b.actualOutput || b.expectedOutput)} g</td>
                                            <td className="px-4 py-3 text-center text-slate-600">{b.unitsActual || '—'}</td>
                                            <td className="px-4 py-3 text-center">
                                                {b.unitsDefective > 0
                                                    ? <span className="text-rose-600 font-bold">{b.unitsDefective}</span>
                                                    : <span className="text-slate-300">0</span>}
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                {b.effectiveness != null
                                                    ? <span className={`font-bold ${b.effectiveness >= 95 ? 'text-emerald-600' : b.effectiveness >= 80 ? 'text-amber-600' : 'text-rose-600'}`}>
                                                        {b.effectiveness}%
                                                    </span>
                                                    : <span className="text-slate-300">—</span>}
                                            </td>
                                            <td className="px-4 py-3 text-center text-slate-500">{b.stagesCompleted}/{b.stagesTotal}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* Mobile cards */}
                        <div className="lg:hidden space-y-3">
                            {batches.map(b => (
                                <div key={b.id} onClick={() => openDetail(b.id)}
                                    className="bg-white rounded-2xl border border-slate-200 p-4 active:bg-blue-50 transition-colors cursor-pointer shadow-sm">
                                    <div className="flex justify-between items-start mb-2">
                                        <div>
                                            <div className="font-black text-blue-600">{b.batchNumber}</div>
                                            <div className="text-xs text-slate-400">{b.flavor}</div>
                                        </div>
                                        <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${statusColors[b.status] || statusColors.PENDING}`}>
                                            {b.status?.replace(/_/g, ' ')}
                                        </span>
                                    </div>
                                    <div className="grid grid-cols-3 gap-2 text-center mt-3">
                                        <div className="bg-slate-50 rounded-lg p-2">
                                            <div className="text-xs text-slate-400">Producido</div>
                                            <div className="text-sm font-bold text-slate-700">{fmt(b.actualOutput || b.expectedOutput)}</div>
                                        </div>
                                        <div className="bg-slate-50 rounded-lg p-2">
                                            <div className="text-xs text-slate-400">Uds</div>
                                            <div className="text-sm font-bold text-slate-700">{b.unitsActual || '—'}</div>
                                        </div>
                                        <div className="bg-slate-50 rounded-lg p-2">
                                            <div className="text-xs text-slate-400">Efect.</div>
                                            <div className={`text-sm font-bold ${b.effectiveness >= 95 ? 'text-emerald-600' : b.effectiveness >= 80 ? 'text-amber-600' : 'text-rose-600'}`}>
                                                {b.effectiveness != null ? `${b.effectiveness}%` : '—'}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Pagination */}
                        {pagination.totalPages > 1 && (
                            <div className="flex justify-center items-center gap-3 mt-6">
                                <button disabled={pagination.page <= 1} onClick={() => fetchBatches(pagination.page - 1)}
                                    className="p-2 rounded-lg border border-slate-200 disabled:opacity-30 hover:bg-slate-50">
                                    <ChevronLeft size={18} />
                                </button>
                                <span className="text-sm text-slate-500">
                                    Página <span className="font-bold text-slate-700">{pagination.page}</span> de {pagination.totalPages}
                                </span>
                                <button disabled={pagination.page >= pagination.totalPages} onClick={() => fetchBatches(pagination.page + 1)}
                                    className="p-2 rounded-lg border border-slate-200 disabled:opacity-30 hover:bg-slate-50">
                                    <ChevronRight size={18} />
                                </button>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};

/* ════════════════════════════════════════════════════════════════════════════
   Sub-components
   ════════════════════════════════════════════════════════════════════════════ */

const KpiCard = ({ label, value, icon, color = 'blue' }) => {
    const colors = {
        blue: 'bg-blue-50 text-blue-700 border-blue-100',
        indigo: 'bg-indigo-50 text-indigo-700 border-indigo-100',
        emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
        cyan: 'bg-cyan-50 text-cyan-700 border-cyan-100',
        rose: 'bg-rose-50 text-rose-700 border-rose-100',
        amber: 'bg-amber-50 text-amber-700 border-amber-100',
    };
    return (
        <div className={`rounded-2xl p-3 text-center border ${colors[color] || colors.blue}`}>
            <div className="flex items-center justify-center gap-1 text-xs font-bold uppercase opacity-60 mb-1">
                {icon} {label}
            </div>
            <div className="text-xl font-black">{value}</div>
        </div>
    );
};

const InfoItem = ({ label, value }) => (
    <div>
        <div className="text-xs font-bold text-slate-400 uppercase">{label}</div>
        <div className="text-sm font-semibold text-slate-700">{value}</div>
    </div>
);

const TimelineCard = ({ stage, index }) => {
    const [expanded, setExpanded] = useState(index < 3); // auto-expand first 3
    const [lightbox, setLightbox] = useState(null); // { url, label }

    return (
        <div className="relative">
            {/* Dot on timeline */}
            <div className="absolute -left-8 top-4 z-10">{noteStatusIcon(stage.status)}</div>

            <div className={`bg-white rounded-2xl border overflow-hidden shadow-sm transition-all ${stage.status === 'COMPLETED' ? 'border-emerald-200' : stage.status === 'EXECUTING' ? 'border-blue-300' : 'border-slate-200'}`}>
                {/* Header — always visible */}
                <button onClick={() => setExpanded(!expanded)}
                    className="w-full text-left px-4 py-3 flex items-center justify-between hover:bg-slate-50/50 transition-colors">
                    <div className="flex items-center gap-3">
                        <span className="text-xs font-bold text-slate-300 w-6">{stage.stageOrder}.</span>
                        <div>
                            <div className="font-bold text-sm text-slate-800">{stage.stageName}</div>
                            <div className="text-xs text-slate-400">
                                {stage.processTypeName}
                                {stage.operator && <> · <User size={12} className="inline" /> {stage.operator}</>}
                                {stage.durationMinutes != null && <> · <Clock size={12} className="inline" /> {fmtDuration(stage.durationMinutes)}</>}
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {stage.actualQuantity > 0 && (
                            <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                                {fmt(stage.actualQuantity)} {stage.processType === 'CONTEO' ? 'uds' : 'g'}
                            </span>
                        )}
                        <ChevronRight size={16} className={`text-slate-400 transition-transform ${expanded ? 'rotate-90' : ''}`} />
                    </div>
                </button>

                {/* Expanded content */}
                {expanded && (
                    <div className="border-t border-slate-100 px-4 py-3 space-y-3 bg-slate-50/30">
                        {/* Times */}
                        <div className="flex flex-wrap gap-4 text-xs text-slate-500">
                            {stage.startedAt && <span>📍 Inicio: <strong>{fmtDateTime(stage.startedAt)}</strong></span>}
                            {stage.completedAt && <span>🏁 Fin: <strong>{fmtDateTime(stage.completedAt)}</strong></span>}
                            {stage.targetQuantity > 0 && <span>🎯 Meta: <strong>{fmt(stage.targetQuantity)}</strong></span>}
                        </div>

                        {/* Ingredients */}
                        {stage.ingredients?.length > 0 && (
                            <div>
                                <div className="text-xs font-bold text-slate-400 uppercase mb-1.5">Ingredientes</div>
                                <div className="space-y-1.5">
                                    {stage.ingredients.map((ing, i) => (
                                        <div key={i} className="flex justify-between items-center bg-white rounded-lg px-3 py-2 border border-slate-100 text-xs">
                                            <div>
                                                <span className="font-semibold text-slate-700">{ing.name}</span>
                                                {ing.lotNumber && (
                                                    <span className="ml-2 font-mono text-[11px] font-bold px-2 py-0.5 rounded-md bg-violet-100 text-violet-700 border border-violet-200">{ing.lotNumber}</span>
                                                )}
                                            </div>
                                            <div className="text-right">
                                                <span className="font-bold text-blue-600">{fmt(ing.actualQuantity || ing.plannedQuantity)} {ing.unit}</span>
                                                {ing.actualQuantity && ing.plannedQuantity && ing.actualQuantity !== ing.plannedQuantity && (
                                                    <span className="ml-1 text-slate-400">/ {fmt(ing.plannedQuantity)} plan</span>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Lot consumptions */}
                        {stage.lotConsumptions?.length > 0 && (
                            <div>
                                <div className="text-xs font-bold text-slate-400 uppercase mb-1.5">Consumo de Lotes</div>
                                <div className="space-y-1.5">
                                    {stage.lotConsumptions.map((lc, i) => (
                                        <div key={i} className="flex justify-between items-center bg-amber-50/50 rounded-lg px-3 py-2 border border-amber-100 text-xs">
                                            <div>
                                                <span className="font-semibold text-slate-700">{lc.product}</span>
                                                <span className="ml-2 font-mono text-[11px] font-bold px-2 py-0.5 rounded-md bg-violet-100 text-violet-700 border border-violet-200">{lc.lotNumber}</span>
                                                {lc.expiresAt && (
                                                    <span className={`ml-2 text-[10px] ${new Date(lc.expiresAt) < new Date() ? 'text-red-500 font-bold' : 'text-slate-400'}`}>
                                                        Vence: {fmtDate(lc.expiresAt)}
                                                    </span>
                                                )}
                                            </div>
                                            <span className="font-bold text-amber-700">{fmt(lc.quantityUsed)} {['gramo','gramos','g','kg'].includes((lc.unit || 'gramo').toLowerCase()) ? 'g' : (lc.unit || 'g')}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Conteo breakdown */}
                        {stage.processType === 'CONTEO' && stage.processParameters?.conteo && (
                            <div>
                                <div className="text-xs font-bold text-slate-400 uppercase mb-1.5">Conteo por Referencia</div>
                                <div className="space-y-1.5">
                                    {Object.entries(stage.processParameters.conteo).map(([name, data]) => (
                                        <div key={name} className="flex justify-between items-center bg-cyan-50/50 rounded-lg px-3 py-2 border border-cyan-100 text-xs">
                                            <span className="font-semibold text-slate-700">{name}</span>
                                            <div className="flex gap-3">
                                                <span className="text-slate-400">Plan: {fmt(data.planned)}</span>
                                                <span className="font-bold text-cyan-700">Real: {fmt(data.actual)}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Empaque data */}
                        {stage.processType === 'EMPAQUE' && stage.processParameters?.empaque && (
                            <div className="flex gap-4">
                                <div className="bg-emerald-50 rounded-lg px-3 py-2 border border-emerald-100 text-xs flex-1 text-center">
                                    <div className="text-slate-400">Conteo</div>
                                    <div className="font-bold text-emerald-700 text-lg">{fmt(stage.processParameters.empaque.conteo_qty)}</div>
                                </div>
                                <div className="bg-rose-50 rounded-lg px-3 py-2 border border-rose-100 text-xs flex-1 text-center">
                                    <div className="text-slate-400">Defectuosos</div>
                                    <div className="font-bold text-rose-700 text-lg">{fmt(stage.processParameters.empaque.defective)}</div>
                                </div>
                                <div className="bg-blue-50 rounded-lg px-3 py-2 border border-blue-100 text-xs flex-1 text-center">
                                    <div className="text-slate-400">Aprobados</div>
                                    <div className="font-bold text-blue-700 text-lg">{fmt(stage.processParameters.empaque.approved)}</div>
                                </div>
                            </div>
                        )}

                        {/* Process variables */}
                        {stage.processVariables?.length > 0 && (
                            <div>
                                <div className="text-xs font-bold text-slate-400 uppercase mb-1.5">Variables de Proceso</div>
                                <div className="flex flex-wrap gap-2">
                                    {stage.processVariables.map((pv, i) => (
                                        <span key={i} className="bg-indigo-50 text-indigo-700 text-xs font-bold px-2.5 py-1 rounded-full border border-indigo-100">
                                            {pv.name}: {pv.value} {pv.unit}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Quality Checks */}
                        {stage.qualityChecks?.length > 0 && (
                            <div>
                                <div className="text-xs font-bold text-slate-400 uppercase mb-1.5">Control de Calidad</div>
                                <div className="space-y-1.5">
                                    {stage.qualityChecks.map((qc, i) => (
                                        <div key={i} className="flex justify-between items-center bg-white rounded-lg px-3 py-2 border border-slate-100 text-xs">
                                            <span className="font-semibold text-slate-700">{qc.parameterName}</span>
                                            <span className={`font-bold ${qc.passed ? 'text-emerald-600' : 'text-red-600'}`}>
                                                {qc.value} {qc.unit} {qc.passed ? '✅' : '❌'}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Observations */}
                        {stage.observations && (
                            <div className="text-xs text-slate-500 bg-white rounded-lg p-3 border border-slate-100 italic">
                                💬 {stage.observations}
                            </div>
                        )}

                        {/* Temperature Validation */}
                        {(stage.temperature || stage.targetTemperature) && (
                            <div className="bg-orange-50 rounded-lg p-3 border border-orange-200">
                                <div className="text-xs font-bold text-orange-600 uppercase mb-2">🌡️ Control de Temperatura</div>
                                <div className="flex flex-wrap gap-4 text-sm">
                                    {stage.targetTemperature && (
                                        <div>
                                            <span className="text-xs text-slate-400">Meta: </span>
                                            <span className="font-bold text-orange-700">{stage.targetTemperature}°C</span>
                                        </div>
                                    )}
                                    {stage.temperature && (
                                        <div>
                                            <span className="text-xs text-slate-400">Real: </span>
                                            <span className={`font-bold ${stage.temperature >= (stage.targetTemperature || 0) ? 'text-emerald-600' : 'text-red-600'}`}>
                                                {stage.temperature}°C
                                            </span>
                                        </div>
                                    )}
                                    {stage.timerCompleted != null && (
                                        <div>
                                            <span className="text-xs text-slate-400">Cronómetro: </span>
                                            <span className={`font-bold ${stage.timerCompleted ? 'text-emerald-600' : 'text-red-600'}`}>
                                                {stage.timerCompleted ? '✅ Completado' : '❌ No completado'}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Photo Evidence */}
                        {stage.photos?.length > 0 && (
                            <div>
                                <div className="text-xs font-bold text-slate-400 uppercase mb-1.5">📸 Evidencia Fotográfica</div>
                                <div className="flex flex-wrap gap-2">
                                    {stage.photos.map((photo, i) => (
                                        <button key={i} onClick={() => setLightbox(photo)}
                                            className="relative group cursor-pointer">
                                            <img src={photo.url} alt={photo.label}
                                                className="w-20 h-20 object-cover rounded-lg border-2 border-slate-200 group-hover:border-blue-400 transition-colors" />
                                            <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[9px] text-center py-0.5 rounded-b-lg">
                                                {photo.label}
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
            {/* Lightbox modal */}
            {lightbox && (
                <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
                    onClick={() => setLightbox(null)}>
                    <div className="relative max-w-3xl max-h-[90vh] animate-in zoom-in-95 duration-200"
                        onClick={e => e.stopPropagation()}>
                        <img src={lightbox.url} alt={lightbox.label}
                            className="max-w-full max-h-[85vh] object-contain rounded-xl shadow-2xl" />
                        <div className="text-center mt-2 text-white text-sm font-bold">{lightbox.label}</div>
                        <button onClick={() => setLightbox(null)}
                            className="absolute -top-3 -right-3 w-8 h-8 bg-white rounded-full shadow-lg flex items-center justify-center text-slate-600 hover:bg-red-50 hover:text-red-600 transition-colors">
                            ✕
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default BatchHistoryPage;
