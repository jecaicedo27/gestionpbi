import React from 'react';
import { ClipboardCheck } from 'lucide-react';
import { INTERNAL_ACCEPTANCE_INTEGRITY_OPTIONS } from '../microLabConfig';

const MicroInternalAcceptancePanel = ({
    data = {},
    onChange,
    onSubmit,
    disabled = false,
    saving = false
}) => {
    const updateField = (field, value) => {
        if (typeof onChange !== 'function') return;
        onChange(previous => ({
            ...previous,
            [field]: value
        }));
    };

    return (
        <div className="bg-white rounded-2xl border border-sky-100 overflow-hidden">
            <div className="bg-sky-50 px-5 py-3 border-b border-sky-100">
                <h3 className="font-bold text-sky-900 text-sm flex items-center gap-2">
                    <ClipboardCheck size={16} /> Recepción y aceptación de la muestra
                </h3>
                <p className="text-xs text-sky-700 mt-1">
                    Registra el ingreso al laboratorio, la condición de la muestra y la decisión de aceptación o rechazo.
                </p>
            </div>

            <div className="p-5 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                    <div>
                        <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Fecha y hora de ingreso *</label>
                        <input
                            type="datetime-local"
                            value={data.receivedAt || ''}
                            onChange={event => updateField('receivedAt', event.target.value)}
                            disabled={disabled}
                            className={`w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-sky-300 ${disabled ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Integridad del envase</label>
                        <select
                            value={data.containerIntegrity || 'INTEGRO'}
                            onChange={event => updateField('containerIntegrity', event.target.value)}
                            disabled={disabled}
                            className={`w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-sky-300 ${disabled ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                        >
                            {INTERNAL_ACCEPTANCE_INTEGRITY_OPTIONS.map(option => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Temperatura (°C)</label>
                        <input
                            type="number"
                            value={data.sampleTemperatureC || ''}
                            onChange={event => updateField('sampleTemperatureC', event.target.value)}
                            disabled={disabled}
                            placeholder="Ej: 6.5"
                            className={`w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-sky-300 ${disabled ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Cantidad recibida</label>
                        <div className="flex gap-2">
                            <input
                                type="number"
                                value={data.sampleQuantity || ''}
                                onChange={event => updateField('sampleQuantity', event.target.value)}
                                disabled={disabled}
                                placeholder="Cantidad"
                                className={`w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-sky-300 ${disabled ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                            />
                            <input
                                type="text"
                                value={data.quantityUnit || ''}
                                onChange={event => updateField('quantityUnit', event.target.value)}
                                disabled={disabled}
                                placeholder="mL / g / placa"
                                className={`w-32 rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-sky-300 ${disabled ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                            />
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Condición de la muestra</label>
                        <input
                            type="text"
                            value={data.sampleCondition || ''}
                            onChange={event => updateField('sampleCondition', event.target.value)}
                            disabled={disabled}
                            placeholder="Íntegra, refrigerada, sin fuga..."
                            className={`w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-sky-300 ${disabled ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Transporte / cadena</label>
                        <input
                            type="text"
                            value={data.transportCondition || ''}
                            onChange={event => updateField('transportCondition', event.target.value)}
                            disabled={disabled}
                            placeholder="Conservación, empaque y traslado"
                            className={`w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-sky-300 ${disabled ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                        />
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Cadena de custodia / referencia</label>
                        <input
                            type="text"
                            value={data.chainOfCustodyRef || ''}
                            onChange={event => updateField('chainOfCustodyRef', event.target.value)}
                            disabled={disabled}
                            placeholder="Código, remisión o referencia"
                            className={`w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-sky-300 ${disabled ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                        />
                    </div>
                    <div className="flex items-end gap-6">
                        <label className="flex items-center gap-2 text-sm font-medium text-emerald-700 cursor-pointer">
                            <input
                                type="radio"
                                checked={data.accepted !== false}
                                onChange={() => updateField('accepted', true)}
                                disabled={disabled}
                            />
                            Aceptada
                        </label>
                        <label className="flex items-center gap-2 text-sm font-medium text-rose-700 cursor-pointer">
                            <input
                                type="radio"
                                checked={data.accepted === false}
                                onChange={() => updateField('accepted', false)}
                                disabled={disabled}
                            />
                            Rechazada
                        </label>
                    </div>
                </div>

                <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">
                        {data.accepted === false ? 'Motivo de rechazo *' : 'Observaciones de recepción'}
                    </label>
                    <textarea
                        value={data.accepted === false ? (data.rejectionReason || '') : (data.conditionNotes || '')}
                        onChange={event => updateField(data.accepted === false ? 'rejectionReason' : 'conditionNotes', event.target.value)}
                        disabled={disabled}
                        rows={3}
                        placeholder={data.accepted === false ? 'Indica por qué la muestra no fue aceptada' : 'Hallazgos del ingreso, sello, temperatura, volumen, etc.'}
                        className={`w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-sky-300 resize-none ${disabled ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                    />
                </div>

                {!disabled && (
                    <div className="flex justify-end">
                        <button
                            type="button"
                            onClick={onSubmit}
                            disabled={saving}
                            className="inline-flex items-center gap-2 rounded-2xl bg-sky-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-60"
                        >
                            {saving ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <ClipboardCheck size={16} />}
                            Registrar recepción
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default MicroInternalAcceptancePanel;
