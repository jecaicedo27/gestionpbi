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

import FormulasPage from './pages/FormulasPage';
import FormulaEditorPage from './pages/FormulaEditorPage';
import AssemblyExecutionPage from './pages/AssemblyExecutionPage';
import AssemblyTemplatesPage from './pages/AssemblyTemplatesPage';
import TemplateEditorPage from './pages/TemplateEditorPage';
import ProductionOperatorPage from './pages/ProductionOperatorPage';
import RpaHistoryPage from './pages/RpaHistoryPage';
import MRPDashboard from './pages/MRPDashboard';
import ProductionKpiPage from './pages/ProductionKpiPage';
import BatchHistoryPage from './pages/BatchHistoryPage';
import ProductionAuditPage from './pages/ProductionAuditPage';
import ProductionKardexPage from './pages/ProductionKardexPage';
import ProductionZonePage from './pages/ProductionZonePage';
import FinishedProductZonePage from './pages/FinishedProductZonePage';
import MaterialZonePage from './pages/MaterialZonePage';
import HandoffsPage from './pages/HandoffsPage';
import RecallReportPage from './pages/RecallReportPage';
import ShiftDisciplineHistoryPage from './pages/ShiftDisciplineHistoryPage';
// ── Academia Popping Boba — Escuela de Lideres ──
import AcademiaCatalogo from './pages/Academia/AcademiaCatalogo';
import AcademiaCurso from './pages/Academia/AcademiaCurso';
import AcademiaLeccion from './pages/Academia/AcademiaLeccion';
import AcademiaQuiz from './pages/Academia/AcademiaQuiz';
import AcademiaPerfil from './pages/Academia/AcademiaPerfil';
import AcademiaRanking from './pages/Academia/AcademiaRanking';
import AcademiaSeguimiento from './pages/Academia/Admin/AcademiaSeguimiento';
import AcademiaPanelEvaluacion from './pages/Academia/Admin/AcademiaPanelEvaluacion';
import AcademiaEvaluar from './pages/Academia/Admin/AcademiaEvaluar';
import AcademiaContenido from './pages/Academia/Admin/AcademiaContenido';
import AdminLeaderBonusPage from './pages/AdminLeaderBonusPage';
import TimingAnalysisPage from './pages/TimingAnalysisPage';
import AdminPhysicalInventoryPage from './pages/AdminPhysicalInventoryPage';
import ProductiveTraceabilityPage from './pages/ProductiveTraceability/ProductiveTraceabilityPage';

// ── Geniality Parallel Production System ──
import GenialityTemplatesPage from './pages/Geniality/GenialityTemplatesPage';
import GenialityTemplateEditorPage from './pages/Geniality/GenialityTemplateEditorPage';
import GenialityFormulasPage from './pages/Geniality/GenialityFormulasPage';
import GenialityOperatorPage from './pages/Geniality/GenialityOperatorPage';
import GenialityExecutionPage from './pages/Geniality/GenialityExecutionPage';
import GenialityMonitoringPage from './pages/Geniality/GenialityMonitoringPage';


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
import AttendancePage from './pages/AttendancePage';
import ForensicRecoveryPage from './pages/ForensicRecoveryPage';
import InventoryAuditPage from './pages/InventoryAuditPage';
import MarcajePage from './pages/MarcajePage';

// ── Aseo (Servicios Generales) ──
import CleaningStaffView from './pages/Cleaning/CleaningStaffView';
import CleaningSuppliesView from './pages/Cleaning/CleaningSuppliesView';
import CleaningSupervisorView from './pages/Cleaning/CleaningSupervisorView';
import CleaningAdminView from './pages/Cleaning/CleaningAdminView';


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

    // ── Reintento automático de carritos / etiquetas que fallaron al guardar
    // Si una tablet pierde conexión justo al registrar carrito o imprimir,
    // los datos quedan en localStorage y se reintentan cada 30s. Persistencia
    // a nivel de aplicación, no de tablet individual.
    useEffect(() => {
        const drainQueue = async () => {
            try {
                const apiMod = (await import('./services/api')).default;
                // Carritos
                const carritoQ = JSON.parse(localStorage.getItem('carrito_retry_queue') || '[]');
                const carritoPending = [];
                for (const item of carritoQ) {
                    try {
                        const url = item.endpoint === 'geniality'
                            ? `/geniality/assembly-notes/${item.noteId}/carriots`
                            : `/assembly-notes/${item.noteId}/carriots`;
                        await apiMod.post(url, item);
                        console.log('[retryQueue] ✓ Carrito reintegrado:', item);
                    } catch (e) {
                        carritoPending.push(item);
                    }
                }
                localStorage.setItem('carrito_retry_queue', JSON.stringify(carritoPending));
                // Etiquetas
                const labelsQ = JSON.parse(localStorage.getItem('package_labels_retry_queue') || '[]');
                const labelsPending = [];
                for (const item of labelsQ) {
                    try {
                        await apiMod.post(`/assembly-notes/${item.noteId}/package-labels`, { labels: item.labels });
                        console.log('[retryQueue] ✓ Etiquetas reintegradas:', item.labels.length);
                    } catch (e) {
                        labelsPending.push(item);
                    }
                }
                localStorage.setItem('package_labels_retry_queue', JSON.stringify(labelsPending));
            } catch (e) { console.warn('[retryQueue] error:', e?.message); }
        };
        drainQueue(); // primera al cargar
        const t = setInterval(drainQueue, 30_000);
        return () => clearInterval(t);
    }, []);

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
                    <Route path="/marcaje" element={<MarcajePage />} />
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
                            <Route path="production/kardex" element={<ProductionKardexPage />} />
                            <Route path="production/zone" element={<ProductionZonePage />} />
                            <Route path="production/finished-zone" element={<FinishedProductZonePage />} />
                            <Route path="inventory/material-zones" element={<MaterialZonePage />} />
                            <Route path="production/handoffs" element={<HandoffsPage />} />
                            <Route path="production/physical-count" element={<PhysicalCountPage />} />
                            <Route path="inventory/count" element={<InventoryCountPage />} />
                            <Route path="inventory/audit" element={<InventoryAuditPage />} />
                            <Route path="recall-report" element={<RecallReportPage />} />
                            <Route path="shift-discipline/history" element={<ShiftDisciplineHistoryPage />} />
                            <Route path="admin/leader-bonus" element={<AdminLeaderBonusPage />} />
                            <Route path="admin/timing-analysis" element={<TimingAnalysisPage />} />
                            <Route path="admin/physical-inventory" element={<AdminPhysicalInventoryPage />} />


                            {/* Assembly System - Geniality (Siropes) */}
                            <Route path="geniality/assembly-templates" element={<GenialityTemplatesPage />} />
                            <Route path="geniality/assembly-templates/:id" element={<GenialityTemplateEditorPage />} />
                            <Route path="geniality/formulas" element={<GenialityFormulasPage />} />
                            <Route path="geniality/formulas/new" element={<FormulaEditorPage />} />
                            <Route path="geniality/formulas/:id" element={<FormulaEditorPage />} />
                            <Route path="geniality/operator" element={<GenialityOperatorPage />} />
                            <Route path="geniality/assembly-execution/:id" element={<GenialityExecutionPage />} />
                            <Route path="geniality/monitor" element={<GenialityMonitoringPage />} />


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
                            <Route path="attendance" element={<AttendancePage />} />
                            <Route path="labor-management" element={<Navigate to="/attendance?tab=operation" replace />} />
                            <Route path="recovery/forensic" element={<ForensicRecoveryPage />} />

                            {/* Academia Popping Boba */}
                            <Route path="academia" element={<AcademiaCatalogo />} />
                            <Route path="academia/cursos/:id" element={<AcademiaCurso />} />
                            <Route path="academia/lecciones/:id" element={<AcademiaLeccion />} />
                            <Route path="academia/modulos/:moduleId/quiz" element={<AcademiaQuiz />} />
                            <Route path="academia/perfil" element={<AcademiaPerfil />} />
                            <Route path="academia/ranking" element={<AcademiaRanking />} />
                            <Route path="academia/admin/seguimiento" element={<AcademiaSeguimiento />} />
                            <Route path="academia/admin/evaluaciones" element={<AcademiaPanelEvaluacion />} />
                            <Route path="academia/admin/evaluar/:id" element={<AcademiaEvaluar />} />
                            <Route path="academia/admin/contenido" element={<AcademiaContenido />} />

                            {/* Aseo (Servicios Generales) */}
                            <Route path="aseo" element={<CleaningStaffView />} />
                            <Route path="aseo/insumos" element={<CleaningSuppliesView />} />
                            <Route path="aseo/supervisor" element={<CleaningSupervisorView />} />
                            <Route path="aseo/admin" element={<CleaningAdminView />} />
                        </Route>
                    </Route>
                </Routes>
                </ZebraProvider>
            </AuthProvider>
        </BrowserRouter>
    );
}

export default App;
