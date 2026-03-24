import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Microscope, TrendingUp, RefreshCcw, Database, MapPinned, ClipboardList, Activity } from 'lucide-react';
import MicroDashboard from './MicroDashboard';
import MicroSamplingPointsConfig from './MicroSamplingPointsConfig';
import MicroTrending from './MicroTrending';
import MicroInternalLabsAdmin from './MicroInternalLabsAdmin';
import MicroSystemOverview from './MicroSystemOverview';

const TABS = [
    {
        id: 'control',
        label: 'Agenda Operativa',
        description: 'Semana operativa, programación y flujo diario',
        icon: Microscope
    },
    {
        id: 'internal',
        label: 'Laboratorios Internos',
        description: 'Mesa operativa, filtros y continuidad del proceso',
        icon: ClipboardList
    },
    {
        id: 'overview',
        label: 'Motores y Cobertura',
        description: 'Salud del sistema, brechas y capas de trazabilidad',
        icon: Activity
    },
    {
        id: 'trends',
        label: 'Tendencia Microbiológica',
        description: 'Dashboard analítico y series históricas',
        icon: TrendingUp
    },
    {
        id: 'points',
        label: 'Puntos de Muestreo',
        description: 'Configuración maestra, códigos de zona y estado',
        icon: MapPinned
    }
];

const MicroModulePage = () => {
    const [searchParams, setSearchParams] = useSearchParams();
    const [refreshSignal, setRefreshSignal] = useState(0);
    const [lastSyncAt, setLastSyncAt] = useState(() => new Date());

    const allowedTabs = TABS.map(tab => tab.id);
    const requestedTab = searchParams.get('tab');
    const activeTab = allowedTabs.includes(requestedTab) ? requestedTab : 'control';

    const updateSyncState = () => {
        setRefreshSignal(previous => previous + 1);
        setLastSyncAt(new Date());
    };

    const handleTabChange = (tabId) => {
        const nextParams = new URLSearchParams(searchParams);
        if (tabId === 'control') {
            nextParams.delete('tab');
        } else {
            nextParams.set('tab', tabId);
        }
        setSearchParams(nextParams, { replace: true });
    };

    const lastSyncLabel = lastSyncAt.toLocaleTimeString('es-CO', {
        hour: '2-digit',
        minute: '2-digit'
    });

    return (
        <div className="p-6 space-y-6 max-w-[1680px] mx-auto">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="px-6 py-5 bg-gradient-to-r from-slate-900 via-teal-900 to-emerald-900 text-white">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div className="flex items-start gap-4">
                            <div className="p-3 rounded-2xl bg-white/10 border border-white/15">
                                <Microscope size={28} />
                            </div>
                            <div>
                                <h1 className="text-2xl font-bold">Módulo de Microbiología</h1>
                                <p className="text-sm text-teal-50/90 mt-1">
                                    Programación semanal de laboratorio, seguimiento interno en planta y analítica histórica sobre la misma base de muestras y resultados.
                                </p>
                            </div>
                        </div>

                        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
                            <div className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-xs font-medium text-teal-50">
                                <Database size={15} />
                                Prisma + PostgreSQL sincronizados
                            </div>
                            <button
                                type="button"
                                onClick={updateSyncState}
                                className="inline-flex items-center gap-2 rounded-xl bg-white text-slate-900 px-4 py-2.5 text-sm font-semibold shadow-sm transition-colors hover:bg-teal-50"
                            >
                                <RefreshCcw size={16} />
                                Sincronizar datos
                            </button>
                        </div>
                    </div>
                </div>

                <div className="px-4 py-4 sm:px-6 border-b border-gray-100 bg-slate-50/80">
                    <div className="grid grid-cols-1 xl:grid-cols-[1fr_auto] gap-4 items-start">
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                            {TABS.map(tab => {
                                const Icon = tab.icon;
                                const isActive = activeTab === tab.id;
                                return (
                                    <button
                                        key={tab.id}
                                        type="button"
                                        onClick={() => handleTabChange(tab.id)}
                                        className={`text-left rounded-2xl border px-4 py-4 transition-all ${isActive
                                            ? 'border-teal-200 bg-white shadow-sm ring-2 ring-teal-100'
                                            : 'border-gray-200 bg-white/70 hover:border-teal-100 hover:bg-white'
                                            }`}
                                    >
                                        <div className="flex items-start gap-3">
                                            <div className={`p-2 rounded-xl ${isActive ? 'bg-teal-100 text-teal-700' : 'bg-gray-100 text-gray-500'}`}>
                                                <Icon size={18} />
                                            </div>
                                            <div>
                                                <p className={`text-sm font-bold ${isActive ? 'text-teal-900' : 'text-gray-800'}`}>{tab.label}</p>
                                                <p className="text-xs text-gray-500 mt-1">{tab.description}</p>
                                            </div>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>

                        <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3 min-w-[220px]">
                            <p className="text-xs font-bold uppercase tracking-wide text-gray-400">Última Sincronización</p>
                            <p className="text-lg font-bold text-gray-900 mt-1">{lastSyncLabel}</p>
                            <p className="text-xs text-gray-500 mt-1">
                                Usa el mismo motor de cálculo para programación, reportes y tendencias.
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {activeTab === 'trends' ? (
                <MicroTrending embedded refreshSignal={refreshSignal} />
            ) : activeTab === 'internal' ? (
                <MicroInternalLabsAdmin
                    embedded
                    refreshSignal={refreshSignal}
                    onDataChange={updateSyncState}
                    onOpenDashboard={() => handleTabChange('control')}
                />
            ) : activeTab === 'overview' ? (
                <MicroSystemOverview
                    embedded
                    refreshSignal={refreshSignal}
                    onNavigate={handleTabChange}
                />
            ) : activeTab === 'points' ? (
                <MicroSamplingPointsConfig onDataChange={updateSyncState} />
            ) : (
                <MicroDashboard
                    embedded
                    refreshSignal={refreshSignal}
                    onDataChange={updateSyncState}
                    onOpenPointsConfig={() => handleTabChange('points')}
                    onOpenInternalAdmin={() => handleTabChange('internal')}
                    onOpenSystemOverview={() => handleTabChange('overview')}
                />
            )}
        </div>
    );
};

export default MicroModulePage;
