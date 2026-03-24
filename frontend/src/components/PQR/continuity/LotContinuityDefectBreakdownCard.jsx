import React from 'react';
import {
    Bar,
    BarChart,
    CartesianGrid,
    Legend,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis
} from 'recharts';
import {
    BUCKET_ORDER,
    resolveBucketMeta,
    toUnitsNumber
} from './shared';

const DefectTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const row = payload[0]?.payload;
    if (!row) return null;

    return (
        <div className="max-w-[320px] rounded-xl border border-slate-200 bg-white px-3 py-3 text-xs shadow-xl">
            <p className="font-black text-slate-900">{row.defectLabel}</p>
            <p className="mt-1 text-slate-700">
                Lotes: <strong>{toUnitsNumber(row.totalLots).toLocaleString('es-CO')}</strong> · unidades defectuosas <strong>{toUnitsNumber(row.defectiveUnits).toLocaleString('es-CO')}</strong>
            </p>
            <p className="mt-1 text-slate-700">
                Impacto ajustado: <strong>{toUnitsNumber(row.impactUnits).toLocaleString('es-CO')}</strong> · confianza prom. <strong>{toUnitsNumber(row.avgConfidencePct).toLocaleString('es-CO')}%</strong>
            </p>
            {BUCKET_ORDER.map((key) => {
                const meta = resolveBucketMeta(key);
                const count = toUnitsNumber(row[key]);
                if (count <= 0) return null;
                return (
                    <p key={key} className="mt-1" style={{ color: meta.color }}>
                        {meta.label}: <strong>{count.toLocaleString('es-CO')}</strong>
                    </p>
                );
            })}
        </div>
    );
};

const LotContinuityDefectBreakdownCard = ({ defectBreakdown }) => {
    const defectRows = Array.isArray(defectBreakdown) ? defectBreakdown : [];

    return (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Distribución por Defecto</p>
                    <h4 className="text-sm font-black text-slate-900">Trayectoria operativa por defecto</h4>
                </div>
                <p className="text-[11px] text-slate-500">
                    Barras apiladas por lotes; el impacto ajustado aparece en el detalle
                </p>
            </div>
            {defectRows.length > 0 ? (
                <>
                    <ResponsiveContainer width="100%" height={340}>
                        <BarChart
                            data={defectRows}
                            layout="vertical"
                            margin={{ top: 8, right: 12, bottom: 8, left: 8 }}
                        >
                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                            <XAxis type="number" tick={{ fontSize: 11 }} />
                            <YAxis dataKey="defectLabel" type="category" width={125} tick={{ fontSize: 10 }} />
                            <Tooltip content={<DefectTooltip />} />
                            <Legend wrapperStyle={{ fontSize: '11px' }} />
                            {BUCKET_ORDER.map((key) => {
                                const meta = resolveBucketMeta(key);
                                return (
                                    <Bar
                                        key={key}
                                        dataKey={key}
                                        stackId="trajectory"
                                        name={meta.label}
                                        fill={meta.color}
                                        radius={key === 'sin_reporte_reciente' ? [0, 6, 6, 0] : [0, 0, 0, 0]}
                                    />
                                );
                            })}
                        </BarChart>
                    </ResponsiveContainer>
                    <p className="mt-2 text-[11px] text-slate-600">
                        Esta lectura muestra si cada defecto está entrando con lotes nuevos, sosteniendo presión activa, pasando por vigilancia o ya entrando a cierre.
                    </p>
                </>
            ) : (
                <div className="flex h-[340px] items-center justify-center text-sm text-slate-400">
                    Sin datos suficientes para la distribución por defecto
                </div>
            )}
        </div>
    );
};

export default LotContinuityDefectBreakdownCard;
