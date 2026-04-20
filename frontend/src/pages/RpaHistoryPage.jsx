import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { RefreshCw, Play, Eye, CheckCircle, XCircle, Loader, ChevronDown, ChevronUp, Search } from 'lucide-react';

const STATUS_CFG = {
    RUNNING: { label: 'Creando NE...', bg: 'bg-blue-100 text-blue-700', icon: Loader },
    SUCCESS: { label: 'Exitoso', bg: 'bg-emerald-100 text-emerald-700', icon: CheckCircle },
    FAILED: { label: 'Fallido', bg: 'bg-red-100 text-red-700', icon: XCircle },
};

const fmtDate = (d) => new Date(d).toLocaleString('es-CO', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
});

/* Detect desktop (>=1024px) */
const useIsDesktop = () => {
    const [isDesktop, setIsDesktop] = useState(window.innerWidth >= 1024);
    useEffect(() => {
        const handler = () => setIsDesktop(window.innerWidth >= 1024);
        window.addEventListener('resize', handler);
        return () => window.removeEventListener('resize', handler);
    }, []);
    return isDesktop;
};

const RpaHistoryPage = () => {
    const [executions, setExecutions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [retrying, setRetrying] = useState(null);
    const [expanded, setExpanded] = useState(null);
    const [screenshotUrl, setScreenshotUrl] = useState(null);
    const [logsData, setLogsData] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [orphans, setOrphans] = useState([]);
    const [orphanLoading, setOrphanLoading] = useState(false);
    const [dispatching, setDispatching] = useState(null);
    const [orphanExpanded, setOrphanExpanded] = useState(true);
    const isDesktop = useIsDesktop();

    const fetchHistory = async () => {
        try {
            setLoading(true);
            const res = await api.get('/rpa/history?limit=100');
            setExecutions(res.data);
        } catch {
            // silently fail
        } finally {
            setLoading(false);
        }
    };

    const fetchOrphans = async () => {
        try {
            setOrphanLoading(true);
            const res = await api.get('/rpa/orphan-notes?days=30');
            setOrphans(res.data.orphans || []);
        } catch {
            // silently fail
        } finally {
            setOrphanLoading(false);
        }
    };

    useEffect(() => { fetchHistory(); fetchOrphans(); }, []);

    useEffect(() => {
        const hasRunning = executions.some(e => e.status === 'RUNNING');
        if (!hasRunning) return;
        const timer = setInterval(fetchHistory, 10000);
        return () => clearInterval(timer);
    }, [executions]);

    const handleRetry = async (id) => {
        try {
            setRetrying(id);
            await api.post(`/rpa/${id}/retry`);
            fetchHistory();
        } catch {
            // silently fail
        } finally {
            setRetrying(null);
        }
    };

    const handleDispatchOrphan = async (noteId) => {
        try {
            setDispatching(noteId);
            await api.post('/rpa/dispatch-orphan', { assemblyNoteId: noteId });
            // Remove from orphan list optimistically and refresh history
            setOrphans(prev => prev.filter(o => o.id !== noteId));
            setTimeout(fetchHistory, 2000);
        } catch (err) {
            alert(err.response?.data?.error || 'Error al despachar RPA');
        } finally {
            setDispatching(null);
        }
    };

    const getBatch = (obs, type) => {
        if (!obs) return null;
        if (type === 'SIIGO_ADJUSTMENT' || obs.toLowerCase().includes('ajuste')) return 'AJUSTE';
        const m = obs.match(/Lote:\s*([^.]+)/i);
        return m ? m[1].trim() : null;
    };

    const filteredExecutions = executions.filter(exec => {
        if (!searchTerm) return true;
        const s = searchTerm.toLowerCase();
        const batch = getBatch(exec.observations, exec.executionType) || '';
        return (exec.productName || '').toLowerCase().includes(s) || 
               batch.toLowerCase().includes(s) || 
               (exec.siigoNoteCode || '').toLowerCase().includes(s);
    });

    const successCount = filteredExecutions.filter(e => e.status === 'SUCCESS').length;
    const failedCount = filteredExecutions.filter(e => e.status === 'FAILED').length;
    const runningCount = filteredExecutions.filter(e => e.status === 'RUNNING').length;

    /* ─── DESKTOP TABLE LAYOUT ──────────────────────────────────── */
    if (isDesktop) {
        return (
            <div style={{ padding: '1.5rem 2rem', minHeight: '100vh', background: '#f8fafc' }}>
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                    <div>
                        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, margin: 0, color: '#1e293b' }}>
                            🤖 Historial RPA
                        </h1>
                        <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                            <span style={{ padding: '3px 10px', borderRadius: 6, fontSize: '0.8rem', fontWeight: 700, background: '#dcfce7', color: '#166534' }}>
                                ✓ {successCount}
                            </span>
                            <span style={{ padding: '3px 10px', borderRadius: 6, fontSize: '0.8rem', fontWeight: 700, background: '#fee2e2', color: '#991b1b' }}>
                                ✗ {failedCount}
                            </span>
                            {runningCount > 0 && (
                                <span style={{ padding: '3px 10px', borderRadius: 6, fontSize: '0.8rem', fontWeight: 700, background: '#dbeafe', color: '#1e40af' }}>
                                    ⏳ {runningCount}
                                </span>
                            )}
                            <span style={{ fontSize: '0.8rem', color: '#94a3b8', alignSelf: 'center' }}>
                                Total: {filteredExecutions.length}
                            </span>
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                        <div style={{ position: 'relative' }}>
                            <Search size={16} color="#94a3b8" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
                            <input
                                type="text"
                                placeholder="Buscar sabor, lote o NE..."
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                                style={{
                                    padding: '8px 16px 8px 34px',
                                    borderRadius: 6,
                                    border: '1px solid #e2e8f0',
                                    fontSize: '0.85rem',
                                    width: '250px',
                                    outline: 'none'
                                }}
                            />
                        </div>
                        <button
                            onClick={fetchHistory}
                            disabled={loading}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 6,
                                padding: '8px 16px', borderRadius: 8, border: '1px solid #e2e8f0',
                                background: '#fff', fontSize: '0.85rem', fontWeight: 600,
                                cursor: 'pointer', color: '#475569'
                            }}
                        >
                            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                            Refrescar
                        </button>
                    </div>
                </div>

                {/* ── ORPHAN NOTES ALERT PANEL ──────────────────────────────────── */}
                {orphans.length > 0 && (
                    <div style={{ marginBottom: '1.25rem', background: '#fff7ed', border: '1.5px solid #fed7aa', borderRadius: 12, overflow: 'hidden' }}>
                        <div
                            onClick={() => setOrphanExpanded(e => !e)}
                            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', cursor: 'pointer' }}
                        >
                            <span style={{ fontSize: '1.1rem' }}>⚠️</span>
                            <div style={{ flex: 1 }}>
                                <span style={{ fontWeight: 800, color: '#92400e', fontSize: '0.9rem' }}>
                                    {orphans.length} nota{orphans.length > 1 ? 's' : ''} sin registrar en Siigo
                                </span>
                                <span style={{ marginLeft: 8, fontSize: '0.75rem', color: '#b45309' }}>
                                    (completadas pero sin RPA en los últimos 30 días)
                                </span>
                            </div>
                            <span style={{ fontSize: '0.8rem', color: '#b45309', fontWeight: 600 }}>
                                {orphanExpanded ? '▲ Ocultar' : '▼ Ver todas'}
                            </span>
                        </div>
                        {orphanExpanded && (
                            <div style={{ borderTop: '1px solid #fed7aa' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                                    <thead>
                                        <tr style={{ background: '#fef3c7' }}>
                                            <th style={{ padding: '8px 14px', textAlign: 'left', color: '#92400e', fontWeight: 700, fontSize: '0.7rem', textTransform: 'uppercase' }}>Producto</th>
                                            <th style={{ padding: '8px 14px', textAlign: 'left', color: '#92400e', fontWeight: 700, fontSize: '0.7rem', textTransform: 'uppercase' }}>Lote</th>
                                            <th style={{ padding: '8px 14px', textAlign: 'right', color: '#92400e', fontWeight: 700, fontSize: '0.7rem', textTransform: 'uppercase' }}>Qty</th>
                                            <th style={{ padding: '8px 14px', textAlign: 'left', color: '#92400e', fontWeight: 700, fontSize: '0.7rem', textTransform: 'uppercase' }}>Completada</th>
                                            <th style={{ padding: '8px 14px', textAlign: 'center', color: '#92400e', fontWeight: 700, fontSize: '0.7rem', textTransform: 'uppercase' }}>Acción</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {orphans.map(o => (
                                            <tr key={o.id} style={{ borderBottom: '1px solid #fde68a' }}>
                                                <td style={{ padding: '8px 14px', fontWeight: 600, color: '#1e293b' }}>
                                                    <div style={{ fontSize: '0.75rem' }}>{o.productName}</div>
                                                    {o.productSku && <span style={{ fontSize: '0.65rem', padding: '1px 5px', borderRadius: 4, background: '#f1f5f9', color: '#475569', fontWeight: 700, fontFamily: 'monospace' }}>{o.productSku}</span>}
                                                </td>
                                                <td style={{ padding: '8px 14px' }}>
                                                    <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: 4, background: '#dbeafe', color: '#1e40af', fontWeight: 600 }}>{o.batchNumber || '—'}</span>
                                                </td>
                                                <td style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 800, color: '#1e293b' }}>{o.quantity?.toLocaleString('es-CO')}</td>
                                                <td style={{ padding: '8px 14px', fontSize: '0.72rem', color: '#64748b' }}>
                                                    {new Date(o.completedAt).toLocaleString('es-CO', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                                </td>
                                                <td style={{ padding: '8px 14px', textAlign: 'center' }}>
                                                    <button
                                                        onClick={() => handleDispatchOrphan(o.id)}
                                                        disabled={dispatching === o.id}
                                                        style={{
                                                            padding: '5px 12px', borderRadius: 6, border: 'none',
                                                            background: dispatching === o.id ? '#e5e7eb' : '#f59e0b',
                                                            color: dispatching === o.id ? '#9ca3af' : '#fff',
                                                            fontSize: '0.72rem', fontWeight: 700, cursor: dispatching === o.id ? 'not-allowed' : 'pointer'
                                                        }}
                                                    >
                                                        {dispatching === o.id ? '⏳ Encolando...' : '🤖 Enviar a Siigo'}
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}

                {/* Table */}
                <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                        <thead>
                            <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                                <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 700, color: '#475569', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Estado</th>
                                <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 700, color: '#475569', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Producto</th>
                                <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 700, color: '#475569', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Lote</th>
                                <th style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 700, color: '#475569', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Cantidad</th>
                                <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 700, color: '#475569', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Nota Siigo</th>
                                <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 700, color: '#475569', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Fecha</th>
                                <th style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 700, color: '#475569', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Duración</th>
                                <th style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 700, color: '#475569', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Acciones</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredExecutions.map((exec, idx) => {
                                const cfg = STATUS_CFG[exec.status] || STATUS_CFG.FAILED;
                                const Icon = cfg.icon;
                                const batch = getBatch(exec.observations, exec.executionType);
                                const screenshotFile = exec.screenshotPath?.split('/').pop();
                                const ssUrl = screenshotFile ? `${window.location.origin}/rpa-screenshots/${screenshotFile}` : null;
                                const isExpanded = expanded === exec.id;

                                return (
                                    <React.Fragment key={exec.id}>
                                        <tr
                                            onClick={() => setExpanded(isExpanded ? null : exec.id)}
                                            style={{
                                                borderBottom: '1px solid #f1f5f9',
                                                cursor: 'pointer',
                                                background: exec.status === 'FAILED' ? '#fef2f2' : exec.status === 'RUNNING' ? '#eff6ff' : idx % 2 === 0 ? '#fff' : '#fafbfc',
                                                transition: 'background .15s',
                                            }}
                                            onMouseEnter={e => { if (exec.status !== 'FAILED' && exec.status !== 'RUNNING') e.currentTarget.style.background = '#f1f5f9'; }}
                                            onMouseLeave={e => { if (exec.status !== 'FAILED' && exec.status !== 'RUNNING') e.currentTarget.style.background = idx % 2 === 0 ? '#fff' : '#fafbfc'; }}
                                        >
                                            <td style={{ padding: '10px 16px' }}>
                                                <div style={{
                                                    display: 'inline-flex', alignItems: 'center', gap: 6,
                                                    padding: '4px 10px', borderRadius: 6, fontSize: '0.75rem', fontWeight: 700,
                                                    background: exec.status === 'SUCCESS' ? '#dcfce7' : exec.status === 'FAILED' ? '#fee2e2' : '#dbeafe',
                                                    color: exec.status === 'SUCCESS' ? '#16a34a' : exec.status === 'FAILED' ? '#dc2626' : '#2563eb',
                                                }}>
                                                    <Icon size={14} className={exec.status === 'RUNNING' ? 'animate-spin' : ''} />
                                                    {cfg.label}
                                                </div>
                                            </td>
                                            <td style={{ padding: '10px 16px', fontWeight: 600, color: '#1e293b' }}>
                                                <div>{exec.productName}</div>
                                                {exec.assemblyNote?.product?.sku && (
                                                    <span style={{ fontSize: '0.65rem', padding: '1px 6px', borderRadius: 4, background: '#f1f5f9', color: '#475569', fontWeight: 700, fontFamily: 'monospace' }}>
                                                        {exec.assemblyNote.product.sku}
                                                    </span>
                                                )}
                                            </td>
                                            <td style={{ padding: '10px 16px' }}>
                                                {batch ? (
                                                    <span style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: 4, background: '#dbeafe', color: '#1e40af', fontWeight: 600 }}>{batch}</span>
                                                ) : <span style={{ color: '#cbd5e1' }}>—</span>}
                                            </td>
                                            <td style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 800, fontSize: '1rem', color: '#1e293b' }}>
                                                {exec.quantity?.toLocaleString('es-CO') || '—'}
                                            </td>
                                            <td style={{ padding: '10px 16px' }}>
                                                {exec.siigoNoteCode ? (
                                                    /^(AJ|NE|IE|CE)-/.test(exec.siigoNoteCode) ? (
                                                        <span style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: 4, background: '#dcfce7', color: '#166534', fontWeight: 700 }}>
                                                            {exec.siigoNoteCode}
                                                        </span>
                                                    ) : /Guardado|Exitoso/i.test(exec.siigoNoteCode) ? (
                                                        <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: 4, background: '#fef9c3', color: '#854d0e', fontWeight: 600 }}>
                                                            Guardado (sin # capturado)
                                                        </span>
                                                    ) : (
                                                        <span style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: 4, background: '#dcfce7', color: '#166534', fontWeight: 700 }}>
                                                            {exec.siigoNoteCode}
                                                        </span>
                                                    )
                                                ) : <span style={{ color: '#cbd5e1' }}>—</span>}
                                            </td>
                                            <td style={{ padding: '10px 16px', fontSize: '0.8rem', color: '#64748b' }}>
                                                {fmtDate(exec.startedAt)}
                                            </td>
                                            <td style={{ padding: '10px 16px', textAlign: 'center', fontSize: '0.8rem', color: '#64748b' }}>
                                                {exec.durationMs ? `${(exec.durationMs / 1000).toFixed(1)}s` : '—'}
                                            </td>
                                            <td style={{ padding: '10px 16px', textAlign: 'center' }}>
                                                <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                                                    {exec.status === 'FAILED' && (
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); handleRetry(exec.id); }}
                                                            disabled={retrying === exec.id}
                                                            style={{
                                                                display: 'flex', alignItems: 'center', gap: 4,
                                                                padding: '5px 12px', borderRadius: 6, border: 'none',
                                                                background: '#f59e0b', color: '#fff', fontSize: '0.75rem',
                                                                fontWeight: 700, cursor: 'pointer', opacity: retrying === exec.id ? 0.6 : 1,
                                                            }}
                                                        >
                                                            <Play size={12} /> Reintentar
                                                        </button>
                                                    )}
                                                    {ssUrl && (
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); setScreenshotUrl(ssUrl); }}
                                                            style={{
                                                                display: 'flex', alignItems: 'center', gap: 4,
                                                                padding: '5px 10px', borderRadius: 6, border: '1px solid #e2e8f0',
                                                                background: '#fff', color: '#475569', fontSize: '0.75rem',
                                                                fontWeight: 600, cursor: 'pointer',
                                                            }}
                                                        >
                                                            📸
                                                        </button>
                                                    )}
                                                    {exec.logs && (
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); setLogsData(exec); }}
                                                            style={{
                                                                display: 'flex', alignItems: 'center', gap: 4,
                                                                padding: '5px 10px', borderRadius: 6, border: '1px solid #e2e8f0',
                                                                background: '#fff', color: '#475569', fontSize: '0.75rem',
                                                                fontWeight: 600, cursor: 'pointer',
                                                            }}
                                                        >
                                                            <Eye size={12} />
                                                        </button>
                                                    )}
                                                    <span style={{ cursor: 'pointer', color: '#94a3b8', display: 'flex', alignItems: 'center' }}>
                                                        {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                                    </span>
                                                </div>
                                            </td>
                                        </tr>
                                        {/* Expanded error row */}
                                        {isExpanded && exec.errorMessage && (
                                            <tr style={{ background: '#fef2f2' }}>
                                                <td colSpan="8" style={{ padding: '8px 16px 12px' }}>
                                                    <div style={{ fontSize: '0.8rem', color: '#dc2626', fontWeight: 600 }}>
                                                        ❌ Error: {exec.errorMessage}
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                );
                            })}
                        </tbody>
                    </table>

                    {filteredExecutions.length === 0 && !loading && (
                        <div style={{ textAlign: 'center', padding: '3rem', color: '#94a3b8' }}>
                            No se encontraron ejecuciones
                        </div>
                    )}
                </div>

                {/* Screenshot Modal */}
                {screenshotUrl && (
                    <div
                        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 24 }}
                        onClick={() => setScreenshotUrl(null)}
                    >
                        <div style={{ background: '#fff', borderRadius: 12, padding: 12, maxWidth: '80vw', maxHeight: '85vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
                            <img src={screenshotUrl} alt="Screenshot" style={{ width: '100%', borderRadius: 8 }} />
                        </div>
                    </div>
                )}

                {/* Logs Modal */}
                {logsData && (
                    <div
                        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 24 }}
                        onClick={() => setLogsData(null)}
                    >
                        <div style={{ background: '#1e293b', borderRadius: 12, padding: 20, maxWidth: '700px', width: '100%', maxHeight: '80vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
                            <div style={{ color: '#94a3b8', fontSize: '0.9rem', fontWeight: 700, marginBottom: 12 }}>
                                Logs — {logsData.productName}
                            </div>
                            <pre style={{ color: '#e2e8f0', fontSize: '0.8rem', lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                {(Array.isArray(logsData.logs) ? logsData.logs : []).join('\n')}
                            </pre>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    /* ─── MOBILE / TABLET CARD LAYOUT (unchanged) ───────────────── */
    return (
        <div style={{ padding: '0.5rem', minHeight: '100vh', background: '#f8fafc' }}>
            {/* Header */}
            <div style={{ marginBottom: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h1 style={{ fontSize: '1.2rem', fontWeight: 800, margin: 0, color: '#1e293b' }}>
                        🤖 Historial RPA
                    </h1>
                    <button
                        onClick={fetchHistory}
                        disabled={loading}
                        style={{
                            display: 'flex', alignItems: 'center', gap: 4,
                            padding: '6px 12px', borderRadius: 8, border: '1px solid #e2e8f0',
                            background: '#fff', fontSize: '0.75rem', fontWeight: 600,
                            cursor: 'pointer', color: '#475569'
                        }}
                    >
                        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                        Refrescar
                    </button>
                </div>
                {/* Mobile Search */}
                <div style={{ position: 'relative', marginTop: '0.75rem' }}>
                    <Search size={14} color="#94a3b8" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
                    <input
                        type="text"
                        placeholder="Buscar sabor, lote o NE..."
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        style={{
                            width: '100%',
                            padding: '8px 12px 8px 32px',
                            borderRadius: 6,
                            border: '1px solid #e2e8f0',
                            fontSize: '0.8rem',
                            outline: 'none'
                        }}
                    />
                </div>
                {/* Stats */}
                <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                    <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: '0.7rem', fontWeight: 700, background: '#dcfce7', color: '#166534' }}>
                        ✓ {successCount}
                    </span>
                    <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: '0.7rem', fontWeight: 700, background: '#fee2e2', color: '#991b1b' }}>
                        ✗ {failedCount}
                    </span>
                    {runningCount > 0 && (
                        <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: '0.7rem', fontWeight: 700, background: '#dbeafe', color: '#1e40af' }}>
                            ⏳ {runningCount}
                        </span>
                    )}
                    <span style={{ fontSize: '0.7rem', color: '#94a3b8', alignSelf: 'center' }}>
                        Total: {filteredExecutions.length}
                    </span>
                </div>
            </div>

            {/* Cards */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {filteredExecutions.map(exec => {
                    const cfg = STATUS_CFG[exec.status] || STATUS_CFG.FAILED;
                    const Icon = cfg.icon;
                    const batch = getBatch(exec.observations, exec.executionType);
                    const isExpanded = expanded === exec.id;
                    const screenshotFile = exec.screenshotPath?.split('/').pop();
                    const ssUrl = screenshotFile ? `${window.location.origin}/rpa-screenshots/${screenshotFile}` : null;

                    return (
                        <div
                            key={exec.id}
                            style={{
                                background: exec.status === 'FAILED' ? '#fef2f2' : exec.status === 'RUNNING' ? '#eff6ff' : '#fff',
                                borderRadius: 10,
                                border: `1px solid ${exec.status === 'FAILED' ? '#fecaca' : exec.status === 'RUNNING' ? '#bfdbfe' : '#e2e8f0'}`,
                                overflow: 'hidden',
                            }}
                        >
                            {/* Main row — always visible */}
                            <div
                                onClick={() => setExpanded(isExpanded ? null : exec.id)}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 8,
                                    padding: '8px 10px', cursor: 'pointer',
                                }}
                            >
                                {/* Status dot */}
                                <div style={{
                                    width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    background: exec.status === 'SUCCESS' ? '#dcfce7' : exec.status === 'FAILED' ? '#fee2e2' : '#dbeafe',
                                }}>
                                    <Icon size={14} style={{
                                        color: exec.status === 'SUCCESS' ? '#16a34a' : exec.status === 'FAILED' ? '#dc2626' : '#2563eb',
                                    }} className={exec.status === 'RUNNING' ? 'animate-spin' : ''} />
                                </div>

                                {/* Product + batch */}
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#1e293b', lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {exec.productName}
                                    </div>
                                    {exec.assemblyNote?.product?.sku && (
                                        <span style={{ fontSize: '0.6rem', padding: '1px 5px', borderRadius: 4, background: '#f1f5f9', color: '#475569', fontWeight: 700, fontFamily: 'monospace' }}>
                                            {exec.assemblyNote.product.sku}
                                        </span>
                                    )}
                                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 2 }}>
                                        <span style={{ fontSize: '0.65rem', color: '#94a3b8' }}>{fmtDate(exec.startedAt)}</span>
                                        {batch && <span style={{ fontSize: '0.6rem', padding: '1px 5px', borderRadius: 4, background: '#dbeafe', color: '#1e40af', fontWeight: 600 }}>{batch}</span>}
                                    </div>
                                </div>

                                {/* Quantity + Siigo code */}
                                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                    <div style={{ fontSize: '0.9rem', fontWeight: 800, color: '#1e293b' }}>
                                        {exec.quantity || '—'}
                                    </div>
                                    {exec.siigoNoteCode && (
                                        <div style={{ fontSize: '0.6rem', padding: '1px 5px', borderRadius: 4, background: /Guardado|Exitoso/i.test(exec.siigoNoteCode) ? '#fef9c3' : '#dcfce7', color: /Guardado|Exitoso/i.test(exec.siigoNoteCode) ? '#854d0e' : '#166534', fontWeight: 600, marginTop: 1 }}>
                                            {/^(AJ|NE|IE|CE)-/.test(exec.siigoNoteCode) ? exec.siigoNoteCode : /Guardado|Exitoso/i.test(exec.siigoNoteCode) ? 'Sin #' : exec.siigoNoteCode}
                                        </div>
                                    )}
                                </div>

                                {/* Expand arrow */}
                                <div style={{ flexShrink: 0 }}>
                                    {isExpanded ? <ChevronUp size={14} color="#94a3b8" /> : <ChevronDown size={14} color="#94a3b8" />}
                                </div>
                            </div>

                            {/* Expanded details */}
                            {isExpanded && (
                                <div style={{ padding: '0 10px 10px', borderTop: '1px solid #f1f5f9' }}>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: '0.7rem', marginTop: 8, color: '#64748b' }}>
                                        <span>Tipo:</span>
                                        <span style={{ fontWeight: 600, color: '#1e293b' }}>{exec.assemblyType === 'terminado' ? '🏭 Terminado' : '🔧 Proceso'}</span>
                                        <span>Duración:</span>
                                        <span style={{ fontWeight: 600, color: '#1e293b' }}>{exec.durationMs ? `${(exec.durationMs / 1000).toFixed(1)}s` : '—'}</span>
                                        <span>Usuario:</span>
                                        <span style={{ fontWeight: 600, color: '#1e293b' }}>{exec.triggeredBy?.name || '—'}</span>
                                        {exec.siigoNoteCode && !/Guardado|Exitoso/i.test(exec.siigoNoteCode) && <>
                                            <span>Documento Siigo:</span>
                                            <span style={{ fontWeight: 700, color: '#16a34a' }}>{exec.siigoNoteCode}</span>
                                        </>}
                                        {exec.errorMessage && <>
                                            <span style={{ color: '#dc2626' }}>Error:</span>
                                            <span style={{ color: '#dc2626', fontWeight: 600, wordBreak: 'break-word' }}>{exec.errorMessage}</span>
                                        </>}
                                    </div>

                                    {/* Actions */}
                                    <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                                        {exec.status === 'FAILED' && (
                                            <button
                                                onClick={(e) => { e.stopPropagation(); handleRetry(exec.id); }}
                                                disabled={retrying === exec.id}
                                                style={{
                                                    display: 'flex', alignItems: 'center', gap: 4,
                                                    padding: '5px 10px', borderRadius: 6, border: 'none',
                                                    background: '#f59e0b', color: '#fff', fontSize: '0.7rem',
                                                    fontWeight: 700, cursor: 'pointer', opacity: retrying === exec.id ? 0.6 : 1,
                                                }}
                                            >
                                                <Play size={12} /> Reintentar
                                            </button>
                                        )}
                                        {ssUrl && (
                                            <button
                                                onClick={(e) => { e.stopPropagation(); setScreenshotUrl(ssUrl); }}
                                                style={{
                                                    display: 'flex', alignItems: 'center', gap: 4,
                                                    padding: '5px 10px', borderRadius: 6, border: '1px solid #e2e8f0',
                                                    background: '#fff', color: '#475569', fontSize: '0.7rem',
                                                    fontWeight: 600, cursor: 'pointer',
                                                }}
                                            >
                                                📸 Screenshot
                                            </button>
                                        )}
                                        {exec.logs && (
                                            <button
                                                onClick={(e) => { e.stopPropagation(); setLogsData(exec); }}
                                                style={{
                                                    display: 'flex', alignItems: 'center', gap: 4,
                                                    padding: '5px 10px', borderRadius: 6, border: '1px solid #e2e8f0',
                                                    background: '#fff', color: '#475569', fontSize: '0.7rem',
                                                    fontWeight: 600, cursor: 'pointer',
                                                }}
                                            >
                                                <Eye size={12} /> Logs
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}

                {filteredExecutions.length === 0 && !loading && (
                    <div style={{ textAlign: 'center', padding: '3rem', color: '#94a3b8' }}>
                        No se encontraron ejecuciones
                    </div>
                )}
            </div>

            {/* Screenshot Modal */}
            {screenshotUrl && (
                <div
                    style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 12 }}
                    onClick={() => setScreenshotUrl(null)}
                >
                    <div style={{ background: '#fff', borderRadius: 12, padding: 8, maxWidth: '95vw', maxHeight: '85vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
                        <img src={screenshotUrl} alt="Screenshot" style={{ width: '100%', borderRadius: 8 }} />
                    </div>
                </div>
            )}

            {/* Logs Modal */}
            {logsData && (
                <div
                    style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 12 }}
                    onClick={() => setLogsData(null)}
                >
                    <div style={{ background: '#1e293b', borderRadius: 12, padding: 16, maxWidth: '95vw', width: '100%', maxHeight: '80vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
                        <div style={{ color: '#94a3b8', fontSize: '0.8rem', fontWeight: 700, marginBottom: 8 }}>
                            Logs — {logsData.productName}
                        </div>
                        <pre style={{ color: '#e2e8f0', fontSize: '0.7rem', lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                            {(Array.isArray(logsData.logs) ? logsData.logs : []).join('\n')}
                        </pre>
                    </div>
                </div>
            )}
        </div>
    );
};

export default RpaHistoryPage;
