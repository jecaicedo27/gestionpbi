import React from 'react';
import { Microscope } from 'lucide-react';
import { INTERNAL_DEVIATION_CATEGORY_OPTIONS } from '../microLabConfig';

const formatNormativeRefs = (refs = []) => (
    Array.isArray(refs) ? refs.join('\n') : ''
);

const MicroInternalExecutionPanel = ({
    executionData = {},
    deviationData = {},
    onExecutionChange,
    onDeviationChange,
    onSubmit,
    disabled = false,
    saving = false
}) => {
    const updateExecutionField = (field, value) => {
        if (typeof onExecutionChange !== 'function') return;
        onExecutionChange(previous => ({
            ...previous,
            [field]: value
        }));
    };

    const updateDeviationField = (field, value) => {
        if (typeof onDeviationChange !== 'function') return;
        onDeviationChange(previous => ({
            ...previous,
            [field]: value
        }));
    };

    return (
        <div className="bg-white rounded-2xl border border-indigo-100 overflow-hidden">
            <div className="bg-indigo-50 px-5 py-3 border-b border-indigo-100">
                <h3 className="font-bold text-indigo-900 text-sm flex items-center gap-2">
                    <Microscope size={16} /> Trazabilidad técnica del ensayo y desviaciones
                </h3>
                <p className="text-xs text-indigo-700 mt-1">
                    Documenta método, versión, analista, incubación, controles y cualquier desviación o plan CAPA asociado.
                </p>
            </div>

            <div className="p-5 space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                    <div>
                        <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Método *</label>
                        <input
                            type="text"
                            value={executionData.methodCode || ''}
                            onChange={event => updateExecutionField('methodCode', event.target.value)}
                            disabled={disabled}
                            placeholder="Ej: ISO 4833"
                            className={`w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-300 ${disabled ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Versión *</label>
                        <input
                            type="text"
                            value={executionData.methodVersion || ''}
                            onChange={event => updateExecutionField('methodVersion', event.target.value)}
                            disabled={disabled}
                            placeholder="Edición / versión vigente"
                            className={`w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-300 ${disabled ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Analista *</label>
                        <input
                            type="text"
                            value={executionData.analystName || ''}
                            onChange={event => updateExecutionField('analystName', event.target.value)}
                            disabled={disabled}
                            placeholder="Nombre responsable"
                            className={`w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-300 ${disabled ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Equipo / lectura</label>
                        <input
                            type="text"
                            value={executionData.equipmentName || ''}
                            onChange={event => updateExecutionField('equipmentName', event.target.value)}
                            disabled={disabled}
                            placeholder="Contador, cabina, etc."
                            className={`w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-300 ${disabled ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Incubador</label>
                        <input
                            type="text"
                            value={executionData.incubatorName || ''}
                            onChange={event => updateExecutionField('incubatorName', event.target.value)}
                            disabled={disabled}
                            placeholder="Incubador / estufa"
                            className={`w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-300 ${disabled ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Lote medio de cultivo</label>
                        <input
                            type="text"
                            value={executionData.mediaLot || ''}
                            onChange={event => updateExecutionField('mediaLot', event.target.value)}
                            disabled={disabled}
                            placeholder="Lote / preparado"
                            className={`w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-300 ${disabled ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Control positivo</label>
                        <input
                            type="text"
                            value={executionData.positiveControl || ''}
                            onChange={event => updateExecutionField('positiveControl', event.target.value)}
                            disabled={disabled}
                            placeholder="Resultado / lote"
                            className={`w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-300 ${disabled ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Control negativo</label>
                        <input
                            type="text"
                            value={executionData.negativeControl || ''}
                            onChange={event => updateExecutionField('negativeControl', event.target.value)}
                            disabled={disabled}
                            placeholder="Resultado / lote"
                            className={`w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-300 ${disabled ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                        />
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                    <div>
                        <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Inicio incubación</label>
                        <input
                            type="datetime-local"
                            value={executionData.incubationStartedAt || ''}
                            onChange={event => updateExecutionField('incubationStartedAt', event.target.value)}
                            disabled={disabled}
                            className={`w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-300 ${disabled ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Fin incubación</label>
                        <input
                            type="datetime-local"
                            value={executionData.incubationEndedAt || ''}
                            onChange={event => updateExecutionField('incubationEndedAt', event.target.value)}
                            disabled={disabled}
                            className={`w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-300 ${disabled ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Lote diluyente</label>
                        <input
                            type="text"
                            value={executionData.diluentLot || ''}
                            onChange={event => updateExecutionField('diluentLot', event.target.value)}
                            disabled={disabled}
                            placeholder="Opcional"
                            className={`w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-300 ${disabled ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Lote placas / soporte</label>
                        <input
                            type="text"
                            value={executionData.plateBatch || ''}
                            onChange={event => updateExecutionField('plateBatch', event.target.value)}
                            disabled={disabled}
                            placeholder="Opcional"
                            className={`w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-300 ${disabled ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                        />
                    </div>
                    <div className="md:col-span-2 xl:col-span-4">
                        <label className="flex items-center gap-2 text-sm font-medium text-indigo-800 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={Boolean(executionData.duplicatePerformed)}
                                onChange={event => updateExecutionField('duplicatePerformed', event.target.checked)}
                                disabled={disabled}
                            />
                            Duplicado / réplica ejecutada como parte del control del ensayo
                        </label>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Criterio de aceptación de corrida</label>
                        <textarea
                            value={executionData.acceptanceCriteria || ''}
                            onChange={event => updateExecutionField('acceptanceCriteria', event.target.value)}
                            disabled={disabled}
                            rows={3}
                            placeholder="Criterios, controles esperados, duplicados, etc."
                            className={`w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-300 resize-none ${disabled ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Notas de ejecución</label>
                        <textarea
                            value={executionData.executionNotes || ''}
                            onChange={event => updateExecutionField('executionNotes', event.target.value)}
                            disabled={disabled}
                            rows={3}
                            placeholder="Observaciones de siembra, lectura, diluciones..."
                            className={`w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-300 resize-none ${disabled ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                        />
                    </div>
                    <div className="md:col-span-2">
                        <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Referencias normativas</label>
                        <textarea
                            value={formatNormativeRefs(executionData.normativeRefs)}
                            onChange={event => updateExecutionField(
                                'normativeRefs',
                                event.target.value.split('\n').map(item => item.trim()).filter(Boolean)
                            )}
                            disabled={disabled}
                            rows={3}
                            placeholder="Una referencia por línea. Ej: ISO 7218:2024"
                            className={`w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-300 resize-none ${disabled ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                        />
                    </div>
                </div>

                <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4 space-y-4">
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <p className="text-sm font-bold text-amber-900">Desviaciones y CAPA</p>
                            <p className="text-xs text-amber-700 mt-1">Activa este bloque si hubo hallazgos, OOS o acciones correctivas asociadas.</p>
                        </div>
                        <label className="flex items-center gap-2 text-sm font-semibold text-amber-800 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={Boolean(deviationData.hasDeviation)}
                                onChange={event => updateDeviationField('hasDeviation', event.target.checked)}
                                disabled={disabled}
                            />
                            Registrar desvío
                        </label>
                    </div>

                    {deviationData.hasDeviation && (
                        <>
                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                                <div>
                                    <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Categoría</label>
                                    <select
                                        value={deviationData.category || 'OOS'}
                                        onChange={event => updateDeviationField('category', event.target.value)}
                                        disabled={disabled}
                                        className={`w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-amber-300 ${disabled ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                                    >
                                        {INTERNAL_DEVIATION_CATEGORY_OPTIONS.map(option => (
                                            <option key={option.value} value={option.value}>{option.label}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Referencia vinculada</label>
                                    <input
                                        type="text"
                                        value={deviationData.linkedReference || ''}
                                        onChange={event => updateDeviationField('linkedReference', event.target.value)}
                                        disabled={disabled}
                                        placeholder="Lote, batch, tote, POE..."
                                        className={`w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-amber-300 ${disabled ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                                    />
                                </div>
                                <div className="md:col-span-2 flex items-end gap-6">
                                    <label className="flex items-center gap-2 text-sm font-medium text-amber-800 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={Boolean(deviationData.requiresHold)}
                                            onChange={event => updateDeviationField('requiresHold', event.target.checked)}
                                            disabled={disabled}
                                        />
                                        Requiere retención / bloqueo
                                    </label>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Detalle del desvío *</label>
                                    <textarea
                                        value={deviationData.details || ''}
                                        onChange={event => updateDeviationField('details', event.target.value)}
                                        disabled={disabled}
                                        rows={3}
                                        placeholder="Describe el hallazgo o no conformidad"
                                        className={`w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-amber-300 resize-none ${disabled ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Acciones inmediatas</label>
                                    <textarea
                                        value={deviationData.immediateActions || ''}
                                        onChange={event => updateDeviationField('immediateActions', event.target.value)}
                                        disabled={disabled}
                                        rows={3}
                                        placeholder="Contención inmediata, limpieza, retención..."
                                        className={`w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-amber-300 resize-none ${disabled ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Plan CAPA</label>
                                    <textarea
                                        value={deviationData.capaPlan || ''}
                                        onChange={event => updateDeviationField('capaPlan', event.target.value)}
                                        disabled={disabled}
                                        rows={3}
                                        placeholder="Acción correctiva y preventiva"
                                        className={`w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-amber-300 resize-none ${disabled ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Impacto en producción</label>
                                    <textarea
                                        value={deviationData.productionImpact || ''}
                                        onChange={event => updateDeviationField('productionImpact', event.target.value)}
                                        disabled={disabled}
                                        rows={3}
                                        placeholder="Lote retenido, re-muestreo, limpieza programada..."
                                        className={`w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-amber-300 resize-none ${disabled ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                                    />
                                </div>
                            </div>
                        </>
                    )}
                </div>

                {!disabled && (
                    <div className="flex justify-end">
                        <button
                            type="button"
                            onClick={onSubmit}
                            disabled={saving}
                            className="inline-flex items-center gap-2 rounded-2xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
                        >
                            {saving ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Microscope size={16} />}
                            Guardar trazabilidad técnica
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default MicroInternalExecutionPanel;
