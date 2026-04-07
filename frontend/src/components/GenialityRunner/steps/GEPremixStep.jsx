import React, { useState, useRef } from 'react';
import { CheckCircle, Camera, AlertCircle } from 'lucide-react';
import api from '../../../services/api';

/**
 * GEPremixStep — Paso 1 Escarchado: Preparación del Premix Seco
 *
 * Ingredientes del premix seco:
 *   - 800g Almidón Instagel Cream Poltec
 *   - 600g Almidón Gel Thin Poltec
 *   - 260g Goma Xantana
 *   - 7,000g Azúcar
 *   - 20g Sucralosa
 *
 * El operador pesa y mezcla estos ingredientes hasta distribución homogénea,
 * luego confirma y avanza al siguiente paso.
 */
const GEPremixStep = ({ note, onConfirm }) => {
    const [confirmed, setConfirmed] = useState(false);
    const [photoUrl, setPhotoUrl] = useState(null);
    const [uploading, setUploading] = useState(false);
    const fileRef = useRef(null);

    // Obtener ingredientes del premix desde processParameters o usar los del proceso
    const premixItems = note?.processParameters?.premix_items || [
        { name: 'Almidón Instagel Cream Poltec', quantity: 800, unit: 'g' },
        { name: 'Almidón Gel Thin Poltec', quantity: 600, unit: 'g' },
        { name: 'Goma Xantana', quantity: 260, unit: 'g' },
        { name: 'Azúcar', quantity: 7000, unit: 'g' },
        { name: 'Sucralosa', quantity: 20, unit: 'g' },
    ];

    const totalPremix = premixItems.reduce((acc, i) => acc + i.quantity, 0);

    const handlePhoto = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setUploading(true);
        try {
            const form = new FormData();
            form.append('photo', file);
            form.append('noteId', note.id);
            form.append('context', 'premix_seco');
            const res = await api.post('/assembly-notes/upload-photo', form, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            setPhotoUrl(res.data.url);
        } catch (err) {
            console.error('Error subiendo foto premix:', err);
        } finally {
            setUploading(false);
        }
    };

    const handleConfirm = () => {
        if (!photoUrl) return;
        setConfirmed(true);
        setTimeout(() => onConfirm?.(), 400);
    };

    return (
        <div className="flex flex-col max-w-2xl mx-auto px-4 py-6 gap-5">
            {/* Header */}
            <div className="bg-white rounded-2xl shadow-lg border-2 border-amber-400 overflow-hidden">
                <div className="bg-gradient-to-r from-amber-600 to-yellow-500 p-3 text-center">
                    <span className="text-white font-extrabold text-sm uppercase tracking-widest">
                        🧂 PREMIX SECO — Escarchado
                    </span>
                </div>

                <div className="p-4 flex flex-col gap-4">
                    {/* Instrucción */}
                    <div className="bg-amber-50 border-2 border-amber-200 rounded-xl p-3">
                        <div className="text-xs font-bold text-amber-600 uppercase mb-1">Instrucción</div>
                        <div className="text-sm text-slate-700 leading-relaxed">
                            Pese y mezcle los ingredientes secos en el orden indicado hasta obtener una
                            distribución <strong>homogénea</strong>. Esta premezcla se incorporará al tanque
                            en el siguiente paso.
                        </div>
                    </div>

                    {/* Lista de ingredientes */}
                    <div>
                        <div className="text-xs font-bold text-slate-500 uppercase mb-2">Ingredientes del Premix Seco</div>
                        <div className="flex flex-col gap-2">
                            {premixItems.map((item, idx) => (
                                <div key={idx} className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
                                    <div className="flex items-center gap-3">
                                        <div className="w-7 h-7 rounded-full bg-amber-100 text-amber-700 font-black text-xs flex items-center justify-center">
                                            {idx + 1}
                                        </div>
                                        <span className="text-sm font-semibold text-slate-700">{item.name}</span>
                                    </div>
                                    <div className="text-sm font-black text-amber-700">
                                        {item.quantity.toLocaleString('es-CO')} {item.unit}
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="mt-2 text-right text-xs font-bold text-slate-400">
                            Total premix: {totalPremix.toLocaleString('es-CO')} g
                        </div>
                    </div>

                    {/* Foto de evidencia */}
                    <div>
                        <div className="text-xs font-bold text-slate-500 uppercase mb-2">Foto de Evidencia</div>
                        {photoUrl ? (
                            <div className="relative rounded-xl overflow-hidden border-2 border-green-400">
                                <img src={photoUrl} alt="Premix seco" className="w-full h-40 object-cover" />
                                <div className="absolute top-2 right-2 bg-green-500 text-white text-xs font-bold rounded-full px-2 py-1 flex items-center gap-1">
                                    <CheckCircle size={12} /> OK
                                </div>
                                <button
                                    onClick={() => { setPhotoUrl(null); }}
                                    className="absolute bottom-2 right-2 bg-white/90 text-slate-600 text-xs font-bold rounded-full px-2 py-1 border border-slate-300"
                                >
                                    Cambiar
                                </button>
                            </div>
                        ) : (
                            <button
                                onClick={() => fileRef.current?.click()}
                                disabled={uploading}
                                className="w-full h-28 border-2 border-dashed border-amber-300 rounded-xl flex flex-col items-center justify-center gap-2 text-amber-600 bg-amber-50 active:scale-95 transition-all"
                            >
                                {uploading ? (
                                    <div className="text-sm font-bold animate-pulse">Subiendo...</div>
                                ) : (
                                    <>
                                        <Camera size={28} />
                                        <span className="text-sm font-bold">Tomar foto del premix</span>
                                        <span className="text-xs text-amber-500">Obligatorio para continuar</span>
                                    </>
                                )}
                            </button>
                        )}
                        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhoto} />
                    </div>

                    {/* Alerta si no hay foto */}
                    {!photoUrl && (
                        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                            <AlertCircle size={16} className="text-red-400 flex-shrink-0" />
                            <span className="text-xs text-red-600 font-semibold">Debes tomar la foto antes de confirmar</span>
                        </div>
                    )}

                    {/* Botón confirmar */}
                    <button
                        onClick={handleConfirm}
                        disabled={!photoUrl || confirmed}
                        className={`w-full py-4 rounded-xl font-black text-base uppercase tracking-wider transition-all active:scale-95 shadow-lg
                            ${confirmed
                                ? 'bg-green-100 border-2 border-green-300 text-green-700'
                                : !photoUrl
                                    ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                                    : 'bg-gradient-to-r from-amber-600 to-yellow-500 text-white hover:shadow-xl'
                            }`}
                    >
                        {confirmed
                            ? <span className="flex items-center justify-center gap-2"><CheckCircle size={20} /> ¡Premix Seco Listo!</span>
                            : '✅ Confirmar Premix Seco'
                        }
                    </button>
                </div>
            </div>
        </div>
    );
};

export default GEPremixStep;
