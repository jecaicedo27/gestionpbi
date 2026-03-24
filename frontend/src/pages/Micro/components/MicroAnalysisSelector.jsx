import React, { useMemo } from 'react';
import { CheckCircle2, FlaskConical } from 'lucide-react';

const SUGGESTED_CODES_BY_ENTITY = {
    ALGINATO: ['AEROBIOS_MESOFILOS', 'ENTEROBACTERIAS', 'MOHOS_LEVADURAS', 'SALMONELLA'],
    COMPUESTO: ['AEROBIOS_MESOFILOS', 'ENTEROBACTERIAS', 'MOHOS_LEVADURAS', 'SALMONELLA'],
    ESFERAS: ['AEROBIOS_MESOFILOS', 'ENTEROBACTERIAS', 'MOHOS_LEVADURAS', 'SALMONELLA'],
    PRODUCTO_TERMINADO: ['AEROBIOS_MESOFILOS', 'ENTEROBACTERIAS', 'MOHOS_LEVADURAS', 'SALMONELLA'],
    SIROPE: ['AEROBIOS_MESOFILOS', 'MOHOS_LEVADURAS', 'LEVADURAS'],
    AGUA: ['COLIFORMES_TOTALES', 'COLIFORMES_FECALES', 'AEROBIOS_MESOFILOS'],
    SUPERFICIE: ['AEROBIOS_MESOFILOS', 'COLIFORMES_TOTALES', 'LEVADURAS'],
    AMBIENTE: ['AEROBIOS_MESOFILOS', 'MOHOS_LEVADURAS', 'LEVADURAS'],
    MATERIA_PRIMA: ['AEROBIOS_MESOFILOS', 'ENTEROBACTERIAS', 'MOHOS_LEVADURAS']
};

const sortParameters = (parameters = [], suggestedCodes = []) => {
    const priority = new Map(suggestedCodes.map((code, index) => [code, index]));

    return [...parameters].sort((left, right) => {
        const leftPriority = priority.has(left.code) ? priority.get(left.code) : 999;
        const rightPriority = priority.has(right.code) ? priority.get(right.code) : 999;

        if (leftPriority !== rightPriority) return leftPriority - rightPriority;
        if ((left.sortOrder ?? 0) !== (right.sortOrder ?? 0)) return (left.sortOrder ?? 0) - (right.sortOrder ?? 0);
        return String(left.name || '').localeCompare(String(right.name || ''));
    });
};

const MicroAnalysisSelector = ({
    parameters = [],
    selectedIds = [],
    onChange,
    entityType = 'OTRO',
    disabled = false,
    helperText = 'Define qué análisis se van a solicitar al laboratorio para que la programación y la toma mantengan el mismo alcance.'
}) => {
    const suggestedCodes = SUGGESTED_CODES_BY_ENTITY[entityType] || [];
    const sortedParameters = useMemo(
        () => sortParameters(parameters, suggestedCodes),
        [parameters, suggestedCodes]
    );

    const toggleParameter = (parameterId) => {
        if (disabled || typeof onChange !== 'function') return;

        const nextSelection = selectedIds.includes(parameterId)
            ? selectedIds.filter(id => id !== parameterId)
            : [...selectedIds, parameterId];

        onChange(nextSelection);
    };

    return (
        <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4">
            <div className="flex items-start gap-3">
                <div className="rounded-xl bg-white p-2 text-indigo-700">
                    <FlaskConical size={18} />
                </div>
                <div>
                    <h3 className="text-sm font-bold text-indigo-900">Análisis solicitados</h3>
                    <p className="mt-1 text-sm text-indigo-800">{helperText}</p>
                </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="inline-flex rounded-full border border-indigo-200 bg-white px-3 py-1 text-xs font-semibold text-indigo-700">
                    {selectedIds.length} análisis seleccionado(s)
                </span>
                {suggestedCodes.length > 0 && (
                    <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                        Sugeridos para este tipo de muestra
                    </span>
                )}
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
                {sortedParameters.map((parameter) => {
                    const selected = selectedIds.includes(parameter.id);
                    const suggested = suggestedCodes.includes(parameter.code);

                    return (
                        <button
                            key={parameter.id}
                            type="button"
                            onClick={() => toggleParameter(parameter.id)}
                            disabled={disabled}
                            className={`rounded-2xl border px-4 py-3 text-left transition-colors ${selected
                                ? 'border-indigo-300 bg-white shadow-sm ring-2 ring-indigo-100'
                                : 'border-white bg-white/80 hover:border-indigo-200 hover:bg-white'
                                } ${disabled ? 'cursor-not-allowed opacity-70' : ''}`}
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <p className="text-sm font-semibold text-slate-900">{parameter.name}</p>
                                    <p className="mt-1 text-xs text-slate-500">{parameter.unit || parameter.specText || parameter.code}</p>
                                </div>
                                {selected && (
                                    <span className="rounded-full bg-indigo-100 p-1 text-indigo-700">
                                        <CheckCircle2 size={14} />
                                    </span>
                                )}
                            </div>
                            {suggested && (
                                <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
                                    Recomendado para este ente muestreado
                                </p>
                            )}
                        </button>
                    );
                })}
            </div>
        </div>
    );
};

export default MicroAnalysisSelector;
