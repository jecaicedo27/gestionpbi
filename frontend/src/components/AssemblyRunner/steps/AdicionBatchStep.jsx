import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { CheckCircle, Play } from 'lucide-react';

const ADDITION_SEQUENCE = [
    { keyword: 'ACIDO', label: 'ÁCIDO CÍTRICO', color: 'orange', gradient: 'from-orange-500 to-amber-400' },
    { keyword: 'AZUCAR', label: 'AZÚCAR', color: 'amber', gradient: 'from-amber-500 to-yellow-400' },
    { keyword: 'GLUCOSA', label: 'GLUCOSA', color: 'purple', gradient: 'from-purple-600 to-violet-500' },
    { keyword: 'FRUCTOSA', label: 'FRUCTOSA', color: 'purple', gradient: 'from-purple-600 to-violet-500' },
];

const matchIngredient = (name) => {
    const upper = (name || '').toUpperCase();
    for (const seq of ADDITION_SEQUENCE) {
        if (seq.keyword === 'AZUCAR' && (upper.includes('AZUCAR') || upper.includes('AZÚCAR'))) return seq;
        if (seq.keyword === 'ACIDO' && (upper.includes('ACIDO') || upper.includes('ÁCIDO'))) return seq;
        if (upper.includes(seq.keyword)) return seq;
    }
    return null;
};

const fmtQty = (q) => `${q.toLocaleString()} g`;

const AdicionBatchStep = ({ stepData: items, note, onAdicionChange }) => {
    const sortedItems = useMemo(() => {
        // Filtrar AGUA (se llena en tanque, no se adiciona a la olla).
        const filtered = [...items].filter(i => !(i.component?.name || '').toUpperCase().includes('AGUA'));

        // Si los items tienen displayOrder definido (plantillas de PROTECCION,
        // formulas Geniality, etc.), respetamos ese orden — viene de la
        // fórmula del producto.
        const allHaveDisplayOrder = filtered.every(i => i.displayOrder != null);
        if (allHaveDisplayOrder) {
            return filtered.sort((a, b) => (a.displayOrder ?? 999) - (b.displayOrder ?? 999));
        }

        // Fallback: orden hardcoded para Azúcar Invertida (TMPL-AZINV-001).
        const order = ['ACIDO', 'AZUCAR', 'GLUCOSA', 'FRUCTOSA'];
        return filtered.sort((a, b) => {
            const aMatch = matchIngredient(a.component?.name);
            const bMatch = matchIngredient(b.component?.name);
            const aIdx = aMatch ? order.indexOf(aMatch.keyword) : 99;
            const bIdx = bMatch ? order.indexOf(bMatch.keyword) : 99;
            return aIdx - bIdx;
        });
    }, [items]);

    const savedState = note?.processParameters?.adicion_state || {};

    // Insumos intermedios (BASE SIROPE, BASE LIQUIPOPS, ALGINATO PREPARADO,
    // COMPUESTO, etc.) ya están físicamente en la olla porque vienen del stage
    // anterior del mismo bache. Se marcan como adicionados automáticamente.
    const isIntermediateName = (name) => {
        const n = (name || '').toUpperCase();
        return n.startsWith('BASE ') || n.startsWith('ALGINATO PREPARADO') ||
               n.startsWith('COMPUESTO') || n.startsWith('PROTECCION') ||
               n.startsWith('PREMEZCLA') || n.startsWith('PROTONICO') ||
               n.startsWith('SABORIZACION');
    };

    const [additions, setAdditions] = useState(() => {
        const restored = {};
        sortedItems.forEach(item => {
            const saved = savedState[item.id];
            if (saved) {
                restored[item.id] = {
                    addedAt: saved.addedAt || null,
                    confirmed: !!saved.confirmed,
                };
            } else if (isIntermediateName(item.component?.name)) {
                // Auto-marca insumos intermedios como ya adicionados (estaban
                // en la olla antes de empezar este stage).
                restored[item.id] = {
                    addedAt: new Date().toISOString(),
                    confirmed: true,
                };
            }
        });
        return restored;
    });

    const persist = useCallback(async (newAdditions) => {
        if (!note?.id) return;
        const serialized = {};
        Object.entries(newAdditions).forEach(([id, add]) => {
            serialized[id] = {
                addedAt: add.addedAt || null,
                confirmed: !!add.confirmed,
            };
        });
        try {
            await fetch(`/api/assembly-notes/${note.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
                body: JSON.stringify({
                    processParameters: { ...note.processParameters, adicion_state: serialized }
                })
            });
        } catch (e) {}
    }, [note?.id, note?.processParameters]);

    const getNextAddableIndex = useCallback(() => {
        for (let i = 0; i < sortedItems.length; i++) {
            const item = sortedItems[i];
            const add = additions[item.id];
            if (!add?.confirmed) return i;
        }
        return -1;
    }, [sortedItems, additions]);

    const handleConfirm = (item) => {
        const updated = {
            ...additions,
            [item.id]: { addedAt: new Date().toISOString(), confirmed: true }
        };
        setAdditions(updated);
        persist(updated);
        onAdicionChange?.(updated);
    };

    const completedCount = sortedItems.filter(item => additions[item.id]?.confirmed).length;
    const allConfirmed = completedCount === sortedItems.length;
    const nextIdx = getNextAddableIndex();

    useEffect(() => {
        onAdicionChange?.({ allConfirmed, completedCount, total: sortedItems.length });
    }, [allConfirmed, completedCount]);

    return (
        <div className="flex flex-col h-full max-w-4xl mx-auto pt-2 pb-44 px-3 overflow-auto">
            {/* Header — compacto */}
            <div className="bg-gradient-to-r from-red-600 to-orange-500 rounded-lg px-3 py-2 mb-2 shadow flex items-center justify-between gap-3">
                <div className="text-white font-black text-sm whitespace-nowrap">🫗 ADICIÓN A LA OLLA</div>
                <div className="flex items-center gap-0.5 flex-1 justify-center overflow-x-auto">
                    {sortedItems.map((item, idx) => {
                        const done = additions[item.id]?.confirmed;
                        const active = idx === nextIdx;
                        return (
                            <React.Fragment key={item.id}>
                                {idx > 0 && (
                                    <div className={`h-0.5 w-2 rounded-full shrink-0 ${done ? 'bg-white' : 'bg-white/30'}`} />
                                )}
                                <div className={`h-5 w-5 shrink-0 rounded-full flex items-center justify-center text-[10px] font-black transition-all ${
                                    done ? 'bg-white text-green-600' :
                                    active ? 'bg-white text-red-600 ring-2 ring-white/50 scale-110' :
                                    'bg-white/20 text-white/60'
                                }`}>
                                    {done ? '✓' : idx + 1}
                                </div>
                            </React.Fragment>
                        );
                    })}
                </div>
                <div className="text-white/90 text-xs font-black whitespace-nowrap">{completedCount}/{sortedItems.length}</div>
            </div>

            {/* Ingredient Cards — densas, todo en una sola fila */}
            <div className="space-y-1.5">
                {sortedItems.map((item, idx) => {
                    const info = matchIngredient(item.component?.name) || { label: item.component?.name, color: 'red', gradient: 'from-red-600 to-orange-500' };
                    const add = additions[item.id] || {};
                    const isNext = idx === nextIdx;
                    const isPast = add.confirmed;
                    const isLocked = !isNext && !isPast;
                    const planned = item.plannedQuantity || 0;
                    const actualWeight = item.actualQuantity || 0;
                    const lotNum = item.lotNumber || '';

                    const borderColor = isPast ? 'border-green-400 bg-green-50'
                        : isNext ? `border-${info.color}-400 bg-white`
                        : 'border-slate-200 bg-white';

                    return (
                        <div key={item.id} className={`rounded-md border ${borderColor} flex items-center gap-2 px-2 py-1.5 transition-all ${isLocked ? 'opacity-50' : ''}`}>
                            {/* Numero de orden + nombre */}
                            <div className={`h-7 w-7 rounded-full bg-gradient-to-br ${info.gradient} text-white flex items-center justify-center font-black text-xs shadow shrink-0`}>
                                {isPast ? <CheckCircle size={14} /> : `${idx + 1}`}
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="text-xs font-black text-slate-800 truncate">{item.component?.name || info.label}</div>
                                <div className="text-[10px] text-slate-500 truncate">
                                    <span className="font-bold text-slate-700">{fmtQty(planned)}</span>
                                    {actualWeight > 0 && actualWeight !== planned && (
                                        <span className="text-blue-500"> · pesado {fmtQty(actualWeight)}</span>
                                    )}
                                    {lotNum && <span className="text-slate-400"> · L:{lotNum}</span>}
                                </div>
                            </div>
                            {/* Estado / Acción al lado derecho */}
                            <div className="shrink-0">
                                {isPast && (
                                    <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-green-100 text-green-700 text-[10px] font-black">
                                        ✓ {add.addedAt ? new Date(add.addedAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : ''}
                                    </div>
                                )}
                                {isNext && (
                                    <button
                                        onClick={() => handleConfirm(item)}
                                        className={`flex items-center gap-1 px-3 py-2 rounded-md bg-gradient-to-r ${info.gradient} text-white font-black text-xs shadow active:scale-95 transition-all whitespace-nowrap`}
                                    >
                                        <Play size={14} fill="white" />
                                        ADICIONAR
                                    </button>
                                )}
                                {isLocked && (
                                    <span className="text-[10px] text-slate-400 italic">Bloqueado</span>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Summary */}
            {allConfirmed && (
                <div className="mt-4 bg-green-50 border-2 border-green-400 rounded-2xl px-4 py-4 text-center">
                    <div className="text-lg font-black text-green-700">✅ Todos los ingredientes adicionados</div>
                    <div className="text-sm text-green-500 mt-1">Puede continuar al siguiente paso</div>
                </div>
            )}
        </div>
    );
};

export default AdicionBatchStep;
