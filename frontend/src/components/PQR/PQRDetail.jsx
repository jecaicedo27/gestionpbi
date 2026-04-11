import React, { useState, useEffect, useCallback } from 'react';
import { X, Eye, Check, AlertCircle, ChevronLeft, ChevronRight, FileText, Package, CheckCircle, Upload, Receipt } from 'lucide-react';
import axios from 'axios';
import { useAuth } from '../../context/AuthContext';

const PQRDetail = ({ pqr, onClose, onUpdate, isReadOnly = false }) => {
    const { token, user } = useAuth();
    const [selectedImage, setSelectedImage] = useState(null);
    const [actionNote, setActionNote] = useState('');
    const [processing, setProcessing] = useState(false);
    const [ncProcessing, setNcProcessing] = useState(false);
    const [ncResult, setNcResult] = useState(null); // { name, id, url }
    const [adjustmentProcessing, setAdjustmentProcessing] = useState(false);
    const [adjustmentNotes, setAdjustmentNotes] = useState('');
    const [adjustmentDocFile, setAdjustmentDocFile] = useState(null);
    const [billingFiles, setBillingFiles] = useState([]);
    const [accountStatementFiles, setAccountStatementFiles] = useState([]);
    const [dispatchFiles, setDispatchFiles] = useState([]);
    const [toast, setToast] = useState(null); // { type: 'success'|'error'|'warning', message }
    const [confirmDialog, setConfirmDialog] = useState(null); // { message, onConfirm }

    // Clipboard paste handler — appends pasted images to the active upload section
    const handlePaste = useCallback((e) => {
        const items = e.clipboardData?.items;
        if (!items) return;
        const pastedFiles = [];
        for (const item of items) {
            if (item.type.startsWith('image/')) {
                const file = item.getAsFile();
                if (file) pastedFiles.push(file);
            }
        }
        if (pastedFiles.length === 0) return;
        e.preventDefault();

        const stage = pqr.stage || (pqr.status === 'PENDING' ? 'PENDING_REVIEW' : null);
        if (stage === 'PENDING_LOGISTICS') {
            setDispatchFiles(prev => [...prev, ...pastedFiles]);
        } else if (stage === 'PENDING_BILLING') {
            setBillingFiles(prev => [...prev, ...pastedFiles]);
        } else if (pqr.pendingAdjustment) {
            // Use the last pasted image as the adjustment document
            setAdjustmentDocFile(pastedFiles[pastedFiles.length - 1]);
        }
    }, [pqr.stage, pqr.status, pqr.pendingAdjustment]);

    useEffect(() => {
        document.addEventListener('paste', handlePaste);
        return () => document.removeEventListener('paste', handlePaste);
    }, [handlePaste]);

    const getStatusBadge = (status) => {
        const styles = {
            PENDING: 'bg-yellow-100 text-yellow-800',
            IN_REVIEW: 'bg-blue-100 text-blue-800',
            APPROVED: 'bg-green-100 text-green-800',
            REJECTED: 'bg-red-100 text-red-800',
            PROCESSED: 'bg-purple-100 text-purple-800'
        };
        const labels = {
            PENDING: 'Pendiente',
            IN_REVIEW: 'En Revisión',
            APPROVED: 'Aprobado',
            REJECTED: 'Rechazado',
            PROCESSED: 'Procesado'
        };
        return (
            <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[status] || 'bg-gray-100 text-gray-800'}`}>
                {labels[status] || status}
            </span>
        );
    };

    const createSiigoNC = async () => {
        setNcProcessing(true);
        try {
            const res = await axios.post(
                `${import.meta.env.VITE_API_URL}/api/pqr/${pqr.id}/siigo-credit-note`,
                {},
                { headers: { Authorization: `Bearer ${token}` } }
            );
            setNcResult(res.data.creditNote);
            setToast({ type: 'success', message: `✅ Nota Crédito ${res.data.creditNote?.name} creada en Siigo` });
            setTimeout(() => { if (onUpdate) onUpdate(); onClose(); }, 2000);
        } catch (err) {
            const msg = err.response?.data?.siigoError || err.response?.data?.error || err.message;
            setToast({ type: 'error', message: `❌ Error Siigo: ${msg}` });
        } finally {
            setNcProcessing(false);
        }
    };

    const markAdjustmentDone = async () => {
        setAdjustmentProcessing(true);
        try {
            const formData = new FormData();
            formData.append('notes', adjustmentNotes || 'Ajuste de inventario por daños registrado');
            if (adjustmentDocFile) formData.append('adjustmentDoc', adjustmentDocFile);

            await axios.post(
                `${import.meta.env.VITE_API_URL}/api/pqr/${pqr.id}/adjustment-done`,
                formData,
                { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'multipart/form-data' } }
            );
            setToast({ type: 'success', message: '✅ Ajuste de inventario registrado exitosamente' });
            setTimeout(() => { if (onUpdate) onUpdate(); onClose(); }, 1800);
        } catch (err) {
            setToast({ type: 'error', message: err.response?.data?.error || 'Error al registrar ajuste' });
        } finally {
            setAdjustmentProcessing(false);
        }
    };

    const handleAction = async (action, extraData = {}) => {
        if (action === 'REJECT' && !actionNote.trim()) {
            setToast({ type: 'warning', message: 'Por favor ingrese una razón para el rechazo.' });
            return;
        }

        // Use custom confirm dialog instead of native confirm()
        setConfirmDialog({
            message: action === 'REJECT' 
                ? '¿Está seguro de rechazar esta solicitud?'
                : action === 'DISPATCH'
                ? `¿Confirmar despacho con ${dispatchFiles.length} evidencia(s)?`
                : '¿Está seguro de continuar con esta acción?',
            onConfirm: () => executeAction(action, extraData)
        });
    };

    const executeAction = async (action, extraData = {}) => {
        setConfirmDialog(null);

        setProcessing(true);
        try {
            if (action === 'DISPATCH') {
                if (dispatchFiles.length === 0) {
                    setToast({ type: 'warning', message: 'Debe seleccionar al menos una foto de evidencia.' });
                    setProcessing(false);
                    return;
                }
                const formData = new FormData();
                dispatchFiles.forEach(f => formData.append('file', f));
                if (actionNote) formData.append('notes', actionNote);

                await axios.post(`${import.meta.env.VITE_API_URL}/api/pqr/${pqr.id}/dispatch`, formData, {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'multipart/form-data'
                    }
                });
            } else if (action === 'UPLOAD_CREDIT_NOTE' || action === 'UPLOAD_INVOICE') {
                if (billingFiles.length === 0) {
                    setToast({ type: 'warning', message: 'Debe seleccionar al menos un archivo.' });
                    setProcessing(false);
                    return;
                }
                if (action === 'UPLOAD_CREDIT_NOTE' && accountStatementFiles.length === 0) {
                    setToast({ type: 'warning', message: 'Debe subir el estado de cuenta del cliente.' });
                    setProcessing(false);
                    return;
                }
                const formData = new FormData();
                billingFiles.forEach(f => formData.append('file', f));
                accountStatementFiles.forEach(f => formData.append('accountStatement', f));
                formData.append('documentType', action === 'UPLOAD_CREDIT_NOTE' ? 'credit_note' : 'invoice');
                formData.append('notes', actionNote);

                await axios.post(`${import.meta.env.VITE_API_URL}/api/pqr/${pqr.id}/billing`, formData, {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'multipart/form-data'
                    }
                });
            } else {
                const payload = {
                    action,
                    rejectionReason: action === 'REJECT' ? actionNote : null,
                    internalNotes: actionNote,
                    ...extraData
                };

                await axios.patch(`${import.meta.env.VITE_API_URL}/api/pqr/${pqr.id}/status`, payload, {
                    headers: { Authorization: `Bearer ${token}` }
                });
            }

            if (onUpdate) onUpdate();
            setToast({ type: 'success', message: '✅ Estado actualizado correctamente.' });
            setTimeout(() => onClose(), 1200);
        } catch (err) {
            console.error('Error updating PQR:', err);
            setToast({ type: 'error', message: 'Error al actualizar: ' + (err.response?.data?.error || err.message) });
        } finally {
            setProcessing(false);
        }
    };

    // Timeline steps — dynamic based on refund method
    const isReplacement = pqr.refundMethod === 'PHYSICAL_REPLACEMENT';

    const steps = isReplacement ? [
        { id: 'PENDING_REVIEW', label: 'Revisión Calidad', icon: Eye },
        { id: 'PENDING_BILLING', label: 'Nota Crédito', icon: Receipt },
        { id: 'PENDING_INVOICE', label: 'Facturación', icon: FileText },
        { id: 'PENDING_LOGISTICS', label: 'Logística', icon: Package },
        { id: 'COMPLETED', label: 'Completado', icon: CheckCircle }
    ] : [
        { id: 'PENDING_REVIEW', label: 'Revisión Calidad', icon: Eye },
        { id: 'PENDING_BILLING', label: 'Nota Crédito', icon: Receipt },
        { id: 'COMPLETED', label: 'Completado', icon: CheckCircle }
    ];

    const getCurrentStepIndex = () => {
        if (pqr.status === 'REJECTED') return -1;
        if (pqr.status === 'PENDING') return 0;

        const stageMap = isReplacement ? {
            'PENDING_REVIEW': 0,
            'PENDING_BILLING': 1,
            'PENDING_INVOICE': 2,
            'PENDING_LOGISTICS': 3,
            'DISPATCHED': 4,
            'COMPLETED': 4
        } : {
            'PENDING_REVIEW': 0,
            'PENDING_BILLING': 1,
            'COMPLETED': 2
        };
        return stageMap[pqr.stage] ?? 0;
    };

    const currentStepIndex = getCurrentStepIndex();

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-5xl max-h-[90vh] overflow-y-auto flex flex-col animate-fadeIn">

                {/* Header */}
                <div className="flex justify-between items-center p-6 border-b border-gray-100 bg-gray-50/50">
                    <div>
                        <div className="flex items-center gap-3">
                            <h2 className="text-xl font-bold text-gray-900">Ticket #{pqr.ticketNumber}</h2>
                            {getStatusBadge(pqr.status)}
                            {pqr.refundMethod === 'WALLET_BALANCE' && <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">Saldo a Favor</span>}
                            {pqr.refundMethod === 'PHYSICAL_REPLACEMENT' && <span className="text-xs bg-purple-100 text-purple-800 px-2 py-0.5 rounded-full">Reposición Física</span>}
                        </div>
                        <p className="text-sm text-gray-500 mt-1">Creado el {new Date(pqr.createdAt).toLocaleDateString()} • {pqr.stage}</p>
                    </div>
                    <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors"><X size={24} /></button>
                </div>

                <div className="p-6">
                    {/* TIMELINE */}
                    <div className="mb-8">
                        <div className="flex items-center justify-between relative">
                            {/* Connector Line */}
                            <div className="absolute left-0 right-0 top-1/2 h-1 bg-gray-100 -z-10 rounded-full"></div>
                            <div
                                className="absolute left-0 top-1/2 h-1 bg-blue-500 -z-10 rounded-full transition-all duration-500"
                                style={{ width: `${Math.max(0, Math.min(100, (currentStepIndex / (steps.length - 1)) * 100))}%` }}
                            ></div>

                            {steps.map((step, index) => {
                                const isActive = index <= currentStepIndex;
                                const isCurrent = index === currentStepIndex;
                                const Icon = step.icon;

                                return (
                                    <div key={step.id} className="flex flex-col items-center gap-2 bg-white px-2">
                                        <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all ${isActive ? 'bg-blue-600 border-blue-600 text-white shadow-lg shadow-blue-200' : 'bg-white border-gray-200 text-gray-300'}`}>
                                            <Icon size={18} />
                                        </div>
                                        <span className={`text-xs font-medium ${isActive ? 'text-blue-700' : 'text-gray-400'}`}>{step.label}</span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* TWO COLUMN LAYOUT */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

                        {/* LEFT: DETAILS */}
                        <div className="lg:col-span-2 space-y-6">
                            {/* Distributor Info */}
                            <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm flex items-center gap-4">
                                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center font-bold text-xl shadow-md">
                                    {pqr.user?.name?.charAt(0) || 'U'}
                                </div>
                                <div>
                                    <h3 className="font-bold text-gray-900">{pqr.user?.name}</h3>
                                    <p className="text-sm text-gray-500">{pqr.user?.email}</p>
                                    <p className="text-xs text-gray-400 mt-0.5">Rol: {pqr.user?.role}</p>
                                    {pqr.reportedByName && (
                                        <p className="text-xs text-blue-700 mt-1">
                                            Reportado por: <span className="font-semibold">{pqr.reportedByName}</span>
                                        </p>
                                    )}
                                </div>
                            </div>

                            {/* Products List */}
                            <h3 className="font-bold text-gray-800 text-sm uppercase tracking-wider">Productos Reportados</h3>
                            <div className="space-y-4">
                                {pqr.items?.map((item, index) => (
                                    <div key={index} className="bg-gray-50 rounded-xl border border-gray-100 p-5 hover:shadow-md transition-shadow">
                                        <div className="flex justify-between items-start mb-3">
                                            <div>
                                                <h4 className="font-bold text-gray-900">{item.product?.name}</h4>
                                                <p className="text-xs text-gray-500">SKU: {item.product?.sku}</p>
                                                {item.lotNumber && (
                                                    <span className="inline-block mt-1 text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-md font-medium">Lote: {item.lotNumber}</span>
                                                )}
                                            </div>
                                            <span className="bg-white px-3 py-1 rounded-lg border border-gray-200 font-bold text-sm shadow-sm">
                                                {item.quantity} {item.unit}
                                            </span>
                                        </div>

                                        <div className="bg-white p-3 rounded-lg border border-gray-100 text-sm text-gray-600 italic mb-4">
                                            "{item.description}"
                                        </div>

                                        {/* Evidence Grid */}
                                        {item.evidence?.length > 0 && (
                                            <div className="flex gap-2 overflow-x-auto pb-2">
                                                {item.evidence.map(ev => (
                                                    <div
                                                        key={ev.id}
                                                        onClick={() => ev.type === 'IMAGE' && setSelectedImage({ images: item.evidence.filter(e => e.type === 'IMAGE'), index: item.evidence.filter(e => e.type === 'IMAGE').findIndex(e => e.id === ev.id) })}
                                                        className="w-16 h-16 rounded-lg bg-gray-200 flex-shrink-0 cursor-pointer overflow-hidden border border-gray-300 relative group"
                                                    >
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
                            </div>

                            {/* Uploaded Documents Section */}
                            {(pqr.creditNoteUrl || pqr.accountStatementUrl || pqr.invoiceUrl || pqr.dispatchEvidenceUrl) && (() => {
                                // Parse URL that may be a JSON array of URLs or a single URL
                                const parseUrls = (raw) => {
                                    if (!raw) return [];
                                    try {
                                        const parsed = JSON.parse(raw);
                                        if (Array.isArray(parsed)) return parsed;
                                    } catch {}
                                    return [raw];
                                };

                                const renderDocLinks = (urls, label, Icon, colorClass) => {
                                    if (urls.length === 0) return null;
                                    return urls.map((url, i) => (
                                        <a key={url} href={`${import.meta.env.VITE_API_URL}${url}`} target="_blank" rel="noopener noreferrer"
                                            className={`flex items-center gap-2 px-4 py-2 border rounded-lg text-sm hover:opacity-80 transition-colors ${colorClass}`}>
                                            <Icon size={16} />
                                            {label}{urls.length > 1 ? ` (${i + 1})` : ''}
                                        </a>
                                    ));
                                };

                                return (
                                    <div className="space-y-2">
                                        <h3 className="font-bold text-gray-800 text-sm uppercase tracking-wider">Documentos del Proceso</h3>
                                        <div className="flex gap-3 flex-wrap">
                                            {renderDocLinks(parseUrls(pqr.creditNoteUrl), 'Nota Crédito', FileText, 'bg-green-50 border-green-200 text-green-800')}
                                            {renderDocLinks(parseUrls(pqr.accountStatementUrl), 'Estado de Cuenta', FileText, 'bg-emerald-50 border-emerald-200 text-emerald-800')}
                                            {renderDocLinks(parseUrls(pqr.invoiceUrl), 'Factura', Receipt, 'bg-blue-50 border-blue-200 text-blue-800')}
                                            {renderDocLinks(parseUrls(pqr.dispatchEvidenceUrl), 'Evidencia Despacho', Package, 'bg-purple-50 border-purple-200 text-purple-800')}
                                        </div>
                                    </div>
                                );
                            })()}
                        </div>

                        {/* RIGHT: ACTIONS & HISTORY */}
                        <div className="space-y-6">

                            {/* ACTION PANEL */}
                            {!isReadOnly && pqr.status !== 'REJECTED' && pqr.stage !== 'COMPLETED' && (() => {
                                const userRole = user?.role;
                                const stage = pqr.stage || (pqr.status === 'PENDING' ? 'PENDING_REVIEW' : null);

                                // Determine if this user can act on the current stage
                                const isInternal = pqr.ticketNumber?.startsWith('PQR-INT-');
                                const canActOnQuality = ['ADMIN', 'CALIDAD'].includes(userRole) && (stage === 'PENDING_REVIEW' || pqr.status === 'PENDING');
                                const canActOnBilling = ['ADMIN', 'COMERCIAL'].includes(userRole) && stage === 'PENDING_BILLING' && !isInternal;
                                const canActOnInvoice = ['ADMIN', 'COMERCIAL'].includes(userRole) && stage === 'PENDING_INVOICE' && !isInternal;
                                const canActOnLogistics = ['ADMIN', 'LOGISTICA'].includes(userRole) && stage === 'PENDING_LOGISTICS' && !isInternal;
                                const canAct = canActOnQuality || canActOnBilling || canActOnInvoice || canActOnLogistics;

                                // Waiting message for stages not matching user's role
                                const waitingMessages = {
                                    'PENDING_REVIEW': 'Este PQR está en revisión por el equipo de Calidad.',
                                    'PENDING_BILLING': 'Este PQR está pendiente de Nota Crédito por Contabilidad.',
                                    'PENDING_INVOICE': 'Este PQR está pendiente de Facturación por el área Comercial.',
                                    'PENDING_LOGISTICS': 'Este PQR está pendiente de despacho por Logística.'
                                };

                                return (
                                    <div className="bg-white border border-blue-100 rounded-xl shadow-lg ring-1 ring-black/5 overflow-hidden">
                                        <div className="bg-blue-50/50 p-4 border-b border-blue-100">
                                            <h3 className="font-bold text-blue-900 flex items-center gap-2">
                                                <AlertCircle size={18} />
                                                Panel de Gestión
                                            </h3>
                                        </div>
                                        <div className="p-4 space-y-4">

                                            {/* WAITING STATE — PQR is at another role's stage */}
                                            {!canAct && (
                                                <div className="bg-gray-50 text-gray-600 text-sm p-4 rounded-lg text-center">
                                                    <p className="font-medium mb-1">⏳ En espera</p>
                                                    <p className="text-xs">{waitingMessages[stage] || 'Este PQR está siendo procesado por otro equipo.'}</p>
                                                </div>
                                            )}

                                            {/* STAGE 1: QUALITY REVIEW */}
                                            {canActOnQuality && (
                                                <>
                                                    <div className="bg-blue-50 text-blue-800 text-xs p-3 rounded-lg">
                                                        <strong>📋 Revisión de Calidad:</strong> Revise los productos reportados y la evidencia. Apruebe si el reclamo es válido o rechace con motivo.
                                                    </div>
                                                    <textarea
                                                        className="w-full border-gray-200 rounded-lg text-sm p-3 focus:ring-2 focus:ring-blue-500 transition-shadow bg-gray-50 focus:bg-white"
                                                        rows="3"
                                                        placeholder="Notas internas o motivo de rechazo..."
                                                        value={actionNote}
                                                        onChange={(e) => setActionNote(e.target.value)}
                                                    ></textarea>
                                                    <div className="grid grid-cols-2 gap-3">
                                                        <button
                                                            onClick={() => handleAction('REJECT')}
                                                            disabled={processing}
                                                            className="px-4 py-2 border border-red-200 text-red-600 rounded-lg hover:bg-red-50 text-sm font-medium disabled:opacity-50"
                                                        >
                                                            Rechazar
                                                        </button>
                                                        <button
                                                            onClick={() => handleAction('APPROVE_QUALITY')}
                                                            disabled={processing}
                                                            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium shadow-md shadow-blue-200 disabled:opacity-50"
                                                        >
                                                            Aprobar Calidad
                                                        </button>
                                                    </div>
                                                </>
                                            )}

                                            {/* STAGE 2: NOTA CRÉDITO (COMERCIAL — crea NC manualmente en Siigo y sube PDF) */}
                                            {canActOnBilling && (
                                                <>
                                                    <div className="bg-amber-50 text-amber-800 text-xs p-3 rounded-lg space-y-1">
                                                        <p><strong>📄 Nota Crédito:</strong></p>
                                                        <p>Método: <strong>{pqr.refundMethod === 'WALLET_BALANCE' ? 'Saldo a Favor' : 'Reposición Física'}</strong></p>
                                                        {isReplacement && (
                                                            <p className="mt-2 text-purple-700 font-medium">⚠️ Al ser reposición física, después deberá crear la factura.</p>
                                                        )}
                                                    </div>

                                                    {/* ── Siigo Auto-Create button ── */}
                                                    {ncResult ? (
                                                        <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
                                                            <p className="text-green-800 font-bold text-sm">✅ NC creada en Siigo</p>
                                                            <p className="text-green-700 text-lg font-mono font-bold mt-1">{ncResult.name}</p>
                                                            {ncResult.url && <a href={ncResult.url} target="_blank" rel="noreferrer" className="text-xs text-green-600 underline mt-1 block">Ver en Siigo →</a>}
                                                        </div>
                                                    ) : (
                                                        <button
                                                            onClick={createSiigoNC}
                                                            disabled={ncProcessing}
                                                            className={`w-full px-4 py-3.5 rounded-xl text-sm font-bold shadow-lg transition-all flex items-center justify-center gap-2 ${
                                                                ncProcessing
                                                                    ? 'bg-gray-100 text-gray-400 cursor-wait'
                                                                    : 'bg-gradient-to-r from-green-600 to-emerald-600 text-white hover:from-green-700 hover:to-emerald-700 shadow-green-200'
                                                            }`}
                                                        >
                                                            {ncProcessing ? (
                                                                <><svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg> Creando en Siigo...</>
                                                            ) : (
                                                                <>🧾 Crear Nota Crédito en Siigo</>
                                                            )}
                                                        </button>
                                                    )}

                                                    <div className="flex items-center gap-3 my-1">
                                                        <div className="flex-1 h-px bg-gray-200"/>
                                                        <span className="text-xs text-gray-400">o suba manualmente</span>
                                                        <div className="flex-1 h-px bg-gray-200"/>
                                                    </div>
                                                    <textarea
                                                        className="w-full border-gray-200 rounded-lg text-sm p-3 focus:ring-2 focus:ring-blue-500 transition-shadow bg-gray-50 focus:bg-white"
                                                        rows="2"
                                                        placeholder="Notas de contabilidad..."
                                                        value={actionNote}
                                                        onChange={(e) => setActionNote(e.target.value)}
                                                    ></textarea>

                                                    {/* Upload Card 1: Nota Crédito */}
                                                    <div className={`border-2 rounded-xl p-4 transition-all ${billingFiles.length > 0 ? 'border-amber-400 bg-amber-50/50' : 'border-dashed border-gray-300 bg-white'}`}>
                                                        <div className="flex items-center gap-2 mb-2">
                                                            <span className="text-lg">📄</span>
                                                            <span className="font-bold text-sm text-gray-800">1. Nota Crédito</span>
                                                            {billingFiles.length > 0 && <span className="ml-auto text-amber-600 text-xs font-semibold">✓ {billingFiles.length} archivo(s)</span>}
                                                        </div>
                                                        <input
                                                            type="file"
                                                            multiple
                                                            accept="image/*,application/pdf"
                                                            onChange={(e) => setBillingFiles(Array.from(e.target.files))}
                                                            className="block w-full text-xs text-gray-500 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-amber-500 file:text-white hover:file:bg-amber-600 cursor-pointer"
                                                        />
                                                        {billingFiles.length > 0 && <p className="text-xs text-gray-500 mt-1 truncate">📎 {billingFiles.map(f => f.name).join(', ')}</p>}
                                                    </div>

                                                    {/* Upload Card 2: Estado de Cuenta */}
                                                    <div className={`border-2 rounded-xl p-4 transition-all ${accountStatementFiles.length > 0 ? 'border-emerald-400 bg-emerald-50/50' : 'border-dashed border-gray-300 bg-white'}`}>
                                                        <div className="flex items-center gap-2 mb-2">
                                                            <span className="text-lg">🧾</span>
                                                            <span className="font-bold text-sm text-gray-800">2. Estado de Cuenta del Cliente</span>
                                                            {accountStatementFiles.length > 0 && <span className="ml-auto text-emerald-600 text-xs font-semibold">✓ {accountStatementFiles.length} archivo(s)</span>}
                                                        </div>
                                                        <input
                                                            type="file"
                                                            multiple
                                                            accept="image/*,application/pdf"
                                                            onChange={(e) => setAccountStatementFiles(Array.from(e.target.files))}
                                                            className="block w-full text-xs text-gray-500 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-emerald-500 file:text-white hover:file:bg-emerald-600 cursor-pointer"
                                                        />
                                                        {accountStatementFiles.length > 0 && <p className="text-xs text-gray-500 mt-1 truncate">📎 {accountStatementFiles.map(f => f.name).join(', ')}</p>}
                                                    </div>

                                                    <button
                                                        onClick={() => handleAction('UPLOAD_CREDIT_NOTE')}
                                                        disabled={billingFiles.length === 0 || accountStatementFiles.length === 0 || processing}
                                                        className={`w-full px-4 py-3 bg-amber-600 text-white rounded-xl hover:bg-amber-700 text-sm font-bold shadow-lg shadow-amber-200 transition-all ${billingFiles.length === 0 || accountStatementFiles.length === 0 || processing ? 'opacity-50 cursor-not-allowed' : ''}`}
                                                    >
                                                        {processing ? 'Subiendo...' : '✅ Confirmar Nota Crédito y Estado de Cuenta'}
                                                    </button>
                                                </>
                                            )}

                                            {/* STAGE 3: INVOICE (CONTABILIDAD — only for replacement) */}
                                            {canActOnInvoice && (
                                                <>
                                                    <div className="bg-indigo-50 text-indigo-800 text-xs p-3 rounded-lg space-y-1">
                                                        <p><strong>🧾 Facturación de Reposición:</strong></p>
                                                        <ol className="list-decimal ml-4 mt-1 space-y-0.5">
                                                            <li>Cree la <strong>factura</strong> para enviar el pedido de reposición</li>
                                                            <li>Suba el PDF de la factura</li>
                                                            <li>Agregue sus anotaciones</li>
                                                        </ol>
                                                        <p className="mt-2 text-indigo-600 font-medium">➡️ Luego se enviará a Logística para despacho.</p>
                                                    </div>
                                                    <textarea
                                                        className="w-full border-gray-200 rounded-lg text-sm p-3 focus:ring-2 focus:ring-blue-500 transition-shadow bg-gray-50 focus:bg-white"
                                                        rows="3"
                                                        placeholder="Notas de facturación..."
                                                        value={actionNote}
                                                        onChange={(e) => setActionNote(e.target.value)}
                                                    ></textarea>
                                                    <div>
                                                        <label className="block text-xs font-medium text-gray-600 mb-1">Factura (PDF)</label>
                                                        <input
                                                            type="file"
                                                            accept="image/*,application/pdf"
                                                            onChange={(e) => setBillingFiles(Array.from(e.target.files))}
                                                            className="block w-full text-xs text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 cursor-pointer"
                                                        />
                                                    </div>
                                                    <button
                                                        onClick={() => handleAction('UPLOAD_INVOICE')}
                                                        disabled={billingFiles.length === 0 || processing}
                                                        className={`w-full px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium shadow-md shadow-indigo-200 transition-all ${billingFiles.length === 0 || processing ? 'opacity-50 cursor-not-allowed' : ''}`}
                                                    >
                                                        {processing ? 'Subiendo...' : 'Confirmar Factura'}
                                                    </button>
                                                </>
                                            )}

                                            {/* STAGE 4: LOGISTICS (LOGISTICA) */}
                                            {canActOnLogistics && (
                                                <>
                                                    <div className="bg-purple-50 text-purple-800 text-xs p-3 rounded-lg space-y-1">
                                                        <p><strong>📦 Despacho de Reposición:</strong></p>
                                                        <ol className="list-decimal ml-4 mt-1 space-y-0.5">
                                                            <li>Tome foto del <strong>producto</strong> a enviar</li>
                                                            <li>Tome foto del <strong>empaque</strong> y embalaje</li>
                                                            <li>Suba <strong>guía de envío</strong> si aplica</li>
                                                        </ol>
                                                    </div>

                                                    <textarea
                                                        className="w-full border-gray-200 rounded-lg text-sm p-3 focus:ring-2 focus:ring-purple-500 transition-shadow bg-gray-50 focus:bg-white"
                                                        rows="2"
                                                        placeholder="Notas del despacho (guía, transportadora, etc.)..."
                                                        value={actionNote}
                                                        onChange={(e) => setActionNote(e.target.value)}
                                                    ></textarea>

                                                    <div className={`border-2 rounded-xl p-4 transition-all ${dispatchFiles.length > 0 ? 'border-purple-400 bg-purple-50/50' : 'border-dashed border-gray-300 bg-white'}`}>
                                                        <div className="flex items-center gap-2 mb-2">
                                                            <span className="text-lg">📸</span>
                                                            <span className="font-bold text-sm text-gray-800">Evidencias del Despacho</span>
                                                            {dispatchFiles.length > 0 && <span className="ml-auto text-purple-600 text-xs font-semibold">✓ {dispatchFiles.length} archivo(s)</span>}
                                                        </div>
                                                        <input
                                                            type="file"
                                                            multiple
                                                            accept="image/*,application/pdf"
                                                            onChange={(e) => setDispatchFiles(prev => [...prev, ...Array.from(e.target.files)])}
                                                            className="block w-full text-xs text-gray-500 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-purple-500 file:text-white hover:file:bg-purple-600 cursor-pointer"
                                                        />
                                                        <p className="text-xs text-gray-400 mt-1">💡 También puede pegar imágenes con <kbd className="px-1 py-0.5 bg-gray-100 border rounded text-[10px]">Ctrl+V</kbd></p>
                                                        {dispatchFiles.length > 0 && (
                                                            <div className="flex gap-2 mt-2 overflow-x-auto">
                                                                {dispatchFiles.map((f, i) => (
                                                                    <div key={i} className="w-14 h-14 rounded-lg bg-gray-200 flex-shrink-0 overflow-hidden border border-gray-300">
                                                                        {f.type.startsWith('image/') ? (
                                                                            <img src={URL.createObjectURL(f)} className="w-full h-full object-cover" alt={f.name} />
                                                                        ) : (
                                                                            <div className="w-full h-full flex items-center justify-center text-xs text-gray-500">PDF</div>
                                                                        )}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>

                                                    <button
                                                        onClick={() => handleAction('DISPATCH')}
                                                        disabled={dispatchFiles.length === 0 || processing}
                                                        className={`w-full px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 text-sm font-medium shadow-md shadow-purple-200 ${dispatchFiles.length === 0 || processing ? 'opacity-50 cursor-not-allowed' : ''}`}
                                                    >
                                                        {processing ? 'Procesando...' : `📦 Confirmar Despacho (${dispatchFiles.length} evidencia${dispatchFiles.length > 1 ? 's' : ''})`}
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                );
                            })()}

                            {/* COMPLETED/REJECTED STATUS */}
                            {(pqr.status === 'REJECTED' || pqr.stage === 'COMPLETED') && (
                                <div className={`p-4 rounded-xl border ${pqr.status === 'REJECTED' ? 'bg-red-50 border-red-100' : 'bg-green-50 border-green-100'}`}>
                                    <h3 className={`font-bold ${pqr.status === 'REJECTED' ? 'text-red-800' : 'text-green-800'} mb-2`}>
                                        {pqr.status === 'REJECTED' ? 'Solicitud Rechazada' : 'Solicitud Completada'}
                                    </h3>
                                    {pqr.rejectionReason && (
                                        <p className="text-sm text-red-700">Motivo: {pqr.rejectionReason}</p>
                                    )}
                                    {pqr.stage === 'COMPLETED' && (
                                        <p className="text-sm text-green-700">El proceso ha finalizado exitosamente.</p>
                                    )}
                                </div>
                            )}

                            {/* ADMIN: Pending Inventory Adjustment */}
                            {(pqr.pendingAdjustment || (pqr.ticketNumber?.startsWith('PQR-INT-') && !pqr.adjustmentDoneAt)) && ["ADMIN","CONTABILIDAD","CARTERA"].includes(user?.role) && (
                                <div className="bg-orange-50 border border-orange-200 rounded-xl overflow-hidden mt-6">
                                    <div className="bg-orange-100 px-4 py-3 border-b border-orange-200 flex items-center gap-2">
                                        <span className="text-orange-600">🔧</span>
                                        <h3 className="font-bold text-orange-900 text-sm">Ajuste de Inventario Pendiente</h3>
                                        <span className="ml-auto bg-orange-200 text-orange-800 text-xs px-2 py-0.5 rounded-full font-semibold">ADMIN</span>
                                    </div>
                                    <div className="p-4 space-y-3">
                                        <p className="text-xs text-orange-700">
                                            {pqr.ticketNumber?.startsWith('PQR-INT-') 
                                                ? <>Al ser un reporte interno, solo se requiere registrar el <strong>ajuste de inventario por daños</strong> para cerrar el proceso.</>
                                                : <>La NC fue emitida. Registre el <strong>ajuste por daños</strong> de las unidades devueltas para cerrar el proceso.</>}
                                        </p>
                                        <textarea
                                            className="w-full border border-orange-200 rounded-lg text-sm p-2.5 bg-white focus:ring-2 focus:ring-orange-400 resize-none"
                                            rows="2"
                                            placeholder="Observaciones (ej: unidades destruidas, lote dado de baja...)"
                                            value={adjustmentNotes}
                                            onChange={e => setAdjustmentNotes(e.target.value)}
                                        />
                                        {/* Document upload */}
                                        <div className={`border-2 rounded-xl p-3 transition-all ${adjustmentDocFile ? 'border-orange-300 bg-orange-50/80' : 'border-dashed border-orange-200 bg-white'}`}>
                                            <div className="flex items-center gap-2 mb-1.5">
                                                <span className="text-sm">📎</span>
                                                <span className="text-xs font-bold text-orange-800">Documento de Ajuste (PDF)</span>
                                                {adjustmentDocFile && <span className="ml-auto text-orange-600 text-xs font-semibold">✓ {adjustmentDocFile.name}</span>}
                                            </div>
                                            <input
                                                type="file"
                                                accept="application/pdf,image/*"
                                                onChange={e => setAdjustmentDocFile(e.target.files[0] || null)}
                                                className="block w-full text-xs text-gray-500 file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-orange-500 file:text-white hover:file:bg-orange-600 cursor-pointer"
                                            />
                                            <p className="text-[10px] text-gray-400 mt-1">💡 También puede pegar con <kbd className="px-1 py-0.5 bg-gray-100 border rounded text-[10px]">Ctrl+V</kbd></p>
                                        </div>
                                        <button
                                            onClick={markAdjustmentDone}
                                            disabled={adjustmentProcessing || !adjustmentDocFile}
                                            className={"w-full py-2.5 rounded-xl text-sm font-bold transition-all " + (adjustmentProcessing || !adjustmentDocFile ? "bg-gray-200 text-gray-400 cursor-not-allowed" : "bg-orange-500 hover:bg-orange-600 text-white shadow-md shadow-orange-200")}
                                        >
                                            {adjustmentProcessing ? "⏳ Registrando..." : "✅ Registrar Ajuste de Inventario"}
                                        </button>
                                        {!adjustmentDocFile && (
                                            <p className="text-[11px] text-orange-500 text-center">⚠️ Debe adjuntar el documento de ajuste para continuar</p>
                                        )}
                                    </div>
                                </div>
                            )}

                            {!pqr.pendingAdjustment && pqr.adjustmentDoneAt && (
                                <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-xs text-gray-500">
                                    🔧 Ajuste registrado el {new Date(pqr.adjustmentDoneAt).toLocaleDateString('es-CO')}
                                    {pqr.adjustmentNotes && <span className="block text-gray-400 mt-0.5">{pqr.adjustmentNotes}</span>}
                                </div>
                            )}

                        </div>
                    </div>
                </div>


                {/* Image Overlay */}
                {selectedImage && (
                    <div
                        className="fixed inset-0 z-[60] bg-black bg-opacity-95 flex items-center justify-center p-4 animate-fadeIn"
                        onClick={() => setSelectedImage(null)}
                    >
                        <div className="relative w-full max-w-6xl h-full flex items-center justify-center" onClick={(e) => e.stopPropagation()}>

                            {/* Close Button */}
                            <button
                                onClick={() => setSelectedImage(null)}
                                className="absolute top-4 right-4 z-50 text-white/70 hover:text-white bg-black/50 hover:bg-black/80 rounded-full p-2 transition-all"
                            >
                                <X size={32} />
                            </button>

                            {/* Previous Button */}
                            {selectedImage.index > 0 && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setSelectedImage(prev => ({ ...prev, index: prev.index - 1 }));
                                    }}
                                    className="absolute left-4 z-50 text-white/70 hover:text-white bg-black/50 hover:bg-black/80 rounded-full p-3 transition-all transform hover:scale-110"
                                >
                                    <ChevronLeft size={40} />
                                </button>
                            )}

                            {/* Image */}
                            <div className="relative max-h-[90vh] max-w-full">
                                <img
                                    src={`${import.meta.env.VITE_API_URL}${selectedImage.images[selectedImage.index].url}`}
                                    alt={`Evidencia ${selectedImage.index + 1}`}
                                    className="max-h-[85vh] max-w-full object-contain rounded-lg shadow-2xl"
                                />
                                <p className="text-white/80 text-center mt-4 font-medium">
                                    {selectedImage.index + 1} / {selectedImage.images.length}
                                </p>
                            </div>

                            {/* Next Button */}
                            {selectedImage.index < selectedImage.images.length - 1 && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setSelectedImage(prev => ({ ...prev, index: prev.index + 1 }));
                                    }}
                                    className="absolute right-4 z-50 text-white/70 hover:text-white bg-black/50 hover:bg-black/80 rounded-full p-3 transition-all transform hover:scale-110"
                                >
                                    <ChevronRight size={40} />
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {/* Custom Toast Notification */}
                {toast && (
                    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[70] animate-fadeIn">
                        <div className={`flex items-center gap-3 px-5 py-3 rounded-xl shadow-2xl border backdrop-blur-sm ${
                            toast.type === 'success' ? 'bg-green-50 border-green-200 text-green-800' :
                            toast.type === 'error' ? 'bg-red-50 border-red-200 text-red-800' :
                            'bg-amber-50 border-amber-200 text-amber-800'
                        }`}>
                            <span className="text-lg">
                                {toast.type === 'success' ? '✅' : toast.type === 'error' ? '❌' : '⚠️'}
                            </span>
                            <p className="text-sm font-medium max-w-sm">{toast.message}</p>
                            <button onClick={() => setToast(null)} className="ml-2 text-gray-400 hover:text-gray-600">
                                <X size={16} />
                            </button>
                        </div>
                    </div>
                )}

                {/* Custom Confirm Dialog */}
                {confirmDialog && (
                    <div className="fixed inset-0 z-[70] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn">
                        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-fadeIn">
                            <div className="bg-gradient-to-r from-purple-600 to-indigo-600 px-6 py-4">
                                <h3 className="text-white font-bold text-lg">Confirmar Acción</h3>
                            </div>
                            <div className="p-6">
                                <p className="text-gray-700 text-sm mb-6">{confirmDialog.message}</p>
                                <div className="flex gap-3">
                                    <button
                                        onClick={() => setConfirmDialog(null)}
                                        className="flex-1 px-4 py-2.5 border border-gray-200 text-gray-600 rounded-xl hover:bg-gray-50 text-sm font-medium transition-colors"
                                    >
                                        Cancelar
                                    </button>
                                    <button
                                        onClick={confirmDialog.onConfirm}
                                        className="flex-1 px-4 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-xl hover:from-purple-700 hover:to-indigo-700 text-sm font-bold shadow-lg shadow-purple-200 transition-all"
                                    >
                                        Confirmar
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default PQRDetail;
