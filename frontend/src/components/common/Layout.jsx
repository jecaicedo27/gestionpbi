import { useState, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import BottomNavBar from './BottomNavBar';
import GlobalTimerAlert from './GlobalTimerAlert';
import { Bell, LogOut } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

const Layout = () => {
    const { user, logout } = useAuth();
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
    const responsiveTabletRoles = ['LOGISTICA', 'CARTERA', 'CONTABILIDAD'];
    const isTabletMode = alwaysTablet || (isSmallScreen && responsiveTabletRoles.includes(user?.role));

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
        if (path === '/admin/users') return 'Usuarios';
        if (path === '/admin/config') return 'Configuración';
        if (path === '/admin/reports') return 'Reportes';
        if (path.includes('analytics')) return 'Análisis';
        return 'Dashboard';
    };

    return (
        <div className={`flex min-h-screen bg-neutral-50 text-neutral-900 font-sans ${isTabletMode ? 'layout--tablet' : ''}`}>
            <GlobalTimerAlert />
            {!isTabletMode && <Sidebar />}

            <main className="flex-1 flex flex-col min-w-0">
                <header className={`layout__header bg-white border-b border-neutral-200 ${isTabletMode ? 'h-12' : 'h-16'} flex items-center justify-between px-6 sticky top-0 z-30`}>
                    <h2 className={`${isTabletMode ? 'text-base' : 'text-lg'} font-semibold text-neutral-800`}>{getTitle()}</h2>

                    <div className="flex items-center gap-4">
                        {!isTabletMode && (
                            <button className="p-2 text-neutral-500 hover:bg-neutral-100 rounded-full transition-colors relative">
                                <Bell size={20} />
                            </button>
                        )}

                        {!isTabletMode && <div className="h-8 w-px bg-neutral-200 mx-1"></div>}

                        <div className="flex items-center gap-3">
                            <div className="text-right hidden sm:block">
                                <p className="text-sm font-medium text-neutral-900">{user?.name}</p>
                                <p className="text-xs text-neutral-500">{user?.role}</p>
                            </div>
                            <div className="w-9 h-9 bg-primary-100 text-primary-700 rounded-full flex items-center justify-center font-bold">
                                {user?.name?.substring(0, 2).toUpperCase()}
                            </div>
                        </div>

                        <div className="h-8 w-px bg-neutral-200 mx-1"></div>

                        <button
                            onClick={logout}
                            className="p-2 text-neutral-500 hover:text-red-600 hover:bg-neutral-100 rounded-lg transition-colors flex items-center gap-2"
                            title="Cerrar Sesión"
                        >
                            <LogOut size={20} />
                        </button>
                    </div>
                </header>

                <div className={`layout__content flex-1 ${isTabletMode ? 'p-0 pb-20' : 'p-0'}`}>
                    <Outlet />
                </div>
            </main>

            {isTabletMode && <BottomNavBar userRole={user?.role} />}
        </div>
    );
};

export default Layout;
