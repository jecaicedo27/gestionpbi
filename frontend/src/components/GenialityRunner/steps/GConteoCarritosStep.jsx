import React, { useState, useRef } from 'react';
import { ShoppingCart, Trash2, Printer, Camera, Loader2 } from 'lucide-react';
import { useZebra } from '../../../context/ZebraContext';
import { buildCarritoLabelZPL } from '../../../services/zplLabelBuilder';
import api from '../../../services/api';

const GConteoCarritosStep = ({
    note,
    carriots = [],
    onAddCarrito,
    onRemoveCarrito,
    onConfirmCarrito,
    onResumeCarrito,
    isPackagingRole = false
}) => {
    const [newCarritoQtys, setNewCarritoQtys] = useState({});
    const fileInputRef = useRef(null);
    const fileAddInputRefs = useRef({});
    const [pendingCarrito, setPendingCarrito] = useState(null);
    const [uploading, setUploading] = useState(false);
    const [uploadingAdd, setUploadingAdd] = useState(null);
    const [previewImage, setPreviewImage] = useState(null);
    const { zebraStatus, printZPL } = useZebra();
    
    const outputTargets = note?.productionBatch?.outputTargets || [];
    
    // Fallback if no outputTargets (unlikely for Geniality Siropes batch, but safe)
    if (outputTargets.length === 0) {
        if (note?.product) {
            outputTargets.push({
                productId: note.productId,
                product: note.product,
                plannedUnits: note.processParameters?.target_qty || note.targetQuantity || 0
            });
        }
    }

    const handlePrintCarrito = async (carrito, targetName) => {
        if (zebraStatus !== 'connected') {
            alert('La impresora Zebra no está conectada o está cargando. Si sigue sin conectar, configure la IP en el icono superior derecho.');
            return;
        }

        try {
            const zpl = buildCarritoLabelZPL({
                carritoId: carrito.carritoNum || carrito.id || '',
                productName: targetName || 'GENIALITY SIROPE',
                lotNumber: note?.productionBatch?.batchNumber || '',
                quantity: carrito.qty || 0,
                unit: 'und',
                totalBoxes: 1,
                boxNumber: 1
            });

            const result = await printZPL(zpl);
            if (!result.ok) {
                alert('Error Zebra: ' + (result.error || 'No se pudo imprimir'));
            }
        } catch (err) {
            alert('Error enviando a Zebra: ' + err.message);
        }
    };

    const extractSize = (name) => {
        if (!name) return 'N/A';
        const match = name.match(/X\s*(\d+\s*(?:GR|ML|KG))/i);
        return match ? match[1] : 'N/A';
    };

    const getFlavorLabel = (name) => {
        if (!name) return name;
        const match = name.match(/SABOR\s+A\s+(.+?)\s+X\s+/i);
        return match ? match[1] : (name.toUpperCase().replace('SIROPE', '').trim() || name);
    };

    const handleAdd = (target) => {
        const qty = parseInt(newCarritoQtys[target.productId], 10);
        if (qty > 0 && onAddCarrito) {
            onAddCarrito(target.productId, target.product?.name || 'Sirope Terminado', qty);
            setNewCarritoQtys(prev => ({ ...prev, [target.productId]: '' }));
        }
    };

    const handlePhotoAddChange = async (e, t) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const qty = parseInt(newCarritoQtys[t.productId], 10);
        if (!qty || isNaN(qty) || qty <= 0) return;

        setUploadingAdd(t.productId);
        try {
            const fd = new FormData();
            fd.append('photo', file);
            if (note?.id) fd.append('noteId', note.id);
            fd.append('context', 'produccion_carrito');
            const res = await api.post('/assembly-notes/upload-photo', fd, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            const data = res.data;
            if (onAddCarrito) {
                await onAddCarrito(t.productId, t.product?.name || 'Sirope Terminado', qty, data.url || data.photoUrl);
            }
            setNewCarritoQtys(prev => ({ ...prev, [t.productId]: '' }));
        } catch (err) {
            console.error('Error subiendo foto de carrito:', err);
            alert('Error subiendo foto de carrito: ' + err.message);
        } finally {
            setUploadingAdd(null);
            e.target.value = '';
        }
    };

    const handleFileChange = async (e) => {
        const file = e.target.files?.[0];
        if (!file || !pendingCarrito) return;
        setUploading(true);
        try {
            const fd = new FormData();
            fd.append('photo', file);
            const res = await api.post('/assembly-notes/upload-photo', fd, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            const data = res.data;
            
            if (onConfirmCarrito) {
                await onConfirmCarrito(pendingCarrito.id, pendingCarrito.productId, data.url || data.photoUrl);
            }
        } catch (err) {
            console.error('Upload error:', err);
            alert('Error subiendo foto de evidencia: ' + err.message);
        } finally {
            setUploading(false);
            setPendingCarrito(null);
            e.target.value = '';
        }
    };

    return (
        <div className="flex flex-col h-full max-w-2xl mx-auto pt-2 pb-28 px-3">
            <input type="file" ref={fileInputRef} accept="image/*" capture="environment" className="hidden" onChange={handleFileChange} />
            
            {/* Header */}
            <div className="flex items-center justify-between mb-4 mt-2">
                <div className="flex items-center gap-2 text-slate-500">
                    <ShoppingCart size={18} />
                    <span className="font-extrabold text-[11px] uppercase tracking-widest leading-none">
                        {isPackagingRole ? 'RECEPCIÓN DE CARRITOS' : 'ENTREGA POR CARRITOS'}
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="bg-orange-500 text-white font-black text-[10px] px-2 py-1 rounded-md uppercase tracking-wider">
                        <div className="text-[8px] opacity-70">CARRITOS</div>
                        {carriots.length}
                    </div>
                    <div className="bg-emerald-500 text-white font-black text-[10px] px-3 py-1 rounded-md uppercase tracking-wider h-full flex flex-col justify-center">
                        <div className="text-[8px] opacity-70">LOTE</div>
                        {note?.productionBatch?.batchNumber || ''}
                    </div>
                </div>
            </div>

            {/* Target Cards */}
            <div className="space-y-6">
                {outputTargets.map(t => {
                    const targetQty = t.plannedUnits || 0;
                    const targetCarriots = carriots.filter(c => c.productId === t.productId);
                    const deliveredQty = targetCarriots.reduce((sum, c) => sum + Number(c.qty), 0);
                    const missingQty = Math.max(0, targetQty - deliveredQty);
                    const sizeLabel = extractSize(t.product?.name);
                    const flavorLabel = getFlavorLabel(t.product?.name);

                    return (
                        <div key={t.productId} className="bg-white rounded-xl shadow-md border border-orange-200 overflow-hidden">
                            {/* Card Header */}
                            <div className="bg-orange-500 p-3 flex justify-between items-center text-white">
                                <div className="flex items-center gap-2">
                                    <div className="bg-white/20 px-2 py-1 rounded text-xs font-black">{sizeLabel}</div>
                                    <div className="font-extrabold tracking-wide uppercase">{flavorLabel}</div>
                                </div>
                                <button className="text-white/70 hover:text-white transition-colors">
                                    {/* Camera icon placeholder */}
                                    <svg xmlns="http://www.w0.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>
                                </button>
                            </div>

                            {/* Data Grid */}
                            <div className="grid grid-cols-3 gap-0 border-b border-slate-100">
                                <div className="text-center py-4">
                                    <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1">PROGRAMADO</div>
                                    <div className="text-xl font-black text-slate-700">{targetQty}</div>
                                </div>
                                <div className="text-center py-4 bg-slate-50/50">
                                    <div className="text-[9px] font-bold text-emerald-500 uppercase tracking-widest mb-1">ENTREGADO</div>
                                    <div className="text-xl font-black text-orange-500">{deliveredQty}</div>
                                </div>
                                <div className="text-center py-4">
                                    <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1">FALTAN</div>
                                    <div className={`text-xl font-black ${missingQty > 0 ? 'text-red-500' : 'text-slate-400'}`}>{missingQty}</div>
                                </div>
                            </div>

                            {/* Input Area */}
                            {!isPackagingRole && (
                                <div className="p-3 bg-slate-50 border-b border-slate-100">
                                    <div className="flex gap-2 items-center">
                                        <ShoppingCart size={18} className="text-orange-400 flex-shrink-0" />
                                        <input
                                            type="number"
                                            min="1"
                                            max={missingQty || undefined}
                                            value={newCarritoQtys[t.productId] || ''}
                                            onChange={(e) => setNewCarritoQtys(prev => ({ ...prev, [t.productId]: e.target.value }))}
                                            placeholder={`1 - ${missingQty}`}
                                            className="flex-1 text-center text-lg font-bold py-2 rounded-lg border-2 border-slate-200 bg-white focus:ring-2 focus:ring-orange-200 focus:outline-none placeholder:text-slate-300"
                                        />
                                        <button
                                            onClick={() => {
                                                const qty = newCarritoQtys[t.productId];
                                                if (qty > 0) fileAddInputRefs.current[t.productId]?.click();
                                            }}
                                            disabled={!newCarritoQtys[t.productId] || parseInt(newCarritoQtys[t.productId], 10) <= 0 || uploadingAdd === t.productId}
                                            className="bg-orange-100 hover:bg-orange-200 text-orange-600 disabled:opacity-50 font-black uppercase text-[11px] tracking-wider px-4 py-3 rounded-lg transition-all flex items-center gap-1"
                                        >
                                            {uploadingAdd === t.productId ? (
                                                <Loader2 size={14} className="animate-spin" />
                                            ) : (
                                                <Camera size={14} />
                                            )}
                                            {uploadingAdd === t.productId ? 'Subiendo...' : '+ Carrito'}
                                        </button>
                                        <input 
                                            ref={el => fileAddInputRefs.current[t.productId] = el}
                                            type="file" accept="image/*" capture="environment" 
                                            className="hidden" 
                                            onChange={(e) => handlePhotoAddChange(e, t)} 
                                        />
                                    </div>
                                </div>
                            )}

                            {/* Cart List */}
                            {targetCarriots.length > 0 && (
                                <div className="bg-white">
                                    <div className="px-3 py-2 text-[9px] font-bold text-slate-400 uppercase tracking-widest bg-slate-50 border-b border-slate-100">
                                        CARRITOS ENTREGADOS ({targetCarriots.length})
                                    </div>
                                    <div className="divide-y divide-slate-100">
                                        {targetCarriots.map((c, i) => (
                                            <div key={c.id} className="p-3 flex items-center justify-between hover:bg-slate-50 transition-colors">
                                                <div className="flex items-center gap-3">
                                                    <div className="flex items-center gap-2">
                                                        <div className="text-orange-500"><ShoppingCart size={14} /></div>
                                                        <span className="font-black text-slate-800 text-sm">Carrito #{c.carritoNum || (i + 1)}</span>
                                                    </div>
                                                    <div className="font-extrabold text-orange-600">{c.qty} uds</div>
                                                </div>
                                                <div className="flex items-center gap-4">
                                                    <div className="text-[10px] text-slate-400 font-bold uppercase flex items-center gap-1">
                                                        {new Date(c.timestamp || c.createdAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                                                        {c.receivedAt && <span className="text-emerald-500">· Recibido</span>}
                                                    </div>
                                                    
                                                    {isPackagingRole ? (
                                                        !c.receivedAt && onConfirmCarrito ? (
                                                            <button 
                                                                onClick={() => {
                                                                    setPendingCarrito({ id: c.id, productId: t.productId });
                                                                    fileInputRef.current?.click();
                                                                }} 
                                                                disabled={uploading && pendingCarrito?.id === c.id}
                                                                className="bg-emerald-500 hover:bg-emerald-600 text-white font-black text-[10px] uppercase px-3 py-1.5 rounded active:scale-95 transition-all shadow-sm flex items-center gap-1.5 disabled:opacity-50"
                                                            >
                                                                {uploading && pendingCarrito?.id === c.id ? (
                                                                    <Loader2 size={12} className="animate-spin" />
                                                                ) : (
                                                                    <Camera size={12} />
                                                                )}
                                                                {uploading && pendingCarrito?.id === c.id ? 'Subiendo...' : 'Recibir'}
                                                            </button>
                                                        ) : c.labeledAt ? (
                                                                <div className="flex items-center gap-2">
                                                                    {c.photoUrl && (
                                                                        <button 
                                                                            onClick={() => setPreviewImage(c.photoUrl)} 
                                                                            className="w-10 h-10 rounded border border-emerald-200 overflow-hidden shadow-sm inline-block shrink-0 active:scale-95 transition-transform"
                                                                        >
                                                                            <img src={c.photoUrl} alt="Evidencia" className="w-full h-full object-cover" />
                                                                        </button>
                                                                    )}
                                                                    <div className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-600 font-black text-[10px] uppercase rounded-md border border-blue-200">
                                                                        <span className="text-blue-500 font-extrabold text-[12px]">✓</span> 
                                                                        Marcado Listo
                                                                    </div>
                                                                </div>
                                                        ) : c.receivedAt ? (
                                                                <div className="flex items-center gap-2">
                                                                    {c.photoUrl && (
                                                                        <button 
                                                                            onClick={() => setPreviewImage(c.photoUrl)} 
                                                                            className="w-10 h-10 rounded border border-emerald-200 overflow-hidden shadow-sm inline-block shrink-0 active:scale-95 transition-transform"
                                                                        >
                                                                            <img src={c.photoUrl} alt="Evidencia" className="w-full h-full object-cover" />
                                                                        </button>
                                                                    )}
                                                                    <button 
                                                                        onClick={() => onResumeCarrito && onResumeCarrito(t.productId, c.qty, c.id)}
                                                                        className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-600 font-black text-[10px] uppercase rounded-md border border-emerald-200 transition-colors"
                                                                    >
                                                                        <span className="text-emerald-500 font-extrabold text-[12px]">✓</span> 
                                                                        Listo · Etiquetar
                                                                    </button>
                                                                </div>
                                                        ) : null
                                                    ) : (
                                                        <div className="flex items-center gap-8 pl-4 border-l border-slate-100 ml-2">
                                                            {c.productionPhotoUrl && (
                                                                <button 
                                                                    onClick={() => setPreviewImage(c.productionPhotoUrl)} 
                                                                    className="w-10 h-10 -ml-2 mr-2 rounded border border-emerald-200 overflow-hidden shadow-sm inline-block shrink-0 active:scale-95 transition-transform"
                                                                >
                                                                    <img src={c.productionPhotoUrl} alt="Produccion" className="w-full h-full object-cover" />
                                                                </button>
                                                            )}
                                                            <button 
                                                                onClick={() => handlePrintCarrito(c, t.product?.name)} 
                                                                className="p-3 -m-3 text-slate-400 bg-slate-50 rounded-full hover:bg-slate-200 hover:text-slate-700 active:scale-95 transition-all"
                                                            >
                                                                <Printer size={18} />
                                                            </button>
                                                            {!c.receivedAt && (
                                                                <button 
                                                                    onClick={() => onRemoveCarrito && onRemoveCarrito(c.id)} 
                                                                    className="p-3 -m-3 text-red-300 bg-red-50 rounded-full hover:bg-red-100 hover:text-red-500 active:scale-95 transition-all"
                                                                >
                                                                    <Trash2 size={18} />
                                                                </button>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Image Preview Modal */}
            {previewImage && (
                <div 
                    className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
                    onClick={() => setPreviewImage(null)}
                >
                    <div className="relative max-w-full max-h-full">
                        <button 
                            className="absolute -top-3 -right-3 bg-red-500 hover:bg-red-600 text-white rounded-full w-8 h-8 flex items-center justify-center font-bold shadow-lg transition-colors border-2 border-white"
                            onClick={(e) => { e.stopPropagation(); setPreviewImage(null); }}
                        >
                            ✕
                        </button>
                        <img 
                            src={previewImage} 
                            alt="Evidencia Ampliada" 
                            className="max-w-full max-h-[85vh] rounded-lg shadow-2xl object-contain border-4 border-white"
                        />
                    </div>
                </div>
            )}
        </div>
    );
};

export default GConteoCarritosStep;
