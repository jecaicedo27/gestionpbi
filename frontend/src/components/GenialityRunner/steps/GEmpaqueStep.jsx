import React, { useState } from 'react';
import { Camera, CheckCircle, Package } from 'lucide-react';
import api from '../../../services/api';

/**
 * GEmpaqueStep — Paso de Empaque para Geniality (Siropes)
 * Registra cantidad de siropes empacados y foto de evidencia.
 * Sin lógica de perlas, sin marcado de cajas Liquipops.
 */
const GEmpaqueStep = ({ note, onDataChange, savedData = {} }) => {
    const [qty, setQty] = useState(savedData.qty || '');
    const [unit, setUnit] = useState(savedData.unit || 'unidades');
    const [photoPreview, setPhotoPreview] = useState(savedData.photoUrl || '');
    const [observations, setObservations] = useState(savedData.observations || '');

    const handleChange = (field, value) => {
        const updated = { qty, unit, photoUrl: photoPreview, observations, [field]: value };
        onDataChange?.(updated);
        if (field === 'qty') setQty(value);
        if (field === 'unit') setUnit(value);
        if (field === 'observations') setObservations(value);
    };

    const handlePhotoCapture = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const localUrl = URL.createObjectURL(file);
        setPhotoPreview(localUrl);
        onDataChange?.({ qty, unit, photoUrl: localUrl, observations });
        try {
            const fd = new FormData();
            fd.append('photo', file);
            fd.append('noteId', note?.id || '');
            fd.append('context', 'empaque_geniality');
            const res = await api.post('/assembly-notes/upload-photo', fd, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            const data = res.data;
            if (data.url) {
                setPhotoPreview(data.url);
                onDataChange?.({ qty, unit, photoUrl: data.url, observations });
            }
        } catch { /* use local preview */ }
    };

    const plannedQty = note?.processParameters?.target_qty || note?.targetQuantity;

    return (
        <div className="flex flex-col h-full max-w-2xl mx-auto pt-2 pb-28 px-3">
            <div className="bg-white rounded-2xl shadow-lg border-2 border-emerald-400 overflow-hidden">
                <div className="bg-gradient-to-r from-emerald-600 to-teal-500 p-2.5 text-center">
                    <span className="text-white font-extrabold text-sm uppercase tracking-widest">📦 EMPAQUE DE SIROPES</span>
                </div>
                <div className="p-4 flex flex-col gap-4">
                    {plannedQty && (
                        <div className="bg-teal-50 border-2 border-teal-200 rounded-xl p-3 text-center">
                            <div className="text-xs font-bold text-teal-500 uppercase">Cantidad objetivo</div>
                            <div className="text-2xl font-black text-teal-700">{plannedQty} {unit}</div>
                        </div>
                    )}

                    <div>
                        <label className="text-xs font-bold text-slate-500 uppercase mb-1.5 block">Cantidad Empacada</label>
                        <div className="flex gap-2">
                            <input
                                type="number" inputMode="numeric" value={qty}
                                onChange={(e) => handleChange('qty', e.target.value)}
                                placeholder="Ej: 50"
                                className="flex-1 text-center text-2xl font-black py-3 px-4 rounded-xl border-2 border-emerald-300 bg-emerald-50 focus:ring-2 focus:ring-emerald-200 focus:outline-none text-emerald-700"
                            />
                            <select value={unit} onChange={(e) => handleChange('unit', e.target.value)}
                                className="px-3 rounded-xl border-2 border-emerald-300 bg-emerald-50 text-emerald-700 font-bold focus:outline-none">
                                <option value="unidades">unidades</option>
                                <option value="litros">litros</option>
                                <option value="kg">kg</option>
                                <option value="botellas">botellas</option>
                                <option value="sachet">sachet</option>
                            </select>
                        </div>
                    </div>

                    <div>
                        <label className="text-xs font-bold text-slate-500 uppercase mb-1.5 block">Observaciones (opcional)</label>
                        <textarea value={observations} onChange={(e) => handleChange('observations', e.target.value)}
                            placeholder="Tamaño de presentación, sabor, lote de envases, etc."
                            rows={3}
                            className="w-full px-3 py-2 rounded-xl border-2 border-slate-200 bg-slate-50 text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-200 resize-none text-sm" />
                    </div>

                    <div>
                        <label className="text-xs font-bold text-slate-500 uppercase mb-1.5 block">📷 Foto del Empaque</label>
                        {photoPreview && <img src={photoPreview} alt="Empaque" className="w-full max-h-40 object-cover rounded-xl border border-emerald-200 mb-2 shadow-sm" />}
                        <label className={`flex items-center justify-center gap-2 w-full py-3 rounded-xl border-2 border-dashed cursor-pointer transition-all active:scale-95 ${photoPreview ? 'border-emerald-200 bg-emerald-50 text-emerald-600' : 'border-slate-300 bg-slate-50 text-slate-500 hover:bg-slate-100'}`}>
                            {photoPreview
                                ? <><CheckCircle size={18} /> <span className="font-bold text-xs">Foto tomada — Cambiar</span></>
                                : <><Camera size={18} /> <span className="font-bold text-xs">Tomar foto del empaque</span></>}
                            <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={handlePhotoCapture} />
                        </label>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default GEmpaqueStep;
