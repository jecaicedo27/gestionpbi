import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { RefreshCw, Play, RotateCcw, CheckCircle, Clock, Layers, ChevronRight, Timer, Factory, Warehouse } from 'lucide-react';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmtDuration = (ms) => {
    if (!ms || ms <= 0) return null;
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
};

const fmtTime = (dateStr) => {
    if (!dateStr) return null;
    return format(new Date(dateStr), 'HH:mm');
};

// ─── Live Elapsed Timer ───────────────────────────────────────────────────────
const LiveTimer = ({ startedAt, className = '' }) => {
    const [elapsed, setElapsed] = useState('');
    useEffect(() => {
        if (!startedAt) return;
        const tick = () => {
            const ms = Date.now() - new Date(startedAt).getTime();
            setElapsed(fmtDuration(ms) || '0s');
        };
        tick();
        const id = setInterval(tick, 1000);
        return () => clearInterval(id);
    }, [startedAt]);
    return <span className={className}>{elapsed}</span>;
};

// ─── Compact Progress Bar with stage dots ─────────────────────────────────────
const StageProgress = ({ notes }) => {
    const total = notes.length;
    const completed = notes.filter(n => n.status === 'COMPLETED').length;
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

    return (
        <div className="w-full">
            {/* Progress track */}
            <div className="relative w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                <div
                    className={`absolute inset-y-0 left-0 rounded-full transition-all duration-700 ${pct === 100 ? 'bg-emerald-500' : 'bg-blue-500'}`}
                    style={{ width: `${pct}%` }}
                />
            </div>
            {/* Dot indicators */}
            <div className="flex items-center mt-1.5 gap-0.5">
                {notes.map((n, i) => {
                    const isDone = n.status === 'COMPLETED';
                    const isRunning = n.status === 'EXECUTING';
                    return (
                        <div
                            key={i}
                            className="flex-1 h-1 rounded-full"
                            style={{
                                background: isDone ? '#334155' : isRunning ? '#3b82f6' : '#e2e8f0',
                                boxShadow: isRunning ? '0 0 4px rgba(59,130,246,.6)' : 'none'
                            }}
                            title={`${i + 1}. ${n.stageName || ''} (${n.status})`}
                        />
                    );
                })}
            </div>
        </div>
    );
};

// ─── Batch Card (Redesigned) ──────────────────────────────────────────────────
const BatchCard = ({ batch, onStart, onDelete, isAdmin, userRole }) => {
    const [showSummary, setShowSummary] = useState(false);
    const isDone = batch.allDone;
    const isStarted = batch.completed > 0;
    const isRunning = batch.inProgress;
    const progressPct = batch.total > 0 ? Math.round((batch.completed / batch.total) * 100) : 0;

    const currentStage = batch.notes.find(n => n.status === 'EXECUTING');
    const nextStage = currentStage || batch.notes.find(n => n.status === 'PENDING');
    const displayStage = currentStage || nextStage;
    const isEmpaqueWaiting = !currentStage && displayStage?.processType?.code === 'EMPAQUE';
    const currentStageName = isEmpaqueWaiting
        ? '📋 Recepción de Carrito'
        : displayStage?.stageName
            ?.replace(/Ensamble Siigo\s*/i, 'Ens. ')
            .replace(/Pesaje de\s*/i, '')
            .replace(/Formación de\s*/i, 'Form. ')
            .replace(/Empaque\s*/i, 'Emp. ')
            .replace(/Conteo de\s*/i, 'Conteo ')
            .trim()
            .slice(0, 30);

    const isSiropeBatch = (batch.batchNumber || '').toUpperCase().includes('SIROPE')
        || (batch.batchNumber || '').toUpperCase().includes('GENIALITY')
        || (batch.allProductNames || []).some(p => {
            const u = p.toUpperCase();
            return u.includes('SIROPE') || u.includes('SABORIZACION') || u.includes('GENIALITY');
        });

    // OPERARIO_PICKING can act on EMPAQUE / ETIQUETADO / ENSAMBLE (Siigo post-empaque)
    // CONTEO is production-only for Liquipops (direct input counting), but SHARED for Siropes (Carrito delivery)
    const PICKING_STAGES = ['EMPAQUE', 'ETIQUETADO', 'ENSAMBLE'];
    if (isSiropeBatch) PICKING_STAGES.push('CONTEO');
    
    const isPickingRole = userRole === 'OPERARIO_PICKING';
    const nextStageCode = nextStage?.processType?.code || '';
    const canPickingAct = !isPickingRole || PICKING_STAGES.includes(nextStageCode);

    // PRODUCCION stops after CONTEO — EMPAQUE/ETIQUETADO/final ENSAMBLE belong to empaque team
    // "Post-empaque ENSAMBLE" = Ensamble Siigo that comes AFTER empaque stages (stageOrder > empaque stageOrder)
    const EMPAQUE_ONLY_STAGES = ['EMPAQUE', 'ETIQUETADO'];
    const isProduccionRole = userRole === 'PRODUCCION';
    const empaqueNotes = batch.notes.filter(n => n.processType?.code === 'EMPAQUE');
    const firstEmpaqueOrder = empaqueNotes.length > 0
        ? Math.min(...empaqueNotes.map(n => n.stageOrder || 999))
        : 999;
    const nextStageOrder = nextStage?.stageOrder || 0;
    // Only block ENSAMBLE if it comes AFTER empaque stages (post-empaque Ensamble Siigo)
    const isPostEmpaqueEnsamble = nextStageCode === 'ENSAMBLE' && nextStageOrder > firstEmpaqueOrder;
    const canProduccionAct = !isProduccionRole || (!EMPAQUE_ONLY_STAGES.includes(nextStageCode) && !isPostEmpaqueEnsamble);

    // Combined: both restrictions must pass
    const canAct = canPickingAct && canProduccionAct;

    const batchStartedAt = batch.notes
        .filter(n => n.startedAt)
        .map(n => new Date(n.startedAt))
        .sort((a, b) => a - b)[0] || null;

    const batchCompletedAt = isDone
        ? batch.notes.filter(n => n.completedAt).map(n => new Date(n.completedAt)).sort((a, b) => b - a)[0] || null
        : null;

    // ── Build radiography data for completed batches ──
    const ingredients = [];
    if (isDone) {
        const seen = new Set();
        for (const note of batch.notes) {
            for (const item of (note.items || [])) {
                const name = item.component?.name || item.componentId;
                const key = `${name}-${item.plannedQuantity}`;
                if (seen.has(key)) continue;
                seen.add(key);
                ingredients.push({
                    name,
                    planned: item.plannedQuantity,
                    actual: item.actualQuantity,
                    unit: item.unit || 'g',
                });
            }
        }
    }
    // Total produced weight = sum of all ingredient quantities
    const totalWeight = ingredients.reduce((sum, ing) => sum + (Number(ing.actual) || Number(ing.planned) || 0), 0);
    // Number of lots from note metadata
    const numLots = isDone ? (batch.notes[0]?.repeatTotal || batch.notes.filter(n => (n.processType?.code || '').includes('PESAJE')).length || null) : null;

    // Card accent
    const accent = isDone
        ? { border: 'border-emerald-200', bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' }
        : isRunning
            ? { border: 'border-blue-200', bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-500' }
            : { border: 'border-slate-200', bg: 'bg-slate-50', text: 'text-slate-500', dot: 'bg-slate-300' };

    return (
        <div className={`bg-white rounded-2xl border ${accent.border} overflow-hidden transition-all hover:shadow-lg group`}
            style={{ boxShadow: '0 1px 4px rgba(0,0,0,.04)' }}>

            {/* Top section */}
            <div className="p-3 pb-2">
                {/* Status badge + time + LOT */}
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${accent.dot} ${isRunning ? 'animate-pulse' : ''}`} />
                        <span className={`text-[11px] font-bold uppercase tracking-wider ${accent.text}`}>
                            {isDone ? '✓ Completado' : isRunning ? 'En Proceso' : 'Pendiente'}
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        {batchStartedAt && !isDone && (
                            <div className="flex items-center gap-1 text-[11px] text-blue-500 font-semibold">
                                <Timer size={10} />
                                <LiveTimer startedAt={batchStartedAt} />
                            </div>
                        )}
                        {isDone && batchStartedAt && batchCompletedAt && (
                            <span className="text-[11px] text-emerald-600 font-semibold">
                                ⏱ {fmtDuration(batchCompletedAt - batchStartedAt)}
                            </span>
                        )}
                        {!isDone && batch.scheduledStart && (
                            <span className="text-[11px] text-slate-400">
                                Prog. {fmtTime(batch.scheduledStart)}
                            </span>
                        )}
                        {isAdmin && !isDone && (
                            <button
                                onClick={(e) => { e.stopPropagation(); onDelete(batch); }}
                                className="text-xs font-bold text-white bg-red-500 hover:bg-red-600 rounded-lg px-2.5 py-1 transition-colors shadow-sm"
                                title="Eliminar proceso (Admin)"
                            >
                                🗑 Eliminar
                            </button>
                        )}
                    </div>
                </div>

                {/* Flavor + Product name + Lot badge full width */}
                <div>
                    {(() => {
                        const bn = batch.batchNumber || '';
                        const flavorMatch = bn.match(/^([A-ZÑ]+(?:[\s-][A-ZÑ]+)*)-(\d{6})/);
                        const flavor = flavorMatch ? flavorMatch[1].replace(/-/g, ' ') : '';
                        const flavorEmojis = {
                            FRESA: '🍓', CEREZA: '🍒', BLUEBERRY: '🫐', MARACUYA: '🥭',
                            UVA: '🍇', MANGO: '🥭', 'MANGO BICHE': '🥭', 'MANGO BICHE CON SAL': '🥭',
                            LIMON: '🍋', MORA: '🫐', DURAZNO: '🍑', PIÑA: '🍍',
                            CHAMOY: '🌶️', TAMARINDO: '🟤', SANDIA: '🍉', NARANJA: '🍊',
                            GUANABANA: '🟢', LULO: '🟡', CHICLE: '🫧', 'ICE PINK': '🩷',
                        };
                        const words = flavor.split(' ');
                        const emoji = flavorEmojis[flavor]
                            || (words.length >= 2 && flavorEmojis[words.slice(0, 2).join(' ')])
                            || flavorEmojis[words[0]]
                            || '🧪';
                        // Build a clear display name: if productName is generic (BASE ...), use product-line-aware label
                        const isGenericName = (batch.productName || '').toUpperCase().startsWith('BASE ');
                        const isSiropeBatch = (batch.batchNumber || '').toUpperCase().includes('SIROPE')
                            || (batch.batchNumber || '').toUpperCase().includes('GENIALITY')
                            || (batch.allProductNames || []).some(p => {
                                const u = p.toUpperCase();
                                return u.includes('SIROPE') || u.includes('SABORIZACION') || u.includes('GENIALITY');
                            });
                        const displayName = flavor && isGenericName
                            ? `${isSiropeBatch ? 'SIROPE' : 'PERLAS'} ${flavor}`
                            : batch.productName;
                        return (
                            <>
                                {flavor && (
                                    <div className="inline-flex items-center gap-1 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-lg px-2.5 py-0.5 mb-0.5 shadow-sm">
                                        <span className="text-sm">{emoji}</span>
                                        <span className="text-sm font-extrabold tracking-wide">{flavor}</span>
                                    </div>
                                )}
                                <h3 className={`${flavor ? 'text-xs text-slate-500 font-semibold' : 'text-base font-extrabold text-slate-800'} leading-tight`}>
                                    {displayName}
                                </h3>
                            </>
                        );
                    })()}
                    {/* Lot badge — full width so long numbers never truncate */}
                    <div className="mt-1 inline-flex items-center gap-1 bg-emerald-50 border border-emerald-200 rounded-md px-1.5 py-0.5 max-w-full">
                        <span className="text-[10px] flex-shrink-0">🏷️</span>
                        <span className="text-[10px] font-bold text-emerald-700 font-mono break-all leading-tight">{batch.batchNumber}</span>
                    </div>
                </div>

                {/* Output Targets — programmed vs real */}
                {batch.outputTargets?.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                        {batch.outputTargets.map((t, i) => {
                            const sizeMatch = t.name.match(/(\d+)\s*(GR|ML|G|L|KG)/i);
                            const sizeLabel = sizeMatch ? `${sizeMatch[1]}${sizeMatch[2].toLowerCase()}` : '';
                            const planned = t.plannedUnits || 0;
                            const real = t.realQty || 0;
                            const hasReal = real > 0;
                            return (
                                <span key={i} className={`inline-flex items-center gap-1 text-[10px] font-semibold border rounded-md px-1.5 py-0.5 ${
                                    hasReal ? 'bg-purple-50 text-purple-700 border-purple-200 shadow-sm' : 'bg-indigo-50 text-indigo-700 border-indigo-100'
                                }`}>
                                    {hasReal ? '🏆' : '📦'}
                                    {hasReal
                                        ? <><span className="text-slate-400 line-through mr-0.5">{planned}</span><span className="font-extrabold">{real}</span></>
                                        : <span>{planned}</span>
                                    }
                                    <span>× {sizeLabel || t.name.slice(0, 20)}</span>
                                </span>
                            );
                        })}
                    </div>
                )}

                {/* Current stage label */}
                {currentStageName && (
                    <div className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 bg-blue-50 border border-blue-100 rounded-lg px-2.5 py-1">
                        <Play size={10} className="fill-blue-500 text-blue-500" />
                        {currentStageName}
                    </div>
                )}
            </div>

            {/* Progress section */}
            <div className="px-3 pb-2">
                <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11px] text-slate-400 font-medium">
                        {batch.completed}/{batch.total} etapas
                    </span>
                    <span className={`text-sm font-bold ${isDone ? 'text-emerald-600' : isRunning ? 'text-blue-600' : 'text-slate-400'}`}>
                        {progressPct}%
                    </span>
                </div>
                <StageProgress notes={batch.notes} />
            </div>

            {/* ── Completed: Radiography summary ── */}
            {isDone && (
                <div className="px-5 pb-3">
                    {/* Always visible: start/end times */}
                    {batchStartedAt && batchCompletedAt && (
                        <div className="flex items-center gap-2 text-xs text-slate-500 mb-2 bg-slate-50 rounded-lg px-3 py-2 border border-slate-100">
                            <span>🕐 <b className="text-slate-700">{fmtTime(batchStartedAt)}</b></span>
                            <span className="text-slate-300">→</span>
                            <span>🏁 <b className="text-slate-700">{fmtTime(batchCompletedAt)}</b></span>
                            <span className="ml-auto font-bold text-emerald-600">
                                ⏱ {fmtDuration(batchCompletedAt - batchStartedAt)}
                            </span>
                        </div>
                    )}

                    {ingredients.length > 0 && (
                        <>
                            <button
                                onClick={() => setShowSummary(!showSummary)}
                                className="w-full flex items-center justify-between text-[11px] font-semibold text-slate-500 hover:text-slate-700 py-1.5 transition-colors"
                            >
                                <span>📋 Resumen de producción</span>
                                <span style={{ transform: showSummary ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform .2s' }}>▼</span>
                            </button>

                            {showSummary && (
                                <div className="mt-1 bg-slate-50 rounded-xl border border-slate-100 p-3 text-xs space-y-2.5">
                                    {/* What was produced */}
                                    <div>
                                        <div className="font-bold text-emerald-700 mb-1 flex items-center gap-1">
                                            📦 Producido
                                        </div>
                                        <div className="bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2 flex items-center justify-between">
                                            <div>
                                                <div className="font-bold text-slate-700">{batch.productName}</div>
                                                <div className="text-slate-500 font-mono text-[10px]">Lote: {batch.batchNumber}</div>
                                            </div>
                                            <div className="text-right">
                                                {totalWeight > 0 && (
                                                    <div className="text-lg font-extrabold text-emerald-700">
                                                        {totalWeight >= 1000
                                                            ? `${(totalWeight / 1000).toLocaleString('es-CO', { maximumFractionDigits: 1 })} kg`
                                                            : `${totalWeight.toLocaleString('es-CO')} g`
                                                        }
                                                    </div>
                                                )}
                                                {numLots && numLots > 1 && (
                                                    <div className="text-[10px] text-emerald-600 font-semibold">{numLots} lotes</div>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Ingredients used */}
                                    <div>
                                        <div className="font-bold text-slate-600 mb-1 flex items-center gap-1">
                                            🧪 Ingredientes consumidos
                                        </div>
                                        <div className="space-y-1">
                                            {ingredients.map((ing, i) => (
                                                <div key={i} className="flex items-center justify-between bg-white rounded-lg px-2.5 py-1.5 border border-slate-100">
                                                    <span className="text-slate-700 truncate" style={{ maxWidth: '60%' }}>{ing.name}</span>
                                                    <span className="font-mono font-semibold text-slate-500 flex-shrink-0">
                                                        {ing.actual != null
                                                            ? <>{Number(ing.actual).toLocaleString('es-CO')} <span className="text-slate-400">{ing.unit}</span></>
                                                            : <>{Number(ing.planned).toLocaleString('es-CO')} <span className="text-slate-400">{ing.unit}</span></>
                                                        }
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}

            {/* CTA */}
            {!isDone ? (
                canAct ? (
                    <button
                        onClick={() => onStart(batch)}
                        className="w-full py-3 flex items-center justify-center gap-2 font-bold text-sm bg-slate-800 hover:bg-slate-900 text-white transition-colors group-hover:bg-blue-600">
                        {isStarted ? <RotateCcw size={14} /> : <Play size={14} />}
                        {isStarted ? 'Continuar proceso' : 'Iniciar proceso'}
                        <ChevronRight size={14} className="ml-1 opacity-50" />
                    </button>
                ) : isProduccionRole ? (
                    <div className="w-full py-3 flex items-center justify-center gap-2 font-bold text-sm bg-emerald-50 text-emerald-600 border-t border-emerald-100">
                        📦 Lista para empaque
                    </div>
                ) : (
                    <div className="w-full py-3 flex items-center justify-center gap-2 font-bold text-sm bg-slate-200 text-slate-400 cursor-not-allowed">
                        🔒 Esperando tu turno
                    </div>
                )
            ) : (
                <div className="w-full py-2.5 bg-emerald-50 flex items-center justify-center gap-2 text-emerald-600 text-xs font-semibold border-t border-emerald-100">
                    <CheckCircle size={14} /> Finalizado
                </div>
            )}
        </div>
    );
};

// ─── Main Page ─────────────────────────────────────────────────────────────
const ProductionOperatorPage = () => {
    const navigate = useNavigate();
    const { user } = useAuth();
    const isAdmin = user?.role === 'ADMIN';
    const [loading, setLoading] = useState(true);
    const [batches, setBatches] = useState([]);
    const [lastRefresh, setLastRefresh] = useState(new Date());
    const [refreshing, setRefreshing] = useState(false);
    const [activeTab, setActiveTab] = useState('active');
    const [activeLine, setActiveLine] = useState('perlas'); // 'perlas' | 'siropes'

    const fetchData = useCallback(async (showSpinner = false) => {
        if (showSpinner) setRefreshing(true);
        try {
            // Filtrar últimos 14 días para no cargar todo el historial
            const since = new Date();
            since.setDate(since.getDate() - 14);
            const sinceISO = since.toISOString();
            const res = await api.get(`/assembly-notes?since=${sinceISO}`);
            const notes = res.data || [];

            const batchMap = {};
            for (const note of notes) {
                const bId = note.productionBatchId;
                if (!bId) continue;
                if (!batchMap[bId]) {
                    batchMap[bId] = {
                        id: bId,
                        batchNumber: note.productionBatch?.batchNumber || bId.slice(0, 8),
                        productName: note.product?.name || 'Producto',
                        scheduledStart: note.productionBatch?.scheduledStart,
                        status: note.productionBatch?.status,
                        batchStatus: note.productionBatch?.status,
                        outputTargets: (note.productionBatch?.outputTargets || []).map(t => ({
                            name: t.product?.name || '',
                            sku: t.product?.sku || '',
                            productId: t.productId || '',
                            plannedUnits: t.plannedUnits || 0,
                            actualUnits: t.actualUnits || 0,
                            plannedWeightKg: t.plannedWeightKg || 0
                        })),
                        allProductNames: [],
                        notes: []
                    };
                }
                if (note.product?.name) batchMap[bId].allProductNames.push(note.product.name);
                batchMap[bId].notes.push(note);
            }

            const batchList = Object.values(batchMap)
                .map(b => {
                    b.notes.sort((a, c) => (a.stageOrder || 0) - (c.stageOrder || 0));
                    b.completed = b.notes.filter(n => n.status === 'COMPLETED').length;
                    b.total = b.notes.length;

                    // Resolve real-time or completed actual counts
                    const conteoNote = b.notes.find(n => n.processType?.code === 'CONTEO');
                    const pp = conteoNote?.processParameters || {};
                    const parsedPP = typeof pp === 'string' ? JSON.parse(pp) : pp;
                    const conteoDraft = typeof parsedPP.conteo_draft === 'string' ? JSON.parse(parsedPP.conteo_draft) : (parsedPP.conteo_draft || {});
                    const conteoFinal = typeof parsedPP.conteo === 'string' ? JSON.parse(parsedPP.conteo) : (parsedPP.conteo || {});
                    const carriotsArr = typeof parsedPP.carriots === 'string' ? JSON.parse(parsedPP.carriots) : (parsedPP.carriots || []);

                    b.outputTargets = b.outputTargets.map(t => {
                        const draftActual = conteoDraft[t.productId];
                        const finalEntry = Object.values(conteoFinal).find(c => c.productId === t.productId || c.productName === t.name);
                        const finalActual = finalEntry?.actual;

                        // Carriots: sum quantities from carriots array matching this product
                        const matchingCarriots = carriotsArr.filter(c => c.productId === t.productId || c.productName === t.name);
                        const carriotsSum = matchingCarriots.reduce((sum, c) => sum + Number(c.qty || 0), 0);

                        let displayQty = t.plannedUnits || 0;
                        let isActual = false;

                        if (carriotsSum > 0) {
                            displayQty = carriotsSum;
                            isActual = true;
                        } else if (draftActual !== undefined && draftActual !== '' && parseInt(draftActual, 10) > 0) {
                            displayQty = parseInt(draftActual, 10);
                            isActual = true;
                        } else if (finalActual != null && finalActual > 0) {
                            displayQty = parseInt(finalActual, 10);
                            isActual = true;
                        } else if (t.actualUnits > 0) {
                            displayQty = parseInt(t.actualUnits, 10);
                            isActual = true;
                        }

                        return { ...t, displayQty, isActual, realQty: isActual ? displayQty : 0 };
                    });
                    // allDone: todas COMPLETED o el batch está marcado COMPLETED en BD
                    b.allDone = (b.total > 0 && b.completed === b.total)
                        || b.batchStatus === 'COMPLETED';
                    // Si el batch está COMPLETED, forzar completed=total para mostrar 100%
                    if (b.allDone && b.batchStatus === 'COMPLETED' && b.completed < b.total) {
                        b.completed = b.total;
                    }
                    // STAGE_X_BASE = batch en progreso (flujo multi-etapa)
                    const isStageInProgress = /^STAGE_\d/.test(b.batchStatus || '');
                    b.inProgress = !b.allDone && (
                        b.notes.some(n => n.status === 'EXECUTING') || isStageInProgress
                    );
                    b.firstPending = b.notes.find(n => n.status !== 'COMPLETED');
                    return b;
                })
                .sort((a, c) => {
                    if (a.allDone !== c.allDone) return a.allDone ? 1 : -1;

                    // OPERARIO_PICKING: actionable batches first
                    if (user?.role === 'OPERARIO_PICKING') {
                        const PICKING_STAGES = ['EMPAQUE', 'ETIQUETADO'];
                        const aNext = (a.notes.find(n => n.status === 'EXECUTING') || a.notes.find(n => n.status === 'PENDING'))?.processType?.code || '';
                        const cNext = (c.notes.find(n => n.status === 'EXECUTING') || c.notes.find(n => n.status === 'PENDING'))?.processType?.code || '';
                        const aCanAct = PICKING_STAGES.includes(aNext);
                        const cCanAct = PICKING_STAGES.includes(cNext);
                        if (aCanAct !== cCanAct) return aCanAct ? -1 : 1;
                    }

                    if (a.inProgress !== c.inProgress) return a.inProgress ? -1 : 1;
                    return new Date(c.scheduledStart || 0) - new Date(a.scheduledStart || 0);
                });

            setBatches(batchList);
            setLastRefresh(new Date());
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
        const interval = setInterval(() => fetchData(), 30000);
        return () => clearInterval(interval);
    }, [fetchData]);

    // Classify batch as sirope or perla — check ALL stage products, not just the first
    const isSirope = (b) => {
        const bn = (b.batchNumber || '').toUpperCase();
        if (bn.includes('SIROPE') || bn.includes('SABORIZACION') || bn.includes('GENIALITY')) return true;
        return (b.allProductNames || []).some(p => {
            const u = p.toUpperCase();
            return u.includes('SIROPE') || u.includes('SABORIZACION') || u.includes('GENIALITY');
        });
    };

    const handleStart = (batch) => {
        if (!batch.firstPending) return;
        // All sirope (Geniality) batches → GenialityExecutionWizard
        // It handles both native steps (G_/GE_) and shared steps (EMPAQUE/ENSAMBLE/CONTEO)
        if (isSirope(batch)) {
            navigate(`/geniality/assembly-execution/${batch.firstPending.id}`);
        } else {
            navigate(`/assembly-execution/${batch.firstPending.id}`);
        }
    };

    const handleDelete = async (batch) => {
        if (!confirm(`¿Eliminar el proceso "${batch.productName}" (${batch.batchNumber})?\n\nEsta acción no se puede deshacer.`)) return;
        try {
            await api.delete(`/production/liquipops/${batch.id}`);
            setBatches(prev => prev.filter(b => b.id !== batch.id));
        } catch (err) {
            console.error('Error deleting batch:', err);
            alert('Error al eliminar: ' + (err.response?.data?.error || err.message));
        }
    };



    // ── SECRET FORMULA FILTER ──────────────────────────────────────────────
    // Only PREMEZCLAS are trade secrets (ingredient formulas).
    // Compuestos, Protecciones, Base Liquipops, Esferas → visible for Production.
    // Only ADMIN and QUIMICO can see premezcla batches.
    const PREMIX_KEYWORDS = [
        'PREMEZCLA', 'PROTONICO',
        'FUENTE DE CALCIO',
        'GOMA', 'CONSERVANTE', 'CALCIO DIOXIDO',
        'CALCIO DIÓXIDO',
    ];
    const isPremixBatch = (b) => {
        const bn = (b.batchNumber || '').toUpperCase();
        const pn = (b.productName || '').toUpperCase();
        const allNames = (b.allProductNames || []).map(p => p.toUpperCase());
        const allText = [bn, pn, ...allNames];
        return allText.some(txt => PREMIX_KEYWORDS.some(kw => txt.includes(kw)));
    };
    const canSeePremixes = isAdmin || user?.role === 'QUIMICO';

    const lineBatches = batches
        .filter(b => canSeePremixes || !isPremixBatch(b))
        .filter(b => activeLine === 'siropes' ? isSirope(b) : !isSirope(b));
    const total = lineBatches.length;
    const inProgress = lineBatches.filter(b => !b.allDone && b.completed > 0).length;
    const completedCount = lineBatches.filter(b => b.allDone).length;
    const pending = lineBatches.filter(b => b.completed === 0 && !b.allDone).length;

    const activeBatches = lineBatches.filter(b => !b.allDone);
    const completedBatches = lineBatches.filter(b => b.allDone);

    // Counts for line tabs (respect premix visibility)
    const filteredBatches = canSeePremixes ? batches : batches.filter(b => !isPremixBatch(b));
    const perlaCount = filteredBatches.filter(b => !b.allDone && !isSirope(b)).length;
    const siropeCount = filteredBatches.filter(b => !b.allDone && isSirope(b)).length;

    const stats = [
        { label: 'Total', value: total, icon: Factory, color: 'text-slate-700', bg: 'bg-white', border: 'border-slate-200' },
        { label: 'En Proceso', value: inProgress, icon: Play, color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200' },
        { label: 'Pendientes', value: pending, icon: Clock, color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200' },
        { label: 'Completados', value: completedCount, icon: CheckCircle, color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200' },
    ];

    const tabs = [
        { key: 'active', label: 'En curso', count: activeBatches.length, icon: '⚡' },
        { key: 'completed', label: 'Completados', count: completedBatches.length, icon: '✅' },
    ];

    const lineTabs = [
        { key: 'perlas', label: 'Perlas', count: perlaCount, icon: '🔵', color: '#3b82f6', bg: '#eff6ff' },
        { key: 'siropes', label: 'Siropes', count: siropeCount, icon: '🍯', color: '#d97706', bg: '#fffbeb' },
    ];

    const visibleBatches = activeTab === 'active' ? activeBatches : completedBatches;

    return (
        <div className="min-h-screen" style={{ background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 50%, #f0f4ff 100%)' }}>
            {/* Header responsivo (compacto en PC) */}
            <div className="bg-white/95 backdrop-blur-sm border-b border-slate-200 px-4 py-3 md:py-4 sticky top-0 z-10 shadow-sm">
                <div className="max-w-screen-2xl mx-auto">
                    {/* Fila 1: Título, Filtro Línea (Perlas/Siropes), Botones Acción */}
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4 md:mb-5">
                        {/* Izquierda: Título */}
                        <div className="flex items-center justify-between md:justify-start gap-4">
                            <div>
                                <div className="flex items-center gap-2.5 mb-0.5">
                                    <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center">
                                         <Layers size={16} className="text-white" />
                                    </div>
                                    <h1 className="text-xl md:text-2xl font-extrabold text-slate-800">Panel de Producción</h1>
                                </div>
                                <p className="text-xs text-slate-400 capitalize md:ml-11">
                                    {format(new Date(), "EEEE, d 'de' MMMM yyyy", { locale: es })}
                                </p>
                            </div>
                            {/* Botones acciones (Mobile) - solo visibles en movil, en PC flotan a la derecha */}
                            <div className="flex md:hidden items-center gap-2">
                                <button onClick={() => navigate('/production/zone')} className="p-2 rounded-lg bg-indigo-50 text-indigo-600 border border-indigo-200"><Warehouse size={16} /></button>
                                <button onClick={() => fetchData(true)} className="p-2 rounded-lg bg-slate-100 text-slate-600 border border-slate-200"><RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} /></button>
                            </div>
                        </div>

                        {/* Centro: Line Tabs (Perlas/Siropes) */}
                        <div className="flex flex-1 md:max-w-md gap-2 w-full">
                            {lineTabs.map(lt => {
                                const isActive = activeLine === lt.key;
                                return (
                                    <button
                                        key={lt.key}
                                        onClick={() => { setActiveLine(lt.key); setActiveTab('active'); }}
                                        style={{
                                            flex: 1,
                                            padding: '0.6rem 0.5rem',
                                            borderRadius: 12,
                                            border: 'none',
                                            background: isActive
                                                ? (lt.key === 'perlas' ? 'linear-gradient(135deg, #3b82f6, #2563eb)' : 'linear-gradient(135deg, #f59e0b, #d97706)')
                                                : '#f1f5f9',
                                            color: isActive ? '#fff' : '#94a3b8',
                                            fontWeight: 800,
                                            fontSize: '0.9rem',
                                            cursor: 'pointer',
                                            transition: 'all .25s',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            gap: '0.4rem',
                                            boxShadow: isActive ? '0 4px 12px rgba(0,0,0,0.15)' : 'none',
                                        }}
                                    >
                                        <span className="text-lg md:text-xl">{lt.icon}</span>
                                        {lt.label}
                                        <span style={{
                                            background: isActive ? 'rgba(255,255,255,0.25)' : '#cbd5e1',
                                            color: isActive ? '#fff' : '#64748b',
                                            borderRadius: 20,
                                            padding: '0.1rem 0.5rem',
                                            fontSize: '0.75rem',
                                            fontWeight: 900,
                                            minWidth: 22,
                                            textAlign: 'center',
                                        }}>{lt.count}</span>
                                    </button>
                                );
                            })}
                        </div>

                        {/* Derecha: Acciones (PC) */}
                        <div className="hidden md:flex items-center gap-2">
                            <button
                                onClick={() => navigate('/production/zone')}
                                className="flex items-center gap-2 text-sm text-indigo-600 hover:text-indigo-900 font-semibold px-4 py-2.5 rounded-xl hover:bg-indigo-50 transition-colors border border-indigo-200 bg-indigo-50 shadow-sm">
                                <Warehouse size={16} />
                                Zona
                            </button>
                            <button
                                onClick={() => fetchData(true)}
                                disabled={refreshing}
                                className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 font-semibold px-4 py-2.5 rounded-xl hover:bg-slate-100 transition-colors border border-slate-200 shadow-sm bg-white">
                                <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
                                Actualizar
                            </button>
                        </div>
                    </div>

                    {/* Compact stats + status tabs — single inline row */}
                    <div className="flex items-center justify-between gap-2">
                        {/* Mini inline stats */}
                        <div className="flex items-center gap-1.5 text-xs flex-wrap">
                            <span className="font-extrabold text-slate-700 text-sm leading-none">{total}</span>
                            <span className="text-slate-300">·</span>
                            <span className="font-bold text-blue-600">⚡{inProgress}</span>
                            <span className="text-slate-300">·</span>
                            <span className="font-bold text-amber-600">⏳{pending}</span>
                            <span className="text-slate-300">·</span>
                            <span className="font-bold text-emerald-600">✓{completedCount}</span>
                            <span className="text-[9px] text-slate-300 hidden sm:inline ml-1">· {format(lastRefresh, 'HH:mm:ss')}</span>
                        </div>
                        {/* Status tabs */}
                        <div className="flex gap-1.5 flex-shrink-0">
                            {tabs.map(tab => (
                                <button
                                    key={tab.key}
                                    onClick={() => setActiveTab(tab.key)}
                                    className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition-all border-2
                                        ${activeTab === tab.key ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-500'}`}
                                >
                                    {tab.icon}
                                    <span className="hidden sm:inline">{tab.label}</span>
                                    <span className={`rounded-full px-1.5 text-[10px] font-black
                                        ${activeTab === tab.key ? 'text-blue-600' : 'text-slate-400'}`}>
                                        {tab.count}
                                    </span>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* Content (Grid de Batches) */}
            <div className="max-w-screen-2xl mx-auto px-4 py-5">

                {loading ? (
                    <div className="flex items-center justify-center py-24 text-slate-400 gap-3">
                        <div className="w-5 h-5 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
                        <span className="text-sm">Cargando procesos...</span>
                    </div>
                ) : visibleBatches.length === 0 ? (
                    <div className="text-center py-24 text-slate-400">
                        <div className="text-5xl mb-3">{activeTab === 'active' ? '🎉' : '📋'}</div>
                        <div className="font-semibold text-slate-500 mb-1">
                            {activeTab === 'active' ? 'Sin procesos pendientes' : 'Sin procesos completados'}
                        </div>
                        <div className="text-sm">
                            {activeTab === 'active' ? '¡Todo está al día!' : 'Aún no se ha completado ningún proceso hoy.'}
                        </div>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
                        {visibleBatches.map(batch => (
                            <BatchCard key={batch.id} batch={batch} onStart={handleStart} onDelete={handleDelete} isAdmin={isAdmin} userRole={user?.role} />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default ProductionOperatorPage;
