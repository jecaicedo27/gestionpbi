import React from 'react';
import {
    BUCKET_META,
    PRESSURE_META,
    QUALITY_META,
    formatShortList,
    getSeverityBadgeClass,
    resolveBucketMeta,
    toUnitsNumber
} from './shared';

const SummaryMetricCard = ({ label, value, subline }) => (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-3">
        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">{label}</p>
        <p className="mt-1 text-2xl font-black text-slate-900">{value}</p>
        <p className="mt-1 text-[11px] text-slate-500">{subline}</p>
    </div>
);

const PriorityLotItem = ({ row, mode = 'priority' }) => {
    const bucketMeta = resolveBucketMeta(row.operationalBucket);
    const impactLabel = mode === 'priority' ? 'Impacto ajustado' : 'Último reporte';
    const impactValue = mode === 'priority'
        ? `${toUnitsNumber(row.impactUnits).toLocaleString('es-CO')} uds`
        : `${row.daysSinceLastReport ?? '—'}d`;

    return (
        <div className="rounded-xl border border-slate-200 bg-white px-3 py-3">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <p className="font-black text-slate-900">{row.lot}</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">{formatShortList(row.flavors)}</p>
                </div>
                <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${getSeverityBadgeClass(row.severity)}`}>
                    {row.severity || 'normal'}
                </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                <span
                    className="inline-flex rounded-full px-2 py-0.5 font-semibold text-white"
                    style={{ backgroundColor: bucketMeta.color }}
                >
                    {bucketMeta.label}
                </span>
                <span className="text-slate-500">{row.defectLabel || 'OTRO'}</span>
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px] text-slate-600">
                <span>{impactLabel}</span>
                <strong className="text-slate-900">{impactValue}</strong>
            </div>
            {mode === 'priority' && (
                <div className="mt-1 flex items-center justify-between text-[11px] text-slate-600">
                    <span>Confianza / prioridad</span>
                    <strong className="text-slate-900">
                        {toUnitsNumber(row.confidenceScore).toLocaleString('es-CO')}% · {toUnitsNumber(row.priorityScore).toLocaleString('es-CO')}
                    </strong>
                </div>
            )}
        </div>
    );
};

const LotContinuityExecutiveSummary = ({ overview, analysisQuality, executiveSummary }) => {
    if (!overview || !analysisQuality || !executiveSummary) return null;

    const pressureMeta = PRESSURE_META[executiveSummary.pressureLevel] || PRESSURE_META.media;
    const qualityMeta = QUALITY_META[analysisQuality.level] || QUALITY_META.baja;

    const bucketCards = (overview.buckets || [])
        .filter((bucket) => toUnitsNumber(bucket.lots) > 0)
        .map((bucket) => ({
            ...bucket,
            meta: BUCKET_META[bucket.key] || BUCKET_META.sin_datos
        }));

    return (
        <div className="rounded-[28px] border border-slate-200 bg-gradient-to-br from-slate-50 via-white to-slate-100 p-4 shadow-sm">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                <div className="max-w-3xl">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Lectura Ejecutiva</p>
                    <h3 className="mt-1 text-xl font-black text-slate-950">{executiveSummary.headline}</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{executiveSummary.narrative}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <div className={`rounded-full border px-3 py-1.5 text-xs font-bold ${pressureMeta.className}`}>
                        {pressureMeta.label}
                    </div>
                    <div className={`rounded-full border px-3 py-1.5 text-xs font-bold ${qualityMeta.className}`}>
                        {qualityMeta.label}
                    </div>
                </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                <SummaryMetricCard
                    label="Observado"
                    value={toUnitsNumber(executiveSummary.observedUnitsTotal).toLocaleString('es-CO')}
                    subline="unidades ya reportadas"
                />
                <SummaryMetricCard
                    label="Proyección Bruta"
                    value={toUnitsNumber(executiveSummary.projectedAdditionalUnitsTotal).toLocaleString('es-CO')}
                    subline="potencial adicional sin ponderar"
                />
                <SummaryMetricCard
                    label="Proyección Ajustada"
                    value={toUnitsNumber(executiveSummary.weightedProjectedAdditionalUnitsTotal).toLocaleString('es-CO')}
                    subline="potencial adicional ponderado por confianza"
                />
                <SummaryMetricCard
                    label="Impacto Esperado"
                    value={toUnitsNumber(executiveSummary.weightedImpactUnitsTotal).toLocaleString('es-CO')}
                    subline="observado + proyección ajustada"
                />
                <SummaryMetricCard
                    label="Alta Severidad Activa"
                    value={toUnitsNumber(executiveSummary.activeHighSeverityLots).toLocaleString('es-CO')}
                    subline="lotes críticos o recall con actividad reciente"
                />
                <SummaryMetricCard
                    label="Cierre Potencial"
                    value={toUnitsNumber(executiveSummary.closureOpportunityLots).toLocaleString('es-CO')}
                    subline="lotes enfriando o sin reporte reciente"
                />
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[1.15fr_0.85fr]">
                <div className="rounded-2xl border border-slate-200 bg-white/90 p-4">
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Criterio Analítico</p>
                    <p className="mt-2 text-sm text-slate-700">{analysisQuality.hint}</p>
                    <p className="mt-2 text-[11px] text-slate-500">
                        Confianza promedio {analysisQuality.averageConfidencePct ?? '—'}% · mediana {analysisQuality.medianConfidencePct ?? '—'}% · confiabilidad {analysisQuality.reliabilityScorePct ?? '—'}% · muestras {analysisQuality.sampleSize ?? 0}
                    </p>
                    <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Foco principal</p>
                            <p className="mt-2 text-sm font-semibold text-slate-900">{executiveSummary.priorityFocus}</p>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Siguiente paso</p>
                            <div className="mt-2 space-y-2">
                                {executiveSummary.nextActions?.slice(0, 3).map((action) => (
                                    <p key={action} className="text-sm text-slate-700">
                                        {action}
                                    </p>
                                ))}
                            </div>
                        </div>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-5">
                        {bucketCards.map((bucket) => (
                            <div key={bucket.key} className={`rounded-xl border px-3 py-3 ${bucket.meta.cardClass}`}>
                                <p className="text-[10px] font-black uppercase tracking-[0.16em]">{bucket.meta.label}</p>
                                <p className="mt-1 text-2xl font-black">{toUnitsNumber(bucket.lots).toLocaleString('es-CO')}</p>
                                <p className="mt-1 text-[11px]">
                                    impacto ajustado {toUnitsNumber(bucket.impactUnits).toLocaleString('es-CO')} uds
                                </p>
                                <p className="mt-0.5 text-[11px]">
                                    confianza prom. {toUnitsNumber(bucket.avgConfidencePct).toLocaleString('es-CO')}%
                                </p>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-4">
                    <div className="rounded-2xl border border-slate-200 bg-white/90 p-4">
                        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Prioridad Inmediata</p>
                        <div className="mt-3 space-y-3">
                            {(executiveSummary.topPriorityLots || []).slice(0, 4).map((row) => (
                                <PriorityLotItem key={row.lot} row={row} mode="priority" />
                            ))}
                        </div>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white/90 p-4">
                        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Oportunidad de Cierre</p>
                        <div className="mt-3 space-y-3">
                            {(executiveSummary.closureCandidates || []).slice(0, 4).map((row) => (
                                <PriorityLotItem key={row.lot} row={row} mode="closure" />
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default LotContinuityExecutiveSummary;
