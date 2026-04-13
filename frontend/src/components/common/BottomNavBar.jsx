import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Package, Calendar, PlayCircle, FlaskConical, Activity, Layers, ShoppingCart, Tag, Truck, ClipboardList, Microscope } from 'lucide-react';

const tabsByRole = {
    PRODUCCION: [
        { icon: LayoutDashboard, label: 'Inicio', path: '/' },
        { icon: Package, label: 'Inventario', path: '/inventory' },
        { icon: ClipboardList, label: 'Conteo', path: '/inventory/count' },
        { icon: Calendar, label: 'Producción', path: '/production/view' },
        { icon: PlayCircle, label: 'Producir', path: '/production/operator' },
        { icon: FlaskConical, label: 'Premezclas', path: '/premix-panel' },
        { icon: Activity, label: 'RPA', path: '/rpa-history' },
        { icon: Layers, label: 'Lotes', path: '/lots/traceability' },
        { icon: Truck, label: 'Entregas', path: '/production/handoffs' },
    ],
    LOGISTICA: [
        { icon: Package, label: 'Pedidos', path: '/orders' },
        { icon: LayoutDashboard, label: 'Inventario', path: '/inventory' },
        { icon: Layers, label: 'Zonas PT', path: '/production/finished-zone' },
        { icon: ClipboardList, label: 'Conteo', path: '/production/physical-count' },
        { icon: ShoppingCart, label: 'Compras', path: '/procurement/purchase-orders' },
        { icon: Tag, label: 'Etiquetas', path: '/labeling' },
        { icon: Truck, label: 'Entregas', path: '/production/handoffs' },
        { icon: Activity, label: 'Recall', path: '/recall-report' },
        { icon: FlaskConical, label: 'PQR', path: '/pqr/manage' },
    ],
    CARTERA: [
        { icon: LayoutDashboard, label: 'Inventario', path: '/inventory' },
        { icon: ShoppingCart, label: 'Compras', path: '/procurement/purchase-orders' },
        { icon: Truck, label: 'Forecast', path: '/procurement/forecast' },
    ],
    CONTABILIDAD: [
        { icon: ShoppingCart, label: 'Compras', path: '/procurement/purchase-orders' },
        { icon: Truck, label: 'Forecast', path: '/procurement/forecast' },
    ],
    OPERARIO_PICKING: [
        { icon: LayoutDashboard, label: 'Inicio', path: '/' },
        { icon: Package, label: 'Inventario', path: '/inventory' },
        { icon: Calendar, label: 'Producción', path: '/production/view' },
        { icon: PlayCircle, label: 'Producir', path: '/production/operator' },
        { icon: FlaskConical, label: 'Premezclas', path: '/premix-panel' },
        { icon: Activity, label: 'RPA', path: '/rpa-history' },
        { icon: Layers, label: 'Lotes', path: '/lots/traceability' },
        { icon: Tag, label: 'Lotes PT', path: '/production/finished-zone' },
        { icon: Truck, label: 'Entregas', path: '/production/handoffs' },
    ],
    QUIMICO: [
        { icon: LayoutDashboard, label: 'Inicio', path: '/' },
        { icon: Calendar, label: 'Producción', path: '/production/view' },
        { icon: PlayCircle, label: 'Operador', path: '/production/operator' },
        { icon: FlaskConical, label: 'Premezclas', path: '/premix-panel' },
        { icon: Layers, label: 'Lotes', path: '/lots/traceability' },
        { icon: Activity, label: 'PQR', path: '/pqr/manage' },
        { icon: Microscope, label: 'Micro', path: '/micro/dashboard' },
        { icon: ClipboardList, label: 'POES', path: '/sanitation/dashboard' },
    ],
};

const getTabs = (role) => tabsByRole[role] || tabsByRole.PRODUCCION;

const BottomNavBar = ({ userRole }) => (
    <nav className="btm-nav">
        {getTabs(userRole).map((tab) => (
            <NavLink
                key={tab.path}
                to={tab.path}
                end={tab.path === '/'}
                className={({ isActive }) =>
                    `btm-nav__tab ${isActive ? 'btm-nav__tab--active' : ''}`
                }
            >
                <tab.icon size={20} strokeWidth={1.8} />
                <span className="btm-nav__label">{tab.label}</span>
            </NavLink>
        ))}
    </nav>
);

export default BottomNavBar;
