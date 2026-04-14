import React, { useState, useRef } from 'react';
import { ShoppingCart, Trash2, Printer, Camera, Loader2, Pencil, Check, X } from 'lucide-react';
import { compressImage } from '../../../utils/imageCompression';
import { useZebra } from '../../../context/ZebraContext';
import { buildCarritoLabelZPL } from '../../../services/zplLabelBuilder';
import api from '../../../services/api';


const RpaStatusTag = ({ executionId }) => {
    const [status, setStatus] = React.useState('PENDING');
    const [noteCode, setNoteCode] = React.useState(null);
    const [screenshotUrl, setScreenshotUrl] = React.useState(null);

    React.useEffect(() => {
        let timer;
        const checkStatus = async () => {
            try {
                const res = await api.get(`/rpa/${executionId}`);
                if (res.data) {
                    setStatus(res.data.status);
                    if (res.data.siigoNoteCode) setNoteCode(res.data.siigoNoteCode);
                    if (res.data.screenshotPath) setScreenshotUrl(res.data.screenshotPath);
                    if (['SUCCESS', 'FAILED'].includes(res.data.status)) {
                        return;
                    }
                }
            } catch (e) {
                console.warn('RPA poll err:', e.message);
            }
            timer = setTimeout(checkStatus, 3000);
        };
        checkStatus();
        return () => clearTimeout(timer);
    }, [executionId]);

    if (status === 'SUCCESS' && noteCode) {
        return (
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-600 font-black text-[10px] uppercase rounded-md border border-blue-200">
                <span className="text-blue-500 font-extrabold text-[12px]">📝</span> 
                {noteCode}
                {screenshotUrl && (
                    <a href={screenshotUrl} target="_blank" rel="noopener noreferrer" className="ml-1 text-[10px] underline hover:text-blue-800" title="Ver Evidencia RPA">
                        IMG
                    </a>
                )}
            </div>
        );
    }
    if (status === 'FAILED') {
        return (
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-600 font-black text-[10px] uppercase rounded-md border border-red-200">
                <span className="text-red-500 font-extrabold text-[12px]">⚠️</span> 
                ERROR RPA
            </div>
        );
    }
    return (
        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 text-slate-500 font-black text-[10px] uppercase rounded-md border border-slate-200">
            <Loader2 size={12} className="animate-spin" />
            CREANDO ENSAMBLE...
        </div>
    );
};

const GConteoCarritosStep = ({
    note,
    carriots = [],
    onAddCarrito,
    onRemoveCarrito,
    onConfirmCarrito,
    onResumeCarrito,
    onUpdateCarrito,
    isPackagingRole = false,
    isAdmin = false
}) => {
    const [newCarritoQtys, setNewCarritoQtys] = useState({});
    const fileInputRef = useRef(null);
    const fileAddInputRefs = useRef({});
    const [pendingCarrito, setPendingCarrito] = useState(null);
    const [uploading, setUploading] = useState(false);
    const [uploadingAdd, setUploadingAdd] = useState(null);
    const [previewImage, setPreviewImage] = useState(null);
    // Admin inline edit state
    const [editingCarritoId, setEditingCarritoId] = useState(null);
    const [editQtyMap, setEditQtyMap] = useState({});
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
                carritoId: carrito.carritoNum || (carriots.indexOf(carrito) + 1) || carrito.id || '',
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
            } else {
                if (onUpdateCarrito && !carrito.printed) {
                    onUpdateCarrito(carrito.id, { printed: true });
                }
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
            const compressedFile = await compressImage(file, { maxSizeMB: 0.8, maxWidthOrHeight: 1280 });
            const fd = new FormData();
            fd.append('photo', compressedFile);
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
            const compressedFile = await compressImage(file, { maxSizeMB: 0.8, maxWidthOrHeight: 1280 });
            const fd = new FormData();
            fd.append('photo', compressedFile);
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
                    let targetQty = t.plannedUnits || 0;
                    if (targetQty === 0 && t.plannedWeightKg > 0) {
                        const is360 = t.product?.name?.includes('360');
                        targetQty = is360 
                            ? Math.round((t.plannedWeightKg * 1000) / 360) 
                            : t.plannedWeightKg; // 1000 ML ~ 1 KG
                    }
                    const targetCarriots = carriots.filter(c => c.productId === t.productId);
                    const deliveredQty = targetCarriots.reduce((sum, c) => sum + Number(c.qty), 0);                    // Redondear a máximo 2 decimales para evitar errores de precisión de punto flotante en cálculo
                    const missingQtyRaw = Math.max(0, targetQty - deliveredQty);
                    const missingQty = Math.round(missingQtyRaw * 100) / 100;
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

                            {/* Input Area — visible solo a operarios de PRODUCCION */}
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
                                                    {/* Qty — inline edit for ADMIN */}
                                                    {editingCarritoId === c.id ? (
                                                        <div className="flex items-center gap-1">
                                                            <input
                                                                type="number"
                                                                min="1"
                                                                autoFocus
                                                                value={editQtyMap[c.id] ?? c.qty}
                                                                onChange={(e) => setEditQtyMap(prev => ({ ...prev, [c.id]: e.target.value }))}
                                                                className="w-20 text-center font-bold text-base py-1 px-2 rounded-lg border-2 border-orange-300 focus:ring-2 focus:ring-orange-200 focus:outline-none"
                                                            />
                                                            <button
                                                                onClick={async () => {
                                                                    const newQty = parseFloat(editQtyMap[c.id]);
                                                                    if (!isNaN(newQty) && newQty > 0 && onUpdateCarrito) {
                                                                        await onUpdateCarrito(c.id, { qty: newQty });
                                                                    }
                                                                    setEditingCarritoId(null);
                                                                }}
                                                                className="p-1.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg active:scale-95 transition-all"
                                                                title="Guardar"
                                                            >
                                                                <Check size={13} />
                                                            </button>
                                                            <button
                                                                onClick={() => setEditingCarritoId(null)}
                                                                className="p-1.5 bg-slate-200 hover:bg-slate-300 text-slate-600 rounded-lg active:scale-95 transition-all"
                                                                title="Cancelar"
                                                            >
                                                                <X size={13} />
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <div className="flex items-center gap-1">
                                                            <span className="font-extrabold text-orange-600">{c.qty} uds</span>
                                                            {isAdmin && (
                                                                <button
                                                                    onClick={() => {
                                                                        setEditQtyMap(prev => ({ ...prev, [c.id]: c.qty }));
                                                                        setEditingCarritoId(c.id);
                                                                    }}
                                                                    className="p-1 text-slate-300 hover:text-blue-500 hover:bg-blue-50 rounded transition-all"
                                                                    title="Editar cantidad (Admin)"
                                                                >
                                                                    <Pencil size={11} />
                                                                </button>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>

                                                <div className="flex items-center gap-4">
                                                    <div className="text-[10px] text-slate-400 font-bold uppercase flex items-center gap-1">
                                                        {new Date(c.timestamp || c.createdAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                                                        {c.receivedAt && <span className="text-emerald-500">· Recibido</span>}
                                                    </div>
                                                    {isPackagingRole ? (
                                                        <div className="flex items-center gap-3">
                                                            {c.productionPhotoUrl && (
                                                                <button 
                                                                    onClick={() => setPreviewImage(c.productionPhotoUrl)} 
                                                                    className="w-10 h-10 rounded border border-orange-200 overflow-hidden shadow-sm inline-block shrink-0 active:scale-95 transition-transform"
                                                                    title="Ver foto de producción"
                                                                >
                                                                    <img src={c.productionPhotoUrl} alt="Produccion" className="w-full h-full object-cover" />
                                                                </button>
                                                            )}
                                                            {!c.receivedAt && onConfirmCarrito ? (
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
                                                                    {c.labeledAt ? (
                                                                        <div className="flex items-center gap-2">
                                                                            <div className="flex flex-col gap-1 items-end">
                                                                                <span className="bg-emerald-100 text-emerald-700 font-black text-[9px] px-2 py-0.5 rounded border border-emerald-200 flex items-center gap-1 uppercase" title="El carrito fue rotulado en empaque">
                                                                                    <Printer size={10} /> ROTULADO OK
                                                                                </span>
                                                                                {!c.rpaExecutionId && (
                                                                                    <span className="bg-slate-100 text-slate-500 font-black text-[9px] px-2 py-0.5 rounded border border-slate-200 flex items-center gap-1 uppercase" title="No hay registro de ensamble en Siigo para este lote (posible prueba antigua o error)">
                                                                                        <svg xmlns="http://www.w0.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/></svg> SIN SIIGO
                                                                                    </span>
                                                                                )}
                                                                            </div>
                                                                            {c.rpaExecutionId && <RpaStatusTag executionId={c.rpaExecutionId} />}
                                                                            {onResumeCarrito && (
                                                                                <button
                                                                                    onClick={() => onResumeCarrito(t.productId, c.qty, c.id)}
                                                                                    className="text-[9px] font-bold text-slate-400 hover:text-blue-500 underline ml-1 px-2 py-1"
                                                                                >
                                                                                    Editar
                                                                                </button>
                                                                            )}
                                                                        </div>
                                                                    ) : onResumeCarrito ? (
                                                                        <button
                                                                            onClick={() => onResumeCarrito(t.productId, c.qty, c.id)}
                                                                            className="flex items-center gap-1.5 px-3 py-2 bg-blue-500 hover:bg-blue-600 text-white font-black text-[11px] uppercase rounded-lg shadow-sm transition-all active:scale-95 border-b-2 border-blue-700"
                                                                        >
                                                                            <Printer size={13} />
                                                                            Etiquetar
                                                                        </button>
                                                                    ) : (
                                                                        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-600 font-black text-[10px] uppercase rounded-md border border-emerald-200">
                                                                            <span className="text-emerald-500 font-extrabold text-[12px]">✓</span> 
                                                                            RECIBIDO OK
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            ) : null}
                                                        </div>
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
                                                                className={`p-3 -m-3 relative rounded-full hover:bg-slate-200 active:scale-95 transition-all ${c.printed ? 'text-emerald-500 bg-emerald-50 hover:text-emerald-700' : 'text-slate-400 bg-slate-50 hover:text-slate-700'}`}
                                                            >
                                                                <Printer size={18} />
                                                                {c.printed && (
                                                                    <span className="absolute -bottom-1 -right-1 bg-emerald-500 text-white rounded-full w-4 h-4 flex items-center justify-center text-[10px] font-bold border-2 border-white">✓</span>
                                                                )}
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
