import { useState } from 'react';
import { LayoutDashboard, Package, Factory, ShoppingCart, Users as UsersIcon, FileText, LineChart, Calendar, Settings, PlayCircle, AlertCircle, Activity, BarChart2, Microscope, Truck, Layers, FlaskConical, ChevronDown, ChevronLeft, ChevronRight, ClipboardList, Warehouse, Printer, Network, Search, FileSpreadsheet, Building2 } from 'lucide-react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

const sectionIcons = {
    'Distribución': ShoppingCart,
    'Logística': Package,
    'Producción': Factory,
    'Calidad': AlertCircle,
    'Compras': Truck,
    'Reportes': BarChart2,
};

const isPathActive = (pathname, path) => {
    if (path === '/') return pathname === '/';
    return pathname === path || pathname.startsWith(`${path}/`);
};

const Sidebar = () => {
    const { user } = useAuth();
    const location = useLocation();
    const [isCollapsed, setIsCollapsed] = useState(false);
    const [expandedGroups, setExpandedGroups] = useState({});

    const allItems = [
        // ── General ──
        { icon: LayoutDashboard, label: 'Dashboard', path: '/', roles: ['ADMIN', 'PRODUCCION', 'OPERARIO_PICKING', 'QUIMICO'] },

        // ── Distribución ──
        { icon: ShoppingCart, label: 'Tienda', path: '/shop', roles: ['DISTRIBUIDOR'], section: 'Distribución' },
        { icon: Package, label: 'Mis Pedidos', path: '/orders', roles: ['DISTRIBUIDOR'] },

        // ── Logística ──
        { icon: Package, label: 'Pedidos', path: '/orders', roles: ['ADMIN', 'LOGISTICA'], section: 'Logística' },
        { icon: LayoutDashboard, label: 'Inventario', path: '/inventory', roles: ['ADMIN', 'PRODUCCION', 'CARTERA', 'LOGISTICA', 'OPERARIO_PICKING', 'QUIMICO'] },
        { icon: Layers, label: 'Trazabilidad Lotes', path: '/lots/traceability', roles: ['ADMIN', 'PRODUCCION', 'QUIMICO'] },

        // ── Producción ──
        { icon: Calendar, label: 'Prog. Producción', path: '/production/schedule', roles: ['ADMIN'], section: 'Producción' },
        { icon: Calendar, label: 'Producción', path: '/production/view', roles: ['PRODUCCION', 'QUIMICO'], section: 'Producción' },
        { icon: PlayCircle, label: 'Modo Operador (PLC)', path: '/production/operator', roles: ['ADMIN', 'PRODUCCION', 'OPERARIO_PICKING', 'QUIMICO'] },
        { icon: Factory, label: 'Plantillas Liquipops', path: '/assembly-templates', roles: ['ADMIN'] },
        { icon: Factory, label: 'Plantillas Geniality', path: '/geniality/assembly-templates', roles: ['ADMIN'] },
        { icon: Activity, label: 'Historial RPA', path: '/rpa-history', roles: ['ADMIN', 'PRODUCCION', 'QUIMICO'] },
        { icon: FileText, label: 'Fórmulas Liquipops', path: '/formulas', roles: ['ADMIN', 'QUIMICO'] },
        { icon: FileText, label: 'Fórmulas Geniality', path: '/geniality/formulas', roles: ['ADMIN', 'QUIMICO'] },
        { icon: LayoutDashboard, label: 'Monitor Geniality', path: '/geniality/monitor', roles: ['ADMIN', 'PRODUCCION', 'QUIMICO'] },
        { icon: FlaskConical, label: 'Premezclas', path: '/premix-panel', roles: ['ADMIN', 'QUIMICO'] },
        { icon: LineChart, label: 'Panel MRP', path: '/mrp', roles: ['ADMIN'] },
        { icon: BarChart2, label: 'KPIs Producción', path: '/production/kpis', roles: ['ADMIN'] },
        { icon: ClipboardList, label: 'Historial Batches', path: '/production/batch-history', roles: ['ADMIN', 'QUIMICO'] },
        { icon: ClipboardList, label: 'Auditoría de Lotes', path: '/production/audit', roles: ['ADMIN', 'QUIMICO'] },
        { icon: Warehouse, label: 'Zona de Producción', path: '/production/zone', roles: ['ADMIN', 'PRODUCCION', 'QUIMICO'] },
        { icon: Package, label: 'Zonas Prod. Terminado', path: '/production/finished-zone', roles: ['ADMIN', 'LOGISTICA', 'PRODUCCION', 'OPERARIO_PICKING'] },
        { icon: Warehouse, label: 'Zonas Materia Prima', path: '/inventory/material-zones', roles: ['ADMIN', 'LOGISTICA', 'PRODUCCION', 'QUIMICO'] },
        { icon: Truck, label: 'Actas de Entrega', path: '/production/handoffs', roles: ['ADMIN', 'LOGISTICA', 'PRODUCCION', 'OPERARIO_PICKING'] },
        { icon: ClipboardList, label: 'Conteo Físico PT', path: '/production/physical-count', roles: ['ADMIN', 'LOGISTICA'] },
        { icon: ClipboardList, label: 'Inventario Físico MP', path: '/inventory/count', roles: ['ADMIN', 'LOGISTICA', 'PRODUCCION', 'QUIMICO'] },

        { icon: AlertCircle, label: 'Recall por Lote', path: '/recall-report', roles: ['ADMIN', 'CALIDAD', 'LOGISTICA', 'QUIMICO'] },
        { icon: Printer, label: 'Impresión Etiquetas', path: '/labeling', roles: ['ADMIN', 'PRODUCCION', 'OPERARIO_PICKING'] },
        { icon: ClipboardList, label: 'Reg. de Lavado POES', path: '/sanitation/operator', roles: ['ADMIN', 'PRODUCCION', 'QUIMICO'] },
        { icon: Calendar,   label: 'Cuadro de Turnos',   path: '/shift-schedule', roles: ['ADMIN'] },

        // ── Calidad ──
        { icon: FileText, label: 'Gestión PQR', path: '/pqr/manage', roles: ['ADMIN', 'CALIDAD', 'CONTABILIDAD', 'COMERCIAL', 'LOGISTICA', 'QUIMICO'], section: 'Calidad' },
        { icon: Activity, label: 'Dashboard PQR', path: '/pqr/dashboard', roles: ['ADMIN', 'CALIDAD', 'QUIMICO'] },
        { icon: AlertCircle, label: 'PQR Interno — Crear', path: '/internal-pqr/create', roles: ['ADMIN', 'CALIDAD', 'QUIMICO'] },
        { icon: AlertCircle, label: 'PQR Interno — Gestión', path: '/internal-pqr/manage', roles: ['ADMIN', 'CALIDAD', 'CONTABILIDAD', 'QUIMICO'] },
        { icon: Network, label: 'Trazabilidad Productiva', path: '/quality/productive-traceability', roles: ['ADMIN', 'CALIDAD', 'PRODUCCION', 'QUIMICO'] },
        { icon: Microscope, label: 'Microbiología', path: '/micro/dashboard', roles: ['ADMIN', 'CALIDAD', 'QUIMICO'] },
        { icon: ClipboardList, label: 'Saneamiento POES', path: '/sanitation/dashboard', roles: ['ADMIN', 'CALIDAD', 'QUIMICO'] },
        { icon: Settings, label: 'Config POES', path: '/sanitation/config', roles: ['ADMIN', 'QUIMICO'] },

        // ── Compras ──
        { icon: Truck, label: 'Forecast MP', path: '/procurement/forecast', roles: ['ADMIN', 'DIRECTOR_TECNICO', 'LIDER_OPERACIONES', 'CONTABILIDAD', 'CARTERA', 'QUIMICO'], section: 'Compras' },
        { icon: ShoppingCart, label: 'Órdenes de Compra', path: '/procurement/purchase-orders', roles: ['ADMIN', 'DIRECTOR_TECNICO', 'LIDER_OPERACIONES', 'CONTABILIDAD', 'CARTERA', 'LOGISTICA', 'QUIMICO'] },
        { icon: UsersIcon, label: 'Proveedores', path: '/procurement/suppliers', roles: ['ADMIN', 'CONTABILIDAD', 'CARTERA'] },

        // ── Distribuidores (PQR) ──
        { icon: FileText, label: 'Garantías (PQR)', path: '/pqr/list', roles: ['DISTRIBUIDOR'], section: 'Distribución' },

        // ── Reportes & Admin ──
        { icon: Building2,  label: 'Control de Ingreso', path: '/attendance', roles: ['ADMIN', 'RECURSOS_HUMANOS'], section: 'Reportes' },
        { icon: Search, label: 'Conciliación Siigo', path: '/reconciliation', roles: ['ADMIN'] },
        { icon: FileSpreadsheet, label: 'Validación Recuperación', path: '/recovery/forensic', roles: ['ADMIN', 'QUIMICO'] },
        { icon: LineChart, label: 'Análisis Ejecutivo', path: '/analytics/executive', roles: ['ADMIN'] },
        { icon: BarChart2, label: 'Ventas por Cliente', path: '/analytics/sales', roles: ['ADMIN'] },
        { icon: FileText, label: 'Movimientos', path: '/admin/movements', roles: ['ADMIN'] },
        { icon: UsersIcon, label: 'Usuarios', path: '/admin/users', roles: ['ADMIN'] },
        { icon: Settings, label: 'Configuración', path: '/admin/config', roles: ['ADMIN'] },
    ];

    // ADMIN sees ALL items; other roles see only their allowed items
    const isAdmin = user?.role === 'ADMIN';
    let currentSection = null;
    const flatItems = [];
    const directItems = [];
    const groupsBySection = new Map();

    allItems.forEach((item) => {
        if (item.section) currentSection = item.section;
        const canSeeItem = isAdmin || item.roles.includes(user?.role);
        if (!canSeeItem) return;

        flatItems.push(item);

        if (!currentSection) {
            directItems.push(item);
            return;
        }

        if (!groupsBySection.has(currentSection)) {
            groupsBySection.set(currentSection, {
                label: currentSection,
                icon: sectionIcons[currentSection] || Layers,
                items: [],
            });
        }

        groupsBySection.get(currentSection).items.push(item);
    });

    const groupedItems = Array.from(groupsBySection.values());
    const toggleGroup = (groupLabel) => {
        setExpandedGroups(prev => ({
            ...prev,
            [groupLabel]: !prev[groupLabel],
        }));
    };

    const renderNavItem = (item, className = '', tabIndex) => (
        <NavLink
            key={`${item.path}-${item.label}`}
            to={item.path}
            title={item.label}
            aria-label={item.label}
            tabIndex={tabIndex}
            className={({ isActive }) =>
                `flex items-center rounded-lg text-sm font-medium transition-colors ${isCollapsed ? 'justify-center px-2 py-2.5' : 'gap-3 px-3 py-2'} ${className} ${isActive
                    ? 'bg-primary-50 text-primary-700'
                    : 'text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900'
                }`
            }
        >
            <item.icon size={20} className="flex-shrink-0" />
            {!isCollapsed && <span className="truncate">{item.label}</span>}
        </NavLink>
    );

    return (
        <aside className={`${isCollapsed ? 'w-20' : 'w-64'} bg-white border-r border-neutral-200 flex flex-col min-h-screen transition-all duration-300`}>
            <div className={`h-16 flex items-center border-b border-neutral-200 ${isCollapsed ? 'justify-between px-3' : 'justify-between px-6'}`}>
                {!isCollapsed && (
                    <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary-600 to-primary-400">
                        Popping Boba
                    </span>
                )}
                {isCollapsed && (
                    <span className="text-sm font-bold text-primary-600">
                        PB
                    </span>
                )}
                <button
                    type="button"
                    onClick={() => setIsCollapsed(prev => !prev)}
                    className="p-2 rounded-lg text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 transition-colors"
                    title={isCollapsed ? 'Expandir menú lateral' : 'Colapsar menú lateral'}
                    aria-label={isCollapsed ? 'Expandir menú lateral' : 'Colapsar menú lateral'}
                >
                    {isCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
                </button>
            </div>

            <nav className={`flex-1 overflow-y-auto ${isCollapsed ? 'p-3 space-y-1' : 'p-4 space-y-2'}`}>
                {isCollapsed ? (
                    flatItems.map(item => renderNavItem(item))
                ) : (
                    <>
                        {directItems.map(item => renderNavItem(item))}

                        {groupedItems.map((group) => {
                            const GroupIcon = group.icon;
                            const isOpen = Boolean(expandedGroups[group.label]);
                            const hasActiveItem = group.items.some(item => isPathActive(location.pathname, item.path));
                            const panelId = `sidebar-group-${group.label.toLowerCase().replace(/\s+/g, '-')}`;

                            return (
                                <div key={group.label} className="rounded-lg">
                                    <button
                                        type="button"
                                        onClick={() => toggleGroup(group.label)}
                                        className={`w-full flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs font-bold uppercase tracking-wider transition-all duration-200 ${hasActiveItem
                                            ? 'bg-primary-50 text-primary-700'
                                            : 'text-neutral-500 hover:bg-neutral-50 hover:text-neutral-900'
                                        }`}
                                        aria-expanded={isOpen}
                                        aria-controls={panelId}
                                    >
                                        <span className="flex items-center gap-2 min-w-0">
                                            <GroupIcon size={16} className="flex-shrink-0" />
                                            <span className="truncate">{group.label}</span>
                                        </span>
                                        <ChevronDown
                                            size={16}
                                            className={`flex-shrink-0 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`}
                                        />
                                    </button>

                                    <div
                                        id={panelId}
                                        aria-hidden={!isOpen}
                                        className={`grid transition-all duration-300 ease-in-out ${isOpen ? 'grid-rows-[1fr] opacity-100 mt-1' : 'grid-rows-[0fr] opacity-0'}`}
                                    >
                                        <div className="min-h-0 overflow-hidden pl-3 space-y-0.5">
                                            {group.items.map(item => renderNavItem(item, 'border-l border-transparent', isOpen ? undefined : -1))}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </>
                )}
            </nav>

        </aside>
    );
};

export default Sidebar;
