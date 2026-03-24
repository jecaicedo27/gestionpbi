import React from 'react';
import { ShieldCheck } from 'lucide-react';
import {
    INTERNAL_RELEASE_DECISION_OPTIONS,
    INTERNAL_REVIEW_DECISION_OPTIONS
} from '../microLabConfig';

const formatNormativeRefs = (refs = []) => (
    Array.isArray(refs) ? refs.join('\n') : ''
);

const MicroInternalReviewPanel = ({
    reviewData = {},
    approvalData = {},
    onReviewChange,
    onApprovalChange,
    onReviewSubmit,
    onCloseSubmit,
    canReview = true,
    canClose = false,
    disabled = false,
    saving = false,
    isClosed = false
}) => {
    const updateReviewField = (field, value) => {
        if (typeof onReviewChange !== 'function') return;
        onReviewChange(previous => ({
            ...previous,
            [field]: value
        }));
    };

    const updateApprovalField = (field, value) => {
        if (typeof onApprovalChange !== 'function') return;
        onApprovalChange(previous => ({
            ...previous,
            [field]: value
        }));
    };

    return (
        <div className="bg-white rounded-2xl border border-fuchsia-100 overflow-hidden">
            <div className="bg-fuchsia-50 px-5 py-3 border-b border-fuchsia-100">
                <h3 className="font-bold text-fuchsia-900 text-sm flex items-center gap-2">
                    <ShieldCheck size={16} /> Revisión técnica, aprobación y cierre
                </h3>
                <p className="text-xs text-fuchsia-700 mt-1">
                    Registra el dictamen técnico y, cuando corresponda, deja la aprobación final para generar el reporte y cerrar el caso.
                </p>
            </div>

            <div className="p-5 space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                    <div>
                        <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Fecha revisión</label>
                        <input
                            type="datetime-local"
                            value={reviewData.reviewedAt || ''}
                            onChange={event => updateReviewField('reviewedAt', event.target.value)}
                            disabled={disabled || isClosed}
                            className={`w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-fuchsia-300 ${(disabled || isClosed) ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Dictamen técnico</label>
                        <select
                            value={reviewData.reviewDecision || 'APPROVED'}
                            onChange={event => updateReviewField('reviewDecision', event.target.value)}
                            disabled={disabled || isClosed}
                            className={`w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-fuchsia-300 ${(disabled || isClosed) ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                        >
                            {INTERNAL_REVIEW_DECISION_OPTIONS.map(option => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                    </div>
                    <div className="md:col-span-2">
                        <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Decisión operativa</label>
                        <select
                            value={reviewData.releaseDecision || 'LIBERAR'}
                            onChange={event => updateReviewField('releaseDecision', event.target.value)}
                            disabled={disabled || isClosed}
                            className={`w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-fuchsia-300 ${(disabled || isClosed) ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                        >
                            {INTERNAL_RELEASE_DECISION_OPTIONS.map(option => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                    </div>
                </div>

                <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Observaciones de revisión</label>
                    <textarea
                        value={reviewData.reviewNotes || ''}
                        onChange={event => updateReviewField('reviewNotes', event.target.value)}
                        disabled={disabled || isClosed}
                        rows={4}
                        placeholder="Conclusión técnica, justificación y decisión operativa"
                        className={`w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-fuchsia-300 resize-none ${(disabled || isClosed) ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                    />
                </div>

                <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Referencias normativas de revisión</label>
                    <textarea
                        value={formatNormativeRefs(reviewData.normativeRefs)}
                        onChange={event => updateReviewField(
                            'normativeRefs',
                            event.target.value.split('\n').map(item => item.trim()).filter(Boolean)
                        )}
                        disabled={disabled || isClosed}
                        rows={3}
                        placeholder="Una referencia por línea. Ej: ISO/IEC 17025:2017"
                        className={`w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-fuchsia-300 resize-none ${(disabled || isClosed) ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                    />
                </div>

                {!isClosed && (
                    <div className="flex justify-end">
                        <button
                            type="button"
                            onClick={onReviewSubmit}
                            disabled={saving || disabled || !canReview}
                            className="inline-flex items-center gap-2 rounded-2xl bg-fuchsia-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-fuchsia-700 disabled:opacity-60"
                        >
                            {saving ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <ShieldCheck size={16} />}
                            Guardar revisión técnica
                        </button>
                    </div>
                )}

                <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 space-y-4">
                    <div>
                        <p className="text-sm font-bold text-emerald-900">Aprobación y cierre</p>
                        <p className="text-xs text-emerald-700 mt-1">
                            Este cierre genera el PDF final y deja la evidencia formal del caso. Solo se habilita cuando la revisión técnica quede aprobada.
                        </p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Fecha aprobación</label>
                            <input
                                type="datetime-local"
                                value={approvalData.approvedAt || ''}
                                onChange={event => updateApprovalField('approvedAt', event.target.value)}
                                disabled={disabled || isClosed}
                                className={`w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-300 ${(disabled || isClosed) ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Notas de aprobación</label>
                            <input
                                type="text"
                                value={approvalData.approvalNotes || ''}
                                onChange={event => updateApprovalField('approvalNotes', event.target.value)}
                                disabled={disabled || isClosed}
                                placeholder="Opcional"
                                className={`w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-300 ${(disabled || isClosed) ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                            />
                        </div>
                    </div>
                    {!isClosed && (
                        <div className="flex justify-end">
                            <button
                                type="button"
                                onClick={onCloseSubmit}
                                disabled={saving || disabled || !canClose}
                                className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-200 disabled:opacity-60"
                            >
                                {saving ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <ShieldCheck size={16} />}
                                Aprobar y cerrar caso
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default MicroInternalReviewPanel;
