import React from 'react';
import { CheckCircle2, Clock3, CircleDashed, Route } from 'lucide-react';

const STATUS_META = {
    completed: {
        icon: CheckCircle2,
        tone: 'border-emerald-200 bg-emerald-50 text-emerald-700'
    },
    current: {
        icon: Clock3,
        tone: 'border-amber-200 bg-amber-50 text-amber-700'
    },
    pending: {
        icon: CircleDashed,
        tone: 'border-slate-200 bg-slate-50 text-slate-500'
    }
};

const getGridColumnsClass = (stepCount = 0) => {
    if (stepCount <= 1) return 'lg:grid-cols-1';
    if (stepCount === 2) return 'lg:grid-cols-2';
    if (stepCount === 3) return 'lg:grid-cols-3';
    if (stepCount === 4) return 'lg:grid-cols-4';
    if (stepCount === 5) return 'lg:grid-cols-5';
    if (stepCount === 6) return 'lg:grid-cols-3 xl:grid-cols-6';
    return 'lg:grid-cols-5';
};

const MicroWorkflowTimeline = ({ steps = [], title = 'Ruta operativa de la muestra' }) => (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2 text-slate-900">
            <Route size={17} className="text-slate-700" />
            <h3 className="text-sm font-bold uppercase tracking-wide">{title}</h3>
        </div>

        <div className={`mt-4 grid gap-3 ${getGridColumnsClass(steps.length)}`}>
            {steps.map((step) => {
                const meta = STATUS_META[step.status] || STATUS_META.pending;
                const Icon = meta.icon;

                return (
                    <div key={step.key} className={`rounded-2xl border px-4 py-3 ${meta.tone}`}>
                        <div className="flex items-center justify-between gap-2">
                            <Icon size={16} />
                            <span className="text-[11px] font-semibold uppercase tracking-wide">
                                {step.status === 'completed' ? 'Completo' : step.status === 'current' ? 'En curso' : 'Pendiente'}
                            </span>
                        </div>
                        <p className="mt-3 text-sm font-semibold">{step.label}</p>
                        {step.detail && (
                            <p className="mt-1 text-xs opacity-80">{step.detail}</p>
                        )}
                        {step.date && (
                            <p className="mt-2 text-[11px] font-medium opacity-75">
                                {new Date(step.date).toLocaleString('es-CO', {
                                    year: 'numeric',
                                    month: '2-digit',
                                    day: '2-digit',
                                    hour: '2-digit',
                                    minute: '2-digit'
                                })}
                            </p>
                        )}
                    </div>
                );
            })}
        </div>
    </div>
);

export default MicroWorkflowTimeline;
