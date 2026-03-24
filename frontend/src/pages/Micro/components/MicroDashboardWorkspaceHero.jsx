import React from 'react';
import { Activity, ArrowRight, Beaker, Building2, ClipboardList, Plus, RefreshCcw, Settings2, Sparkles } from 'lucide-react';

const MicroDashboardWorkspaceHero = ({
    heroBadges = [],
    summaryCards = [],
    workspaceMode = 'ALL',
    workspaceOptions = [],
    quickAction = '',
    quickActionOptions = [],
    onWorkspaceModeChange,
    onQuickActionChange,
    onCreateSchedule,
    onRefresh,
    onOpenExternal,
    onOpenInternal,
    onOpenInternalAdmin,
    onOpenSystemOverview,
    onOpenPointsConfig
}) => (
    <div className="relative overflow-hidden rounded-[30px] border border-slate-200 bg-gradient-to-br from-slate-950 via-teal-950 to-emerald-900 text-white shadow-[0_30px_80px_-35px_rgba(15,23,42,0.8)]">
        <div className="pointer-events-none absolute inset-0">
            <div className="absolute -left-10 top-6 h-40 w-40 rounded-full bg-cyan-400/15 blur-3xl" />
            <div className="absolute right-0 top-0 h-52 w-52 rounded-full bg-emerald-300/10 blur-3xl" />
            <div className="absolute bottom-0 left-1/3 h-40 w-40 rounded-full bg-white/5 blur-3xl" />
        </div>

        <div className="relative px-6 py-6 lg:px-7">
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_420px] xl:items-start">
                <div className="space-y-5">
                    <div className="flex items-start gap-4">
                        <div className="rounded-3xl border border-white/10 bg-white/10 p-3 shadow-lg shadow-black/10 backdrop-blur">
                            <Beaker size={28} />
                        </div>
                        <div>
                            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-100/90">
                                <Sparkles size={12} />
                                Centro Operativo
                            </div>
                            <h1 className="mt-3 text-2xl font-bold tracking-tight text-white sm:text-[2rem]">
                                Dashboard de Laboratorio y Programación
                            </h1>
                            <p className="mt-2 max-w-3xl text-sm leading-6 text-cyan-50/85 sm:text-[15px]">
                                Una sola vista para coordinar agenda, recolección, flujos internos/externos y lectura de cobertura sin que el proceso se sienta saturado.
                            </p>
                        </div>
                    </div>

                    <div className="flex flex-wrap gap-2.5">
                        {heroBadges.map(badge => (
                            <div
                                key={badge.label}
                                className="rounded-2xl border border-white/10 bg-white/10 px-3.5 py-2.5 backdrop-blur transition-all duration-300 hover:-translate-y-0.5 hover:bg-white/15"
                            >
                                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-100/70">{badge.label}</p>
                                <p className="mt-1 text-sm font-semibold text-white">{badge.value}</p>
                            </div>
                        ))}
                    </div>

                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                        {summaryCards.map((card, index) => (
                            <div
                                key={card.label}
                                className="rounded-2xl border border-white/10 bg-white/10 px-4 py-4 backdrop-blur transition-all duration-300 hover:-translate-y-1 hover:bg-white/15"
                                style={{ transitionDelay: `${index * 40}ms` }}
                            >
                                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-100/70">{card.label}</p>
                                <p className="mt-2 text-3xl font-bold text-white">{card.value ?? 0}</p>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="rounded-[28px] border border-white/10 bg-white/10 p-5 backdrop-blur-xl">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <p className="text-sm font-bold text-white">Panel de control</p>
                            <p className="mt-1 text-xs leading-5 text-cyan-50/80">
                                Cambia el enfoque visible y ejecuta acciones rápidas sin salir del dashboard.
                            </p>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-white/10 p-2">
                            <Activity size={16} className="text-cyan-100" />
                        </div>
                    </div>

                    <div className="mt-5 space-y-3">
                        <div>
                            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100/75">
                                Enfoque visible
                            </label>
                            <select
                                value={workspaceMode}
                                onChange={event => onWorkspaceModeChange?.(event.target.value)}
                                className="w-full rounded-2xl border border-white/10 bg-white/10 px-3 py-3 text-sm font-medium text-white outline-none transition-colors focus:border-cyan-300 focus:ring-2 focus:ring-cyan-200/40"
                            >
                                {workspaceOptions.map(option => (
                                    <option key={option.value} value={option.value} className="text-slate-900">
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100/75">
                                Acción rápida
                            </label>
                            <select
                                value={quickAction}
                                onChange={event => onQuickActionChange?.(event.target.value)}
                                className="w-full rounded-2xl border border-white/10 bg-white/10 px-3 py-3 text-sm font-medium text-white outline-none transition-colors focus:border-cyan-300 focus:ring-2 focus:ring-cyan-200/40"
                            >
                                {quickActionOptions.map(option => (
                                    <option key={option.value} value={option.value} className="text-slate-900">
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div className="mt-5 grid gap-2 sm:grid-cols-2">
                        <button
                            type="button"
                            onClick={onCreateSchedule}
                            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-slate-900 transition-all duration-300 hover:-translate-y-0.5 hover:bg-cyan-50"
                        >
                            <Plus size={16} />
                            Nueva programación
                        </button>
                        <button
                            type="button"
                            onClick={onRefresh}
                            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm font-semibold text-white transition-all duration-300 hover:-translate-y-0.5 hover:bg-white/15"
                        >
                            <RefreshCcw size={16} />
                            Sincronizar
                        </button>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                        <button
                            type="button"
                            onClick={onOpenExternal}
                            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-white/15"
                        >
                            <Building2 size={13} />
                            Externo manual
                        </button>
                        <button
                            type="button"
                            onClick={onOpenInternal}
                            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-white/15"
                        >
                            <ClipboardList size={13} />
                            Interno manual
                        </button>
                    </div>

                    <div className="mt-5 grid gap-2 sm:grid-cols-3">
                        {typeof onOpenSystemOverview === 'function' && (
                            <button
                                type="button"
                                onClick={onOpenSystemOverview}
                                className="inline-flex items-center justify-center gap-1.5 rounded-2xl border border-white/10 bg-black/10 px-3 py-2 text-xs font-semibold text-cyan-50 transition-colors hover:bg-black/20"
                            >
                                <Activity size={13} />
                                Ver motores
                            </button>
                        )}
                        {typeof onOpenInternalAdmin === 'function' && (
                            <button
                                type="button"
                                onClick={onOpenInternalAdmin}
                                className="inline-flex items-center justify-center gap-1.5 rounded-2xl border border-white/10 bg-black/10 px-3 py-2 text-xs font-semibold text-cyan-50 transition-colors hover:bg-black/20"
                            >
                                <ClipboardList size={13} />
                                Internos
                            </button>
                        )}
                        {typeof onOpenPointsConfig === 'function' && (
                            <button
                                type="button"
                                onClick={onOpenPointsConfig}
                                className="inline-flex items-center justify-center gap-1.5 rounded-2xl border border-white/10 bg-black/10 px-3 py-2 text-xs font-semibold text-cyan-50 transition-colors hover:bg-black/20"
                            >
                                <Settings2 size={13} />
                                Puntos
                            </button>
                        )}
                    </div>

                    <div className="mt-5 rounded-2xl border border-white/10 bg-black/10 px-4 py-3 text-xs text-cyan-50/80">
                        <p className="font-semibold text-white">Sugerencia de uso</p>
                        <p className="mt-1 leading-5">
                            Usa el enfoque `Agenda` para la semana operativa, `Calidad` para alertas y cobertura, o `Historial` cuando necesites revisar casos recientes.
                        </p>
                        <div className="mt-3 inline-flex items-center gap-2 font-semibold text-cyan-100">
                            Navegación más limpia
                            <ArrowRight size={13} />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
);

export default MicroDashboardWorkspaceHero;
