import { useState, useEffect } from 'react';
import { Shield, Lock, CheckSquare, AlertTriangle } from 'lucide-react';
import api from '../../services/api';

const BATCH_SUMMARY_AREAS = ['PRODUCCION', 'SIROPES', 'EMPAQUE'];

export default function LeaderAuthorizationPanel({ handover, checklists, onUpdate }) {
    const [pin, setPin] = useState('');
    const [hasNovelty, setHasNovelty] = useState('NO');
    const [noveltyDetail, setNoveltyDetail] = useState('');
    const [checkValues, setCheckValues] = useState({});
    const [productionSummary, setProductionSummary] = useState(null);
    const [summarySelections, setSummarySelections] = useState({});
    const [summaryLoading, setSummaryLoading] = useState(false);
    const [summaryError, setSummaryError] = useState('');
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);

    // Initialize checklist values
    useEffect(() => {
        if (checklists?.length > 0) {
            const init = {};
            checklists.forEach(c => {
                init[c.id] = checkValues[c.id] ?? (c.fieldType === 'boolean' ? false : '');
            });
            setCheckValues(init);
        }
    }, [checklists, handover?.id]);

    useEffect(() => {
        if (!BATCH_SUMMARY_AREAS.includes(handover?.area) || !handover?.id) {
            setProductionSummary(null);
            setSummarySelections({});
            setSummaryError('');
            return;
        }

        let active = true;
        setSummaryLoading(true);
        setSummaryError('');

        api.get(`/shift-handover/${handover.id}/production-summary`)
            .then(res => {
                if (active) {
                    setProductionSummary(res.data);
                    setSummarySelections(res.data?.reviewSelections || {});
                }
            })
            .catch(e => {
                if (active) setSummaryError(e.response?.data?.error || 'No fue posible cargar los lotes del turno');
            })
            .finally(() => {
                if (active) setSummaryLoading(false);
            });

        return () => { active = false; };
    }, [handover?.id, handover?.area, handover?.status]);

    if (!handover) return null;

    const isAuthorized = ['DELIVERED', 'RECEIVED', 'WITH_INCIDENT', 'VALIDATED'].includes(handover.status);
    const showsProductionSummary = BATCH_SUMMARY_AREAS.includes(handover.area);
    const visibleChecklists = (checklists || []).filter(c =>
        !(showsProductionSummary && isProductionLotsChecklistItem(c.label))
    );
    const requiresProductionLeader = ['SIROPES', 'EMPAQUE'].includes(handover.area);
    const leaderTitle = requiresProductionLeader ? 'Autorización Líder de Producción' : 'Autorización Líder Saliente';
    const leaderPinLabel = requiresProductionLeader ? 'PIN del Líder de Producción (saliente)' : 'PIN del Líder Saliente';
    const waitingLabel = requiresProductionLeader
        ? 'Esperando firmas para validar con el líder de Producción'
        : 'Esperando firmas de operarios';

    const outgoingSignatures = (handover.signatures || []).filter(signature => signature.participantGroup === 'OUTGOING');
    const outOps = (handover.outgoingParticipants || []).filter(p => p.role !== 'LIDER');
    const signedUserIds = new Set(outgoingSignatures.map(signature => signature.userId));
    const signedCount = outOps.filter(operator => signedUserIds.has(operator.userId)).length;
    const allOpsSigned = outOps.length === 0 || signedCount >= outOps.length;
    const summaryBlocked = showsProductionSummary && (summaryLoading || summaryError || !productionSummary);

    const toggleSummaryBatch = (section, batch) => {
        const key = getBatchReviewKey(batch);
        if (!key || !productionSummary) return;
        setSummarySelections(prev => {
            const sectionSelections = prev[section] || {};
            const next = {
                ...prev,
                [section]: {
                    ...sectionSelections,
                    [key]: !isSelectionChecked(sectionSelections[key])
                }
            };
            persistSummarySelections(next);
            return next;
        });
    };

    const persistSummarySelections = async (nextSelections) => {
        try {
            const res = await api.patch(`/shift-handover/${handover.id}/review-selection`, {
                reviewSelections: nextSelections
            });
            if (res.data?.summary) {
                setProductionSummary(res.data.summary);
                setSummarySelections(res.data.summary.reviewSelections || {});
            }
        } catch (e) {
            setError(e.response?.data?.error || 'No se pudo guardar la revisión del lote');
        }
    };

    const handleAuthorize = async () => {
        if (pin.length !== 4) { setError('Ingresa 4 dígitos'); return; }
        if (!allOpsSigned) { setError('Todos los operarios deben firmar primero'); return; }
        if (summaryBlocked) {
            setError(summaryLoading
                ? 'Espera un momento: estamos cargando los lotes del turno'
                : (summaryError || 'No se pudo cargar el resumen automático de lotes'));
            return;
        }
        if (hasNovelty === 'SI' && !noveltyDetail.trim()) {
            setError('Indica cuál fue la novedad');
            return;
        }

        // Build checklist with values
        const checklistData = visibleChecklists.map(c => ({
            id: c.id,
            label: c.label,
            fieldType: c.fieldType,
            value: checkValues[c.id] ?? (c.fieldType === 'boolean' ? false : '')
        }));
        checklistData.push({
            id: 'SHIFT_NOVELTY',
            label: 'Novedades / incidencias',
            fieldType: 'novelty',
            value: {
                hasNovelty: hasNovelty === 'SI',
                detail: hasNovelty === 'SI' ? noveltyDetail.trim() : ''
            }
        });
        if (showsProductionSummary && productionSummary) {
            checklistData.unshift({
                id: 'AUTO_SHIFT_BATCH_SUMMARY',
                label: productionSummary.title || 'Baches del turno',
                fieldType: 'production_summary',
                value: buildSummaryForSave(productionSummary, summarySelections)
            });
        }

        setSubmitting(true);
        setError('');
        try {
            await api.post(`/shift-handover/${handover.id}/authorize-outgoing`, {
                pin,
                checklist: checklistData,
                pendingTasks: null,
                incidents: hasNovelty === 'SI' ? noveltyDetail.trim() : null,
                observations: null
            });
            setPin('');
            if (onUpdate) onUpdate();
        } catch (e) {
            setError(e.response?.data?.error || 'Error al autorizar');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div style={{ background: '#fff', borderRadius: 8, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
            {/* Header */}
            <div style={{
                padding: '16px 20px',
                background: isAuthorized ? 'linear-gradient(135deg, #eff6ff, #dbeafe)' : 'linear-gradient(135deg, #faf5ff, #f3e8ff)',
                borderBottom: `2px solid ${isAuthorized ? '#93c5fd' : '#d8b4fe'}`
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Shield size={20} color={isAuthorized ? '#2563eb' : '#7c3aed'} />
                    <div>
                        <div style={{ fontSize: 15, fontWeight: 800, color: '#0f172a' }}>
                            {isAuthorized ? '✅ Autorización Registrada' : leaderTitle}
                        </div>
                        {isAuthorized && handover.outgoingLeader && (
                            <div style={{ fontSize: 12, color: '#64748b' }}>
                                {handover.outgoingLeader.name} — {handover.outgoingLeaderAt && new Date(handover.outgoingLeaderAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {isAuthorized ? (
                <div style={{ padding: '16px 20px' }}>
                    {handover.checklist && Array.isArray(handover.checklist) && (
                        <div style={{ marginBottom: 12 }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 8, textTransform: 'uppercase' }}>Checklist</div>
                            <ChecklistSummary items={handover.checklist} />
                        </div>
                    )}
                    {handover.incidents && !hasNoveltyChecklistItem(handover.checklist) && (
                        <div style={{ marginBottom: 8 }}>
                            <span style={{ fontSize: 12, fontWeight: 700, color: '#dc2626' }}>Incidencias: </span>
                            <span style={{ fontSize: 13, color: '#334155' }}>{handover.incidents}</span>
                        </div>
                    )}
                </div>
            ) : (
                <div style={{ padding: '16px 20px' }}>
                    {!allOpsSigned && (
                        <div style={{
                            padding: '12px 16px', borderRadius: 8, marginBottom: 16,
                            background: '#fef3c7', border: '1px solid #fde68a',
                            display: 'flex', alignItems: 'center', gap: 10
                        }}>
                            <AlertTriangle size={18} color="#d97706" />
                            <span style={{ fontSize: 13, fontWeight: 600, color: '#92400e' }}>
                                {waitingLabel} ({signedCount}/{outOps.length})
                            </span>
                        </div>
                    )}

                    {/* Checklist */}
                    {showsProductionSummary && (
                        <ProductionShiftSummary
                            summary={productionSummary}
                            selectedBatches={summarySelections}
                            onToggleBatch={toggleSummaryBatch}
                            loading={summaryLoading}
                            error={summaryError}
                        />
                    )}

                    {visibleChecklists && visibleChecklists.length > 0 && (
                        <div style={{ marginBottom: 16 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: '#475569', marginBottom: 8 }}>
                                <CheckSquare size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 6 }} />
                                Checklist de Entrega
                            </div>
                            {visibleChecklists.map(c => (
                                <div key={c.id} style={{ marginBottom: 8 }}>
                                    {c.fieldType === 'boolean' ? (
                                        <ChecklistButton
                                            checked={Boolean(checkValues[c.id])}
                                            label={c.label}
                                            onClick={() => setCheckValues(prev => ({ ...prev, [c.id]: !prev[c.id] }))}
                                        />
                                    ) : (
                                        <div>
                                            <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 4 }}>{c.label}</div>
                                            <input
                                                type="text"
                                                value={checkValues[c.id] || ''}
                                                onChange={e => setCheckValues(prev => ({ ...prev, [c.id]: e.target.value }))}
                                                style={{
                                                    width: '100%', padding: '8px 12px', borderRadius: 8,
                                                    border: '1px solid #e2e8f0', fontSize: 13, boxSizing: 'border-box'
                                                }}
                                            />
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}

                    <NoveltyQuestion
                        value={hasNovelty}
                        detail={noveltyDetail}
                        onChange={setHasNovelty}
                        onDetailChange={setNoveltyDetail}
                    />

                    {/* PIN + authorize */}
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#475569', marginBottom: 8 }}>
                        <Lock size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 6 }} />
                        {leaderPinLabel}
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <input
                            type="password"
                            inputMode="numeric"
                            maxLength={4}
                            placeholder="PIN"
                            value={pin}
                            onChange={e => { setPin(e.target.value.replace(/\D/g, '').slice(0, 4)); setError(''); }}
                            onKeyDown={e => e.key === 'Enter' && handleAuthorize()}
                            style={{
                                flex: 1, padding: '12px 16px', borderRadius: 8,
                                border: `2px solid ${error ? '#fca5a5' : '#e2e8f0'}`,
                                fontSize: 20, fontWeight: 700, textAlign: 'center',
                                letterSpacing: 8, fontFamily: 'monospace'
                            }}
                        />
                        <button
                            onClick={handleAuthorize}
                            disabled={submitting || pin.length !== 4 || !allOpsSigned || summaryBlocked}
                            style={{
                                padding: '12px 24px', borderRadius: 8, border: 'none',
                                background: (allOpsSigned && pin.length === 4 && !summaryBlocked) ? '#7c3aed' : '#94a3b8',
                                color: '#fff', fontWeight: 800, fontSize: 14, cursor: 'pointer',
                                opacity: submitting ? 0.6 : 1
                            }}
                        >
                            {submitting ? '...' : 'Autorizar'}
                        </button>
                    </div>

                    {error && (
                        <div style={{
                            marginTop: 8, padding: '8px 12px', borderRadius: 8,
                            background: '#fef2f2', color: '#dc2626', fontSize: 13,
                            fontWeight: 600, textAlign: 'center'
                        }}>{error}</div>
                    )}
                </div>
            )}
        </div>
    );
}

function isProductionLotsChecklistItem(label = '') {
    const normalized = String(label)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
    return (normalized.includes('lote') || normalized.includes('bache')) &&
        (normalized.includes('produc') || normalized.includes('turno') || normalized.includes('empaque') || normalized.includes('sirope'));
}

function hasNoveltyChecklistItem(checklist) {
    return Array.isArray(checklist) && checklist.some(item => item?.fieldType === 'novelty' || item?.id === 'SHIFT_NOVELTY');
}

function getBatchReviewKey(batch) {
    return batch?.id || batch?.batchNumber || '';
}

function isSelectionChecked(value) {
    if (!value) return false;
    if (typeof value === 'object') return value.selected !== false;
    return Boolean(value);
}

function buildSummaryForSave(summary, selections) {
    return {
        ...summary,
        reviewSelections: selections || {},
        reviewedAt: new Date().toISOString()
    };
}

function NoveltyQuestion({ value, detail, onChange, onDetailChange }) {
    const hasNovelty = value === 'SI';

    return (
        <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#475569', marginBottom: 8 }}>
                ¿Hubo novedades o incidencias?
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: hasNovelty ? 10 : 0 }}>
                {['NO', 'SI'].map(option => {
                    const active = value === option;
                    return (
                        <button
                            key={option}
                            type="button"
                            onClick={() => {
                                onChange(option);
                                if (option === 'NO') onDetailChange('');
                            }}
                            style={{
                                padding: '10px 12px',
                                borderRadius: 8,
                                border: `2px solid ${active ? (option === 'SI' ? '#f97316' : '#16a34a') : '#e2e8f0'}`,
                                background: active ? (option === 'SI' ? '#fff7ed' : '#f0fdf4') : '#fff',
                                color: active ? (option === 'SI' ? '#c2410c' : '#166534') : '#475569',
                                fontSize: 13,
                                fontWeight: 900,
                                cursor: 'pointer'
                            }}
                        >
                            {option === 'SI' ? 'Sí' : 'No'}
                        </button>
                    );
                })}
            </div>
            {hasNovelty && (
                <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 4 }}>
                        ¿Cuál fue la novedad?
                    </div>
                    <textarea
                        value={detail}
                        onChange={e => onDetailChange(e.target.value)}
                        rows={3}
                        placeholder="Describe la novedad del relevo..."
                        style={{
                            width: '100%',
                            padding: '8px 12px',
                            borderRadius: 8,
                            border: '1px solid #e2e8f0',
                            fontSize: 13,
                            resize: 'vertical',
                            boxSizing: 'border-box'
                        }}
                    />
                </div>
            )}
        </div>
    );
}

function ProductionShiftSummary({ summary, loading, error, selectedBatches = null, onToggleBatch = null }) {
    const totals = summary?.totals || {};
    const labels = summary?.labels || {};
    const reviewSelections = selectedBatches || summary?.reviewSelections || {};
    const isProductionReview = summary?.area === 'PRODUCCION';
    const interactive = Boolean(onToggleBatch);

    return (
        <div style={{
            marginBottom: 16,
            border: '2px solid #bfdbfe',
            borderRadius: 8,
            background: '#f8fbff',
            overflow: 'hidden'
        }}>
            <div style={{
                padding: '12px 14px',
                background: '#dbeafe',
                borderBottom: '1px solid #bfdbfe',
                display: 'flex',
                justifyContent: 'space-between',
                gap: 12,
                flexWrap: 'wrap'
            }}>
                <div>
                    <div style={{ fontSize: 14, fontWeight: 900, color: '#1d4ed8' }}>
                        {summary?.title || 'Baches del turno'}
                    </div>
                    <div style={{ fontSize: 12, color: '#475569', marginTop: 2, fontWeight: 700 }}>
                        {summary?.window
                            ? `Turno ${summary.outgoingShift} | ${summary.window.startLabel} a ${summary.window.endLabel}`
                            : 'Resumen automático de producción'}
                    </div>
                </div>
                {summary && (
                    <div style={{
                        display: 'flex',
                        gap: 6,
                        alignItems: 'center',
                        fontSize: 12,
                        fontWeight: 900,
                        color: '#1e40af'
                    }}>
                        {isProductionReview && <span style={summaryPillStyle}>Actuales: {totals.currentInProcess || 0}</span>}
                        <span style={summaryPillStyle}>Terminados: {totals.completedDuringShift || 0}</span>
                        <span style={summaryPillStyle}>
                            {isProductionReview ? `Faltan: ${totals.pendingToProduce || 0}` : `Quedan: ${totals.remainingForNextShift || 0}`}
                        </span>
                    </div>
                )}
            </div>

            <div style={{ padding: 14 }}>
                {loading && (
                    <div style={{ fontSize: 13, color: '#64748b', fontWeight: 700 }}>
                        Cargando lotes del turno...
                    </div>
                )}
                {error && !loading && (
                    <div style={{ fontSize: 13, color: '#dc2626', fontWeight: 800 }}>
                        {error}
                    </div>
                )}
                {!loading && !error && summary && isProductionReview && (
                    <div style={{ display: 'grid', gap: 14 }}>
                        <BatchSection
                            title={labels.receivedTitle || 'Lotes actuales de perlas en producción'}
                            emptyText="No hay lotes de perlas en fabricación en este momento."
                            batches={summary.currentInProcess || summary.remainingForNextShift || []}
                            renderLine={(batch) => `${batch.batchNumber} | va en ${batch.progress}%`}
                            sectionKey="currentInProcess"
                            selections={reviewSelections.currentInProcess}
                            onToggleBatch={onToggleBatch}
                            interactive={interactive}
                        />
                        <BatchSection
                            title={labels.completedTitle || 'Lotes producidos durante el turno'}
                            emptyText="No hay lotes de perlas terminados en este turno."
                            batches={summary.completedDuringShift || []}
                            numbered
                            renderLine={(batch) => `${batch.batchNumber} | ${labels.completedVerb || 'terminó'} ${batch.time || '--:--'} | 100%`}
                            sectionKey="completedDuringShift"
                            selections={reviewSelections.completedDuringShift}
                            onToggleBatch={onToggleBatch}
                            interactive={interactive}
                        />
                        <BatchSection
                            title={labels.pendingTitle || 'Lotes que faltan por producir'}
                            emptyText="No hay lotes pendientes de iniciar en este turno."
                            batches={summary.pendingToProduce || []}
                            renderLine={(batch) => `${batch.batchNumber} | pendiente de iniciar`}
                            sectionKey="pendingToProduce"
                            selections={reviewSelections.pendingToProduce}
                            onToggleBatch={onToggleBatch}
                            interactive={interactive}
                        />
                    </div>
                )}
                {!loading && !error && summary && !isProductionReview && (
                    <div style={{ display: 'grid', gap: 14 }}>
                        <BatchSection
                            title={labels.receivedTitle || 'Recibidos en proceso'}
                            emptyText="No se recibieron baches en proceso."
                            batches={summary.receivedInProcess || []}
                            renderLine={(batch) => `${batch.batchNumber} | inició turno en ${batch.progress}%`}
                            sectionKey="receivedInProcess"
                            selections={reviewSelections.receivedInProcess}
                            onToggleBatch={onToggleBatch}
                            interactive={interactive}
                        />
                        <BatchSection
                            title={labels.completedTitle || 'Terminados durante el turno'}
                            emptyText="No hay baches terminados en este turno."
                            batches={summary.completedDuringShift || []}
                            numbered
                            renderLine={(batch) => `${batch.batchNumber} | ${labels.completedVerb || 'terminó'} ${batch.time || '--:--'} | 100%`}
                            sectionKey="completedDuringShift"
                            selections={reviewSelections.completedDuringShift}
                            onToggleBatch={onToggleBatch}
                            interactive={interactive}
                        />
                        <BatchSection
                            title={labels.remainingTitle || 'Quedan para el siguiente turno'}
                            emptyText="No quedan baches abiertos para el siguiente turno."
                            batches={summary.remainingForNextShift || []}
                            renderLine={(batch) => `${batch.batchNumber} | queda en ${batch.progress}%`}
                            sectionKey="remainingForNextShift"
                            selections={reviewSelections.remainingForNextShift}
                            onToggleBatch={onToggleBatch}
                            interactive={interactive}
                        />
                    </div>
                )}
            </div>
        </div>
    );
}

const summaryPillStyle = {
    padding: '5px 8px',
    borderRadius: 8,
    background: '#eff6ff',
    border: '1px solid #93c5fd'
};

function BatchSection({
    title,
    emptyText,
    batches,
    renderLine,
    numbered = false,
    sectionKey,
    selections = {},
    onToggleBatch,
    interactive = false
}) {
    return (
        <div>
            <div style={{ fontSize: 12, color: '#334155', fontWeight: 900, marginBottom: 6 }}>
                {title}
            </div>
            {batches.length === 0 ? (
                <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 700 }}>
                    {emptyText}
                </div>
            ) : (
                <div style={{ display: 'grid', gap: 6 }}>
                    {batches.map((batch, index) => {
                        const key = getBatchReviewKey(batch);
                        const selection = selections?.[key];
                        const checked = isSelectionChecked(selection);
                        const checkedBy = typeof selection === 'object' ? selection.userName : null;
                        const content = (
                            <>
                                <span style={{ color: checked ? '#15803d' : '#2563eb', minWidth: numbered ? 18 : 8 }}>
                                    {checked ? '✓' : (numbered ? `${index + 1}.` : '-')}
                                </span>
                                <div style={{ flex: 1 }}>
                                    <div>{renderLine(batch)}</div>
                                    {batch.currentStep && (
                                        <div style={{ fontSize: 11, color: checked ? '#166534' : '#64748b', marginTop: 2, fontWeight: 700 }}>
                                            Etapa actual: {batch.currentStep}
                                        </div>
                                    )}
                                    {checked && (
                                        <div style={{ fontSize: 11, color: '#15803d', marginTop: 2, fontWeight: 900 }}>
                                            Revisado en este relevo{checkedBy ? ` por ${checkedBy}` : ''}
                                        </div>
                                    )}
                                </div>
                            </>
                        );
                        const commonStyle = {
                            display: 'flex',
                            gap: 8,
                            alignItems: 'flex-start',
                            padding: '8px 10px',
                            borderRadius: 8,
                            background: checked ? '#f0fdf4' : '#fff',
                            border: `1px solid ${checked ? '#86efac' : '#dbeafe'}`,
                            fontSize: 13,
                            color: checked ? '#166534' : '#0f172a',
                            fontWeight: 800,
                            textAlign: 'left'
                        };

                        if (interactive) {
                            return (
                                <button
                                    key={key || `${title}-${index}`}
                                    type="button"
                                    onClick={() => onToggleBatch(sectionKey, batch)}
                                    style={{
                                        ...commonStyle,
                                        width: '100%',
                                        cursor: 'pointer'
                                    }}
                                >
                                    {content}
                                </button>
                            );
                        }

                        return (
                            <div key={key || `${title}-${index}`} style={commonStyle}>
                                {content}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

function ChecklistButton({ checked, label, onClick }) {
    return (
        <button
            type="button"
            onClick={onClick}
            style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 12px',
                borderRadius: 8,
                border: `2px solid ${checked ? '#86efac' : '#e2e8f0'}`,
                background: checked ? '#f0fdf4' : '#fff',
                cursor: 'pointer',
                textAlign: 'left',
                color: checked ? '#166534' : '#475569',
                fontSize: 13,
                fontWeight: 800
            }}
        >
            <span style={{
                width: 22,
                height: 22,
                borderRadius: 8,
                border: `2px solid ${checked ? '#16a34a' : '#cbd5e1'}`,
                background: checked ? '#16a34a' : '#fff',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 950,
                flexShrink: 0
            }}>
                {checked ? '✓' : ''}
            </span>
            <span>{label}</span>
        </button>
    );
}

function ChecklistSummary({ items }) {
    return (
        <div style={{ display: 'grid', gap: 6 }}>
            {items.map((item, i) => {
                if (item.fieldType === 'production_summary') {
                    return (
                        <ProductionShiftSummary
                            key={item.id || i}
                            summary={item.value}
                            loading={false}
                            error=""
                        />
                    );
                }
                if (item.fieldType === 'novelty') {
                    const hasNovelty = Boolean(item.value?.hasNovelty);
                    return (
                        <div key={item.id || i} style={{
                            display: 'grid',
                            gap: 4,
                            padding: '8px 10px',
                            borderRadius: 8,
                            background: hasNovelty ? '#fff7ed' : '#f0fdf4',
                            border: `1px solid ${hasNovelty ? '#fed7aa' : '#bbf7d0'}`,
                            color: hasNovelty ? '#c2410c' : '#166534',
                            fontSize: 12,
                            fontWeight: 800
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span>{hasNovelty ? '!' : '✓'}</span>
                                <span style={{ flex: 1 }}>{item.label}</span>
                                <span>{hasNovelty ? 'Sí' : 'No'}</span>
                            </div>
                            {hasNovelty && item.value?.detail && (
                                <div style={{ color: '#7c2d12', fontWeight: 700, paddingLeft: 20 }}>
                                    {item.value.detail}
                                </div>
                            )}
                        </div>
                    );
                }
                const isBoolean = item.fieldType === 'boolean';
                const checked = Boolean(item.value);
                return (
                    <div key={item.id || i} style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '8px 10px',
                        borderRadius: 8,
                        background: !isBoolean || checked ? '#f0fdf4' : '#f8fafc',
                        border: `1px solid ${!isBoolean || checked ? '#bbf7d0' : '#e2e8f0'}`,
                        color: !isBoolean || checked ? '#166534' : '#64748b',
                        fontSize: 12,
                        fontWeight: 800
                    }}>
                        <span>{isBoolean ? (checked ? '✓' : '—') : '•'}</span>
                        <span style={{ flex: 1 }}>{item.label}</span>
                        {!isBoolean && (
                            <span style={{ color: '#475569', fontWeight: 700 }}>{item.value || '—'}</span>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
