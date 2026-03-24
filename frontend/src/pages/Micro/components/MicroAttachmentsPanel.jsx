import React from 'react';
import { Camera, ExternalLink, FileText, Film, Image as ImageIcon, Paperclip, RotateCcw, Trash2, Upload } from 'lucide-react';
import { formatFileSize, getAttachmentKindMeta } from '../microSampleEntryConfig';

const unwrapPendingFile = (entry) => entry?.file || entry;
const getPendingAttachmentId = (entry, index) => entry?.id || `${unwrapPendingFile(entry)?.name || 'file'}-${index}`;

const fileCategoryFromPendingFile = (entry) => {
    const file = unwrapPendingFile(entry);
    if (file?.type?.startsWith('image/')) return 'PHOTO';
    if (file?.type?.startsWith('video/')) return 'VIDEO';
    return 'DOCUMENT';
};

const getAttachmentContextLabel = (contextOptions = [], contextId = '') => (
    contextOptions.find(option => option.value === contextId)?.label || 'Expediente general'
);

const AttachmentItem = ({
    apiBase,
    attachment,
    removable = false,
    removed = false,
    onToggleRemove,
    contextOptions = [],
    assignedContextId = '',
    onContextChange
}) => {
    const meta = getAttachmentKindMeta(attachment);
    const isPhoto = attachment.category === 'PHOTO';
    const isVideo = attachment.category === 'VIDEO';

    return (
        <div className={`rounded-2xl border p-3 ${removed ? 'border-red-200 bg-red-50/70' : 'border-gray-200 bg-white'}`}>
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        {isPhoto ? (
                            <ImageIcon size={15} className="text-amber-600" />
                        ) : isVideo ? (
                            <Film size={15} className="text-sky-600" />
                        ) : (
                            <FileText size={15} className="text-slate-600" />
                        )}
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${meta.tone}`}>{meta.label}</span>
                    </div>
                    <p className="mt-2 truncate text-sm font-semibold text-gray-800">{attachment.originalName || attachment.storedName}</p>
                    <p className="mt-1 text-xs text-gray-500">{formatFileSize(attachment.sizeBytes)}</p>
                    {contextOptions.length > 0 && (
                        <div className="mt-3">
                            <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Asignado a</label>
                            <select
                                value={assignedContextId || contextOptions[0]?.value || ''}
                                onChange={(event) => onContextChange?.(event.target.value)}
                                className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 outline-none focus:ring-2 focus:ring-teal-300"
                            >
                                {contextOptions.map(option => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>
                        </div>
                    )}
                </div>
                {removable && (
                    <button
                        type="button"
                        onClick={onToggleRemove}
                        className={`rounded-lg border px-2 py-1 text-xs font-medium ${removed ? 'border-red-200 text-red-700 hover:bg-red-100' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                    >
                        {removed ? <span className="inline-flex items-center gap-1"><RotateCcw size={12} /> Restaurar</span> : <span className="inline-flex items-center gap-1"><Trash2 size={12} /> Quitar</span>}
                    </button>
                )}
            </div>
            <div className="mt-3">
                <a
                    href={`${apiBase}${attachment.url}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-teal-700 hover:text-teal-800"
                >
                    <ExternalLink size={12} />
                    Abrir archivo
                </a>
            </div>
        </div>
    );
};

const PendingAttachmentItem = ({
    entry,
    onRemove,
    contextOptions = [],
    assignedContextId = '',
    onContextChange
}) => {
    const file = unwrapPendingFile(entry);
    const category = fileCategoryFromPendingFile(entry);
    const meta = getAttachmentKindMeta({ category });

    return (
        <div className="rounded-2xl border border-teal-200 bg-teal-50/70 p-3">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        {category === 'PHOTO' ? (
                            <Camera size={15} className="text-amber-600" />
                        ) : category === 'VIDEO' ? (
                            <Film size={15} className="text-sky-600" />
                        ) : (
                            <Paperclip size={15} className="text-slate-600" />
                        )}
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${meta.tone}`}>{meta.label}</span>
                    </div>
                    <p className="mt-2 truncate text-sm font-semibold text-gray-800">{file.name}</p>
                    <p className="mt-1 text-xs text-gray-500">{formatFileSize(file.size)}</p>
                    {contextOptions.length > 0 && (
                        <div className="mt-3">
                            <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Se guardará en</label>
                            <select
                                value={assignedContextId || contextOptions[0]?.value || ''}
                                onChange={(event) => onContextChange?.(event.target.value)}
                                className="mt-1 w-full rounded-xl border border-teal-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 outline-none focus:ring-2 focus:ring-teal-300"
                            >
                                {contextOptions.map(option => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>
                        </div>
                    )}
                </div>
                <button
                    type="button"
                    onClick={onRemove}
                    className="rounded-lg border border-teal-200 px-2 py-1 text-xs font-medium text-teal-700 hover:bg-teal-100"
                >
                    <span className="inline-flex items-center gap-1">
                        <Trash2 size={12} />
                        Remover
                    </span>
                </button>
            </div>
        </div>
    );
};

const MicroAttachmentsPanel = ({
    apiBase,
    existingAttachments,
    removedAttachmentIds,
    onToggleExistingAttachment,
    reportFile,
    onReportSelected,
    onClearReport,
    pendingAttachments,
    onAddAttachments,
    onRemovePendingAttachment,
    contextOptions = [],
    selectedContextId = '',
    onSelectedContextChange,
    existingAttachmentAssignments = {},
    pendingAttachmentAssignments = {},
    onExistingAttachmentContextChange,
    onPendingAttachmentContextChange,
    showReportSection = true,
    introText = 'Guarde el informe principal y adjunte fotos, soportes o documentos complementarios en la misma muestra.',
    reportTitle = 'Informe principal del laboratorio',
    reportDescription = 'Se guarda como documento principal de la muestra.',
    reportInputLabel = 'Subir PDF',
    supportTitle = 'Adjuntos complementarios',
    supportDescription = 'Fotos, hojas de análisis, soportes internos o documentos de apoyo.',
    supportInputLabel = 'Agregar varios archivos',
    supportInputHelper = 'Puede cargar imágenes, PDF, Word o Excel.'
}) => {
    const activeExistingAttachments = existingAttachments.filter(attachment => !removedAttachmentIds.includes(attachment.id));
    const existingReport = activeExistingAttachments.find(attachment => attachment.category === 'LAB_REPORT');
    const archivedReport = existingAttachments.find(attachment => attachment.category === 'LAB_REPORT' && removedAttachmentIds.includes(attachment.id));
    const supportAttachments = activeExistingAttachments.filter(attachment => attachment.category !== 'LAB_REPORT');
    const removedAttachments = existingAttachments.filter(attachment => removedAttachmentIds.includes(attachment.id) && attachment.category !== 'LAB_REPORT');

    return (
        <div className="space-y-4">
            <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                <div className="flex items-center gap-2 text-gray-900">
                    <Upload size={16} className="text-teal-600" />
                    <h3 className="text-sm font-bold uppercase tracking-wide">Soportes y Evidencias</h3>
                </div>
                <p className="mt-1 text-sm text-gray-500">
                    {introText}
                </p>

                <div className={`mt-4 grid gap-4 ${showReportSection ? 'lg:grid-cols-2' : 'lg:grid-cols-1'}`}>
                    {showReportSection && (
                        <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4">
                            <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">{reportTitle}</p>
                            <p className="mt-1 text-xs text-blue-600">{reportDescription}</p>

                            {existingReport && (
                                <div className="mt-3">
                                    <AttachmentItem
                                        apiBase={apiBase}
                                        attachment={existingReport}
                                        removable={!existingReport.isLegacyFallback}
                                        onToggleRemove={() => onToggleExistingAttachment(existingReport.id)}
                                    />
                                </div>
                            )}

                            {!existingReport && archivedReport && !reportFile && (
                                <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                                    El informe actual quedó marcado para eliminación. Puede restaurarlo o reemplazarlo por un nuevo PDF.
                                </div>
                            )}

                            {reportFile && (
                                <div className="mt-3 rounded-2xl border border-teal-200 bg-teal-50 p-3">
                                    <p className="text-xs font-semibold text-teal-700">Nuevo informe listo para guardar</p>
                                    <p className="mt-1 truncate text-sm font-medium text-gray-800">{reportFile.name}</p>
                                    <button
                                        type="button"
                                        onClick={onClearReport}
                                        className="mt-3 inline-flex items-center gap-1 rounded-lg border border-teal-200 px-2.5 py-1 text-xs font-medium text-teal-700 hover:bg-teal-100"
                                    >
                                        <Trash2 size={12} />
                                        Quitar selección
                                    </button>
                                </div>
                            )}

                            <div className="mt-4 rounded-2xl border-2 border-dashed border-blue-200 bg-white/80 p-4">
                                <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500">{reportInputLabel}</label>
                                <input
                                    type="file"
                                    accept="application/pdf,.pdf"
                                    onChange={(event) => {
                                        const file = event.target.files?.[0] || null;
                                        onReportSelected(file);
                                        event.target.value = '';
                                    }}
                                    className="mt-2 block w-full text-xs text-gray-500 file:mr-3 file:rounded-lg file:border-0 file:bg-blue-600 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-white hover:file:bg-blue-700"
                                />
                            </div>
                        </div>
                    )}

                    <div className="rounded-2xl border border-teal-100 bg-teal-50/60 p-4">
                        <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">{supportTitle}</p>
                        <p className="mt-1 text-xs text-teal-600">{supportDescription}</p>

                        {contextOptions.length > 0 && (
                            <div className="mt-4 rounded-2xl border border-teal-200 bg-white/90 p-3">
                                <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Destino actual de carga</label>
                                <select
                                    value={selectedContextId || ''}
                                    onChange={(event) => onSelectedContextChange?.(event.target.value)}
                                    className="mt-2 w-full rounded-xl border border-teal-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 outline-none focus:ring-2 focus:ring-teal-300"
                                >
                                    {contextOptions.map(option => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                    ))}
                                </select>
                                <p className="mt-2 text-xs text-slate-500">
                                    Los nuevos archivos se asignarán a <span className="font-semibold text-slate-700">{getAttachmentContextLabel(contextOptions, selectedContextId)}</span>.
                                </p>
                            </div>
                        )}

                        <div className="mt-4 rounded-2xl border-2 border-dashed border-teal-200 bg-white/80 p-4">
                            <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500">{supportInputLabel}</label>
                            <input
                                type="file"
                                multiple
                                accept="image/*,video/*,application/pdf,.pdf,.doc,.docx,.xls,.xlsx"
                                onChange={(event) => {
                                    const files = Array.from(event.target.files || []);
                                    onAddAttachments(files);
                                    event.target.value = '';
                                }}
                                className="mt-2 block w-full text-xs text-gray-500 file:mr-3 file:rounded-lg file:border-0 file:bg-teal-600 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-white hover:file:bg-teal-700"
                            />
                            <p className="mt-2 text-xs text-gray-500">{supportInputHelper}</p>
                        </div>

                        {pendingAttachments.length > 0 && (
                            <div className="mt-4 space-y-3">
                                {pendingAttachments.map((entry, index) => (
                                    <PendingAttachmentItem
                                        key={getPendingAttachmentId(entry, index)}
                                        entry={entry}
                                        onRemove={() => onRemovePendingAttachment(index)}
                                        contextOptions={contextOptions}
                                        assignedContextId={pendingAttachmentAssignments[getPendingAttachmentId(entry, index)] || selectedContextId}
                                        onContextChange={(contextId) => onPendingAttachmentContextChange?.(getPendingAttachmentId(entry, index), contextId)}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {(supportAttachments.length > 0 || removedAttachments.length > 0) && (
                    <div className="mt-5 space-y-4">
                        {supportAttachments.length > 0 && (
                            <div>
                                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Adjuntos guardados</p>
                                <div className="mt-3 grid gap-3 md:grid-cols-2">
                                    {supportAttachments.map((attachment) => (
                                        <AttachmentItem
                                            key={attachment.id}
                                            apiBase={apiBase}
                                            attachment={attachment}
                                            removable={!attachment.isLegacyFallback}
                                            onToggleRemove={() => onToggleExistingAttachment(attachment.id)}
                                            contextOptions={contextOptions}
                                            assignedContextId={existingAttachmentAssignments[attachment.id] || ''}
                                            onContextChange={(contextId) => onExistingAttachmentContextChange?.(attachment.id, contextId)}
                                        />
                                    ))}
                                </div>
                            </div>
                        )}

                        {removedAttachments.length > 0 && (
                            <div>
                                <p className="text-xs font-semibold uppercase tracking-wide text-red-600">Se eliminarán al guardar</p>
                                <div className="mt-3 grid gap-3 md:grid-cols-2">
                                    {removedAttachments.map((attachment) => (
                                        <AttachmentItem
                                            key={attachment.id}
                                            apiBase={apiBase}
                                            attachment={attachment}
                                            removable={!attachment.isLegacyFallback}
                                            removed
                                            onToggleRemove={() => onToggleExistingAttachment(attachment.id)}
                                            contextOptions={contextOptions}
                                            assignedContextId={existingAttachmentAssignments[attachment.id] || ''}
                                            onContextChange={(contextId) => onExistingAttachmentContextChange?.(attachment.id, contextId)}
                                        />
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default MicroAttachmentsPanel;
