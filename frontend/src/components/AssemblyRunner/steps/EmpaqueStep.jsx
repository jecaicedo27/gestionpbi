import React from 'react';

/**
 * EmpaqueStep – Tablet-optimized Empaque QC step
 *
 * Redesigned for full-width tablet layout:
 * - Compact gradient header with product + lot + inline stats
 * - Large touch-friendly defective counter
 * - Grid-based defect evidence cards
 * - Clear approval summary
 */
const EmpaqueStep = ({
    stepData,
    empaqueDefective = 0,
    onEmpaqueDefectiveChange,
    empaquePhotoUrls = [],
    onEmpaquePhotoChange,
    empaqueDefectReasons = [],
    onEmpaqueDefectReasonChange,
    carriots = [],
    onConfirmCarrito,
}) => {
    const noteData = stepData;
    const empData = noteData.empaqueData || {};
    const empRef = noteData.processParameters?.empaqueRef || {};

    const fmtTime = (iso) => {
        try { return new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: true }); }
        catch { return ''; }
    };

    let plannedQty = empData.planned_qty ?? empRef.planned_qty ?? null;
    let conteoQty = empData.conteo_qty ?? empRef.conteo_qty ?? null;

    if (plannedQty === null && noteData.items?.length > 0) {
        const containerItem = noteData.items.find(i =>
            /TARRO|FRASCO|BOTELLA|ENVASE/i.test(i.component?.name || '')
        );
        if (containerItem) {
            plannedQty = containerItem.plannedQuantity || null;
            if (conteoQty === null && containerItem.actualQuantity) {
                conteoQty = containerItem.actualQuantity;
            }
        }
    }
    if (plannedQty === null) plannedQty = noteData.targetQuantity || null;

    const defectivos = parseInt(empaqueDefective || 0, 10);
    const aprobados = conteoQty !== null ? Math.max(0, conteoQty - defectivos) : null;
    const needsPhoto = defectivos > 0 && empaquePhotoUrls.filter(Boolean).length < defectivos;
    const pctAprobados = conteoQty > 0 && aprobados !== null ? Math.round((aprobados / conteoQty) * 100) : 100;

    const receivedCarriots = carriots.filter(c => c.receivedAt);
    const pendingCarriots = carriots.filter(c => !c.receivedAt);
    const totalCarriotUnits = carriots.reduce((s, c) => s + (c.qty || 0), 0);
    const receivedQty = receivedCarriots.reduce((s, c) => s + (c.qty || 0), 0);

    const pctColor = pctAprobados === 100 ? '#34d399' : pctAprobados > 80 ? '#fbbf24' : '#f87171';

    return (
        <div style={{
            display: 'flex', flexDirection: 'column', gap: '16px',
            maxWidth: '900px', width: '100%', margin: '0 auto',
            padding: '16px 16px 140px', boxSizing: 'border-box',
        }}>

            {/* ── CARRIOTS ── */}
            {carriots.length > 0 && (
                <div style={{
                    background: '#fff', borderRadius: '20px', overflow: 'hidden',
                    boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
                    border: pendingCarriots.length > 0 ? '2px solid #fed7aa' : '2px solid #a7f3d0',
                }}>
                    <div style={{
                        background: pendingCarriots.length > 0
                            ? 'linear-gradient(135deg, #f97316, #f59e0b)'
                            : 'linear-gradient(135deg, #10b981, #14b8a6)',
                        padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <span style={{ fontSize: '24px' }}>🛒</span>
                            <div>
                                <div style={{ fontWeight: 900, color: '#fff', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                                    Carriots de Producción
                                </div>
                                <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: '11px' }}>
                                    {receivedCarriots.length}/{carriots.length} recibidos · {totalCarriotUnits} uds
                                </div>
                            </div>
                        </div>
                        <span style={{
                            background: 'rgba(255,255,255,0.2)', color: '#fff', fontSize: '11px', fontWeight: 800,
                            padding: '4px 12px', borderRadius: '20px',
                        }}>
                            {pendingCarriots.length > 0 ? `${pendingCarriots.length} en camino` : '✅ Todos recibidos'}
                        </span>
                    </div>
                    <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {[...carriots].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)).map(c => (
                            <div key={c.id} style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                borderRadius: '12px', padding: '12px 16px',
                                background: c.receivedAt ? '#ecfdf5' : '#fff7ed',
                                border: c.receivedAt ? '1px solid #a7f3d0' : '1px solid #fed7aa',
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    <span style={{ fontSize: '20px' }}>{c.receivedAt ? '✅' : '🛒'}</span>
                                    <div>
                                        <div style={{ fontWeight: 700, color: '#1e293b', fontSize: '13px' }}>
                                            Carrito #{c.carritoNum} · <span style={{ color: c.receivedAt ? '#059669' : '#ea580c' }}>{c.qty} uds</span>
                                        </div>
                                        <div style={{ color: '#94a3b8', fontSize: '11px' }}>
                                            {c.productName} · Enviado {fmtTime(c.timestamp)}
                                            {c.receivedAt && ` · Recibido ${fmtTime(c.receivedAt)}`}
                                        </div>
                                    </div>
                                </div>
                                {!c.receivedAt && onConfirmCarrito && (
                                    <button onClick={() => onConfirmCarrito(c.id)} style={{
                                        padding: '8px 16px', background: '#10b981', color: '#fff',
                                        fontSize: '12px', fontWeight: 800, borderRadius: '12px', border: 'none',
                                        cursor: 'pointer', boxShadow: '0 2px 8px rgba(16,185,129,0.3)',
                                    }}>
                                        ✅ Recibir
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* ── COMPACT HEADER + STATS ── */}
            <div style={{
                borderRadius: '16px', overflow: 'hidden',
                background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 50%, #9333ea 100%)',
                boxShadow: '0 4px 16px rgba(99,102,241,0.25)',
            }}>
                {/* Product + lot row */}
                <div style={{ padding: '12px 16px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: 0 }}>
                        <span style={{ fontSize: '18px' }}>📦</span>
                        <div style={{ minWidth: 0 }}>
                            <div style={{ color: '#fff', fontWeight: 800, fontSize: '15px', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {noteData.product?.name || noteData.stageName}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '3px' }}>
                                <span style={{
                                    background: '#10b981', borderRadius: '6px', padding: '2px 8px',
                                    color: '#fff', fontWeight: 800, fontSize: '11px',
                                }}>
                                    🏷️ {noteData.productionBatch?.batchNumber}
                                </span>
                                <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '10px' }}>Empaque · QC</span>
                            </div>
                        </div>
                    </div>
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: '5px',
                        background: 'rgba(255,255,255,0.15)', borderRadius: '14px', padding: '4px 10px', flexShrink: 0,
                    }}>
                        <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#34d399' }} />
                        <span style={{ color: '#fff', fontSize: '10px', fontWeight: 600 }}>En Proceso</span>
                    </div>
                </div>

                {/* 5 stats — compact */}
                <div style={{
                    display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)',
                    borderTop: '1px solid rgba(255,255,255,0.1)',
                }}>
                    {[
                        { label: 'Planificados', value: plannedQty, color: 'rgba(255,255,255,0.6)' },
                        { label: 'Producidos', value: conteoQty, color: '#67e8f9' },
                        { label: 'Recibidos', value: carriots.length > 0 ? receivedQty : conteoQty, color: '#c4b5fd' },
                        { label: 'Buen Estado', value: aprobados, color: aprobados === conteoQty ? '#6ee7b7' : '#fde68a' },
                        { label: 'No Conformes', value: defectivos, color: defectivos === 0 ? '#6ee7b7' : '#fca5a5' },
                    ].map(({ label, value, color }, idx) => (
                        <div key={label} style={{
                            padding: '8px 4px', textAlign: 'center',
                            borderLeft: idx > 0 ? '1px solid rgba(255,255,255,0.08)' : 'none',
                        }}>
                            <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '8px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
                            <div style={{ fontSize: '20px', fontWeight: 900, color, lineHeight: 1.3 }}>{value?.toLocaleString?.('es-CO') ?? value ?? '—'}</div>
                        </div>
                    ))}
                </div>

                {/* Progress bar */}
                <div style={{ padding: '0 16px 8px' }}>
                    <div style={{ height: '4px', background: 'rgba(255,255,255,0.08)', borderRadius: '4px', overflow: 'hidden' }}>
                        <div style={{
                            height: '100%', borderRadius: '4px', transition: 'width 0.5s ease',
                            width: `${pctAprobados}%`, background: pctColor,
                        }} />
                    </div>
                </div>
            </div>

            {/* ── DEFECTIVE COUNTER (compact inline) ── */}
            <div style={{
                background: '#fff', borderRadius: '14px', padding: '12px 16px',
                boxShadow: '0 2px 10px rgba(0,0,0,0.05)', border: '1px solid #f1f5f9',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
            }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: '#334155' }}>No Conformes</div>
                    <div style={{ fontSize: '11px', color: '#94a3b8' }}>Sellado, etiqueta o formulación</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                    <button
                        onClick={() => onEmpaqueDefectiveChange && onEmpaqueDefectiveChange(Math.max(0, defectivos - 1))}
                        style={{
                            width: '40px', height: '40px', borderRadius: '12px', border: '2px solid #e2e8f0',
                            background: '#f8fafc', color: '#475569', fontSize: '20px', fontWeight: 700,
                            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                        }}
                    >−</button>
                    <input
                        type="number"
                        min="0"
                        max={conteoQty ?? 9999}
                        value={empaqueDefective}
                        onChange={e => onEmpaqueDefectiveChange && onEmpaqueDefectiveChange(Math.max(0, parseInt(e.target.value || 0, 10)))}
                        style={{
                            width: '70px', textAlign: 'center', fontSize: '28px', fontWeight: 900,
                            color: '#1e293b', padding: '4px 0', borderRadius: '12px',
                            border: '2px solid #e2e8f0', background: '#f8fafc', outline: 'none',
                        }}
                    />
                    <button
                        onClick={() => onEmpaqueDefectiveChange && onEmpaqueDefectiveChange(Math.min(conteoQty ?? 9999, defectivos + 1))}
                        style={{
                            width: '40px', height: '40px', borderRadius: '12px', border: '2px solid #e2e8f0',
                            background: '#f8fafc', color: '#475569', fontSize: '20px', fontWeight: 700,
                            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                        }}
                    >+</button>
                </div>
                <span style={{
                    background: defectivos === 0 ? '#d1fae5' : '#fee2e2',
                    color: defectivos === 0 ? '#059669' : '#dc2626',
                    fontSize: '11px', fontWeight: 700, padding: '4px 10px', borderRadius: '14px', flexShrink: 0,
                }}>
                    {defectivos === 0 ? '✓ OK' : `⚠ ${defectivos}`}
                </span>
            </div>

            {/* ── PER-TARRO EVIDENCE ── */}
            {defectivos > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '0 4px' }}>
                        <span style={{ fontSize: '18px' }}>📸</span>
                        <div>
                            <div style={{ fontSize: '14px', fontWeight: 700, color: '#334155' }}>Evidencia Fotográfica — 1 foto por defectuoso</div>
                            <div style={{ fontSize: '12px', color: '#94a3b8' }}>{empaquePhotoUrls.filter(Boolean).length} de {defectivos} fotos</div>
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
                        {Array.from({ length: defectivos }).map((_, i) => {
                            const photoUrl = empaquePhotoUrls[i] || '';
                            const isUploaded = !!photoUrl;
                            return (
                                <div key={i} style={{
                                    background: '#fff', borderRadius: '16px', padding: '16px',
                                    boxShadow: '0 2px 12px rgba(0,0,0,0.05)',
                                    border: isUploaded ? '2px solid #a7f3d0' : '2px solid #fde68a',
                                    transition: 'border-color 0.2s',
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                                        <span style={{ fontSize: '11px', fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                                            Defectuoso #{i + 1}
                                        </span>
                                        <span style={{
                                            fontSize: '10px', fontWeight: 700, padding: '3px 10px', borderRadius: '10px',
                                            background: isUploaded ? '#d1fae5' : '#fef3c7',
                                            color: isUploaded ? '#059669' : '#d97706',
                                        }}>
                                            {isUploaded ? '✓ Foto cargada' : '📷 Pendiente'}
                                        </span>
                                    </div>

                                    {photoUrl && (
                                        <img src={photoUrl} alt={`Defectuoso #${i + 1}`} style={{
                                            width: '100%', maxHeight: '140px', objectFit: 'cover',
                                            borderRadius: '12px', border: '1px solid #a7f3d0', marginBottom: '12px',
                                        }} />
                                    )}

                                    {/* Cause */}
                                    <div style={{ marginBottom: '10px' }}>
                                        <label style={{ fontSize: '10px', fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: '4px' }}>
                                            Causa
                                        </label>
                                        <select
                                            value={empaqueDefectReasons[i]?.cause || ''}
                                            onChange={e => onEmpaqueDefectReasonChange && onEmpaqueDefectReasonChange(i, 'cause', e.target.value)}
                                            style={{
                                                width: '100%', padding: '10px 12px', borderRadius: '12px',
                                                border: '2px solid #e2e8f0', background: '#fff',
                                                fontSize: '13px', fontWeight: 600, color: '#334155', outline: 'none',
                                            }}
                                        >
                                            <option value="">— Seleccionar causa —</option>
                                            <option value="mal_sellado">Mal Sellado</option>
                                            <option value="tarro_deforme">Tarro Deforme</option>
                                            <option value="tarro_danado">Tarro se Dañó</option>
                                            <option value="cuerpo_extrano">Cuerpo Extraño</option>
                                            <option value="medio_lleno">Medio Lleno</option>
                                        </select>
                                    </div>

                                    {/* Description */}
                                    <div style={{ marginBottom: '10px' }}>
                                        <label style={{ fontSize: '10px', fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: '4px' }}>
                                            Descripción (opcional)
                                        </label>
                                        <input
                                            type="text"
                                            value={empaqueDefectReasons[i]?.description || ''}
                                            onChange={e => onEmpaqueDefectReasonChange && onEmpaqueDefectReasonChange(i, 'description', e.target.value)}
                                            placeholder="Detalle del defecto..."
                                            style={{
                                                width: '100%', padding: '8px 12px', borderRadius: '12px',
                                                border: '2px solid #e2e8f0', background: '#fff',
                                                fontSize: '13px', color: '#334155', outline: 'none',
                                                boxSizing: 'border-box',
                                            }}
                                        />
                                    </div>

                                    {/* Camera */}
                                    <label style={{
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                                        width: '100%', padding: '12px 0', borderRadius: '12px', cursor: 'pointer',
                                        border: isUploaded ? '2px dashed #a7f3d0' : '2px dashed #fde68a',
                                        background: isUploaded ? '#ecfdf5' : '#fffbeb',
                                        color: isUploaded ? '#059669' : '#d97706',
                                        fontWeight: 600, fontSize: '13px', transition: 'all 0.15s',
                                        boxSizing: 'border-box',
                                    }}>
                                        <span style={{ fontSize: '18px' }}>{isUploaded ? '🔄' : '📷'}</span>
                                        <span>{isUploaded ? 'Cambiar foto' : 'Tomar foto'}</span>
                                        <input
                                            type="file"
                                            accept="image/*"
                                            capture="environment"
                                            style={{ display: 'none' }}
                                            onChange={async (e) => {
                                                const file = e.target.files?.[0];
                                                if (!file) return;
                                                const localUrl = URL.createObjectURL(file);
                                                onEmpaquePhotoChange && onEmpaquePhotoChange(i, localUrl);
                                                try {
                                                    const fd = new FormData();
                                                    fd.append('photo', file);
                                                    fd.append('noteId', noteData?.id || '');
                                                    fd.append('context', `empaque_defecto_${i + 1}`);
                                                    const res = await fetch('/api/assembly-notes/upload-photo', { method: 'POST', body: fd });
                                                    const data = await res.json();
                                                    if (data.url) onEmpaquePhotoChange && onEmpaquePhotoChange(i, data.url);
                                                } catch (err) {
                                                    console.warn('Upload failed, using local preview:', err);
                                                }
                                            }}
                                        />
                                    </label>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* ── BOTTOM SUMMARY ── */}
            {aprobados !== null && (
                <div style={{
                    borderRadius: '16px', padding: '16px 20px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
                    fontSize: '14px', fontWeight: 700,
                    background: aprobados === conteoQty ? '#ecfdf5' : '#fffbeb',
                    border: aprobados === conteoQty ? '1px solid #a7f3d0' : '1px solid #fde68a',
                    color: aprobados === conteoQty ? '#065f46' : '#92400e',
                }}>
                    {aprobados === conteoQty
                        ? <><span>✅</span><span>Todos los <strong>{aprobados}</strong> tarros aprobados — se registrarán en Siigo al completar</span></>
                        : <><span>⚠️</span><span><strong>{aprobados}</strong> aprobados · <strong style={{ color: '#dc2626' }}>{defectivos} defectuosos</strong> — Siigo generará un ajuste{needsPhoto ? ' (falta foto)' : ''}</span></>
                    }
                </div>
            )}
        </div>
    );
};

export default EmpaqueStep;
