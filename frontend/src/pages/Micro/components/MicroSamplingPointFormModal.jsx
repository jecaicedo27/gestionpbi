import React, { useEffect, useMemo, useState } from 'react';
import { Layers3, PencilLine, Save, X } from 'lucide-react';
import {
    LABORATORY_PROFILE_OPTIONS,
    SHIFT_OPTIONS,
    WORKFLOW_OPTIONS,
    WORK_CONTEXT_OPTIONS,
    appendWorkContextOption,
    buildWorkContextOptions,
    normalizeWorkContextCollection,
    normalizeWorkContextValue
} from '../microLabConfig';

const getDefaultAllowedProfiles = (point = null) => {
    if (Array.isArray(point?.allowedLaboratoryProfiles) && point.allowedLaboratoryProfiles.length > 0) {
        return point.allowedLaboratoryProfiles;
    }

    const processArea = `${point?.processArea || ''}`.toLowerCase();
    if (processArea.includes('agua')) return ['AGUA'];
    if (point?.isEnvironmental) return ['AMBIENTE', 'SUPERFICIE'];
    return ['PRODUCTO', 'LIBERACION'];
};

const getDefaultAllowedShifts = (point = null) => (
    Array.isArray(point?.allowedShifts) && point.allowedShifts.length > 0
        ? point.allowedShifts
        : ['MANANA', 'TARDE']
);

const getDefaultAllowedWorkflowTypes = (point = null) => (
    Array.isArray(point?.allowedWorkflowTypes) && point.allowedWorkflowTypes.length > 0
        ? point.allowedWorkflowTypes
        : ['EXTERNAL', 'INTERNAL']
);

const buildInitialState = (point = null) => ({
    code: point?.code || '',
    name: point?.name || '',
    description: point?.description || '',
    processArea: point?.processArea || '',
    zoneName: point?.zoneName || '',
    sortOrder: point?.sortOrder ?? '',
    defaultWorkflowType: point?.defaultWorkflowType || 'EXTERNAL',
    allowedWorkflowTypes: getDefaultAllowedWorkflowTypes(point),
    defaultAssignedLab: point?.defaultAssignedLab || '',
    defaultLaboratoryProfile: point?.defaultLaboratoryProfile || getDefaultAllowedProfiles(point)[0] || '',
    allowedLaboratoryProfiles: getDefaultAllowedProfiles(point),
    defaultWorkContext: point?.defaultWorkContext || '',
    allowedWorkContexts: normalizeWorkContextCollection(point?.allowedWorkContexts || []),
    defaultShift: point?.defaultShift || getDefaultAllowedShifts(point)[0] || '',
    allowedShifts: getDefaultAllowedShifts(point),
    isEnvironmental: Boolean(point?.isEnvironmental)
});

const MicroSamplingPointFormModal = ({ point = null, saving = false, onClose, onSubmit }) => {
    const isEditMode = Boolean(point?.id);
    const [formData, setFormData] = useState(() => buildInitialState(point));
    const [manualWorkContext, setManualWorkContext] = useState('');

    useEffect(() => {
        setFormData(buildInitialState(point));
        setManualWorkContext('');
    }, [point]);

    const updateField = (field, value) => {
        setFormData((current) => ({ ...current, [field]: value }));
    };

    const contextOptions = useMemo(
        () => buildWorkContextOptions(appendWorkContextOption(formData.allowedWorkContexts, formData.defaultWorkContext)),
        [formData.allowedWorkContexts, formData.defaultWorkContext]
    );
    const workflowDefaultOptions = useMemo(() => (
        (formData.allowedWorkflowTypes || []).length > 0
            ? WORKFLOW_OPTIONS.filter((option) => formData.allowedWorkflowTypes.includes(option.value))
            : WORKFLOW_OPTIONS
    ), [formData.allowedWorkflowTypes]);
    const profileDefaultOptions = useMemo(() => (
        (formData.allowedLaboratoryProfiles || []).length > 0
            ? LABORATORY_PROFILE_OPTIONS.filter((option) => formData.allowedLaboratoryProfiles.includes(option.value))
            : LABORATORY_PROFILE_OPTIONS
    ), [formData.allowedLaboratoryProfiles]);
    const shiftDefaultOptions = useMemo(() => (
        (formData.allowedShifts || []).length > 0
            ? SHIFT_OPTIONS.filter((option) => formData.allowedShifts.includes(option.value))
            : SHIFT_OPTIONS
    ), [formData.allowedShifts]);

    const toggleWorkContext = (contextValue) => {
        const normalizedContext = normalizeWorkContextValue(contextValue);
        if (!normalizedContext) return;

        setFormData((current) => {
            const exists = (current.allowedWorkContexts || []).includes(normalizedContext);
            const nextAllowed = exists
                ? (current.allowedWorkContexts || []).filter((item) => item !== normalizedContext)
                : normalizeWorkContextCollection([...(current.allowedWorkContexts || []), normalizedContext]);

            return {
                ...current,
                allowedWorkContexts: nextAllowed,
                defaultWorkContext: current.defaultWorkContext === normalizedContext && exists
                    ? ''
                    : current.defaultWorkContext
            };
        });
    };

    const handleAddManualContext = () => {
        const normalizedContext = normalizeWorkContextValue(manualWorkContext);
        if (!normalizedContext) return;

        setFormData((current) => ({
            ...current,
            allowedWorkContexts: normalizeWorkContextCollection([...(current.allowedWorkContexts || []), normalizedContext]),
            defaultWorkContext: current.defaultWorkContext || normalizedContext
        }));
        setManualWorkContext('');
    };

    const toggleConfiguredOption = (field, defaultField, nextValue) => {
        setFormData((current) => {
            const currentValues = current[field] || [];
            const exists = currentValues.includes(nextValue);
            const updatedValues = exists
                ? currentValues.filter((item) => item !== nextValue)
                : [...currentValues, nextValue];

            return {
                ...current,
                [field]: updatedValues,
                [defaultField]: current[defaultField] === nextValue && exists
                    ? updatedValues[0] || ''
                    : current[defaultField] || updatedValues[0] || ''
            };
        });
    };

    const handleSubmit = (event) => {
        event.preventDefault();
        onSubmit({
            ...formData,
            allowedWorkflowTypes: Array.from(new Set([
                ...(formData.allowedWorkflowTypes || []),
                formData.defaultWorkflowType
            ].filter(Boolean))),
            allowedLaboratoryProfiles: Array.from(new Set([
                ...(formData.allowedLaboratoryProfiles || []),
                formData.defaultLaboratoryProfile
            ].filter(Boolean))),
            defaultWorkContext: normalizeWorkContextValue(formData.defaultWorkContext),
            allowedWorkContexts: normalizeWorkContextCollection([
                ...(formData.allowedWorkContexts || []),
                formData.defaultWorkContext
            ]),
            allowedShifts: Array.from(new Set([
                ...(formData.allowedShifts || []),
                formData.defaultShift
            ].filter(Boolean))),
            sortOrder: formData.sortOrder === '' ? '' : Number(formData.sortOrder)
        });
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
            <div className="w-full max-w-3xl overflow-hidden rounded-3xl bg-white shadow-2xl">
                <div className="flex items-center justify-between border-b border-slate-100 bg-gradient-to-r from-slate-900 via-cyan-900 to-teal-900 px-6 py-5 text-white">
                    <div className="flex items-center gap-3">
                        <div className="rounded-2xl bg-white/10 p-3">
                            <Layers3 size={20} />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold">{isEditMode ? 'Editar Punto de Muestreo' : 'Nuevo Punto de Muestreo'}</h2>
                            <p className="mt-1 text-sm text-cyan-50/80">
                                {isEditMode
                                    ? 'Puede actualizar el punto y deshabilitarlo más tarde sin perder historial.'
                                    : 'El código de zona se genera automáticamente al guardar y queda reservado para este punto.'}
                            </p>
                        </div>
                    </div>

                    <button type="button" onClick={onClose} className="rounded-full p-2 text-white/80 hover:bg-white/10 hover:text-white">
                        <X size={20} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-5 p-6">
                    {isEditMode && (
                        <div className="rounded-2xl border border-cyan-100 bg-cyan-50 px-4 py-3">
                            <p className="text-xs font-bold uppercase tracking-wide text-cyan-700">Código de zona</p>
                            <p className="mt-1 text-lg font-bold text-cyan-900">{point.zoneCode}</p>
                            <p className="mt-1 text-xs text-cyan-700">Este identificador es automático, único y no se reutiliza.</p>
                        </div>
                    )}

                    <div className="grid gap-4 md:grid-cols-2">
                        <div>
                            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Código del punto *</label>
                            <input
                                type="text"
                                value={formData.code}
                                onChange={(event) => updateField('code', event.target.value.toUpperCase())}
                                placeholder="Ej: ALG-PRE-01"
                                className="w-full rounded-2xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-200"
                                required
                            />
                        </div>

                        <div>
                            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Nombre *</label>
                            <input
                                type="text"
                                value={formData.name}
                                onChange={(event) => updateField('name', event.target.value)}
                                placeholder="Ej: Alginato pre-pasteurización"
                                className="w-full rounded-2xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-200"
                                required
                            />
                        </div>

                        <div>
                            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Zona visible</label>
                            <input
                                type="text"
                                value={formData.zoneName}
                                onChange={(event) => updateField('zoneName', event.target.value)}
                                placeholder="Ej: Pasteurización línea 1"
                                className="w-full rounded-2xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-200"
                            />
                        </div>

                        <div>
                            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Área de proceso</label>
                            <input
                                type="text"
                                value={formData.processArea}
                                onChange={(event) => updateField('processArea', event.target.value)}
                                placeholder="Ej: Pasteurización"
                                className="w-full rounded-2xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-200"
                            />
                        </div>

                        <div>
                            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Flujo por defecto</label>
                            <select
                                value={formData.defaultWorkflowType}
                                onChange={(event) => updateField('defaultWorkflowType', event.target.value)}
                                className="w-full rounded-2xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-200"
                            >
                                <option value="">Automático</option>
                                {workflowDefaultOptions.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Laboratorio asignado por defecto</label>
                            <input
                                type="text"
                                value={formData.defaultAssignedLab}
                                onChange={(event) => updateField('defaultAssignedLab', event.target.value)}
                                placeholder="Ej: Biotrends Laboratorios"
                                className="w-full rounded-2xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-200"
                            />
                        </div>

                        <div>
                            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Perfil por defecto</label>
                            <select
                                value={formData.defaultLaboratoryProfile}
                                onChange={(event) => updateField('defaultLaboratoryProfile', event.target.value)}
                                className="w-full rounded-2xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-200"
                            >
                                <option value="">Automático</option>
                                {profileDefaultOptions.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Turno por defecto</label>
                            <select
                                value={formData.defaultShift}
                                onChange={(event) => updateField('defaultShift', event.target.value)}
                                className="w-full rounded-2xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-200"
                            >
                                <option value="">Automático</option>
                                {shiftDefaultOptions.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Orden visual</label>
                            <input
                                type="number"
                                value={formData.sortOrder}
                                onChange={(event) => updateField('sortOrder', event.target.value)}
                                placeholder="Ej: 10"
                                className="w-full rounded-2xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-200"
                            />
                        </div>
                    </div>

                    <div className="rounded-2xl border border-amber-100 bg-amber-50/70 p-4 space-y-4">
                        <div>
                            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-amber-700">Flexibilidad operativa</label>
                            <p className="text-sm text-amber-900">
                                Define qu&eacute; turnos, perfiles y modos admite este punto. El valor por defecto siempre se conserva dentro de la lista al guardar.
                            </p>
                        </div>

                        <div className="space-y-3">
                            <div>
                                <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">Modos permitidos</label>
                                <div className="flex flex-wrap gap-2">
                                    {WORKFLOW_OPTIONS.map((option) => {
                                        const isActive = (formData.allowedWorkflowTypes || []).includes(option.value);
                                        return (
                                            <button
                                                key={option.value}
                                                type="button"
                                                onClick={() => toggleConfiguredOption('allowedWorkflowTypes', 'defaultWorkflowType', option.value)}
                                                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${isActive
                                                    ? 'border-amber-300 bg-amber-100 text-amber-900'
                                                    : 'border-white bg-white text-slate-600 hover:bg-amber-50'
                                                    }`}
                                            >
                                                {option.label}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            <div>
                                <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">Tipos de laboratorio permitidos</label>
                                <div className="flex flex-wrap gap-2">
                                    {LABORATORY_PROFILE_OPTIONS.map((option) => {
                                        const isActive = (formData.allowedLaboratoryProfiles || []).includes(option.value);
                                        return (
                                            <button
                                                key={option.value}
                                                type="button"
                                                onClick={() => toggleConfiguredOption('allowedLaboratoryProfiles', 'defaultLaboratoryProfile', option.value)}
                                                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${isActive
                                                    ? 'border-amber-300 bg-amber-100 text-amber-900'
                                                    : 'border-white bg-white text-slate-600 hover:bg-amber-50'
                                                    }`}
                                            >
                                                {option.label}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            <div>
                                <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">Turnos permitidos</label>
                                <div className="flex flex-wrap gap-2">
                                    {SHIFT_OPTIONS.map((option) => {
                                        const isActive = (formData.allowedShifts || []).includes(option.value);
                                        return (
                                            <button
                                                key={option.value}
                                                type="button"
                                                onClick={() => toggleConfiguredOption('allowedShifts', 'defaultShift', option.value)}
                                                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${isActive
                                                    ? 'border-amber-300 bg-amber-100 text-amber-900'
                                                    : 'border-white bg-white text-slate-600 hover:bg-amber-50'
                                                    }`}
                                            >
                                                {option.label}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="rounded-2xl border border-cyan-100 bg-cyan-50/70 p-4 space-y-4">
                        <div>
                            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-cyan-700">Contextos sincronizados</label>
                            <p className="text-sm text-cyan-900">
                                Define los contextos que este punto puede usar y deja uno por defecto. Puedes combinar presets con contextos manuales.
                            </p>
                        </div>

                        <div className="flex flex-wrap gap-2">
                            {WORK_CONTEXT_OPTIONS.map((option) => {
                                const isActive = (formData.allowedWorkContexts || []).includes(option.value);
                                return (
                                    <button
                                        key={option.value}
                                        type="button"
                                        onClick={() => toggleWorkContext(option.value)}
                                        className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${isActive
                                            ? 'border-cyan-300 bg-cyan-100 text-cyan-800'
                                            : 'border-white bg-white text-slate-600 hover:bg-cyan-50'
                                            }`}
                                    >
                                        {option.label}
                                    </button>
                                );
                            })}
                            {(formData.allowedWorkContexts || [])
                                .filter((context) => !WORK_CONTEXT_OPTIONS.some((option) => option.value === context))
                                .map((context) => (
                                    <button
                                        key={context}
                                        type="button"
                                        onClick={() => toggleWorkContext(context)}
                                        className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                                    >
                                        {context}
                                    </button>
                                ))}
                        </div>

                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={manualWorkContext}
                                onChange={(event) => setManualWorkContext(event.target.value)}
                                placeholder="Crear o editar contexto manual"
                                className="flex-1 rounded-2xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-200"
                            />
                            <button
                                type="button"
                                onClick={handleAddManualContext}
                                className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
                            >
                                <PencilLine size={15} />
                                Agregar
                            </button>
                        </div>

                        <div className="grid gap-4 md:grid-cols-2">
                            <div>
                                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Contexto por defecto</label>
                                <select
                                    value={formData.defaultWorkContext}
                                    onChange={(event) => updateField('defaultWorkContext', event.target.value)}
                                    className="w-full rounded-2xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-200"
                                >
                                    <option value="">Automático</option>
                                    {contextOptions.map((option) => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Editar manualmente el contexto por defecto</label>
                                <input
                                    type="text"
                                    value={formData.defaultWorkContext}
                                    onChange={(event) => updateField('defaultWorkContext', normalizeWorkContextValue(event.target.value))}
                                    placeholder="Ej: Producción, Lavado, Liberación o uno manual"
                                    className="w-full rounded-2xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-200"
                                />
                            </div>
                        </div>
                    </div>

                    <div>
                        <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Descripción</label>
                        <textarea
                            rows="3"
                            value={formData.description}
                            onChange={(event) => updateField('description', event.target.value)}
                            placeholder="Observaciones operativas del punto de muestreo"
                            className="w-full resize-none rounded-2xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-200"
                        />
                    </div>

                    <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700">
                        <input
                            type="checkbox"
                            checked={formData.isEnvironmental}
                            onChange={(event) => updateField('isEnvironmental', event.target.checked)}
                            className="h-4 w-4 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500"
                        />
                        Marcar como punto ambiental / superficie
                    </label>

                    <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
                        <button
                            type="button"
                            onClick={onClose}
                            className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            disabled={saving}
                            className="inline-flex items-center gap-2 rounded-2xl bg-cyan-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-cyan-700 disabled:opacity-60"
                        >
                            <Save size={15} />
                            {saving ? 'Guardando...' : isEditMode ? 'Guardar cambios' : 'Crear punto'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default MicroSamplingPointFormModal;
