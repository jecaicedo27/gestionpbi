import React, { useMemo, useState } from 'react';
import { Link2, PencilLine, RotateCcw, Sparkles } from 'lucide-react';
import {
    WORK_CONTEXT_OPTIONS,
    appendWorkContextOption,
    buildOptionLabel,
    buildWorkContextOptions,
    normalizeWorkContextValue
} from '../microLabConfig';

const MicroWorkContextField = ({
    label = 'Contexto',
    value = '',
    onChange,
    allowedValues = [],
    defaultValue = '',
    disabled = false,
    helperText = '',
    allowManual = true
}) => {
    const [draftValue, setDraftValue] = useState('');
    const normalizedValue = normalizeWorkContextValue(value) || '';
    const normalizedDefaultValue = normalizeWorkContextValue(defaultValue) || '';
    const optionList = useMemo(
        () => buildWorkContextOptions(appendWorkContextOption(allowedValues, normalizedValue || normalizedDefaultValue)),
        [allowedValues, normalizedDefaultValue, normalizedValue]
    );

    const applyValue = (nextValue) => {
        if (typeof onChange === 'function') {
            onChange(normalizeWorkContextValue(nextValue));
        }
    };

    const handleAddManual = () => {
        const nextValue = normalizeWorkContextValue(draftValue);
        if (!nextValue) return;
        applyValue(nextValue);
        setDraftValue('');
    };

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
                <label className="block text-xs font-semibold text-gray-500 uppercase">{label}</label>
                {normalizedDefaultValue && (
                    <button
                        type="button"
                        onClick={() => applyValue(normalizedDefaultValue)}
                        disabled={disabled}
                        className="inline-flex items-center gap-1 rounded-full border border-cyan-200 bg-cyan-50 px-2.5 py-1 text-[11px] font-semibold text-cyan-700 hover:bg-cyan-100 disabled:opacity-60"
                    >
                        <RotateCcw size={11} />
                        Sincronizar con punto
                    </button>
                )}
            </div>

            <div className="flex flex-wrap gap-2">
                {optionList.length > 0 ? optionList.map((option) => {
                    const isActive = option.value === normalizedValue;
                    return (
                        <button
                            key={option.value}
                            type="button"
                            onClick={() => applyValue(option.value)}
                            disabled={disabled}
                            className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${isActive
                                ? 'border-cyan-300 bg-cyan-100 text-cyan-800'
                                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                                } disabled:opacity-60`}
                        >
                            {option.value === normalizedDefaultValue ? <Sparkles size={11} /> : <Link2 size={11} />}
                            {option.label}
                        </button>
                    );
                }) : (
                    WORK_CONTEXT_OPTIONS.map((option) => (
                        <button
                            key={option.value}
                            type="button"
                            onClick={() => applyValue(option.value)}
                            disabled={disabled}
                            className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${option.value === normalizedValue
                                ? 'border-cyan-300 bg-cyan-100 text-cyan-800'
                                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                                } disabled:opacity-60`}
                        >
                            <Link2 size={11} />
                            {option.label}
                        </button>
                    ))
                )}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-3">
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">Valor actual</label>
                <input
                    type="text"
                    value={normalizedValue}
                    onChange={(event) => applyValue(event.target.value)}
                    disabled={disabled || !allowManual}
                    placeholder="Ej: Producción, Lavado, Liberación o un contexto manual"
                    className={`w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-200 ${disabled || !allowManual ? 'bg-slate-100 cursor-not-allowed opacity-75' : ''}`}
                />
                <p className="mt-2 text-xs text-slate-500">
                    {helperText || `Se sincroniza con el punto, pero también puedes escribir un contexto manual.`}
                </p>
            </div>

            {allowManual && !disabled && (
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={draftValue}
                        onChange={(event) => setDraftValue(event.target.value)}
                        placeholder="Crear o editar contexto manual"
                        className="flex-1 rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-200"
                    />
                    <button
                        type="button"
                        onClick={handleAddManual}
                        className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
                    >
                        <PencilLine size={15} />
                        Usar
                    </button>
                </div>
            )}

            {normalizedValue && (
                <p className="text-xs text-slate-500">
                    Etiqueta visible: <strong>{buildOptionLabel(optionList, normalizedValue)}</strong>
                </p>
            )}
        </div>
    );
};

export default MicroWorkContextField;
