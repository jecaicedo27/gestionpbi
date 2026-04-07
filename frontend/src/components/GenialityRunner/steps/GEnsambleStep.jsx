import React, { useState } from 'react';
import { CheckCircle, Loader, AlertTriangle } from 'lucide-react';
import api from '../../../services/api';

/**
 * GEnsambleStep — Paso de Ensamble Final para Geniality
 * Genera la nota de ensamble de siropes en Siigo una vez confirmado.
 * El RPA solo se activa para Geniality, no afecta a Liquipops.
 */
const GEnsambleStep = ({ note, onComplete }) => {
    const [status, setStatus] = useState('idle'); // idle | submitting | success | error
    const [errorMsg, setErrorMsg] = useState('');
    const [outputQty, setOutputQty] = useState(note?.processParameters?.output_qty || '');
    const [outputUnit, setOutputUnit] = useState(note?.processParameters?.output_unit || 'unidades');
    const [lotNumber, setLotNumber] = useState('');

    // Pre-populate outputQty with the real conteo from the completed EMPAQUE note
    // so the operator doesn't accidentally type the planned quantity (which equals Siigo target)
    React.useEffect(() => {
        if (outputQty !== '' || !note?.productionBatchId) return; // already set
        const token = localStorage.getItem('token');
        fetch(`/api/assembly-notes?batchId=${note.productionBatchId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        })
            .then(r => r.json())
            .then(notes => {
                if (!Array.isArray(notes)) return;
                const empaqueNote = notes.find(n =>
                    n.processType?.code === 'G_EMPAQUE' &&
                    n.status === 'COMPLETED' &&
                    n.productId === note.productId
                );
                if (!empaqueNote?.processParameters) return;
                const ep = empaqueNote.processParameters;
                const realQty = ep.empaque?.approved_qty
                    || ep.empaque?.conteo_qty
                    || ep.empaqueRef?.conteo_qty
                    || null;
                if (realQty && realQty > 0) {
                    setOutputQty(String(realQty));
                    setOutputUnit('unidades');
                }
            })
            .catch(() => {}); // non-blocking
    }, [note?.productionBatchId]);


    const handleSubmit = async () => {
        if (!outputQty) { setErrorMsg('Ingresa la cantidad de producto terminado'); return; }
        setStatus('submitting');
        setErrorMsg('');
        try {
            // Save output data to the note processParameters
            await api.patch(`/geniality/assembly-notes/${note.id}`, {
                processParameters: {
                    ...note.processParameters,
                    ensamble_result: {
                        outputQty: parseFloat(outputQty),
                        outputUnit,
                        lotNumber,
                        completedAt: new Date().toISOString()
                    }
                }
            });
            // Fire RPA for Geniality assembly note
            try {
                await api.post('/rpa/siigo-assembly', {
                    assemblyNoteId: note.id,
                    source: 'geniality'
                });
            } catch (rpaErr) {
                console.warn('RPA Siigo - no crítico:', rpaErr.message);
            }
            setStatus('success');
            setTimeout(() => onComplete?.(), 800);
        } catch (err) {
            setStatus('error');
            setErrorMsg(err.response?.data?.error || 'Error al registrar ensamble');
        }
    };

    return (
        <div className="flex flex-col h-full max-w-2xl mx-auto pt-2 pb-28 px-3">
            <div className="bg-white rounded-2xl shadow-lg border-2 border-amber-400 overflow-hidden">
                <div className="bg-gradient-to-r from-amber-600 to-orange-500 p-2.5 text-center">
                    <span className="text-white font-extrabold text-sm uppercase tracking-widest">🔗 ENSAMBLE FINAL - SIROPE TERMINADO</span>
                </div>
                <div className="p-4 flex flex-col gap-4">
                    <div className="bg-amber-50 border-2 border-amber-200 rounded-xl p-3">
                        <div className="text-xs font-bold text-amber-600 uppercase mb-1">Producto a registrar</div>
                        <div className="text-base font-black text-slate-800">{note?.outputProduct?.name || 'Sirope terminado'}</div>
                    </div>

                    <div>
                        <label className="text-xs font-bold text-slate-500 uppercase mb-1.5 block">Cantidad Producida</label>
                        <div className="flex gap-2">
                            <input
                                type="number" inputMode="decimal" value={outputQty}
                                onChange={(e) => setOutputQty(e.target.value)}
                                placeholder="Ej: 100"
                                className="flex-1 text-center text-2xl font-black py-3 px-4 rounded-xl border-2 border-amber-300 bg-amber-50 focus:ring-2 focus:ring-amber-200 focus:outline-none text-amber-700"
                            />
                            <select value={outputUnit} onChange={(e) => setOutputUnit(e.target.value)}
                                className="px-3 rounded-xl border-2 border-amber-300 bg-amber-50 text-amber-700 font-bold focus:outline-none">
                                <option value="unidades">unidades</option>
                                <option value="litros">litros</option>
                                <option value="kg">kg</option>
                                <option value="botellas">botellas</option>
                            </select>
                        </div>
                    </div>

                    <div>
                        <label className="text-xs font-bold text-slate-500 uppercase mb-1.5 block">Lote de Producto Terminado (opcional)</label>
                        <input type="text" value={lotNumber} onChange={(e) => setLotNumber(e.target.value)}
                            placeholder="Ej: G-2026-001"
                            className="w-full text-center text-lg font-bold py-2 px-4 rounded-xl border-2 border-slate-200 bg-slate-50 focus:ring-2 focus:ring-slate-200 focus:outline-none text-slate-700 uppercase" />
                    </div>

                    {errorMsg && (
                        <div className="bg-red-50 border-2 border-red-200 rounded-xl p-3 flex items-center gap-2">
                            <AlertTriangle size={18} className="text-red-500 flex-shrink-0" />
                            <span className="text-sm font-bold text-red-700">{errorMsg}</span>
                        </div>
                    )}

                    <button
                        onClick={handleSubmit}
                        disabled={status === 'submitting' || status === 'success'}
                        className={`w-full py-4 rounded-xl font-black text-base uppercase tracking-wider transition-all active:scale-95 shadow-lg
                            ${status === 'success'
                                ? 'bg-green-100 border-2 border-green-300 text-green-700'
                                : status === 'submitting'
                                    ? 'bg-amber-100 border-2 border-amber-300 text-amber-500 cursor-wait'
                                    : 'bg-gradient-to-r from-amber-600 to-orange-500 text-white hover:shadow-xl'
                            }`}
                    >
                        {status === 'success' && <span className="flex items-center justify-center gap-2"><CheckCircle size={20} /> ¡Ensamble registrado en Siigo!</span>}
                        {status === 'submitting' && <span className="flex items-center justify-center gap-2"><Loader size={20} className="animate-spin" /> Registrando...</span>}
                        {(status === 'idle' || status === 'error') && '🔗 Completar Ensamble Final'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default GEnsambleStep;
