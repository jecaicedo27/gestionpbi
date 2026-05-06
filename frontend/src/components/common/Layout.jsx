import { useState, useEffect, useRef } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import BottomNavBar from './BottomNavBar';
import GlobalTimerAlert from './GlobalTimerAlert';
import PinLockScreen from './PinLockScreen';
// DISABLED — Old shift handoff system paused (interfería con entrega de producto)
// import ShiftBlockScreen from '../ShiftBlockScreen';
// import ShiftEndAlert from '../ShiftEndAlert';
// import ShiftAlarm from '../ShiftAlarm';
import HandoverAlarm from '../ShiftHandover/HandoverAlarm';
import HandoverBlockScreen from '../ShiftHandover/HandoverBlockScreen';
import PurchaseOrderAlert from './PurchaseOrderAlert';
import { Bell, LogOut, Printer, Wifi, LockKeyhole } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useZebra } from '../../context/ZebraContext';

const Layout = () => {
    const { user, logout, lockScreen, isLocked, unlockWithPin, fullLogoutFromLock, lastUser } = useAuth();
    const navigate = useNavigate();
    const { zebraStatus, zebraIp, relayIp, updateConfig, recheckNow, isRechecking, forceIp, setForceDirectIp } = useZebra();
    const [showZebraConfig, setShowZebraConfig] = useState(false);
    const [inputRelay, setInputRelay] = useState('');
    const [inputForce, setInputForce] = useState('');
    const zebraRef = useRef(null);

    // Close popover on outside click
    useEffect(() => {
        if (!showZebraConfig) return;
        const handler = (e) => { if (zebraRef.current && !zebraRef.current.contains(e.target)) setShowZebraConfig(false); };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [showZebraConfig]);

    const saveRelayIp = () => {
        updateConfig(null, inputRelay.trim());
        recheckNow();
        setShowZebraConfig(false);
    };
    const saveForceIp = () => {
        setForceDirectIp(inputForce.trim());
        setShowZebraConfig(false);
    };
    const clearForce = () => {
        setForceDirectIp('');
        recheckNow();
    };
    const location = useLocation();

    // Track screen width for responsive bottom nav
    const [isSmallScreen, setIsSmallScreen] = useState(typeof window !== 'undefined' && window.innerWidth <= 900);
    useEffect(() => {
        const onResize = () => setIsSmallScreen(window.innerWidth <= 900);
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    // PRODUCCION always tablet mode (dedicated tablets). Others only on small screens.
    const alwaysTablet = user?.role === 'PRODUCCION';
    const responsiveTabletRoles = ['LOGISTICA', 'CARTERA', 'CONTABILIDAD', 'OPERARIO_PICKING', 'QUIMICO'];
    const isTabletMode = alwaysTablet || (isSmallScreen && responsiveTabletRoles.includes(user?.role));
    
    // Check if we are in the distributor welcome screen to hide the sidebar and allow a full-width hero
    const isDistributorWelcome = user?.role === 'DISTRIBUIDOR' && location.pathname === '/';

    const getTitle = () => {
        const path = location.pathname;
        if (path === '/') return 'Dashboard';
        if (path === '/shop') return 'Tienda';
        if (path === '/orders') return 'Pedidos';
        if (path === '/inventory') return 'Inventario';
        if (path === '/production') return 'Producción';
        if (path === '/production/schedule') return 'Programador de Producción';
        if (path === '/production/view') return 'Producción';
        if (path === '/production/operator') return 'Panel de Producción';
        if (path === '/premix-panel') return 'Premezclas';
        if (path === '/rpa-history') return 'Historial RPA';
        if (path === '/lots/traceability') return 'Trazabilidad de Lotes';
        if (path === '/quality/productive-traceability') return 'Trazabilidad Productiva';
        if (path.startsWith('/micro')) return 'Microbiología';
        if (path === '/admin/users') return 'Usuarios';
        if (path === '/admin/config') return 'Configuración';
        if (path === '/admin/reports') return 'Reportes';
        if (path === '/shift-schedule') return 'Cuadro de Turnos';
        if (path === '/attendance') return 'Control de Ingreso';
        if (path === '/labor-management') return 'Gestión Laboral';
        if (path === '/recovery/forensic') return 'Validacion de Recuperacion';
        if (path.includes('analytics')) return 'Análisis';
        return 'Dashboard';
    };

    return (
        <div className={`flex min-h-screen bg-neutral-50 text-neutral-900 font-sans ${isTabletMode ? 'layout--tablet' : ''}`}>
            <GlobalTimerAlert />
            {/* <ShiftAlarm /> — DISABLED (old system) */}
            <HandoverAlarm />
            <HandoverBlockScreen />
            <PurchaseOrderAlert />
            {!isTabletMode && !isDistributorWelcome && <Sidebar />}

            <main className="flex-1 flex flex-col min-w-0">
                <header className={`layout__header bg-white border-b border-neutral-200 ${isTabletMode ? 'h-12' : 'h-16'} flex items-center justify-between px-3 sm:px-6 sticky top-0 z-30`}>
                    <h2 className={`${isTabletMode ? 'text-base' : 'text-lg'} font-semibold text-neutral-800 truncate mr-2`}>{getTitle()}</h2>

                    <div className="flex items-center gap-2 sm:gap-4 flex-shrink-0">
                        {/* Zebra printer status — shown to operational roles */}
                        {['PRODUCCION', 'OPERARIO_PICKING', 'ADMIN', 'LOGISTICA', 'SUPERADMIN', 'QUIMICO'].includes(user?.role) && (
                            <div className="relative" ref={zebraRef}>
                                <button
                                    onClick={() => { setInputRelay(relayIp || ''); setInputForce(forceIp || ''); setShowZebraConfig(v => !v); }}
                                    title="Estado impresora Zebra — clic para configurar"
                                    className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-bold border transition-all cursor-pointer
                                        ${zebraStatus === 'connected'
                                            ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                                            : zebraStatus === 'checking'
                                            ? 'bg-slate-50 border-slate-200 text-slate-400 animate-pulse'
                                            : 'bg-red-50 border-red-200 text-red-500'}`}
                                >
                                    <Printer size={13} />
                                    <span>
                                        {zebraStatus === 'connected' ? `Zebra ✓` : zebraStatus === 'checking' ? 'Zebra...' : 'Sin impresora'}
                                    </span>
                                </button>

                                {showZebraConfig && (
                                    <div className="absolute left-0 lg:right-0 lg:left-auto top-9 z-50 bg-white border border-neutral-200 rounded-xl shadow-xl p-4 w-72">
                                        <p className="text-xs font-bold text-neutral-700 mb-2 flex items-center gap-1.5"><Wifi size={13}/> Configurar impresora Zebra</p>
                                        <p className="text-xs text-neutral-500 mb-3">Estado: <span className="font-semibold">{zebraStatus === 'connected' ? `🟢 Conectada (${zebraIp})` : zebraStatus === 'checking' ? '🔵 Verificando...' : '🔴 No alcanzable'}</span></p>

                                        {/* Section 1: Force Direct IP (for Android/tablet) */}
                                        <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 mb-3">
                                            <p className="text-xs font-bold text-amber-800 mb-0.5">📱 IP directa Zebra (tablet)</p>
                                            <p className="text-xs text-amber-600 mb-1.5">Usa esto si Chrome bloquea la detección automática.</p>
                                            {forceIp && (
                                                <div className="mb-2 p-1.5 bg-emerald-100/50 rounded flex flex-col items-start gap-1">
                                                    <span className="text-[11px] text-emerald-800 font-bold break-all">
                                                        ✓ IP Actual: {forceIp}
                                                    </span>
                                                    <button onClick={clearForce} className="text-[11px] font-bold text-red-600 underline">
                                                        Quitar configuración
                                                    </button>
                                                </div>
                                            )}
                                            <div className="flex gap-2">
                                                <input
                                                    type="text"
                                                    value={inputForce}
                                                    onChange={e => setInputForce(e.target.value)}
                                                    placeholder="192.168.0.126"
                                                    className="flex-1 border border-amber-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                                                />
                                                <button onClick={saveForceIp} className="bg-amber-500 text-white text-xs rounded-lg px-3 py-1.5 font-semibold hover:bg-amber-600">
                                                    Forzar
                                                </button>
                                            </div>
                                        </div>

                                        {/* Section 2: PC Relay */}
                                        <p className="text-xs text-neutral-600 font-medium">IP del PC relay (opcional)</p>
                                        <p className="text-xs text-neutral-400 mb-1">Solo si usas el relay del PC.</p>
                                        <div className="flex gap-2 mt-1">
                                            <input
                                                type="text"
                                                value={inputRelay}
                                                onChange={e => setInputRelay(e.target.value)}
                                                placeholder="192.168.0.x"
                                                className="flex-1 border border-neutral-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary-400"
                                            />
                                            <button onClick={saveRelayIp} className="bg-primary-600 text-white text-xs rounded-lg px-3 py-1.5 font-semibold hover:bg-primary-700">
                                                {isRechecking ? '...' : 'Guardar'}
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                        {!isTabletMode && (
                            <button className="p-2 text-neutral-500 hover:bg-neutral-100 rounded-full transition-colors relative">
                                <Bell size={20} />
                            </button>
                        )}

                        {!isTabletMode && <div className="h-8 w-px bg-neutral-200 mx-1"></div>}

                        <div className="flex items-center gap-2 sm:gap-3">
                            <div className="text-right hidden sm:block">
                                <p className="text-sm font-medium text-neutral-900 truncate max-w-[150px]">{user?.name}</p>
                                <p className="text-xs text-neutral-500">{user?.role}</p>
                            </div>
                            <div className="w-8 h-8 sm:w-9 sm:h-9 bg-primary-100 text-primary-700 rounded-full flex items-center justify-center font-bold flex-shrink-0">
                                {user?.name?.substring(0, 2).toUpperCase()}
                            </div>
                        </div>

                        <div className="h-8 w-px bg-neutral-200 mx-1"></div>

                        {/* Lock screen button — only for operational roles */}
                        {user?.role !== 'DISTRIBUIDOR' && (
                            <button
                                onClick={lockScreen}
                                className="p-1.5 sm:p-2 text-neutral-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors flex-shrink-0"
                                title="Bloquear pantalla (PIN)"
                            >
                                <LockKeyhole size={18} />
                            </button>
                        )}

                        <button
                            onClick={logout}
                            className="p-1.5 sm:p-2 text-neutral-500 hover:text-red-600 hover:bg-neutral-100 rounded-lg transition-colors flex items-center gap-1 sm:gap-2 flex-shrink-0"
                            title="Cerrar Sesión"
                        >
                            <LogOut size={20} />
                            <span className="text-xs font-semibold hidden sm:inline">Salir</span>
                        </button>
                    </div>
                </header>

                <div className={`layout__content flex-1 ${isTabletMode ? 'p-0 pb-20' : 'p-0'}`}>
                    <Outlet />
                </div>
            </main>

            {isTabletMode && <BottomNavBar userRole={user?.role} isCleaningOnly={!!user?.isCleaningOnly} isCleaningStaff={!!user?.isCleaningStaff} isCleaningSupervisor={!!user?.isCleaningSupervisor} />}

            {/* DISABLED — Shift handoff system paused */}
            {/* <ShiftBlockScreen userRole={user?.role} /> */}
            {/* <ShiftEndAlert userRole={user?.role} /> */}

            {/* PIN Lock Screen Overlay */}
            {isLocked && (
                <PinLockScreen
                    lastUser={lastUser}
                    onUnlock={async (pin) => {
                        const result = await unlockWithPin(pin);
                        if (result.success && result.roleChanged) {
                            // Role changed — redirect to dashboard
                            navigate('/', { replace: true });
                        }
                        return result;
                    }}
                    onFullLogout={fullLogoutFromLock}
                />
            )}
        </div>
    );
};

export default Layout;
