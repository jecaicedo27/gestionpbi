import React from 'react';
import { CalendarRange, Factory, Package, ShieldCheck, TestTube2 } from 'lucide-react';
import { formatDateTimeLabel } from '../microLabConfig';

const ToggleChip = ({ active = false, onClick, disabled = false, children }) => (
    <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${active
            ? 'border-cyan-300 bg-cyan-100 text-cyan-800'
            : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            } ${disabled ? 'cursor-not-allowed opacity-70' : ''}`}
    >
        {children}
    </button>
);

const MicroProductionContextPanel = ({
    context = null,
    loading = false,
    error = '',
    selectedScheduleEntryId = '',
    onSelectScheduleEntry,
    selectedBatchIds = [],
    onToggleBatch,
    selectedProductIds = [],
    onToggleProduct,
    selectedMaterialLotIds = [],
    onToggleMaterialLot,
    selectedRegistryLotKeys = [],
    onToggleRegistryLot,
    readOnly = false
}) => {
    const entityLabel = context?.entityContext?.entityLabel || 'Contexto productivo';

    return (
        <div className="rounded-2xl border border-cyan-100 bg-cyan-50/50 p-5 space-y-5">
            <div className="flex items-start gap-3">
                <div className="rounded-xl bg-white p-2 text-cyan-700">
                    <Factory size={18} />
                </div>
                <div>
                    <h3 className="text-sm font-bold text-cyan-900">Cruce automático con producción</h3>
                    <p className="mt-1 text-sm text-cyan-800">
                        {context?.entityContext?.helper || `Se están listando batches, productos y lotes relevantes para la muestra de tipo ${entityLabel}.`}
                    </p>
                </div>
            </div>

            {loading && (
                <div className="rounded-2xl border border-cyan-100 bg-white px-4 py-6 text-sm text-cyan-700">
                    Analizando producción en curso, lotes y programaciones relacionadas...
                </div>
            )}

            {!loading && error && (
                <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {error}
                </div>
            )}

            {!loading && !error && context && (
                <>
                    {(context.scheduleCandidates || []).length > 0 && (
                        <div className="rounded-2xl border border-white bg-white/80 p-4">
                            <div className="flex items-center gap-2 text-slate-900">
                                <CalendarRange size={16} className="text-cyan-700" />
                                <p className="text-sm font-bold">Programaciones disponibles para esta toma</p>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                                {context.scheduleCandidates.map((entry) => (
                                    <ToggleChip
                                        key={entry.id}
                                        active={selectedScheduleEntryId === entry.id}
                                        onClick={() => onSelectScheduleEntry?.(selectedScheduleEntryId === entry.id ? '' : entry.id)}
                                        disabled={readOnly}
                                    >
                                        {entry.plannedTime || 'Sin hora'} · {entry.shift || 'Sin turno'} · {entry.laboratoryProfile || 'Sin perfil'}
                                    </ToggleChip>
                                ))}
                            </div>
                        </div>
                    )}

                    {(context.activeBatches || []).length > 0 && (
                        <div className="rounded-2xl border border-white bg-white/80 p-4">
                            <div className="flex items-center gap-2 text-slate-900">
                                <Factory size={16} className="text-cyan-700" />
                                <p className="text-sm font-bold">Batches y totes en ventana de toma</p>
                            </div>
                            <div className="mt-3 grid gap-3 xl:grid-cols-2">
                                {context.activeBatches.map((batch) => (
                                    <div key={batch.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <p className="text-sm font-bold text-slate-900">{batch.batchNumber}</p>
                                                <p className="mt-1 text-xs text-slate-500">
                                                    {batch.flavor || 'Sin sabor'} · {batch.status}
                                                </p>
                                            </div>
                                            <ToggleChip
                                                active={selectedBatchIds.includes(batch.id)}
                                                onClick={() => onToggleBatch?.(batch.id)}
                                                disabled={readOnly}
                                            >
                                                {selectedBatchIds.includes(batch.id) ? 'Vinculado' : 'Vincular'}
                                            </ToggleChip>
                                        </div>
                                        {batch.activeStage && (
                                            <p className="mt-3 text-xs text-slate-600">
                                                Etapa actual: <strong>{batch.activeStage.stageName}</strong> ({batch.activeStage.status})
                                            </p>
                                        )}
                                        {batch.outputTargets.length > 0 && (
                                            <div className="mt-3 flex flex-wrap gap-2">
                                                {batch.outputTargets.map((target) => (
                                                    <ToggleChip
                                                        key={`${batch.id}-${target.productId}`}
                                                        active={selectedProductIds.includes(target.productId)}
                                                        onClick={() => onToggleProduct?.(target.productId)}
                                                        disabled={readOnly}
                                                    >
                                                        {target.productName}
                                                    </ToggleChip>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {(context.productsInProduction || []).length > 0 && (
                        <div className="rounded-2xl border border-white bg-white/80 p-4">
                            <div className="flex items-center gap-2 text-slate-900">
                                <Package size={16} className="text-cyan-700" />
                                <p className="text-sm font-bold">Productos fabricados detectados</p>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                                {context.productsInProduction.map((product) => (
                                    <ToggleChip
                                        key={product.productId}
                                        active={selectedProductIds.includes(product.productId)}
                                        onClick={() => onToggleProduct?.(product.productId)}
                                        disabled={readOnly}
                                    >
                                        {product.name}
                                    </ToggleChip>
                                ))}
                            </div>
                        </div>
                    )}

                    {(context.relevantMaterialLots || []).length > 0 && (
                        <div className="rounded-2xl border border-white bg-white/80 p-4">
                            <div className="flex items-center gap-2 text-slate-900">
                                <ShieldCheck size={16} className="text-cyan-700" />
                                <p className="text-sm font-bold">Lotes relevantes para este tipo de muestra</p>
                            </div>
                            <div className="mt-3 grid gap-3 md:grid-cols-2">
                                {context.relevantMaterialLots.map((lot) => (
                                    <div key={lot.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <p className="text-sm font-bold text-slate-900">{lot.lotNumber}</p>
                                                <p className="mt-1 text-xs text-slate-500">{lot.productName}</p>
                                            </div>
                                            <ToggleChip
                                                active={selectedMaterialLotIds.includes(lot.id)}
                                                onClick={() => onToggleMaterialLot?.(lot.id)}
                                                disabled={readOnly}
                                            >
                                                {selectedMaterialLotIds.includes(lot.id) ? 'Vinculado' : 'Vincular'}
                                            </ToggleChip>
                                        </div>
                                        <p className="mt-3 text-xs text-slate-600">
                                            Estado: <strong>{lot.status}</strong> · Zona: <strong>{lot.zone}</strong>
                                        </p>
                                        <p className="mt-1 text-xs text-slate-500">
                                            Stock actual: {Number(lot.currentQuantity || 0).toLocaleString('es-CO')}
                                        </p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {((context.registryLots?.productionLots || []).length > 0 || (context.registryLots?.syrupLots || []).length > 0) && (
                        <div className="rounded-2xl border border-white bg-white/80 p-4">
                            <div className="flex items-center gap-2 text-slate-900">
                                <TestTube2 size={16} className="text-cyan-700" />
                                <p className="text-sm font-bold">Histórico cercano de lotes fabricados</p>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                                {(context.registryLots?.productionLots || []).map((lot) => {
                                    const key = `production:${lot.lotCode}`;
                                    return (
                                        <ToggleChip
                                            key={key}
                                            active={selectedRegistryLotKeys.includes(key)}
                                            onClick={() => onToggleRegistryLot?.(key)}
                                            disabled={readOnly}
                                        >
                                            {lot.lotCode} · {lot.flavor}
                                        </ToggleChip>
                                    );
                                })}
                                {(context.registryLots?.syrupLots || []).map((lot) => {
                                    const key = `syrup:${lot.lotCode}:${lot.flavor}`;
                                    return (
                                        <ToggleChip
                                            key={key}
                                            active={selectedRegistryLotKeys.includes(key)}
                                            onClick={() => onToggleRegistryLot?.(key)}
                                            disabled={readOnly}
                                        >
                                            {lot.lotCode} · {lot.flavor}
                                        </ToggleChip>
                                    );
                                })}
                            </div>
                            {((context.registryLots?.productionLots || [])[0] || (context.registryLots?.syrupLots || [])[0]) && (
                                <p className="mt-3 text-xs text-slate-500">
                                    Último registro detectado: {formatDateTimeLabel(
                                        (context.registryLots?.productionLots || [])[0]?.productionDate
                                        || (context.registryLots?.syrupLots || [])[0]?.productionDate
                                    )}
                                </p>
                            )}
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

export default MicroProductionContextPanel;
