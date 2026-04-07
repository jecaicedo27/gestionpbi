import api from '../services/api';

export const getSanitationConfig = async () => {
    const response = await api.get('/sanitation/config');
    return response.data;
};

export const listSanitationRecords = async (params) => {
    const response = await api.get('/sanitation/records', { params });
    return response.data;
};

export const createSanitationRecord = async (data) => {
    const response = await api.post('/sanitation/records', data);
    return response.data;
};

export const verifySanitationRecord = async (id, verifiedById) => {
    const response = await api.patch(`/sanitation/records/${id}/verify`, { verifiedById });
    return response.data;
};

// --- Configuración Admin ---
export const createSanitationArea = async (data) => {
    const response = await api.post('/sanitation/areas', data);
    return response.data;
};

export const updateSanitationArea = async (id, data) => {
    const response = await api.put(`/sanitation/areas/${id}`, data);
    return response.data;
};

export const createSanitationChemical = async (data) => {
    const response = await api.post('/sanitation/chemicals', data);
    return response.data;
};

export const updateSanitationChemical = async (id, data) => {
    const response = await api.put(`/sanitation/chemicals/${id}`, data);
    return response.data;
};

// --- Componentes de Equipos ---
export const createSanitationComponent = async (data) => {
    const response = await api.post('/sanitation/components', data);
    return response.data;
};

export const updateSanitationComponent = async (id, data) => {
    const response = await api.put(`/sanitation/components/${id}`, data);
    return response.data;
};

// --- Upload de foto de evidencia ---
export const uploadSanitationPhoto = async (file) => {
    const formData = new FormData();
    formData.append('photo', file);
    const response = await api.post('/uploads/evidence', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
    });
    return response.data; // { url, filename }
};

export const updateCheckItem = async (id, data) => {
    const response = await api.put(`/sanitation/check-items/${id}`, data);
    return response.data;
};
