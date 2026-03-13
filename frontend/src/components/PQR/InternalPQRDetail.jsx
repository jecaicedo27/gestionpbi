import React, { useState } from 'react';
import { X, Eye, FileText, CheckCircle, Upload, AlertCircle, AlertTriangle } from 'lucide-react';
import axios from 'axios';
import { useAuth } from '../../context/AuthContext';

const ORIGIN_LABELS = {
    DETERIORO_PLANTA: '🏭 Deterioro en Planta',
    DEFECTO_FABRICACION: '⚠️ Defecto de Fabricación'
};

const pqrTypeLabels = {
    CALCIFICACION: 'Calcificación', INFLADO: 'Inflado', ELEMENTO_EXTRANO: 'Elemento Extraño',
    SABOR_DIFERENTE: 'Sabor Diferente', MAL_SELLADO: 'Mal Sellado', MAL_ETIQUETADO: 'Mal Etiquetado',
    VENCIDO: 'Vencido', CONTAMINADO: 'Contaminado', OTRO: 'Otro', CALIDAD: 'Calidad'
};

const STAGE_STEPS = [
    { id: 'PENDING_REVIEW', label: 'Revisión Calidad', icon: Eye },
    { id: 'PENDING_BILLING', label: 'Ajuste Inventario', icon: FileText },
    { id: 'COMPLETED', label: 'Completado', icon: CheckCircle }
];

const getStageIndex = (stage) => {
    const map = { PENDING_REVIEW: 0, PENDING_BILLING: 1, COMPLETED: 2 };
    return map[stage] ?? 0;
};

const InternalPQRDetail = ({ pqr, onClose, onUpdate }) => {
    const { token, user } = useAuth();
    const [actionNote, setActionNote] = useState('');
    const [adjFile, setAdjFile] = useState(null);
    const [processing, setProcessing] = useState(false);
    const [selectedImage, setSelectedImage] = useState(null);

    const isRejected = pqr.status === 'REJECTED';
    const isCompleted = pqr.stage === 'COMPLETED';
    const currentStep = isRejected ? -1 : getStageIndex(pqr.stage);

    const handleAction = async (action) => {
        if (action === 'REJECT' && !actionNote.trim()) { alert('Ingrese el motivo del rechazo.'); return; }
        if (!confirm('¿Confirma esta acción?')) return;
        setProcessing(true);
        try {
            if (action === 'CONFIRM_ADJUSTMENT') {
                const formData = new FormData();
                if (adjFile) formData.append('file', adjFile);
                if (actionNote) formData.append('notes', actionNote);
                await axios.post(`${import.meta.env.VITE_API_URL}/api/internal-pqr/${pqr.id}/adjustment`, formData, {
                    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'multipart/form-data' }
                });
            } else {
                await axios.patch(`${import.meta.env.VITE_API_URL}/api/internal-pqr/${pqr.id}/status`, {
                    action, rejectionReason: action === 'REJECT' ? actionNote : null, internalNotes: actionNote
                }, { headers: { Authorization: `Bearer ${token}` } });
            }
            if (onUpdate) onUpdate();
            onClose();
        } catch (err) {
            alert('Error: ' + (err.response?.data?.error || err.message));
        } finally {
            setProcessing(false);
        }
    };

    const userRole = user?.role;
    const stage = pqr.stage;
    const canActOnQuality = ['ADMIN', 'CALIDAD'].includes(userRole) && stage === 'PENDING_REVIEW';
    const canActOnAccounting = ['ADMIN', 'CONTABILIDAD'].includes(userRole) && stage === 'PENDING_BILLING';

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
                {/* Header */}
                <div className="flex justify-between items-center p-6 border-b border-gray-100 bg-gradient-to-r from-orange-50 to-red-50">
                    <div>
                        <div className="flex items-center gap-3">
                            <AlertTriangle size={20} className="text-orange-600" />
                            <h2 className="text-xl font-bold text-gray-900">PQR Interno #{pqr.ticketNumber}</h2>
                            <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${isRejected ? 'bg-red-100 text-red-700' :
                                    isCompleted ? 'bg-green-100 text-green-700' :
                                        'bg-orange-100 text-orange-700'
                                }`}>
                                {isRejected ? 'Rechazado' : isCompleted ? 'Completado' : 'En Proceso'}
                            </span>
                            {pqr.origin && (
                                <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600">
                                    {ORIGIN_LABELS[pqr.origin] || pqr.origin}
                                </span>
                            )}
                        </div>
                        <p className="text-sm text-gray-500 mt-1">
                            Creado el {new Date(pqr.createdAt).toLocaleDateString()} por {pqr.user?.name}
                            {pqr.daysAfterProduction ? ` • ${pqr.daysAfterProduction} días desde fabricación` : ''}
                        </p>
                    </div>
                    <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100"><X size={22} /></button>
                </div>

                <div className="p-6">
                    {/* Timeline */}
                    {!isRejected && (
                        <div className="mb-8">
                            <div className="flex items-center justify-between relative">
                                <div className="absolute left-0 right-0 top-1/2 h-1 bg-gray-100 -z-10 rounded-full" />
                                <div className="absolute left-0 top-1/2 h-1 bg-orange-500 -z-10 rounded-full transition-all duration-500"
                                    style={{ width: `${Math.max(0, Math.min(100, (currentStep / (STAGE_STEPS.length - 1)) * 100))}%` }} />
                                {STAGE_STEPS.map((step, index) => {
                                    const isActive = index <= currentStep;
                                    const Icon = step.icon;
                                    return (
                                        <div key={step.id} className="flex flex-col items-center gap-2 bg-white px-3">
                                            <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all ${isActive ? 'bg-orange-500 border-orange-500 text-white shadow-lg shadow-orange-200' : 'bg-white border-gray-200 text-gray-300'}`}>
                                                <Icon size={18} />
                                            </div>
                                            <span className={`text-xs font-medium text-center ${isActive ? 'text-orange-700' : 'text-gray-400'}`}>{step.label}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* Left: Products */}
                        <div className="lg:col-span-2 space-y-4">
                            <h3 className="font-bold text-gray-700 text-sm uppercase tracking-wider">Productos Reportados</h3>
                            {pqr.items?.map((item, i) => (
                                <div key={i} className="bg-gray-50 rounded-xl border border-gray-100 p-4">
                                    <div className="flex justify-between items-start mb-2">
                                        <div>
                                            <h4 className="font-bold text-gray-900">{item.product?.name || '(Sin producto)'}</h4>
                                            {item.product?.sku && <p className="text-xs text-gray-400">SKU: {item.product.sku}</p>}
                                            {item.lotNumber && (
                                                <span className="inline-block mt-1 text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-md font-medium">Lote: {item.lotNumber}</span>
                                            )}
                                        </div>
                                        <div className="text-right">
                                            <span className="bg-white px-3 py-1 rounded-lg border border-gray-200 font-bold text-sm">{item.quantity} {item.unit}</span>
                                            <p className="text-xs text-gray-500 mt-1">{pqrTypeLabels[item.type] || item.type}</p>
                                        </div>
                                    </div>
                                    <div className="bg-white p-3 rounded-lg border border-gray-100 text-sm text-gray-600 italic mb-3">
                                        "{item.description}"
                                    </div>
                                    {item.evidence?.length > 0 && (
                                        <div className="flex gap-2 overflow-x-auto pb-1">
                                            {item.evidence.filter(e => e.type === 'IMAGE').map((ev, j) => (
                                                <div key={j} onClick={() => setSelectedImage(ev)}
                                                    className="w-16 h-16 rounded-lg bg-gray-200 flex-shrink-0 cursor-pointer overflow-hidden border border-gray-300 group relative">
                                                    <img src={`${import.meta.env.VITE_API_URL}${ev.url}`} className="w-full h-full object-cover" />
                                                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all flex items-center justify-center">
                                                        <Eye size={12} className="text-white opacity-0 group-hover:opacity-100" />
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ))}

                            {pqr.adjustmentDocUrl && (
                                <div className="mt-2">
                                    <h3 className="font-bold text-gray-700 text-sm uppercase tracking-wider mb-2">Documento de Ajuste</h3>
                                    <a href={`${import.meta.env.VITE_API_URL}${pqr.adjustmentDocUrl}`} target="_blank" rel="noopener noreferrer"
                                        className="flex items-center gap-2 px-4 py-2 bg-orange-50 border border-orange-200 rounded-lg text-orange-800 text-sm hover:bg-orange-100 w-fit">
                                        <FileText size={16} /> Ajuste de Inventario PDF
                                    </a>
                                </div>
                            )}
                        </div>

                        {/* Right: Action Panel */}
                        <div>
                            {!isCompleted && !isRejected && (
                                <div className="bg-white border border-orange-100 rounded-xl shadow-sm overflow-hidden">
                                    <div className="bg-orange-50/70 p-4 border-b border-orange-100">
                                        <h3 className="font-bold text-orange-900 flex items-center gap-2 text-sm">
                                            <AlertCircle size={16} /> Panel de Gestión
                                        </h3>
                                    </div>
                                    <div className="p-4 space-y-4">
                                        {!canActOnQuality && !canActOnAccounting && (
                                            <div className="bg-gray-50 text-gray-500 text-xs p-4 rounded-lg text-center">
                                                <p className="font-medium mb-1">⏳ En espera</p>
                                                <p>{stage === 'PENDING_REVIEW' ? 'Revisión por Calidad.' : 'Ajuste de inventario por Contabilidad.'}</p>
                                            </div>
                                        )}

                                        {canActOnQuality && (
                                            <>
                                                <div className="bg-blue-50 text-blue-800 text-xs p-3 rounded-lg">
                                                    <strong>📋 Revisión de Calidad:</strong> Verifique los productos y evidencia. Si es válido, apruebe para Contabilidad.
                                                </div>
                                                <textarea className="w-full border border-gray-200 rounded-lg text-sm p-3 focus:ring-2 focus:ring-orange-400 bg-gray-50 focus:bg-white"
                                                    rows="3" placeholder="Notas internas o motivo de rechazo..." value={actionNote} onChange={e => setActionNote(e.target.value)} />
                                                <div className="grid grid-cols-2 gap-3">
                                                    <button onClick={() => handleAction('REJECT')} disabled={processing}
                                                        className="px-3 py-2 border border-red-200 text-red-600 rounded-lg hover:bg-red-50 text-sm font-medium disabled:opacity-50">Rechazar</button>
                                                    <button onClick={() => handleAction('APPROVE_QUALITY')} disabled={processing}
                                                        className="px-3 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 text-sm font-bold shadow-md shadow-orange-200 disabled:opacity-50">Aprobar</button>
                                                </div>
                                            </>
                                        )}

                                        {canActOnAccounting && (
                                            <>
                                                <div className="bg-amber-50 text-amber-800 text-xs p-3 rounded-lg space-y-1">
                                                    <p><strong>📦 Ajuste de Inventario:</strong></p>
                                                    <ol className="list-decimal ml-4 space-y-0.5">
                                                        <li>Cree el ajuste en Siigo.</li>
                                                        <li>Adjunte el PDF (opcional).</li>
                                                        <li>Confirme para cerrar.</li>
                                                    </ol>
                                                </div>
                                                <textarea className="w-full border border-gray-200 rounded-lg text-sm p-3 focus:ring-2 focus:ring-orange-400 bg-gray-50 focus:bg-white"
                                                    rows="2" placeholder="Notas de contabilidad..." value={actionNote} onChange={e => setActionNote(e.target.value)} />
                                                <div className={`border-2 rounded-xl p-3 transition-all ${adjFile ? 'border-amber-400 bg-amber-50/50' : 'border-dashed border-gray-300'}`}>
                                                    <div className="flex items-center gap-2 mb-2">
                                                        <Upload size={14} className="text-gray-500" />
                                                        <span className="text-xs font-medium text-gray-700">PDF Ajuste <span className="text-gray-400">(opcional)</span></span>
                                                    </div>
                                                    <input type="file" accept="application/pdf" onChange={e => setAdjFile(e.target.files[0])}
                                                        className="block w-full text-xs text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-amber-500 file:text-white hover:file:bg-amber-600 cursor-pointer" />
                                                    {adjFile && <p className="text-xs text-gray-500 mt-1 truncate">📎 {adjFile.name}</p>}
                                                </div>
                                                <button onClick={() => handleAction('CONFIRM_ADJUSTMENT')} disabled={processing}
                                                    className="w-full px-4 py-3 bg-amber-600 text-white rounded-xl hover:bg-amber-700 text-sm font-bold shadow-lg shadow-amber-200 disabled:opacity-50">
                                                    {processing ? 'Procesando...' : '✅ Confirmar Ajuste de Inventario'}
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </div>
                            )}

                            {(isCompleted || isRejected) && (
                                <div className={`p-4 rounded-xl border ${isRejected ? 'bg-red-50 border-red-100' : 'bg-green-50 border-green-100'}`}>
                                    <h3 className={`font-bold mb-1 ${isRejected ? 'text-red-800' : 'text-green-800'}`}>
                                        {isRejected ? '❌ Rechazado' : '✅ Completado'}
                                    </h3>
                                    {pqr.rejectionReason && <p className="text-sm text-red-700">Motivo: {pqr.rejectionReason}</p>}
                                    {isCompleted && <p className="text-sm text-green-700">El ajuste de inventario fue procesado.</p>}
                                    {pqr.resolvedAt && <p className="text-xs text-gray-400 mt-1">Cerrado: {new Date(pqr.resolvedAt).toLocaleString()}</p>}
                                    {pqr.managedBy && <p className="text-xs text-gray-400">Por: {pqr.managedBy.name}</p>}
                                </div>
                            )}

                            {pqr.internalNotes && (
                                <div className="mt-4 p-3 bg-gray-50 rounded-xl border border-gray-100">
                                    <p className="text-xs font-bold text-gray-500 uppercase mb-1">Notas Internas</p>
                                    <p className="text-sm text-gray-600 italic">"{pqr.internalNotes}"</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {selectedImage && (
                <div className="fixed inset-0 z-[60] bg-black/95 flex items-center justify-center p-4" onClick={() => setSelectedImage(null)}>
                    <button onClick={() => setSelectedImage(null)} className="absolute top-4 right-4 text-white/70 hover:text-white bg-black/50 rounded-full p-2"><X size={28} /></button>
                    <img src={`${import.meta.env.VITE_API_URL}${selectedImage.url}`} className="max-h-[85vh] max-w-full object-contain rounded-lg shadow-2xl" onClick={e => e.stopPropagation()} />
                </div>
            )}
        </div>
    );
};

export default InternalPQRDetail;
