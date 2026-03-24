import React from 'react';
import { ArrowRight } from 'lucide-react';

const SECTION_STATUS_META = {
    current: 'border-cyan-200 bg-cyan-50 text-cyan-800',
    completed: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    attention: 'border-amber-200 bg-amber-50 text-amber-800',
    blocked: 'border-rose-200 bg-rose-50 text-rose-800',
    pending: 'border-slate-200 bg-white text-slate-700'
};

const MicroInternalWorkspaceNav = ({
    sections = [],
    activeSectionId = '',
    onChange,
    nextAction = null
}) => (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
                <h3 className="text-sm font-bold uppercase tracking-wide text-slate-900">Subventanas del laboratorio</h3>
                <p className="mt-1 text-xs text-slate-500">
                    Trabaja por etapas para que la ficha, la ejecución y el cierre no compitan en la misma vista.
                </p>
            </div>
            {nextAction?.label && typeof onChange === 'function' && (
                <button
                    type="button"
                    onClick={() => onChange(nextAction.sectionId)}
                    className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
                >
                    <ArrowRight size={14} />
                    {nextAction.label}
                </button>
            )}
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {sections.map(section => {
                const Icon = section.icon;
                const statusClass = SECTION_STATUS_META[section.status] || SECTION_STATUS_META.pending;
                const isActive = activeSectionId === section.id;

                return (
                    <button
                        key={section.id}
                        type="button"
                        onClick={() => onChange?.(section.id)}
                        className={`rounded-2xl border px-4 py-3 text-left transition-colors ${isActive ? 'ring-2 ring-cyan-200' : ''} ${statusClass}`}
                    >
                        <div className="flex items-center justify-between gap-2">
                            <div className="inline-flex items-center gap-2">
                                {Icon ? <Icon size={15} /> : null}
                                <span className="text-sm font-semibold">{section.label}</span>
                            </div>
                            {section.badge ? (
                                <span className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-semibold">
                                    {section.badge}
                                </span>
                            ) : null}
                        </div>
                        <p className="mt-2 text-xs opacity-80">{section.helper || 'Sin detalle adicional.'}</p>
                    </button>
                );
            })}
        </div>
    </div>
);

export default MicroInternalWorkspaceNav;
