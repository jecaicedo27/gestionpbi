import React from 'react';
import { CheckCircle2, Save } from 'lucide-react';

const MicroInternalResultsPanel = ({
    results = [],
    finalConclusion = '',
    onConclusionChange,
    onResultChange,
    onSave,
    canEdit = false,
    canSave = false,
    saving = false,
    isQualitativeResult,
    showMissingDataWarning = false,
    requiredCount = 0,
    completedCount = 0,
    missingCount = 0
}) => (
    <div className="bg-white rounded-2xl border border-emerald-100 overflow-hidden">
        <div className="bg-emerald-50 px-5 py-3 border-b border-emerald-100">
            <h3 className="font-bold text-emerald-900 text-sm flex items-center gap-2">
                <CheckCircle2 size={16} /> Resultados finales
            </h3>
            <p className="text-xs text-emerald-700 mt-1">
                Consolida los resultados que pasarán a revisión técnica. Este paso no cierra el caso automáticamente.
            </p>
        </div>
        <div className="p-5 space-y-4">
            {!canEdit && (
                <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
                    Los resultados finales se habilitan una vez la muestra haya sido recepcionada y aceptada.
                </div>
            )}
            {showMissingDataWarning && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    Para registrar resultados finales debes contar con al menos una lectura válida en bitácora o diligenciar resultados manuales.
                </div>
            )}
            {requiredCount > 0 && (
                <div className={`rounded-2xl border px-4 py-3 text-sm ${missingCount > 0 ? 'border-orange-200 bg-orange-50 text-orange-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
                    Cobertura analítica: {completedCount}/{requiredCount} resultado(s) diligenciado(s)
                    {missingCount > 0 ? ` · faltan ${missingCount}` : ' · completa'}
                </div>
            )}

            <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
                {results.map((result, index) => (
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
                                            name={`final_detect_${index}`}
                                            checked={result.isDetected === false}
                                            onChange={() => onResultChange?.(index, 'isDetected', false)}
                                            disabled={!canEdit}
                                        />
                                        <span className="text-emerald-700 font-medium">Ausente</span>
                                    </label>
                                    <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                                        <input
                                            type="radio"
                                            name={`final_detect_${index}`}
                                            checked={result.isDetected === true}
                                            onChange={() => onResultChange?.(index, 'isDetected', true)}
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
                                        onChange={event => onResultChange?.(index, 'value', event.target.value)}
                                        disabled={!canEdit}
                                        placeholder="Valor final"
                                        className={`w-full md:w-36 rounded-2xl border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-300 ${!canEdit ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                                    />
                                    <input
                                        type="text"
                                        value={result.valueText}
                                        onChange={event => onResultChange?.(index, 'valueText', event.target.value)}
                                        disabled={!canEdit}
                                        placeholder="Texto final"
                                        className={`w-full md:w-36 rounded-2xl border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-300 ${!canEdit ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                                    />
                                    <input
                                        type="text"
                                        value={result.notes}
                                        onChange={event => onResultChange?.(index, 'notes', event.target.value)}
                                        disabled={!canEdit}
                                        placeholder="Nota final"
                                        className={`w-full rounded-2xl border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-300 ${!canEdit ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                                    />
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Conclusión final</label>
                <textarea
                    value={finalConclusion}
                    onChange={event => onConclusionChange?.(event.target.value)}
                    rows={4}
                    disabled={!canEdit}
                    placeholder="Conclusión del laboratorio, dictamen y observaciones de resultados..."
                    className={`w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-300 resize-none ${!canEdit ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                />
            </div>

            <div className="flex justify-end">
                <button
                    type="button"
                    onClick={onSave}
                    disabled={saving || !canEdit || !canSave}
                    className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                    {saving ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save size={16} />}
                    Guardar resultados finales
                </button>
            </div>
        </div>
    </div>
);

export default MicroInternalResultsPanel;
