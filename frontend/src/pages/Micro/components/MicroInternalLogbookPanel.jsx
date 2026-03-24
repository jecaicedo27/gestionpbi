import React from 'react';
import { ClipboardList, PlusCircle, Save } from 'lucide-react';

const MicroInternalLogbookPanel = ({
    sampleStatusMeta,
    requestedCount = 0,
    canEdit = false,
    dailyLogDate = '',
    onDailyLogDateChange,
    dailyObservations = '',
    onDailyObservationsChange,
    dailyReadings = [],
    onReadingChange,
    onSave,
    onNewLog,
    saving = false,
    logs = [],
    selectedLogDate = '',
    onSelectLog,
    isQualitativeResult,
    formatDateTimeLabel
}) => (
    <div className="grid grid-cols-1 xl:grid-cols-[0.8fr_1.2fr] gap-4">
        <div className="bg-slate-50 rounded-2xl border border-slate-100 p-4">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <h3 className="text-sm font-bold text-slate-900">Bitácoras registradas</h3>
                    <p className="text-xs text-slate-500 mt-1">
                        Selecciona un día para editarlo o crea una nueva bitácora operativa.
                    </p>
                </div>
                <button
                    type="button"
                    onClick={onNewLog}
                    disabled={!canEdit || saving}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                >
                    <PlusCircle size={13} />
                    Nueva
                </button>
            </div>

            <div className="mt-4 space-y-3 max-h-[520px] overflow-y-auto pr-1">
                {logs.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
                        Aún no hay bitácoras internas registradas.
                    </div>
                ) : (
                    logs.map(log => {
                        const isSelected = selectedLogDate === `${log.logDate}`.slice(0, 10);
                        const filledCount = (log.readings || []).filter(reading => (
                            reading?.value !== '' && reading?.value !== null && reading?.value !== undefined
                            || reading?.valueText !== '' && reading?.valueText !== null && reading?.valueText !== undefined
                            || reading?.isDetected !== null && reading?.isDetected !== undefined
                        )).length;

                        return (
                            <button
                                key={log.id}
                                type="button"
                                onClick={() => onSelectLog?.(log)}
                                className={`w-full rounded-2xl border p-3 text-left transition-colors ${isSelected ? 'border-cyan-200 bg-cyan-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <p className="text-sm font-bold text-slate-800">Día {log.dayNumber || '—'}</p>
                                    <span className="text-xs text-slate-500">{formatDateTimeLabel(log.logDate)}</span>
                                </div>
                                <p className="mt-1 text-xs text-slate-500">
                                    {filledCount} lectura(s) · {log.recordedBy?.name || 'Sistema'}
                                </p>
                                <p className="mt-2 text-sm text-slate-700 line-clamp-3">
                                    {log.observations || 'Sin observaciones.'}
                                </p>
                            </button>
                        );
                    })
                )}
            </div>
        </div>

        <div className="bg-white rounded-2xl border border-teal-100 overflow-hidden">
            <div className="bg-teal-50 px-5 py-3 border-b border-teal-100">
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <h3 className="font-bold text-teal-900 text-sm flex items-center gap-2">
                            <ClipboardList size={16} /> Editor de bitácora
                        </h3>
                        <p className="text-xs text-teal-700 mt-1">
                            Alcance del seguimiento: {requestedCount > 0 ? `${requestedCount} análisis definidos` : 'panel abierto sin análisis filtrados'}.
                        </p>
                    </div>
                    <div className={`inline-flex items-center gap-2 rounded-2xl px-3 py-2 text-sm font-semibold ${sampleStatusMeta.chipClass}`}>
                        {sampleStatusMeta.label}
                    </div>
                </div>
            </div>

            <div className="p-5 space-y-4">
                {!canEdit && (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                        La bitácora se habilita cuando la muestra ya fue recepcionada y aceptada.
                    </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Fecha de bitácora</label>
                        <input
                            type="date"
                            value={dailyLogDate}
                            onChange={event => onDailyLogDateChange?.(event.target.value)}
                            disabled={!canEdit}
                            className={`w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-teal-300 ${!canEdit ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                        />
                    </div>
                    <div className="flex items-end">
                        <p className="text-xs text-slate-500">
                            Guardar sobre la misma fecha actualiza esa bitácora; cambiar la fecha crea una nueva entrada.
                        </p>
                    </div>
                </div>

                <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Observaciones del día</label>
                    <textarea
                        value={dailyObservations}
                        onChange={event => onDailyObservationsChange?.(event.target.value)}
                        rows={3}
                        disabled={!canEdit}
                        placeholder="Incubación, apariencia, hallazgos, novedades del análisis..."
                        className={`w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-teal-300 resize-none ${!canEdit ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                    />
                </div>

                <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
                    {dailyReadings.map((result, index) => (
                        <div key={result.parameterId} className="rounded-2xl border border-gray-100 bg-gray-50 p-3">
                            <div className="flex flex-col xl:flex-row xl:items-center gap-3">
                                <div className="xl:w-60 shrink-0">
                                    <p className="text-sm font-bold text-gray-800">{result.parameterName}</p>
                                    <p className="text-[10px] text-gray-400">
                                        {result.unit}
                                        {result.specText && <span className="ml-1">• {result.specText}</span>}
                                        {result.specMax && <span className="ml-1">• m:{result.specMin} M:{result.specMax}</span>}
                                    </p>
                                </div>
                                {isQualitativeResult(result) ? (
                                    <div className="flex items-center gap-4">
                                        <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                                            <input
                                                type="radio"
                                                name={`log_detect_${index}`}
                                                checked={result.isDetected === false}
                                                onChange={() => onReadingChange?.(index, 'isDetected', false)}
                                                disabled={!canEdit}
                                            />
                                            <span className="text-emerald-700 font-medium">Ausente</span>
                                        </label>
                                        <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                                            <input
                                                type="radio"
                                                name={`log_detect_${index}`}
                                                checked={result.isDetected === true}
                                                onChange={() => onReadingChange?.(index, 'isDetected', true)}
                                                disabled={!canEdit}
                                            />
                                            <span className="text-red-700 font-medium">Detectado</span>
                                        </label>
                                    </div>
                                ) : (
                                    <div className="flex flex-col md:flex-row gap-3 flex-1">
                                        <input
                                            type="number"
                                            value={result.value}
                                            onChange={event => onReadingChange?.(index, 'value', event.target.value)}
                                            disabled={!canEdit}
                                            placeholder="Valor"
                                            className={`w-full md:w-36 rounded-2xl border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal-300 ${!canEdit ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                                        />
                                        <input
                                            type="text"
                                            value={result.valueText}
                                            onChange={event => onReadingChange?.(index, 'valueText', event.target.value)}
                                            disabled={!canEdit}
                                            placeholder="Texto"
                                            className={`w-full md:w-36 rounded-2xl border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal-300 ${!canEdit ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                                        />
                                        <input
                                            type="text"
                                            value={result.notes}
                                            onChange={event => onReadingChange?.(index, 'notes', event.target.value)}
                                            disabled={!canEdit}
                                            placeholder="Nota diaria"
                                            className={`w-full rounded-2xl border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal-300 ${!canEdit ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                                        />
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>

                <div className="flex justify-end">
                    <button
                        type="button"
                        onClick={onSave}
                        disabled={saving || !canEdit}
                        className="inline-flex items-center gap-2 rounded-2xl bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
                    >
                        {saving ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save size={16} />}
                        Guardar bitácora
                    </button>
                </div>
            </div>
        </div>
    </div>
);

export default MicroInternalLogbookPanel;
