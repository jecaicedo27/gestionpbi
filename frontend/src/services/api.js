import axios from 'axios';
import { compressImage } from '../utils/imageCompression.js';

// Create axios instance
const baseURL = (import.meta.env.VITE_API_URL || '').replace(/\/api\/?$/, '').replace(/\/$/, '') + '/api';
const api = axios.create({
    baseURL
});

// Add interceptor to include token and auto-compress images
api.interceptors.request.use(async (config) => {
    const token = localStorage.getItem('token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }

    // Auto-compress any image Files inside FormData
    if (config.data instanceof FormData) {
        const newFormData = new FormData();
        for (const [key, value] of config.data.entries()) {
            if (value instanceof File && value.type.startsWith('image/')) {
                try {
                    const compressed = await compressImage(value);
                    newFormData.append(key, compressed, value.name);
                } catch (err) {
                    newFormData.append(key, value);
                }
            } else {
                newFormData.append(key, value);
            }
        }
        config.data = newFormData;
    }

    return config;
});

export const inventoryService = {
    getDashboard: async () => {
        // For Phase 1 demo we might mock if backend isn't running, but we should try to hit backend.
        // If backend is failing, we can return mock data.
        try {
            const response = await api.get('/inventory/dashboard');
            return response.data;
        } catch (e) {
            console.warn("Backend unreachable, returning mock data");
            return {
                data: {
                    materiasPrimas: [],
                    productoTerminado: {
                        geniality: [{ name: 'Perla Fresa 350g', currentStock: 45, daysOfStock: 12 }],
                        liquipops: [],
                        syrups: [{ name: 'Syrup Mango 360ml', currentStock: 30, daysOfStock: 10 }],
                        baseCitrica: []
                    }
                }
            }
        }
    },
    getReplenishment: async () => {
        const response = await api.get('/analytics/replenishment');
        return response.data;
    },
    updateProductConfig: async (id, data) => {
        const response = await api.post(`/inventory/product/${id}/config`, data);
        return response.data;
    }
};

export default api;
