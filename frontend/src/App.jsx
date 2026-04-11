import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
// QueryClientProvider moved to main.jsx
import { AuthProvider } from './context/AuthContext';
import { ZebraProvider } from './context/ZebraContext';
import ProtectedRoute from './components/common/ProtectedRoute';
import Login from './pages/Login';
import Layout from './components/common/Layout';
import Dashboard from './pages/Dashboard';
import Shop from './pages/shop/Shop';
// Orders.jsx deleted — replaced by OrderManagement.jsx
import Production from './pages/Production';

import Labeling from './pages/Labeling';

import Inventory from './pages/Inventory';
import Users from './pages/admin/Users';
import Reports from './pages/admin/Reports';
import ExecutiveAnalysis from './pages/ExecutiveAnalysis';
import Replenishment from './pages/admin/Replenishment';
import ProductionScheduler from './pages/ProductionScheduler'; // New
import AdminConfig from './pages/AdminConfig';
import DistributorPortal from './pages/DistributorPortal'; // NEW
import OrderManagement from './pages/OrderManagement'; // NEW

import AssemblyTemplatesPage from './pages/AssemblyTemplatesPage';
import TemplateEditorPage from './pages/TemplateEditorPage';
import FormulasPage from './pages/FormulasPage';
import FormulaEditorPage from './pages/FormulaEditorPage';
import AssemblyExecutionPage from './pages/AssemblyExecutionPage';
import ProductionOperatorPage from './pages/ProductionOperatorPage';
import RpaHistoryPage from './pages/RpaHistoryPage';
import MRPDashboard from './pages/MRPDashboard';
import ProductionKpiPage from './pages/ProductionKpiPage';
import BatchHistoryPage from './pages/BatchHistoryPage';
import ProductionAuditPage from './pages/ProductionAuditPage';
import ProductionZonePage from './pages/ProductionZonePage';
import FinishedProductZonePage from './pages/FinishedProductZonePage';
import HandoffsPage from './pages/HandoffsPage';
import RecallReportPage from './pages/RecallReportPage';
import ProductiveTraceabilityPage from './pages/ProductiveTraceability/ProductiveTraceabilityPage';

// ── Geniality Parallel Production System ──
import GenialityTemplatesPage from './pages/Geniality/GenialityTemplatesPage';
import GenialityTemplateEditorPage from './pages/Geniality/GenialityTemplateEditorPage';
import GenialityFormulasPage from './pages/Geniality/GenialityFormulasPage';
import GenialityOperatorPage from './pages/Geniality/GenialityOperatorPage';
import GenialityExecutionPage from './pages/Geniality/GenialityExecutionPage';


import MovementsPage from './pages/MovementsPage';
import LotTraceabilityPage from './pages/LotTraceabilityPage';

import PQRDistributor from './pages/PQR/PQRDistributor';
import PQRManagement from './pages/PQR/PQRManagement';
import PQRDashboard from './pages/PQR/PQRDashboard';
import PQRAdvancedValidation from './pages/PQR/PQRAdvancedValidation';
import InternalPQRManagement from './pages/PQR/InternalPQRManagement';
import InternalPQRCreate from './pages/PQR/InternalPQRCreate';

import MicroModulePage from './pages/Micro/MicroModulePage';

// ── Sanitación (POES) ──
import SanitationDashboard from './pages/Sanitation/SanitationDashboard';
import SanitationForm from './pages/Sanitation/SanitationForm';
import SanitationConfig from './pages/Sanitation/SanitationConfig';

import ForecastPage from './pages/ForecastPage';
import PurchaseOrdersPage from './pages/PurchaseOrdersPage';
import SuppliersPage from './pages/SuppliersPage';
import PremixQuickPanel from './pages/PremixQuickPanel';
import ReconciliationPage from './pages/ReconciliationPage';
import PhysicalCountPage from './pages/PhysicalCountPage';
import InventoryCountPage from './pages/InventoryCountPage';
import SalesAnalyticsDashboard from './pages/SalesAnalyticsDashboard';
import ShiftSchedulePage from './pages/ShiftSchedulePage';


import { useEffect } from 'react';
import { io } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';

// Initialize Socket outside component to prevent multiple connections
const socket = io(import.meta.env.VITE_POPPING_SOCKET_URL || undefined, {
    path: '/socket.io',
    transports: ['websocket', 'polling']
});

function App() {
    const queryClient = useQueryClient();

    useEffect(() => {
        socket.on('connect', () => console.log('Connected to WebSocket'));

        socket.on('inventory:updated', () => {
            console.log('Real-time update received');
            queryClient.invalidateQueries({ queryKey: ['inventory'] });
            queryClient.invalidateQueries({ queryKey: ['orders'] });
        });

        socket.on('siigo:event', (data) => {
            console.log('Siigo Event:', data);
            // Optionally show toast notification
        });

        return () => {
            socket.off('inventory:updated');
            socket.off('siigo:event');
        };
    }, [queryClient]);

    return (
        <BrowserRouter>
            <AuthProvider>
                <ZebraProvider>
                <Routes>
                    <Route path="/login" element={<Login />} />
                    <Route element={<ProtectedRoute />}>
                        <Route path="/" element={<Layout />}>
                            <Route index element={<Dashboard />} />
                            <Route path="shop" element={<DistributorPortal />} />
                            <Route path="orders" element={<OrderManagement />} />
                            <Route path="inventory" element={<Inventory />} />
                            <Route path="lots/traceability" element={<LotTraceabilityPage />} />
                            <Route path="premix-panel" element={<PremixQuickPanel />} />
                            <Route path="production" element={<Production />} />
                            <Route path="production/schedule" element={<ProductionScheduler />} /> {/* New */}
                            <Route path="production/view" element={<ProductionScheduler readOnly />} />
                            <Route path="admin/config" element={<AdminConfig />} />
                            <Route path="labeling" element={<Labeling />} />


                            {/* Assembly System - Liquipops */}
                            <Route path="assembly-templates" element={<AssemblyTemplatesPage />} />
                            <Route path="assembly-templates/:id" element={<TemplateEditorPage />} />
                            <Route path="formulas" element={<FormulasPage />} />
                            <Route path="formulas/:id" element={<FormulaEditorPage />} />
                            <Route path="assembly-execution/:id" element={<AssemblyExecutionPage />} />
                            <Route path="rpa-history" element={<RpaHistoryPage />} />
                            <Route path="production/operator" element={<ProductionOperatorPage />} />
                            <Route path="mrp" element={<MRPDashboard />} />
                            <Route path="production/kpis" element={<ProductionKpiPage />} />
                            <Route path="production/batch-history" element={<BatchHistoryPage />} />
                            <Route path="production/audit" element={<ProductionAuditPage />} />
                            <Route path="production/zone" element={<ProductionZonePage />} />
                            <Route path="production/finished-zone" element={<FinishedProductZonePage />} />
                            <Route path="production/handoffs" element={<HandoffsPage />} />
                            <Route path="production/physical-count" element={<PhysicalCountPage />} />
                            <Route path="inventory/count" element={<InventoryCountPage />} />
                            <Route path="recall-report" element={<RecallReportPage />} />


                            {/* Assembly System - Geniality (Siropes) */}
                            <Route path="geniality/assembly-templates" element={<GenialityTemplatesPage />} />
                            <Route path="geniality/assembly-templates/:id" element={<GenialityTemplateEditorPage />} />
                            <Route path="geniality/formulas" element={<GenialityFormulasPage />} />
                            <Route path="geniality/formulas/new" element={<FormulaEditorPage />} />
                            <Route path="geniality/formulas/:id" element={<FormulaEditorPage />} />
                            <Route path="geniality/operator" element={<GenialityOperatorPage />} />
                            <Route path="geniality/assembly-execution/:id" element={<GenialityExecutionPage />} />


                            <Route path="admin/users" element={<Users />} />
                            <Route path="admin/reports" element={<Reports />} />
                            <Route path="admin/replenishment" element={<Replenishment />} />
                            <Route path="admin/orders" element={<OrderManagement />} /> {/* NEW */}
                            <Route path="distributor/portal" element={<DistributorPortal />} /> {/* NEW */}
                            <Route path="analytics/executive" element={<ExecutiveAnalysis />} />
                            <Route path="analytics/sales" element={<SalesAnalyticsDashboard />} />

                            <Route path="admin/movements" element={<MovementsPage />} />
                            <Route path="pqr/list" element={<PQRDistributor />} />
                            <Route path="pqr/manage" element={<PQRManagement />} />
                            <Route path="pqr/dashboard" element={<PQRDashboard />} />
                            <Route path="pqr/advanced-validation" element={<PQRAdvancedValidation />} />
                            <Route path="internal-pqr/create" element={<InternalPQRCreate />} />
                            <Route path="internal-pqr/manage" element={<InternalPQRManagement />} />
                            <Route path="quality/productive-traceability" element={<ProductiveTraceabilityPage />} />

                            <Route path="micro" element={<Navigate to="/micro/dashboard" replace />} />
                            <Route path="micro/dashboard" element={<MicroModulePage />} />
                            <Route path="micro/trends" element={<Navigate to="/micro/dashboard?tab=trends" replace />} />

                            <Route path="sanitation/dashboard" element={<SanitationDashboard />} />
                            <Route path="sanitation/operator" element={<SanitationForm />} />
                            <Route path="sanitation/config" element={<SanitationConfig />} />

                            {/* Procurement System */}
                            <Route path="procurement/forecast" element={<ForecastPage />} />
                            <Route path="procurement/purchase-orders" element={<PurchaseOrdersPage />} />
                            <Route path="procurement/suppliers" element={<SuppliersPage />} />
                            <Route path="reconciliation" element={<ReconciliationPage />} />
                            <Route path="shift-schedule" element={<ShiftSchedulePage />} />
                        </Route>
                    </Route>
                </Routes>
                </ZebraProvider>
            </AuthProvider>
        </BrowserRouter>
    );
}

export default App;
