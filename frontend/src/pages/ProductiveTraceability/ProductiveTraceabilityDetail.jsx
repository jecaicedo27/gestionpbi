import React from 'react';
import {
    Activity,
    AlertTriangle,
    Boxes,
    ChevronDown,
    ClipboardCheck,
    FileImage,
    FileSearch,
    Factory,
    FlaskConical,
    Layers3,
    Microscope,
    PackageCheck,
    PackageSearch,
    Route,
    ShieldCheck,
    TimerReset,
    UserRound,
    Workflow
} from 'lucide-react';
import {
    clampText,
    formatDate,
    formatNumber,
    formatQty,
    getBatchFocusLabel,
    getStatusClasses,
    getTraceabilitySegmentMeta,
    isImageUrl,
    resolveAssetUrl,
    sumEvidenceByNotes
} from './utils';

const TABS = [
    { id: 'overview', label: 'Resumen', icon: Layers3, description: 'Visión ejecutiva del lote y sus claves de rastreo' },
    { id: 'supply', label: 'Abastecimiento', icon: PackageSearch, description: 'Compras, recepciones, consumos y traslados' },
    { id: 'process', label: 'Proceso', icon: Workflow, description: 'Etapas, operadores, variables, QC y payload técnico' },
    { id: 'quality', label: 'Calidad', icon: ShieldCheck, description: 'Registro histórico, QC por etapa y novedades PQR' },
    { id: 'micro', label: 'Laboratorio', icon: Microscope, description: 'Muestras microbiológicas y seguimientos internos' },
    { id: 'evidence', label: 'Archivos', icon: FileImage, description: 'Evidencias visuales y documentos de soporte' }
];

const Pill = ({ status, children }) => (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${getStatusClasses(status)}`}>
        {children || status || 'Sin estado'}
    </span>
);

const SectionCard = ({ title, description, icon: Icon, actions = null, children, collapsible = false, defaultOpen = true }) => {
    if (collapsible) {
        return (
            <details open={defaultOpen} className="group rounded-3xl border border-slate-200 bg-white shadow-sm">
                <summary className="flex cursor-pointer list-none flex-col gap-3 border-b border-slate-100 px-5 py-4 lg:flex-row lg:items-center lg:justify-between [&::-webkit-details-marker]:hidden">
                    <div className="flex items-start gap-3">
                        {Icon && (
                            <div className="rounded-2xl bg-slate-950 p-2 text-white shadow-sm">
                                <Icon size={18} />
                            </div>
                        )}
                        <div>
                            <h3 className="text-sm font-bold text-slate-950">{title}</h3>
                            {description && <p className="mt-1 text-xs text-slate-500">{description}</p>}
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        {actions}
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-2 text-slate-500 transition-transform group-open:rotate-180">
                            <ChevronDown size={16} />
                        </div>
                    </div>
                </summary>
                <div className="px-5 py-5">{children}</div>
            </details>
        );
    }

    return (
        <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-start gap-3">
                    {Icon && (
                        <div className="rounded-2xl bg-slate-950 p-2 text-white shadow-sm">
                            <Icon size={18} />
                        </div>
                    )}
                    <div>
                        <h3 className="text-sm font-bold text-slate-950">{title}</h3>
                        {description && <p className="mt-1 text-xs text-slate-500">{description}</p>}
                    </div>
                </div>
                {actions}
            </div>
            <div className="px-5 py-5">{children}</div>
        </section>
    );
};

const StatCard = ({ label, value, helper, tone = 'slate' }) => {
    const tones = {
        slate: 'border-slate-200 bg-slate-50 text-slate-950',
        emerald: 'border-emerald-200 bg-emerald-50 text-emerald-950',
        blue: 'border-cyan-200 bg-cyan-50 text-cyan-950',
        amber: 'border-amber-200 bg-amber-50 text-amber-950',
        rose: 'border-rose-200 bg-rose-50 text-rose-950'
    };

    return (
        <div className={`rounded-2xl border p-4 ${tones[tone] || tones.slate}`}>
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500">{label}</p>
            <p className="mt-2 text-2xl font-black">{value}</p>
            {helper && <p className="mt-1 text-xs text-slate-500">{helper}</p>}
        </div>
    );
};

const EmptyState = ({ title, description }) => (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-5 py-8 text-center">
        <p className="text-sm font-bold text-slate-900">{title}</p>
        <p className="mt-2 text-sm text-slate-500">{description}</p>
    </div>
);

const KeyValueGrid = ({ items = [] }) => (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {items.map((item) => (
            <div key={item.label} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">{item.label}</p>
                <p className="mt-2 text-sm font-semibold text-slate-900">{item.value}</p>
            </div>
        ))}
    </div>
);

const EvidenceGallery = ({ evidence = [] }) => {
    if (!evidence.length) {
        return <EmptyState title="Sin evidencias cargadas" description="Este lote aún no tiene archivos o fotos asociadas en las fuentes integradas." />;
    }

    return (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {evidence.map((entry, index) => {
                const assetUrl = resolveAssetUrl(entry.url);
                const isImage = isImageUrl(entry.url);

                return (
                    <article key={`${entry.url}-${index}`} className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
                        <div className="border-b border-slate-100 bg-slate-950/95 px-4 py-3 text-white">
                            <p className="text-sm font-bold">{entry.label || 'Evidencia'}</p>
                            <p className="mt-1 text-xs text-slate-300">{entry.sourceLabel || entry.sourceType || 'Archivo del proceso'}</p>
                        </div>
                        <div className="space-y-4 px-4 py-4">
                            {isImage ? (
                                <a href={assetUrl} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-2xl border border-slate-200">
                                    <img src={assetUrl} alt={entry.label || 'Evidencia'} className="h-52 w-full object-cover" />
                                </a>
                            ) : (
                                <div className="flex h-52 items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 text-slate-500">
                                    <FileSearch size={32} />
                                </div>
                            )}

                            <div className="space-y-2 text-sm text-slate-600">
                                <div className="flex flex-wrap items-center gap-2">
                                    <Pill status={entry.sourceType}>{entry.sourceType || 'ARCHIVO'}</Pill>
                                    {entry.at && <span className="text-xs text-slate-400">{formatDate(entry.at, true)}</span>}
                                </div>
                                <p className="font-medium text-slate-900">{entry.sourceLabel || 'Fuente sin etiqueta'}</p>
                                <a
                                    href={assetUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50"
                                >
                                    <FileSearch size={14} />
                                    Abrir archivo
                                </a>
                            </div>
                        </div>
                    </article>
                );
            })}
        </div>
    );
};

const LotStream = ({ title, tone = 'slate', items = [], emptyMessage = 'Sin elementos relacionados' }) => {
    const tones = {
        slate: 'border-slate-200 bg-slate-50',
        cyan: 'border-cyan-200 bg-cyan-50',
        amber: 'border-amber-200 bg-amber-50'
    };

    return (
        <div className={`rounded-3xl border p-4 ${tones[tone] || tones.slate}`}>
            <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-bold text-slate-950">{title}</p>
                <div className="rounded-2xl border border-white/70 bg-white px-3 py-2 text-xs font-semibold text-slate-600">
                    {formatNumber(items.length || 0)}
                </div>
            </div>

            {items.length ? (
                <div className="mt-4 space-y-3">
                    {items.map((item) => (
                        <article key={item.id || item.label} className="rounded-2xl border border-white/80 bg-white px-4 py-3">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                    <p className="text-sm font-bold text-slate-950">{item.label}</p>
                                    <p className="mt-1 text-xs text-slate-500">{item.helper || 'Sin descripcion adicional'}</p>
                                </div>
                                {item.badge && (
                                    <div className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700">
                                        {item.badge}
                                    </div>
                                )}
                            </div>
                            {!!item.meta?.length && (
                                <div className="mt-3 flex flex-wrap gap-2">
                                    {item.meta.map((entry) => (
                                        <span key={`${item.id || item.label}-${entry}`} className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                                            {entry}
                                        </span>
                                    ))}
                                </div>
                            )}
                        </article>
                    ))}
                </div>
            ) : (
                <p className="mt-4 text-sm text-slate-500">{emptyMessage}</p>
            )}
        </div>
    );
};

const renderOverview = (detail) => {
    const { batch, summary, process, evidence, relatedKeys, supply, quality } = detail;
    const stats = summary?.stats || {};
    const finishedTargets = (summary?.outputTargets || []).map((target) => ({
        id: target.id,
        label: target.product?.name || 'Producto objetivo',
        helper: `${formatNumber(target.plannedUnits || 0)} unidades · ${formatQty(target.plannedWeightKg || 0, 'kg')}`,
        badge: 'Salida',
        meta: [target.product?.sku].filter(Boolean)
    }));
    const subprocessLots = (supply?.producedMaterialLots || []).map((lot) => ({
        id: lot.id,
        label: lot.product?.name || lot.lotNumber || 'Lote intermedio',
        helper: `${lot.lotNumber || 'Sin lote'} · ${formatDate(lot.receivedAt, true)}`,
        badge: lot.status || 'Generado',
        meta: [lot.zone, formatQty(lot.currentQuantity, lot.unit)].filter(Boolean)
    }));
    const legacyConnections = [
        ...(quality?.productionRegistry || []).map((row) => ({
            id: `legacy-production-${row.id || row.lotCode}`,
            label: row.lotCode || 'ProductionLot',
            helper: `Registro historico de produccion · ${formatDate(row.productionDate, true)}`,
            badge: 'Legacy',
            meta: [row.flavor, row.leader].filter(Boolean)
        })),
        ...(quality?.syrupRegistry || []).map((row) => ({
            id: `legacy-syrup-${row.id || row.lotCode}`,
            label: row.lotCode || 'SyrupLot',
            helper: `Registro historico de jarabe · ${formatDate(row.productionDate, true)}`,
            badge: 'Jarabe',
            meta: [row.flavor].filter(Boolean)
        }))
    ];

    return (
        <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                <StatCard label="Etapas completadas" value={`${stats.stagesCompleted || 0}/${stats.stagesTotal || 0}`} helper="Progreso del batch" tone="emerald" />
                <StatCard label="Consumos trazados" value={formatNumber(stats.consumedLots || 0)} helper="Registros de lotes de materia prima" tone="blue" />
                <StatCard label="Chequeos de calidad" value={formatNumber(stats.qualityChecks || 0)} helper="Controles por etapa" tone="amber" />
                <StatCard label="Muestras micro" value={formatNumber(stats.microSamples || 0)} helper="Muestras relacionadas al lote" tone="slate" />
                <StatCard label="Evidencias" value={formatNumber(stats.evidence || evidence?.length || 0)} helper="Fotos y documentos detectados" tone="rose" />
            </div>

            <SectionCard
                title="Claves de rastreo"
                description="Identificadores centrales para vincular el lote con procesos, laboratorio y novedades."
                icon={Route}
                collapsible
            >
                <KeyValueGrid
                    items={[
                        { label: 'Lote visible', value: clampText(batch.displayLot) },
                        { label: 'Batch interno', value: clampText(batch.batchNumber) },
                        { label: 'Clave compacta', value: clampText(relatedKeys?.compactLot) },
                        { label: 'Sabor / familia', value: clampText(batch.flavor || batch.product?.name) }
                    ]}
                />
            </SectionCard>

            <SectionCard
                title="Arquitectura del lote"
                description="Separacion explicita entre producto terminado, lotes intermedios y cruces legacy para no mezclar universos distintos."
                icon={Boxes}
                collapsible
            >
                <div className="grid gap-4 xl:grid-cols-3">
                    <LotStream
                        title="Producto terminado"
                        tone="cyan"
                        items={finishedTargets}
                        emptyMessage="Este expediente no tiene salidas comerciales objetivo registradas."
                    />
                    <LotStream
                        title="Subproceso / lotes intermedios"
                        tone="amber"
                        items={subprocessLots}
                        emptyMessage="No se detectaron lotes intermedios generados en la ventana del batch."
                    />
                    <LotStream
                        title="Cruces legacy / historicos"
                        tone="slate"
                        items={legacyConnections}
                        emptyMessage="Aun no aparecen coincidencias con tablas historicas o heredadas."
                    />
                </div>
            </SectionCard>

            <SectionCard
                title="Salida esperada"
                description="Presentaciones y metas consolidadas del batch."
                icon={PackageCheck}
                collapsible
            >
                {summary?.outputTargets?.length ? (
                    <div className="grid gap-4 xl:grid-cols-2">
                        {summary.outputTargets.map((target) => (
                            <article key={target.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                    <div>
                                        <p className="text-sm font-bold text-slate-900">{target.product?.name || 'Producto'}</p>
                                        <p className="mt-1 text-xs text-slate-500">{target.product?.sku || 'Sin SKU'}</p>
                                    </div>
                                    <Pill status="COMPLETED">Objetivo</Pill>
                                </div>
                                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                                        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Unidades</p>
                                        <p className="mt-2 text-lg font-black text-slate-950">{formatNumber(target.plannedUnits || 0)}</p>
                                    </div>
                                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                                        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Peso planeado</p>
                                        <p className="mt-2 text-lg font-black text-slate-950">{formatQty(target.plannedWeightKg || 0, 'kg')}</p>
                                    </div>
                                </div>
                            </article>
                        ))}
                    </div>
                ) : (
                    <EmptyState title="Sin metas de salida" description="Este batch no tiene presentaciones planeadas registradas." />
                )}
            </SectionCard>

            <SectionCard
                title="Ruta operativa"
                description="Resumen de las etapas identificadas y su avance actual."
                icon={Activity}
                collapsible
            >
                {process?.notes?.length ? (
                    <div className="space-y-3">
                        {process.notes.map((note) => (
                            <div key={note.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                                    <div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-950 text-xs font-black text-white">
                                                {note.stageOrder}
                                            </span>
                                            <p className="text-sm font-bold text-slate-950">{note.stageName}</p>
                                            <Pill status={note.status}>{note.status}</Pill>
                                        </div>
                                        <p className="mt-2 text-xs text-slate-500">
                                            {note.processType?.name || note.processType?.code || 'Proceso'} · {formatDate(note.startedAt || note.createdAt, true)}
                                        </p>
                                    </div>
                                    <div className="grid gap-2 sm:grid-cols-3">
                                        <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2">
                                            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Meta</p>
                                            <p className="mt-1 text-sm font-bold text-slate-950">{formatQty(note.targetQuantity, note.unit)}</p>
                                        </div>
                                        <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2">
                                            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Real</p>
                                            <p className="mt-1 text-sm font-bold text-slate-950">{formatQty(note.actualQuantity, note.unit)}</p>
                                        </div>
                                        <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2">
                                            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Evidencias</p>
                                            <p className="mt-1 text-sm font-bold text-slate-950">{formatNumber(note.evidence?.length || 0)}</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <EmptyState title="Batch sin etapas generadas" description="La programación existe, pero todavía no hay notas de producción ejecutadas para construir la ruta operativa." />
                )}
            </SectionCard>
        </div>
    );
};

const renderSupply = (detail) => {
    const { supply } = detail;

    return (
        <div className="space-y-6">
            <SectionCard
                title="Consumo de lotes"
                description="Lotes de materia prima consumidos por las notas del batch."
                icon={Boxes}
                collapsible
            >
                {supply?.consumptions?.length ? (
                    <div className="space-y-3">
                        {supply.consumptions.map((entry) => (
                            <article key={entry.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                                    <div className="space-y-2">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <p className="text-sm font-bold text-slate-950">{entry.materialLot?.product?.name || entry.materialLot?.siigoProductName || 'Materia prima'}</p>
                                            <Pill status={entry.materialLot?.status}>{entry.materialLot?.lotNumber || 'Sin lote'}</Pill>
                                        </div>
                                        <p className="text-xs text-slate-500">
                                            Consumido {formatDate(entry.usedAt, true)} por {entry.usedBy?.name || 'Sin operador'}
                                        </p>
                                        {entry.materialLot?.purchaseOrder && (
                                            <p className="text-xs font-semibold text-cyan-700">
                                                OC {entry.materialLot.purchaseOrder.orderNumber} · {entry.materialLot.purchaseOrder.supplierName}
                                            </p>
                                        )}
                                    </div>
                                    <div className="grid gap-2 sm:grid-cols-3">
                                        <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2">
                                            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Consumido</p>
                                            <p className="mt-1 text-sm font-black text-slate-950">{formatQty(entry.quantityUsed, 'g')}</p>
                                        </div>
                                        <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2">
                                            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Ingreso</p>
                                            <p className="mt-1 text-sm font-semibold text-slate-950">{formatDate(entry.materialLot?.receivedAt, true)}</p>
                                        </div>
                                        <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2">
                                            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Vencimiento</p>
                                            <p className="mt-1 text-sm font-semibold text-slate-950">{formatDate(entry.materialLot?.expiresAt)}</p>
                                        </div>
                                    </div>
                                </div>
                                {entry.observations && (
                                    <div className="mt-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
                                        {entry.observations}
                                    </div>
                                )}
                            </article>
                        ))}
                    </div>
                ) : (
                    <EmptyState title="Sin consumos trazados" description="No se encontraron lotes de materia prima consumidos para este batch." />
                )}
            </SectionCard>

            <SectionCard
                title="Lotes producidos e intermedios"
                description="Lotes internos generados dentro de la ventana del expediente para diferenciar subproceso y salida trazable."
                icon={Factory}
                collapsible
                defaultOpen={false}
            >
                {supply?.producedMaterialLots?.length ? (
                    <div className="grid gap-4 xl:grid-cols-2">
                        {supply.producedMaterialLots.map((lot) => (
                            <article key={lot.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <p className="text-sm font-bold text-slate-950">{lot.product?.name || 'Producto interno'}</p>
                                            <Pill status={lot.status}>{lot.status || 'GENERADO'}</Pill>
                                        </div>
                                        <p className="mt-1 text-xs text-slate-500">{lot.lotNumber || 'Sin lote'} · {lot.product?.sku || 'Sin SKU'}</p>
                                        <p className="mt-2 text-xs text-slate-500">Generado {formatDate(lot.receivedAt, true)}</p>
                                    </div>
                                    <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-right">
                                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Stock</p>
                                        <p className="mt-1 text-sm font-black text-slate-950">{formatQty(lot.currentQuantity, lot.unit)}</p>
                                    </div>
                                </div>
                                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                                    <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2">
                                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Inicial</p>
                                        <p className="mt-1 text-sm font-semibold text-slate-950">{formatQty(lot.initialQuantity, lot.unit)}</p>
                                    </div>
                                    <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2">
                                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Zona</p>
                                        <p className="mt-1 text-sm font-semibold text-slate-950">{clampText(lot.zone)}</p>
                                    </div>
                                    <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2">
                                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Vence</p>
                                        <p className="mt-1 text-sm font-semibold text-slate-950">{formatDate(lot.expiresAt)}</p>
                                    </div>
                                </div>
                            </article>
                        ))}
                    </div>
                ) : (
                    <EmptyState title="Sin lotes internos generados" description="No se encontraron lotes intermedios o de salida materializados dentro de esta ventana productiva." />
                )}
            </SectionCard>

            <SectionCard
                title="Ordenes de compra y recepciones"
                description="Documentos de abastecimiento detectados a partir de los lotes consumidos."
                icon={PackageSearch}
                collapsible
                defaultOpen={false}
            >
                {supply?.purchaseOrders?.length ? (
                    <div className="grid gap-4 xl:grid-cols-2">
                        {supply.purchaseOrders.map((order) => (
                            <article key={order.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <p className="text-sm font-bold text-slate-950">{order.orderNumber}</p>
                                            <Pill status={order.status}>{order.status}</Pill>
                                        </div>
                                        <p className="mt-1 text-xs text-slate-500">{order.supplierName || order.supplier?.name || 'Proveedor sin nombre'}</p>
                                        <p className="mt-2 text-xs text-slate-500">Creada {formatDate(order.createdAt, true)} por {order.createdBy?.name || 'Sin usuario'}</p>
                                    </div>
                                    <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-right">
                                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Recepciones</p>
                                        <p className="mt-1 text-lg font-black text-slate-950">{formatNumber(order.receptions?.length || 0)}</p>
                                    </div>
                                </div>

                                <div className="mt-4 space-y-3">
                                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                                        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Items</p>
                                        <div className="mt-3 space-y-2">
                                            {(order.items || []).slice(0, 4).map((item) => (
                                                <div key={item.id} className="flex items-center justify-between gap-3 text-sm">
                                                    <div>
                                                        <p className="font-semibold text-slate-900">{item.product?.name || item.siigoProductName}</p>
                                                        <p className="text-xs text-slate-500">{item.siigoProductCode}</p>
                                                    </div>
                                                    <p className="text-xs font-semibold text-slate-600">
                                                        {formatQty(item.quantityReceived, 'g')} / {formatQty(item.quantityOrdered, 'g')}
                                                    </p>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    {(order.receptions || []).map((reception) => (
                                        <div key={reception.id} className="rounded-2xl border border-cyan-100 bg-cyan-50 px-4 py-3">
                                            <div className="flex flex-wrap items-center justify-between gap-3">
                                                <div>
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <p className="text-sm font-bold text-slate-950">Recepcion</p>
                                                        <Pill status={reception.status}>{reception.status}</Pill>
                                                    </div>
                                                    <p className="mt-1 text-xs text-slate-600">
                                                        Recibida {formatDate(reception.receivedAt, true)} por {reception.receivedBy?.name || 'Sin usuario'}
                                                    </p>
                                                </div>
                                                {reception.accountingUser && (
                                                    <div className="rounded-2xl border border-white/70 bg-white px-3 py-2 text-right">
                                                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Validacion</p>
                                                        <p className="mt-1 text-xs font-semibold text-slate-900">{reception.accountingUser.name}</p>
                                                    </div>
                                                )}
                                            </div>
                                            {reception.observations && (
                                                <p className="mt-3 text-sm text-slate-600">{reception.observations}</p>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </article>
                        ))}
                    </div>
                ) : (
                    <EmptyState title="Sin ordenes vinculadas" description="Los lotes consumidos de este batch no tienen una orden de compra asociada o aun no se ha identificado el enlace." />
                )}
            </SectionCard>

            <SectionCard
                title="Traslados de zona"
                description="Movimiento del material entre bodega y zona de produccion detectado para el batch."
                icon={TimerReset}
                collapsible
                defaultOpen={false}
            >
                {supply?.zoneTransfers?.length ? (
                    <div className="space-y-3">
                        {supply.zoneTransfers.map((transfer) => (
                            <div key={transfer.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                                    <div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <Pill status={transfer.direction === 'IN' ? 'RECEIVED' : 'FAILED'}>
                                                {transfer.direction === 'IN' ? 'Bodega -> Produccion' : 'Produccion -> Bodega'}
                                            </Pill>
                                            <p className="text-sm font-bold text-slate-950">{transfer.product?.name || transfer.materialLot?.lotNumber || 'Traslado'}</p>
                                        </div>
                                        <p className="mt-2 text-xs text-slate-500">
                                            {formatDate(transfer.createdAt, true)} · {transfer.transferredBy?.name || 'Sin usuario'}
                                        </p>
                                    </div>
                                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Cantidad</p>
                                        <p className="mt-1 text-sm font-black text-slate-950">{formatQty(transfer.quantity, transfer.unit)}</p>
                                    </div>
                                </div>
                                {transfer.observations && <p className="mt-3 text-sm text-slate-600">{transfer.observations}</p>}
                            </div>
                        ))}
                    </div>
                ) : (
                    <EmptyState title="Sin traslados registrados" description="No se encontraron movimientos de zona vinculados al batch o a sus materiales relacionados." />
                )}
            </SectionCard>
        </div>
    );
};

const renderProcess = (detail) => {
    const { process } = detail;

    return (
        <div className="space-y-6">
            <SectionCard
                title="Linea de operadores"
                description="Registro consolidado de las intervenciones humanas a lo largo del lote."
                icon={UserRound}
                collapsible
                defaultOpen={false}
            >
                {process?.operatorTimeline?.length ? (
                    <div className="space-y-3">
                        {process.operatorTimeline.map((entry, index) => (
                            <div key={`${entry.sourceId || entry.sourceLabel}-${index}`} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                                <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                                    <div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <Pill status={entry.sourceType}>{entry.sourceType || 'EVENTO'}</Pill>
                                            <p className="text-sm font-bold text-slate-950">{entry.action}</p>
                                        </div>
                                        <p className="mt-2 text-sm text-slate-600">
                                            {entry.user?.name || 'Sistema'} {entry.user?.role ? `· ${entry.user.role}` : ''}
                                        </p>
                                        <p className="mt-1 text-xs text-slate-500">{entry.sourceLabel || 'Sin etiqueta'} {entry.detail ? `· ${entry.detail}` : ''}</p>
                                    </div>
                                    <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-right">
                                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Momento</p>
                                        <p className="mt-1 text-sm font-semibold text-slate-950">{formatDate(entry.at, true)}</p>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <EmptyState title="Sin trazas operativas" description="No se detectaron intervenciones de operadores, calidad o laboratorio para este batch." />
                )}
            </SectionCard>

            <SectionCard
                title="Expediente por etapa"
                description="Detalle tecnico de cada paso del proceso, incluyendo materiales, variables, controles y evidencias."
                icon={Workflow}
                collapsible
            >
                {process?.notes?.length ? (
                    <div className="space-y-4">
                        {process.notes.map((note) => (
                            <details key={note.id} open={note.stageOrder <= 2} className="group overflow-hidden rounded-3xl border border-slate-200 bg-slate-50">
                                <summary className="flex cursor-pointer list-none flex-col gap-3 border-b border-slate-200 bg-white px-5 py-4 xl:flex-row xl:items-center xl:justify-between [&::-webkit-details-marker]:hidden">
                                    <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                                        <div>
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-slate-950 text-xs font-black text-white">
                                                    {note.stageOrder}
                                                </span>
                                                <div>
                                                    <p className="text-sm font-bold text-slate-950">{note.stageName}</p>
                                                    <p className="mt-1 text-xs text-slate-500">{note.processType?.name || note.processType?.code || 'Proceso'} · {note.noteNumber}</p>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            <Pill status={note.status}>{note.status}</Pill>
                                            <Pill status={note.processType?.code}>{note.processType?.code || 'PROCESO'}</Pill>
                                        </div>
                                    </div>
                                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-2 text-slate-500 transition-transform group-open:rotate-180">
                                        <ChevronDown size={16} />
                                    </div>
                                </summary>

                                <div className="space-y-5 px-5 py-5">
                                    <KeyValueGrid
                                        items={[
                                            { label: 'Inicio', value: formatDate(note.startedAt || note.createdAt, true) },
                                            { label: 'Fin', value: formatDate(note.completedAt, true) },
                                            { label: 'Meta', value: formatQty(note.targetQuantity, note.unit) },
                                            { label: 'Real', value: formatQty(note.actualQuantity, note.unit) }
                                        ]}
                                    />

                                    {(note.items || []).length > 0 && (
                                        <div>
                                            <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Materiales usados</p>
                                            <div className="mt-3 space-y-2">
                                                {note.items.map((item) => (
                                                    <div key={item.id} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                                                        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                                                            <div>
                                                                <p className="text-sm font-bold text-slate-950">{item.component?.name || 'Componente'}</p>
                                                                <p className="mt-1 text-xs text-slate-500">{item.component?.sku || item.componentType}</p>
                                                            </div>
                                                            <div className="grid gap-2 sm:grid-cols-3">
                                                                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
                                                                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Plan</p>
                                                                    <p className="mt-1 text-sm font-bold text-slate-950">{formatQty(item.plannedQuantity, item.unit)}</p>
                                                                </div>
                                                                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
                                                                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Real</p>
                                                                    <p className="mt-1 text-sm font-bold text-slate-950">{formatQty(item.actualQuantity, item.unit)}</p>
                                                                </div>
                                                                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
                                                                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Lote</p>
                                                                    <p className="mt-1 text-sm font-bold text-slate-950">{clampText(item.lotNumber)}</p>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    <div className="grid gap-4 xl:grid-cols-2">
                                        <div className="rounded-2xl border border-slate-200 bg-white p-4">
                                            <div className="flex items-center gap-2">
                                                <Activity size={16} className="text-cyan-700" />
                                                <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Variables</p>
                                            </div>
                                            {(note.processVariables || []).length ? (
                                                <div className="mt-3 space-y-2">
                                                    {note.processVariables.map((item) => (
                                                        <div key={item.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
                                                            <div className="flex flex-wrap items-center justify-between gap-3">
                                                                <p className="text-sm font-bold text-slate-950">{item.variableName}</p>
                                                                <p className="text-sm font-black text-slate-950">{item.variableValue}{item.variableUnit ? ` ${item.variableUnit}` : ''}</p>
                                                            </div>
                                                            <p className="mt-1 text-xs text-slate-500">{formatDate(item.capturedAt, true)} · {item.capturedBy?.name || 'Sin usuario'}</p>
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <p className="mt-3 text-sm text-slate-500">Esta etapa no tiene variables capturadas.</p>
                                            )}
                                        </div>

                                        <div className="rounded-2xl border border-slate-200 bg-white p-4">
                                            <div className="flex items-center gap-2">
                                                <ClipboardCheck size={16} className="text-emerald-700" />
                                                <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Control de calidad</p>
                                            </div>
                                            {(note.qualityChecks || []).length ? (
                                                <div className="mt-3 space-y-2">
                                                    {note.qualityChecks.map((item) => (
                                                        <div key={item.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
                                                            <div className="flex flex-wrap items-center justify-between gap-3">
                                                                <p className="text-sm font-bold text-slate-950">{item.checkName}</p>
                                                                <Pill status={item.passed ? 'COMPLETED' : 'FAILED'}>{item.passed ? 'Pasa' : 'No pasa'}</Pill>
                                                            </div>
                                                            <p className="mt-1 text-xs text-slate-500">
                                                                Valor: {clampText(item.resultValue)} {item.expectedValue ? `· Esperado: ${item.expectedValue}` : ''}
                                                            </p>
                                                            <p className="mt-1 text-xs text-slate-500">{formatDate(item.checkedAt, true)} · {item.checkedBy?.name || 'Sin usuario'}</p>
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <p className="mt-3 text-sm text-slate-500">No hay checks de calidad almacenados para esta etapa.</p>
                                            )}
                                        </div>
                                    </div>

                                    {(note.rpaExecutions || []).length > 0 && (
                                        <div className="rounded-2xl border border-slate-200 bg-white p-4">
                                            <div className="flex items-center gap-2">
                                                <Route size={16} className="text-indigo-700" />
                                                <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Ejecuciones RPA / Siigo</p>
                                            </div>
                                            <div className="mt-3 space-y-2">
                                                {note.rpaExecutions.map((item) => (
                                                    <div key={item.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
                                                        <div className="flex flex-wrap items-center justify-between gap-3">
                                                            <p className="text-sm font-bold text-slate-950">{item.executionType}</p>
                                                            <Pill status={item.status}>{item.status}</Pill>
                                                        </div>
                                                        <p className="mt-1 text-xs text-slate-500">
                                                            {item.productName} · {formatQty(item.quantity)} · {item.assemblyType || 'sin tipo'}
                                                        </p>
                                                        <p className="mt-1 text-xs text-slate-500">
                                                            Inicio {formatDate(item.startedAt, true)} {item.completedAt ? `· Fin ${formatDate(item.completedAt, true)}` : ''}
                                                        </p>
                                                        {item.errorMessage && <p className="mt-2 text-xs font-semibold text-rose-700">{item.errorMessage}</p>}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {note.evidence?.length > 0 && (
                                        <div>
                                            <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Evidencias de la etapa</p>
                                            <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                                                {note.evidence.map((entry, index) => (
                                                    <a
                                                        key={`${entry.url}-${index}`}
                                                        href={resolveAssetUrl(entry.url)}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        className="rounded-2xl border border-slate-200 bg-white p-3 transition-colors hover:border-slate-300 hover:bg-slate-50"
                                                    >
                                                        <p className="text-sm font-bold text-slate-900">{entry.label}</p>
                                                        <p className="mt-2 text-xs text-slate-500">{entry.sourceLabel || note.stageName}</p>
                                                    </a>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {(note.processParameters || note.actualParameters) && (
                                        <details className="rounded-2xl border border-slate-200 bg-white p-4">
                                            <summary className="cursor-pointer text-sm font-bold text-slate-900">Payload tecnico y trazas crudas</summary>
                                            <div className="mt-4 grid gap-4 xl:grid-cols-2">
                                                <div className="rounded-2xl border border-slate-200 bg-slate-950 p-4 text-xs text-slate-100">
                                                    <p className="mb-3 font-bold text-white">processParameters</p>
                                                    <pre className="overflow-x-auto whitespace-pre-wrap">{JSON.stringify(note.processParameters || {}, null, 2)}</pre>
                                                </div>
                                                <div className="rounded-2xl border border-slate-200 bg-slate-950 p-4 text-xs text-slate-100">
                                                    <p className="mb-3 font-bold text-white">actualParameters</p>
                                                    <pre className="overflow-x-auto whitespace-pre-wrap">{JSON.stringify(note.actualParameters || {}, null, 2)}</pre>
                                                </div>
                                            </div>
                                        </details>
                                    )}
                                </div>
                            </details>
                        ))}
                    </div>
                ) : (
                    <EmptyState title="Sin etapas registradas" description="Aun no existen notas de produccion para construir el expediente del proceso." />
                )}
            </SectionCard>
        </div>
    );
};

const renderQuality = (detail) => {
    const { process, quality } = detail;
    const qcCount = process?.notes?.reduce((total, note) => total + (note.qualityChecks?.length || 0), 0) || 0;

    return (
        <div className="space-y-6">
            <SectionCard
                title="Control de calidad consolidado"
                description="Resumen de checks por etapa y variables relacionadas."
                icon={ClipboardCheck}
                collapsible
            >
                <div className="grid gap-4 md:grid-cols-3">
                    <StatCard label="Checks cargados" value={formatNumber(qcCount)} helper="Controles en notas de produccion" tone="emerald" />
                    <StatCard label="PQR vinculados" value={formatNumber(quality?.pqrCases?.length || 0)} helper="Novedades externas e internas" tone="amber" />
                    <StatCard label="Registros historicos" value={formatNumber((quality?.productionRegistry?.length || 0) + (quality?.syrupRegistry?.length || 0))} helper="Cruces con tablas legacy/importadas" tone="blue" />
                </div>
            </SectionCard>

            <SectionCard
                title="Registro historico de produccion"
                description="Datos heredados/importados que coinciden con el lote visible o sus notas de ensamble."
                icon={Layers3}
                collapsible
                defaultOpen={false}
            >
                {(quality?.productionRegistry?.length || quality?.syrupRegistry?.length) ? (
                    <div className="grid gap-4 xl:grid-cols-2">
                        {(quality.productionRegistry || []).map((row) => (
                            <article key={`${row.lotCode}-${row.productionDate}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <p className="text-sm font-bold text-slate-950">{row.lotCode}</p>
                                    <Pill status="COMPLETED">ProductionLot</Pill>
                                </div>
                                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                                    <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2">
                                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Produccion</p>
                                        <p className="mt-1 text-sm font-semibold text-slate-950">{formatDate(row.productionDate, true)}</p>
                                    </div>
                                    <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2">
                                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Sabor</p>
                                        <p className="mt-1 text-sm font-semibold text-slate-950">{clampText(row.flavor)}</p>
                                    </div>
                                    <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2">
                                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">pH / Bx</p>
                                        <p className="mt-1 text-sm font-semibold text-slate-950">{clampText(row.phJarabe)} / {clampText(row.bxJarabe)}</p>
                                    </div>
                                    <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2">
                                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Lider</p>
                                        <p className="mt-1 text-sm font-semibold text-slate-950">{clampText(row.leader)}</p>
                                    </div>
                                </div>
                            </article>
                        ))}

                        {(quality.syrupRegistry || []).map((row) => (
                            <article key={`${row.lotCode}-${row.productionDate}`} className="rounded-2xl border border-cyan-200 bg-cyan-50 p-4">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <p className="text-sm font-bold text-slate-950">{row.lotCode}</p>
                                    <Pill status="APPROVED">SyrupLot</Pill>
                                </div>
                                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                                    <div className="rounded-2xl border border-white/80 bg-white px-3 py-2">
                                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Produccion</p>
                                        <p className="mt-1 text-sm font-semibold text-slate-950">{formatDate(row.productionDate, true)}</p>
                                    </div>
                                    <div className="rounded-2xl border border-white/80 bg-white px-3 py-2">
                                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Sabor</p>
                                        <p className="mt-1 text-sm font-semibold text-slate-950">{clampText(row.flavor)}</p>
                                    </div>
                                </div>
                            </article>
                        ))}
                    </div>
                ) : (
                    <EmptyState title="Sin cruces historicos" description="No hubo coincidencias en los registros legacy/importados para este lote." />
                )}
            </SectionCard>

            <SectionCard
                title="Novedades y PQR"
                description="Casos de calidad o reclamo reportados sobre este lote visible."
                icon={AlertTriangle}
                collapsible
                defaultOpen={false}
            >
                {quality?.pqrCases?.length ? (
                    <div className="space-y-3">
                        {quality.pqrCases.map((entry) => (
                            <article key={entry.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                                    <div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <p className="text-sm font-bold text-slate-950">{entry.ticketNumber}</p>
                                            <Pill status={entry.stage}>{entry.stage}</Pill>
                                            <Pill status={entry.status}>{entry.status}</Pill>
                                            <Pill status={entry.isInternal ? 'FAILED' : 'APPROVED'}>
                                                {entry.isInternal ? 'Interno' : 'Externo'}
                                            </Pill>
                                        </div>
                                        <p className="mt-2 text-xs text-slate-500">
                                            Creado {formatDate(entry.createdAt, true)} por {entry.user?.name || 'Sin usuario'}
                                        </p>
                                        {entry.internalNotes && <p className="mt-3 text-sm text-slate-600">{entry.internalNotes}</p>}
                                    </div>
                                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-right">
                                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Evidencias</p>
                                        <p className="mt-1 text-lg font-black text-slate-950">{formatNumber(entry.items?.reduce((total, item) => total + (item.evidence?.length || 0), 0) || 0)}</p>
                                    </div>
                                </div>

                                <div className="mt-4 space-y-2">
                                    {(entry.items || []).map((item) => (
                                        <div key={item.id} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                                            <div className="flex flex-wrap items-center justify-between gap-3">
                                                <div>
                                                    <p className="text-sm font-bold text-slate-950">{item.product?.name || 'Producto'}</p>
                                                    <p className="mt-1 text-xs text-slate-500">{item.lotNumber || 'Sin lote'} · {formatQty(item.quantity, item.unit)}</p>
                                                </div>
                                                <p className="text-xs font-semibold text-slate-600">{formatNumber(item.evidence?.length || 0)} archivos</p>
                                            </div>
                                            <p className="mt-2 text-sm text-slate-600">{item.description}</p>
                                        </div>
                                    ))}
                                </div>
                            </article>
                        ))}
                    </div>
                ) : (
                    <EmptyState title="Sin PQR asociados" description="No hay novedades internas o externas asociadas a este lote visible." />
                )}
            </SectionCard>
        </div>
    );
};

const renderMicro = (detail) => {
    const samples = detail?.microbiology?.samples || [];

    return (
        <div className="space-y-6">
            <SectionCard
                title="Muestras microbiologicas"
                description="Cruce por lote visible, lote compacto o batchCode."
                icon={FlaskConical}
                collapsible
                defaultOpen={false}
            >
                {samples.length ? (
                    <div className="grid gap-4 xl:grid-cols-2">
                        {samples.map((sample) => (
                            <article key={sample.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <p className="text-sm font-bold text-slate-950">{sample.sampleNumber}</p>
                                            <Pill status={sample.status}>{sample.status}</Pill>
                                        </div>
                                        <p className="mt-1 text-xs text-slate-500">{sample.samplingPoint?.code || 'Sin punto'} · {sample.samplingPoint?.name || 'Sin nombre'}</p>
                                        <p className="mt-2 text-xs text-slate-500">Tomada {formatDate(sample.takenAt, true)} por {sample.takenBy?.name || 'Sin usuario'}</p>
                                    </div>
                                    <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-right">
                                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Adjuntos</p>
                                        <p className="mt-1 text-lg font-black text-slate-950">{formatNumber(sample.attachments?.length || 0)}</p>
                                    </div>
                                </div>

                                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                                    <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2">
                                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Lote / batch</p>
                                        <p className="mt-1 text-sm font-semibold text-slate-950">{sample.lotNumber || sample.batchCode || '-'}</p>
                                    </div>
                                    <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2">
                                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Contexto</p>
                                        <p className="mt-1 text-sm font-semibold text-slate-950">{sample.workContext || sample.zoneName || '-'}</p>
                                    </div>
                                </div>

                                {(sample.results || []).length > 0 && (
                                    <div className="mt-4 rounded-2xl border border-slate-200 bg-white px-4 py-3">
                                        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Resultados</p>
                                        <div className="mt-3 space-y-2">
                                            {sample.results.map((result) => (
                                                <div key={result.id} className="flex flex-wrap items-center justify-between gap-3 text-sm">
                                                    <div>
                                                        <p className="font-semibold text-slate-900">{result.parameter?.name || result.parameter?.code || 'Parametro'}</p>
                                                        <p className="text-xs text-slate-500">{result.notes || '-'}</p>
                                                    </div>
                                                    <div className="text-right">
                                                        <p className="font-bold text-slate-900">{result.valueText || result.value || '-'}</p>
                                                        <p className="text-xs text-slate-500">{result.isCompliant == null ? 'Sin evaluacion' : result.isCompliant ? 'Conforme' : 'Fuera de spec'}</p>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {(sample.internalLogs || []).length > 0 && (
                                    <div className="mt-4 rounded-2xl border border-slate-200 bg-white px-4 py-3">
                                        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Seguimiento interno</p>
                                        <div className="mt-3 space-y-2">
                                            {sample.internalLogs.map((log) => (
                                                <div key={log.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
                                                    <div className="flex flex-wrap items-center justify-between gap-3">
                                                        <p className="text-sm font-bold text-slate-950">{formatDate(log.logDate, true)}</p>
                                                        <p className="text-xs font-semibold text-slate-500">{log.recordedBy?.name || 'Sin usuario'}</p>
                                                    </div>
                                                    {log.observations && <p className="mt-2 text-sm text-slate-600">{log.observations}</p>}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </article>
                        ))}
                    </div>
                ) : (
                    <EmptyState title="Sin muestras relacionadas" description="No se encontraron muestras de microbiologia conectadas por lote visible o batchCode." />
                )}
            </SectionCard>
        </div>
    );
};

const renderEvidence = (detail) => (
    <div className="space-y-6">
        <SectionCard
            title="Repositorio documental"
            description="Agrupacion de imagenes, reportes y soportes detectados en produccion, abastecimiento, laboratorio y novedades."
            icon={FileImage}
            collapsible
            defaultOpen={false}
            actions={(
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-600">
                    {formatNumber(detail?.evidence?.length || 0)} archivos detectados
                </div>
            )}
        >
            <EvidenceGallery evidence={detail?.evidence || []} />
        </SectionCard>
    </div>
);

const renderBodyByTab = (detail, activeTab) => {
    if (!detail) return null;
    if (activeTab === 'supply') return renderSupply(detail);
    if (activeTab === 'process') return renderProcess(detail);
    if (activeTab === 'quality') return renderQuality(detail);
    if (activeTab === 'micro') return renderMicro(detail);
    if (activeTab === 'evidence') return renderEvidence(detail);
    return renderOverview(detail);
};

const ProductiveTraceabilityDetail = ({ detail, loading = false, error = '', activeTab = 'overview', onTabChange }) => {
    if (loading) {
        return (
            <div className="space-y-4">
                <div className="h-52 animate-pulse rounded-3xl bg-slate-200" />
                <div className="h-96 animate-pulse rounded-3xl bg-slate-100" />
            </div>
        );
    }

    if (!detail) {
        return (
            <div className="rounded-3xl border border-dashed border-slate-300 bg-white px-8 py-16 text-center">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                    <Layers3 size={30} />
                </div>
                <h2 className="mt-5 text-xl font-black text-slate-950">
                    {error ? 'No se pudo construir el expediente' : 'Selecciona un lote para abrir el expediente'}
                </h2>
                <p className={`mt-3 mx-auto max-w-2xl text-sm ${error ? 'text-rose-600' : 'text-slate-500'}`}>
                    {error || 'La vista de detalle organiza la trazabilidad en subventanas de abastecimiento, proceso, calidad, laboratorio y evidencias para evitar mezclar todo en una sola pantalla.'}
                </p>
            </div>
        );
    }

    const { batch, summary } = detail;
    const stats = summary?.stats || {};
    const segmentMeta = getTraceabilitySegmentMeta(batch.segment);

    return (
        <div className="space-y-6">
            <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
                <div className="bg-[radial-gradient(circle_at_top_left,_rgba(34,197,94,0.22),_transparent_35%),linear-gradient(135deg,#020617_0%,#0f172a_40%,#0f766e_100%)] px-6 py-6 text-white">
                    <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                        <div className="max-w-3xl">
                            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.2em] text-emerald-50">
                                <Route size={14} />
                                Trazabilidad Productiva
                            </div>
                            <div className="mt-4 flex flex-wrap items-center gap-3">
                                <h1 className="text-3xl font-black tracking-tight">{batch.displayLot || batch.batchNumber}</h1>
                                <Pill status={batch.status}>{batch.status}</Pill>
                                <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${segmentMeta.badge}`}>
                                    {segmentMeta.label}
                                </span>
                            </div>
                            <p className="mt-3 text-sm text-slate-200">
                                Batch interno {batch.batchNumber} · {getBatchFocusLabel(batch)}
                            </p>
                            {batch.notes && <p className="mt-3 max-w-2xl text-sm text-slate-300">{batch.notes}</p>}
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                            <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3">
                                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-200">Tipo</p>
                                <p className="mt-2 text-base font-black">{segmentMeta.label}</p>
                            </div>
                            <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3">
                                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-200">Etapas</p>
                                <p className="mt-2 text-xl font-black">{stats.stagesCompleted || 0}/{stats.stagesTotal || 0}</p>
                            </div>
                            <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3">
                                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-200">Calidad</p>
                                <p className="mt-2 text-xl font-black">{formatNumber(stats.qualityChecks || 0)}</p>
                            </div>
                            <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3">
                                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-200">Evidencias</p>
                                <p className="mt-2 text-xl font-black">{formatNumber(detail.evidence?.length || 0)}</p>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="border-b border-slate-100 bg-slate-50 px-4 py-4 sm:px-6">
                    <div className="grid gap-3 xl:grid-cols-[1fr_auto] xl:items-start">
                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                            {TABS.map((tab) => {
                                const Icon = tab.icon;
                                const isActive = activeTab === tab.id;

                                return (
                                    <button
                                        key={tab.id}
                                        type="button"
                                        onClick={() => onTabChange(tab.id)}
                                        className={`rounded-2xl border px-4 py-4 text-left transition-all ${isActive
                                            ? 'border-emerald-200 bg-white shadow-sm ring-2 ring-emerald-100'
                                            : 'border-slate-200 bg-white/70 hover:border-emerald-100 hover:bg-white'
                                            }`}
                                    >
                                        <div className="flex items-start gap-3">
                                            <div className={`rounded-2xl p-2 ${isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                                                <Icon size={18} />
                                            </div>
                                            <div>
                                                <p className={`text-sm font-bold ${isActive ? 'text-emerald-900' : 'text-slate-900'}`}>{tab.label}</p>
                                                <p className="mt-1 text-xs text-slate-500">{tab.description}</p>
                                            </div>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>

                        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Fechas clave</p>
                            <div className="mt-3 space-y-2 text-sm text-slate-600">
                                <div className="flex items-start gap-2">
                                    <PackageCheck size={15} className="mt-0.5 text-emerald-700" />
                                    <div>
                                        <p className="font-semibold text-slate-900">Inicio</p>
                                        <p>{formatDate(batch.startedAt || batch.scheduledStart || batch.createdAt, true)}</p>
                                    </div>
                                </div>
                                <div className="flex items-start gap-2">
                                    <ClipboardCheck size={15} className="mt-0.5 text-cyan-700" />
                                    <div>
                                        <p className="font-semibold text-slate-900">Cierre</p>
                                        <p>{formatDate(batch.completedAt || batch.scheduledEnd, true)}</p>
                                    </div>
                                </div>
                                <div className="flex items-start gap-2">
                                    <FileImage size={15} className="mt-0.5 text-rose-700" />
                                    <div>
                                        <p className="font-semibold text-slate-900">Soportes</p>
                                        <p>{sumEvidenceByNotes(detail.process?.notes || [])} en etapas + {formatNumber(detail.evidence?.length || 0)} globales</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {renderBodyByTab(detail, activeTab)}
        </div>
    );
};

export default ProductiveTraceabilityDetail;
