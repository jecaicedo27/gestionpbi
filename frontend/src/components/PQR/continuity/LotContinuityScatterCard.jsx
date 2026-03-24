import React from 'react';
import {
    CartesianGrid,
    Legend,
    ReferenceLine,
    ResponsiveContainer,
    Scatter,
    ScatterChart,
    Tooltip,
    XAxis,
    YAxis,
    ZAxis
} from 'recharts';
import {
    BUCKET_ORDER,
    formatShortList,
    resolveBucketMeta,
    toUnitsNumber
} from './shared';

const BubbleTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const row = payload[0]?.payload;
    if (!row) return null;
    const meta = resolveBucketMeta(row.operationalBucket);

    return (
        <div className="max-w-[300px] rounded-xl border border-slate-200 bg-white px-3 py-3 text-xs shadow-xl">
            <p className="font-black text-slate-900">{row.lot}</p>
            <p className="mt-0.5 text-slate-500">{formatShortList(row.flavors)}</p>
            <div className="mt-2 flex items-center gap-2">
                <span className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold text-white" style={{ backgroundColor: meta.color }}>
                    {meta.label}
                </span>
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{row.severity || 'normal'}</span>
            </div>
            <p className="mt-2 text-slate-700">
                Defecto: <strong>{row.defectLabel || 'OTRO'}</strong>
            </p>
            <p className="mt-1 text-slate-700">
                Prob. continuidad: <strong>{toUnitsNumber(row.continueReportingProbabilityPct).toLocaleString('es-CO')}%</strong> · confianza <strong>{toUnitsNumber(row.confidenceScore).toLocaleString('es-CO')}%</strong>
            </p>
            <p className="mt-1 text-slate-700">
                Último reporte: <strong>{row.daysSinceLastReport ?? '—'}d</strong> · desde el primero <strong>{row.daysSinceFirstReport ?? '—'}d</strong>
            </p>
            <p className="mt-1 text-slate-700">
                Observado: <strong>{toUnitsNumber(row.reportedUnits).toLocaleString('es-CO')}</strong> · proyección ajustada <strong>{toUnitsNumber(row.weightedProjectedAdditionalUnits).toLocaleString('es-CO')}</strong>
            </p>
            <p className="mt-1 text-slate-700">
                Impacto ajustado: <strong>{toUnitsNumber(row.impactUnits).toLocaleString('es-CO')}</strong> · prioridad <strong>{toUnitsNumber(row.priorityScore).toLocaleString('es-CO')}</strong>
            </p>
        </div>
    );
};

const LotContinuityScatterCard = ({ overview, continuityMap }) => {
    if (!overview?.buckets?.length) return null;

    const thresholds = overview.thresholds || {
        recentDays: 7,
        monitorDays: 14,
        stoppedDays: 21
    };

    const visibleBuckets = BUCKET_ORDER
        .map((key) => overview.buckets.find((bucket) => bucket.key === key))
        .filter((bucket) => bucket && toUnitsNumber(bucket.lots) > 0);

    const mapRows = Array.isArray(continuityMap) ? continuityMap : [];

    return (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Visual Operativa</p>
                    <h4 className="text-sm font-black text-slate-900">Mapa de continuidad por lote</h4>
                </div>
                <p className="text-[11px] text-slate-500">
                    X = días desde último reporte · Y = continuidad probable · tamaño = impacto ajustado
                </p>
            </div>
            <ResponsiveContainer width="100%" height={340}>
                <ScatterChart margin={{ top: 12, right: 18, bottom: 8, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis
                        type="number"
                        dataKey="daysSinceLastReport"
                        name="Días desde último reporte"
                        tick={{ fontSize: 11 }}
                        tickFormatter={(value) => `${value}d`}
                    />
                    <YAxis
                        type="number"
                        dataKey="continueReportingProbabilityPct"
                        name="Probabilidad"
                        domain={[0, 100]}
                        tick={{ fontSize: 11 }}
                        tickFormatter={(value) => `${value}%`}
                    />
                    <ZAxis type="number" dataKey="impactUnits" range={[90, 1200]} />
                    <Tooltip content={<BubbleTooltip />} cursor={{ strokeDasharray: '4 4' }} />
                    <Legend wrapperStyle={{ fontSize: '11px' }} />
                    <ReferenceLine x={thresholds.recentDays} stroke="#cbd5e1" strokeDasharray="4 4" />
                    <ReferenceLine x={thresholds.monitorDays} stroke="#cbd5e1" strokeDasharray="4 4" />
                    <ReferenceLine x={thresholds.stoppedDays} stroke="#16a34a" strokeDasharray="4 4" />
                    <ReferenceLine y={60} stroke="#f97316" strokeDasharray="4 4" />
                    {visibleBuckets.map((bucket) => {
                        const meta = resolveBucketMeta(bucket.key);
                        const bucketRows = mapRows.filter((row) => row.operationalBucket === bucket.key);
                        if (bucketRows.length === 0) return null;
                        return (
                            <Scatter
                                key={bucket.key}
                                name={meta.label}
                                data={bucketRows}
                                fill={meta.color}
                            />
                        );
                    })}
                </ScatterChart>
            </ResponsiveContainer>
            <p className="mt-2 text-[11px] text-slate-600">
                La esquina superior izquierda concentra lotes nuevos o activos con presión fuerte. Hacia la derecha aparecen lotes con salida progresiva o candidatos a cierre.
            </p>
        </div>
    );
};

export default LotContinuityScatterCard;
