import React, { useMemo } from 'react';
import { Bar, Line } from 'react-chartjs-2';
import { Activity, Clock3, Scale, TestTubeDiagonal } from 'lucide-react';
import {
    buildSeriesChartModel,
    formatContextList,
    formatDateTimeLabel,
    formatSpecText,
    formatValueLabel,
    getDataKindLabel,
    getSeriesChartLabel
} from '../microTrendUtils';

const MetricCard = ({ label, value, accent = 'text-slate-900' }) => (
    <div className="rounded-2xl border border-slate-100 bg-slate-50/80 px-3 py-3">
        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
        <p className={`mt-1 text-sm font-semibold ${accent}`}>{value}</p>
    </div>
);

const MicroTrendSeriesCard = ({ trend, color }) => {
    const chartModel = useMemo(() => buildSeriesChartModel(trend, color), [trend, color]);
    const ChartComponent = chartModel.type === 'bar' ? Bar : Line;
    const contextLine = [
        formatContextList(trend.contexts?.workContexts),
        formatContextList(trend.contexts?.laboratoryProfiles),
        formatContextList(trend.contexts?.shifts)
    ].filter(value => value && value !== '—').join(' · ');

    const observedValue = trend.dataKind === 'qualitative'
        ? `${trend.detectionRate ?? 0}% detectado`
        : `${formatValueLabel(trend.minValue)} → ${formatValueLabel(trend.maxValue)}`;

    const coverageValue = trend.hasCriteria
        ? `${trend.complianceRate ?? 0}% conforme`
        : `${trend.evaluationCoverageRate ?? 0}% evaluado`;

    return (
        <article className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-bold text-slate-900">{trend.parameter?.name}</h3>
                        <span className="inline-flex rounded-full border border-cyan-100 bg-cyan-50 px-2.5 py-1 text-[11px] font-semibold text-cyan-700">
                            {trend.point?.code || 'Sin punto'}
                        </span>
                        <span className="inline-flex rounded-full border border-violet-100 bg-violet-50 px-2.5 py-1 text-[11px] font-semibold text-violet-700">
                            {getDataKindLabel(trend.dataKind)}
                        </span>
                        <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700">
                            {getSeriesChartLabel(trend)}
                        </span>
                    </div>
                    <p className="text-sm text-slate-600">
                        {trend.point?.name || 'Punto no disponible'} · {trend.point?.processArea || 'Área sin clasificar'} · {trend.parameter?.unit || 'Sin unidad'}
                    </p>
                    <p className="text-xs text-slate-500">
                        {formatSpecText(trend.parameter)}
                    </p>
                    {contextLine && (
                        <p className="text-xs text-slate-400">
                            Contexto visible: {contextLine}
                        </p>
                    )}
                </div>

                <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 lg:min-w-[220px]">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Última captura</p>
                    <p className="mt-1 text-sm font-semibold text-slate-800">{formatDateTimeLabel(trend.latestCapture)}</p>
                    <p className="mt-1 text-xs text-slate-500">
                        {trend.latestSampleNumber || 'Sin muestra visible'} · {formatValueLabel(trend.latestDisplayValue)}
                    </p>
                </div>
            </div>

            {!trend.hasCriteria && (
                <div className="mt-4 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    Esta serie sí aporta historial y comparación, pero todavía no tiene criterio microbiológico configurado para calificar conformidad.
                </div>
            )}

            <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
                <MetricCard
                    label="Último Resultado"
                    value={formatValueLabel(trend.latestDisplayValue)}
                    accent="text-slate-900"
                />
                <MetricCard
                    label={trend.dataKind === 'qualitative' ? 'Detección' : 'Rango Observado'}
                    value={observedValue}
                    accent={trend.dataKind === 'qualitative' ? 'text-rose-700' : 'text-cyan-700'}
                />
                <MetricCard
                    label="Registros"
                    value={`${trend.recordCount} observación(es)`}
                    accent="text-slate-900"
                />
                <MetricCard
                    label={trend.hasCriteria ? 'Conformidad' : 'Cobertura'}
                    value={coverageValue}
                    accent={trend.hasCriteria ? 'text-emerald-700' : 'text-amber-700'}
                />
            </div>

            <div className="mt-5 h-80">
                <ChartComponent data={chartModel.data} options={chartModel.options} />
            </div>

            <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="rounded-2xl border border-slate-100 bg-white px-4 py-3">
                    <div className="flex items-center gap-2 text-slate-700">
                        <Clock3 size={15} />
                        <span className="text-xs font-bold uppercase tracking-wide">Muestreo</span>
                    </div>
                    <p className="mt-2 text-sm text-slate-600">
                        {trend.point?.processArea || 'Área no definida'} · {trend.point?.zoneName || 'Zona no definida'}
                    </p>
                </div>

                <div className="rounded-2xl border border-slate-100 bg-white px-4 py-3">
                    <div className="flex items-center gap-2 text-slate-700">
                        <Activity size={15} />
                        <span className="text-xs font-bold uppercase tracking-wide">Motor</span>
                    </div>
                    <p className="mt-2 text-sm text-slate-600">
                        {trend.chartRecommendation?.reason}
                    </p>
                </div>

                <div className="rounded-2xl border border-slate-100 bg-white px-4 py-3">
                    <div className="flex items-center gap-2 text-slate-700">
                        {trend.dataKind === 'qualitative' ? <TestTubeDiagonal size={15} /> : <Scale size={15} />}
                        <span className="text-xs font-bold uppercase tracking-wide">
                            {trend.dataKind === 'qualitative' ? 'Lectura' : 'Escala'}
                        </span>
                    </div>
                    <p className="mt-2 text-sm text-slate-600">
                        {trend.dataKind === 'qualitative'
                            ? 'Serie binaria de presencia o ausencia.'
                            : trend.chartRecommendation?.useLogScale
                                ? 'Escala logarítmica para comparar recuentos con saltos amplios.'
                                : 'Escala lineal porque la variación es comparable sin comprimir la serie.'}
                    </p>
                </div>
            </div>
        </article>
    );
};

export default MicroTrendSeriesCard;
