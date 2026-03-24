import React from 'react';
import {
    resolvePredictionModeLabel,
    resolvePredictionReadinessMeta,
    toUnitsNumber
} from './shared';

const MetricCard = ({ label, value, subline }) => (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">{label}</p>
        <p className="mt-1 text-2xl font-black text-slate-900">{value}</p>
        <p className="mt-1 text-[11px] text-slate-500">{subline}</p>
    </div>
);

const formatMetricValue = (value, suffix = '') => (
    `${toUnitsNumber(value).toLocaleString('es-CO')}${suffix}`
);

const LotPredictionMethodologyCard = ({ predictionModel }) => {
    if (!predictionModel) return null;

    const readinessMeta = resolvePredictionReadinessMeta(predictionModel.readiness?.level);
    const diagnostics = predictionModel.trainingDiagnostics || {};
    const validation = predictionModel.validation || {};
    const calibration = predictionModel.calibration || {};
    const candidateLots = toUnitsNumber(diagnostics.candidateLots);
    const horizonEligibleLots = toUnitsNumber(diagnostics.horizonEligibleLots);
    const usableSnapshotLots = toUnitsNumber(diagnostics.usableSnapshotLots);
    const lookbackEligibleLots = toUnitsNumber(diagnostics.lookbackEligibleLots);
    const methodologyLabel = resolvePredictionModeLabel(predictionModel);
    const maturityWindowLabel = `${toUnitsNumber(predictionModel.minimumMatureHistoryDays)}d`;

    return (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                <div className="max-w-3xl">
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Motor Predictivo</p>
                    <h4 className="mt-1 text-sm font-black text-slate-900">{methodologyLabel}</h4>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{predictionModel.summary}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <div className={`rounded-full border px-3 py-1.5 text-xs font-bold ${readinessMeta.className}`}>
                        {predictionModel.readiness?.label || readinessMeta.label}
                    </div>
                    {predictionModel.fallbackLabel && (
                        <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-600">
                            {predictionModel.fallbackLabel}
                        </div>
                    )}
                    <div className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-bold text-sky-700">
                        Confiabilidad {formatMetricValue(predictionModel.reliabilityScorePct, '%')}
                    </div>
                </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
                <MetricCard
                    label="Muestras"
                    value={formatMetricValue(predictionModel.trainingSamples)}
                    subline={predictionModel.trained ? 'muestras supervisadas activas' : 'aun sin entrenamiento supervisado'}
                />
                <MetricCard
                    label="Lotes maduros"
                    value={`${horizonEligibleLots.toLocaleString('es-CO')} / ${candidateLots.toLocaleString('es-CO')}`}
                    subline={`alcanzan la ventana minima de ${maturityWindowLabel}`}
                />
                <MetricCard
                    label="Snapshots utiles"
                    value={usableSnapshotLots.toLocaleString('es-CO')}
                    subline={`${lookbackEligibleLots.toLocaleString('es-CO')} lotes ya entran en lookback`}
                />
                <MetricCard
                    label="Cobertura"
                    value={calibration.isCalibrated ? 'Calibrada' : 'Base'}
                    subline={calibration.isCalibrated
                        ? `gamma ${calibration.gamma} · mse ${calibration.mse}`
                        : 'sin calibracion historica suficiente'}
                />
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_0.9fr]">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Uso Recomendado</p>
                    <p className="mt-2 text-sm text-slate-700">{predictionModel.recommendedUse}</p>
                    <p className="mt-3 text-[11px] text-slate-500">
                        {predictionModel.trained
                            ? `F1 ${validation.f1 ?? '—'} · AUC ${validation.aucRoc ?? '—'} · Brier ${validation.brier ?? '—'}`
                            : `El sistema activara entrenamiento supervisado cuando existan lotes con ${maturityWindowLabel} o mas desde el primer reporte.`}
                    </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Limitacion Actual</p>
                    <p className="mt-2 text-sm text-slate-700">{predictionModel.limitation}</p>
                    <p className="mt-3 text-[11px] text-slate-500">{predictionModel.nextMilestone}</p>
                </div>
            </div>
        </div>
    );
};

export default LotPredictionMethodologyCard;
