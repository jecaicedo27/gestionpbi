import api from '../services/api';

// Personal de aseo
export const listStaff = () => api.get('/cleaning/staff').then(r => r.data);

// Zonas
export const listZones = () => api.get('/cleaning/zones').then(r => r.data);
export const createZone = (data) => api.post('/cleaning/zones', data).then(r => r.data);
export const updateZone = (id, data) => api.put(`/cleaning/zones/${id}`, data).then(r => r.data);

// Tareas
export const listTasks = (params = {}) => api.get('/cleaning/tasks', { params }).then(r => r.data);
export const createTask = (data) => api.post('/cleaning/tasks', data).then(r => r.data);
export const updateTask = (id, data) => api.put(`/cleaning/tasks/${id}`, data).then(r => r.data);
export const deleteTask = (id) => api.delete(`/cleaning/tasks/${id}`).then(r => r.data);
export const assignExtraTask = (data) => api.post('/cleaning/tasks/extra', data).then(r => r.data);

// Ejecuciones
export const getTodayTasks = () => api.get('/cleaning/today').then(r => r.data);
export const startExecution = (id) => api.post(`/cleaning/executions/${id}/start`).then(r => r.data);
export const completeExecution = (id, data) => api.post(`/cleaning/executions/${id}/complete`, data).then(r => r.data);
export const skipExecution = (id, data) => api.post(`/cleaning/executions/${id}/skip`, data).then(r => r.data);

// Verificación
export const listPendingVerifications = () => api.get('/cleaning/verifications/pending').then(r => r.data);
export const verifyExecution = (id, data) => api.post(`/cleaning/executions/${id}/verify`, data).then(r => r.data);

// Insumos
export const listSupplies = () => api.get('/cleaning/supplies').then(r => r.data);
export const createSupply = (data) => api.post('/cleaning/supplies', data).then(r => r.data);
export const updateSupply = (id, data) => api.put(`/cleaning/supplies/${id}`, data).then(r => r.data);
export const reportSupplyLow = (id, data) => api.post(`/cleaning/supplies/${id}/alert`, data).then(r => r.data);
export const listAlerts = (params = {}) => api.get('/cleaning/alerts', { params }).then(r => r.data);
export const resolveAlert = (id) => api.put(`/cleaning/alerts/${id}/resolve`).then(r => r.data);

// Reportes
export const getDailyReport = (date) => api.get('/cleaning/reports/daily', { params: date ? { date } : {} }).then(r => r.data);
export const getWeeklyReport = (params = {}) => api.get('/cleaning/reports/weekly', { params }).then(r => r.data);
export const regenerateToday = () => api.post('/cleaning/regenerate-today').then(r => r.data);
