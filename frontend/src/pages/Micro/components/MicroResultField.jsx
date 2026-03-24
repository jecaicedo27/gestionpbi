import React from 'react';
import { RotateCcw, X } from 'lucide-react';
import { hasResultData } from '../microSampleEntryConfig';

const buildSpecLabel = (result) => {
    const parts = [];

    if (result.unit) parts.push(result.unit);
    if (result.specMin !== null && result.specMin !== undefined && result.specMax !== null && result.specMax !== undefined) {
        parts.push(`m:${result.specMin}  M:${result.specMax}`);
    }
    if (result.specText) parts.push(result.specText);

    return parts.join(' • ');
};

const getNumericStatus = (result) => {
    if (result.value === '' || result.value === null || result.value === undefined) return null;
    if (result.specMax === null || result.specMax === undefined) return null;

    const parsed = parseFloat(result.value);
    if (Number.isNaN(parsed)) return null;

    if (result.specMin !== null && result.specMin !== undefined && parsed <= result.specMin) {
        return { label: 'Aceptable', tone: 'bg-green-100 text-green-700' };
    }

    if (parsed <= result.specMax) {
        return { label: 'Marginal', tone: 'bg-amber-100 text-amber-700' };
    }

    return { label: 'No Conforme', tone: 'bg-red-100 text-red-700' };
};

const MicroResultField = ({ result, featured = false, onChange, onClear, onHide }) => {
    const qualitative = `${result.specText || ''}`.toLowerCase().includes('ausente');
    const numericStatus = getNumericStatus(result);
    const filled = hasResultData(result);

    return (
        <div className={`rounded-2xl border p-4 ${featured ? 'border-teal-200 bg-gradient-to-br from-teal-50 via-white to-emerald-50 shadow-sm' : 'border-gray-200 bg-white'}`}>
            <div className="flex items-start justify-between gap-3">
                <div>
                    <p className="text-sm font-bold text-gray-900">{result.parameterName}</p>
                    <p className="mt-1 text-[11px] text-gray-500">{buildSpecLabel(result)}</p>
                </div>
                <div className="flex items-center gap-2">
                    {filled && (
                        <button
                            type="button"
                            onClick={onClear}
                            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
                        >
                            <RotateCcw size={12} />
                            Limpiar
                        </button>
                    )}
                    {onHide && !filled && (
                        <button
                            type="button"
                            onClick={onHide}
                            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-500 hover:bg-gray-50"
                        >
                            <X size={12} />
                            Ocultar
                        </button>
                    )}
                </div>
            </div>

            {qualitative ? (
                <div className="mt-4 flex flex-wrap gap-3">
                    <label className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm cursor-pointer ${result.isDetected === false ? 'border-green-300 bg-green-50 text-green-700' : 'border-gray-200 text-gray-600'}`}>
                        <input
                            type="radio"
                            name={`micro-${result.parameterId}`}
                            checked={result.isDetected === false}
                            onChange={() => onChange('isDetected', false)}
                            className="text-green-600 focus:ring-green-400"
                        />
                        Ausente
                    </label>
                    <label className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm cursor-pointer ${result.isDetected === true ? 'border-red-300 bg-red-50 text-red-700' : 'border-gray-200 text-gray-600'}`}>
                        <input
                            type="radio"
                            name={`micro-${result.parameterId}`}
                            checked={result.isDetected === true}
                            onChange={() => onChange('isDetected', true)}
                            className="text-red-600 focus:ring-red-400"
                        />
                        Detectado
                    </label>
                </div>
            ) : (
                <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center">
                    <input
                        type="number"
                        value={result.value}
                        onChange={event => onChange('value', event.target.value)}
                        placeholder="Valor numérico"
                        className={`w-full rounded-xl border px-3 py-2.5 text-sm outline-none focus:ring-2 lg:w-44 ${result.value !== '' && result.specMax !== null && result.specMax !== undefined && parseFloat(result.value) > result.specMax
                            ? 'border-red-300 bg-red-50 text-red-800 focus:ring-red-300'
                            : 'border-gray-200 bg-white focus:border-teal-400 focus:ring-teal-300'
                            }`}
                    />
                    <input
                        type="text"
                        value={result.valueText}
                        onChange={event => onChange('valueText', event.target.value)}
                        placeholder="Texto opcional (ej: <10)"
                        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-300 lg:w-52"
                    />
                    {numericStatus && (
                        <span className={`inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-semibold ${numericStatus.tone}`}>
                            {numericStatus.label}
                        </span>
                    )}
                </div>
            )}

            <input
                type="text"
                value={result.notes || ''}
                onChange={event => onChange('notes', event.target.value)}
                placeholder="Nota del resultado"
                className="mt-3 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-300"
            />
        </div>
    );
};

export default MicroResultField;
