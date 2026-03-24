import React from 'react';
import { Pencil, Power, PowerOff } from 'lucide-react';
import {
    LABORATORY_PROFILE_OPTIONS,
    LAB_LABELS,
    SHIFT_OPTIONS,
    WORKFLOW_OPTIONS,
    buildOptionLabel,
    buildWorkContextOptions
} from '../microLabConfig';

const statusMeta = {
    true: {
        label: 'Activo',
        className: 'bg-emerald-50 text-emerald-700 border border-emerald-200'
    },
    false: {
        label: 'Deshabilitado',
        className: 'bg-slate-100 text-slate-600 border border-slate-200'
    }
};

const MicroSamplingPointCard = ({ point, saving = false, onEdit, onToggleStatus }) => {
    const pointStatus = statusMeta[`${point.isActive}`];
    const contextOptions = buildWorkContextOptions(point.allowedWorkContexts || []);

    return (
        <div className="px-5 py-4">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-xl bg-slate-900 px-3 py-1 text-xs font-bold tracking-wide text-white">{point.zoneCode}</span>
                        <span className="rounded-xl bg-cyan-50 px-3 py-1 text-xs font-bold tracking-wide text-cyan-700">{point.code}</span>
                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${pointStatus.className}`}>{pointStatus.label}</span>
                        {point.isEnvironmental && (
                            <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700">
                                Ambiental
                            </span>
                        )}
                    </div>

                    <div>
                        <h3 className="text-lg font-bold text-slate-900">{point.name}</h3>
                        <p className="mt-1 text-sm text-slate-500">
                            {point.zoneName || point.processArea || 'Sin zona visible definida'}
                        </p>
                    </div>

                    <div className="flex flex-wrap gap-2 text-xs">
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 font-semibold text-slate-700">
                            Flujo: {LAB_LABELS[point.defaultWorkflowType] || point.defaultWorkflowType}
                        </span>
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 font-semibold text-slate-700">
                            Área: {point.processArea || 'Sin área'}
                        </span>
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 font-semibold text-slate-700">
                            Contexto def.: {point.defaultWorkContext || 'Automático'}
                        </span>
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 font-semibold text-slate-700">
                            Orden: {point.sortOrder ?? 0}
                        </span>
                        <span className="rounded-full border border-cyan-100 bg-cyan-50 px-2.5 py-1 font-semibold text-cyan-700">
                            {point.usage?.samples || 0} muestra(s)
                        </span>
                        <span className="rounded-full border border-cyan-100 bg-cyan-50 px-2.5 py-1 font-semibold text-cyan-700">
                            {point.usage?.scheduleEntries || 0} programación(es)
                        </span>
                    </div>

                    {point.description && (
                        <p className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                            {point.description}
                        </p>
                    )}

                    {contextOptions.length > 0 && (
                        <div className="flex flex-wrap gap-2 text-xs">
                            {contextOptions.map((context) => (
                                <span key={context.value} className="rounded-full border border-cyan-100 bg-cyan-50 px-2.5 py-1 font-semibold text-cyan-700">
                                    {context.label}
                                </span>
                            ))}
                        </div>
                    )}

                    <div className="flex flex-wrap gap-2 text-xs">
                        {(point.allowedWorkflowTypes || []).map((workflow) => (
                            <span key={workflow} className="rounded-full border border-amber-100 bg-amber-50 px-2.5 py-1 font-semibold text-amber-700">
                                {buildOptionLabel(WORKFLOW_OPTIONS, workflow)}
                            </span>
                        ))}
                        {(point.allowedLaboratoryProfiles || []).map((profile) => (
                            <span key={profile} className="rounded-full border border-violet-100 bg-violet-50 px-2.5 py-1 font-semibold text-violet-700">
                                {buildOptionLabel(LABORATORY_PROFILE_OPTIONS, profile)}
                            </span>
                        ))}
                        {(point.allowedShifts || []).map((shift) => (
                            <span key={shift} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 font-semibold text-slate-700">
                                {buildOptionLabel(SHIFT_OPTIONS, shift)}
                            </span>
                        ))}
                    </div>
                </div>

                <div className="flex flex-wrap gap-2 xl:justify-end">
                    <button
                        type="button"
                        onClick={() => onEdit(point)}
                        className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                        <Pencil size={15} />
                        Editar
                    </button>
                    <button
                        type="button"
                        disabled={saving}
                        onClick={() => onToggleStatus(point)}
                        className={`inline-flex items-center gap-2 rounded-2xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 ${point.isActive ? 'bg-amber-600 hover:bg-amber-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}
                    >
                        {point.isActive ? <PowerOff size={15} /> : <Power size={15} />}
                        {point.isActive ? 'Deshabilitar' : 'Habilitar'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default MicroSamplingPointCard;
