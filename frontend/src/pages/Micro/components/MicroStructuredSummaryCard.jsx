import React from 'react';
import { PencilLine } from 'lucide-react';

const TONE_CLASSES = {
    slate: 'border-slate-200 bg-slate-50',
    sky: 'border-sky-100 bg-sky-50',
    indigo: 'border-indigo-100 bg-indigo-50',
    teal: 'border-teal-100 bg-teal-50',
    emerald: 'border-emerald-100 bg-emerald-50',
    fuchsia: 'border-fuchsia-100 bg-fuchsia-50',
    rose: 'border-rose-100 bg-rose-50'
};

const formatSummaryValue = (value) => {
    if (React.isValidElement(value)) return value;
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'boolean') return value ? 'Sí' : 'No';
    if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : '—';
    return `${value}`;
};

const MicroStructuredSummaryCard = ({
    title,
    description = '',
    tone = 'slate',
    items = [],
    emptyText = 'Sin información registrada.',
    actionLabel = '',
    onAction,
    actionDisabled = false,
    footer = null
}) => {
    const visibleItems = items.filter(item => item && item.label);
    const toneClass = TONE_CLASSES[tone] || TONE_CLASSES.slate;

    return (
        <div className={`rounded-2xl border p-4 ${toneClass}`}>
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h3 className="text-sm font-bold text-slate-900">{title}</h3>
                    {description && (
                        <p className="mt-1 text-xs text-slate-600">{description}</p>
                    )}
                </div>
                {actionLabel && typeof onAction === 'function' && (
                    <button
                        type="button"
                        onClick={onAction}
                        disabled={actionDisabled}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                    >
                        <PencilLine size={13} />
                        {actionLabel}
                    </button>
                )}
            </div>

            {visibleItems.length === 0 ? (
                <p className="mt-4 text-sm text-slate-500">{emptyText}</p>
            ) : (
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                    {visibleItems.map(item => (
                        <div key={item.label} className={item.fullWidth ? 'md:col-span-2' : ''}>
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{item.label}</p>
                            <div className="mt-1 text-sm font-medium text-slate-800 whitespace-pre-wrap break-words">
                                {formatSummaryValue(item.value)}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {footer && (
                <div className="mt-4">
                    {footer}
                </div>
            )}
        </div>
    );
};

export default MicroStructuredSummaryCard;
