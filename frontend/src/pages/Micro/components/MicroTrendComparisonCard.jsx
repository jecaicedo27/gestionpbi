import React, { useMemo } from 'react';
import { Bar, Line } from 'react-chartjs-2';
import { GitCompareArrows, Layers3, MapPinned } from 'lucide-react';
import {
    buildComparisonChartModel,
    formatDateTimeLabel,
    formatSpecText,
    formatValueLabel,
    getComparisonChartLabel,
    getDataKindLabel
} from '../microTrendUtils';

const PointSummaryCard = ({ group, summary }) => {
    const secondaryValue = group.dataKind === 'qualitative'
        ? `${summary.detectionRate ?? 0}% detectado`
        : `Último: ${formatValueLabel(summary.latestDisplayValue)}`;

    return (
        <div className="rounded-2xl border border-slate-100 bg-slate-50/80 px-3 py-3">
            <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-900">{summary.point?.code || 'Sin punto'}</p>
                <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                    {summary.recordCount} reg.
                </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">{summary.point?.name || 'Punto no disponible'}</p>
            <p className="mt-2 text-sm font-medium text-slate-700">{secondaryValue}</p>
            <p className="mt-1 text-xs text-slate-400">{formatDateTimeLabel(summary.latestCapture)}</p>
        </div>
    );
};

const MicroTrendComparisonCard = ({ group }) => {
    const chartModel = useMemo(() => buildComparisonChartModel(group), [group]);
    const ChartComponent = chartModel.type === 'bar' ? Bar : Line;

    return (
        <article className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-bold text-slate-900">{group.parameter?.name}</h3>
                        <span className="inline-flex rounded-full border border-sky-100 bg-sky-50 px-2.5 py-1 text-[11px] font-semibold text-sky-700">
                            {getComparisonChartLabel(group)}
                        </span>
                        <span className="inline-flex rounded-full border border-violet-100 bg-violet-50 px-2.5 py-1 text-[11px] font-semibold text-violet-700">
                            {getDataKindLabel(group.dataKind)}
                        </span>
                    </div>
                    <p className="text-sm text-slate-600">
                        {group.parameter?.unit || 'Sin unidad'} · {formatSpecText(group.parameter)}
                    </p>
                    <p className="text-xs text-slate-400">
                        Solo se comparan series que comparten exactamente el mismo parámetro, unidad y eje de lectura.
                    </p>
                </div>

                <div className="grid grid-cols-2 gap-3 lg:min-w-[280px]">
                    <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Puntos</p>
                        <p className="mt-1 text-lg font-bold text-slate-900">{group.pointCount}</p>
                    </div>
                    <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Registros</p>
                        <p className="mt-1 text-lg font-bold text-slate-900">{group.totalRecords}</p>
                    </div>
                </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="rounded-2xl border border-slate-100 bg-white px-4 py-3">
                    <div className="flex items-center gap-2 text-slate-700">
                        <GitCompareArrows size={15} />
                        <span className="text-xs font-bold uppercase tracking-wide">Comparación</span>
                    </div>
                    <p className="mt-2 text-sm text-slate-600">{group.chartRecommendation?.reason}</p>
                </div>

                <div className="rounded-2xl border border-slate-100 bg-white px-4 py-3">
                    <div className="flex items-center gap-2 text-slate-700">
                        <MapPinned size={15} />
                        <span className="text-xs font-bold uppercase tracking-wide">Áreas</span>
                    </div>
                    <p className="mt-2 text-sm text-slate-600">
                        {(group.processAreas || []).length > 0 ? group.processAreas.join(' · ') : 'Sin áreas relacionadas'}
                    </p>
                </div>

                <div className="rounded-2xl border border-slate-100 bg-white px-4 py-3">
                    <div className="flex items-center gap-2 text-slate-700">
                        <Layers3 size={15} />
                        <span className="text-xs font-bold uppercase tracking-wide">Última captura</span>
                    </div>
                    <p className="mt-2 text-sm text-slate-600">
                        {formatDateTimeLabel(group.latestCapture)} · {formatValueLabel(group.latestDisplayValue)}
                    </p>
                </div>
            </div>

            <div className="mt-5 h-96">
                <ChartComponent data={chartModel.data} options={chartModel.options} />
            </div>

            <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {(group.pointSummaries || []).map(summary => (
                    <PointSummaryCard key={summary.seriesKey} group={group} summary={summary} />
                ))}
            </div>
        </article>
    );
};

export default MicroTrendComparisonCard;
