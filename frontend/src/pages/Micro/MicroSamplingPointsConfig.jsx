import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
    AlertTriangle,
    Layers3,
    MapPinned,
    Plus,
    RefreshCcw
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import MicroSamplingPointFormModal from './components/MicroSamplingPointFormModal';
import MicroSamplingPointCard from './components/MicroSamplingPointCard';

const API = import.meta.env.VITE_API_URL;

const MicroSamplingPointsConfig = ({ onDataChange }) => {
    const { token } = useAuth();
    const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

    const [points, setPoints] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [showForm, setShowForm] = useState(false);
    const [editingPoint, setEditingPoint] = useState(null);

    const fetchPoints = async () => {
        setLoading(true);
        setError('');

        try {
            const response = await axios.get(`${API}/api/micro/sampling-points`, {
                headers,
                params: {
                    includeInactive: true,
                    includeUsage: true
                }
            });

            setPoints(response.data || []);
        } catch (fetchError) {
            setError(fetchError.response?.data?.error || 'No fue posible cargar la configuración de puntos de muestreo.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchPoints();
    }, []);

    const summary = useMemo(() => ({
        total: points.length,
        active: points.filter((point) => point.isActive).length,
        inactive: points.filter((point) => !point.isActive).length,
        withHistory: points.filter((point) => (point.usage?.samples || 0) > 0).length
    }), [points]);

    const openCreateForm = () => {
        setEditingPoint(null);
        setShowForm(true);
    };

    const openEditForm = (point) => {
        setEditingPoint(point);
        setShowForm(true);
    };

    const closeForm = () => {
        setEditingPoint(null);
        setShowForm(false);
    };

    const handleSubmit = async (payload) => {
        setSaving(true);
        setError('');

        try {
            if (editingPoint?.id) {
                await axios.patch(`${API}/api/micro/sampling-points/${editingPoint.id}`, payload, { headers });
            } else {
                await axios.post(`${API}/api/micro/sampling-points`, payload, { headers });
            }

            closeForm();
            await fetchPoints();
            if (typeof onDataChange === 'function') onDataChange();
        } catch (submitError) {
            setError(submitError.response?.data?.error || 'No fue posible guardar el punto de muestreo.');
        } finally {
            setSaving(false);
        }
    };

    const togglePointStatus = async (point) => {
        const nextStatus = !point.isActive;
        const confirmationMessage = nextStatus
            ? `¿Desea habilitar nuevamente el punto ${point.name}?`
            : `¿Desea deshabilitar el punto ${point.name}? No se borrará el historial.`;

        if (!window.confirm(confirmationMessage)) return;

        setSaving(true);
        setError('');

        try {
            await axios.patch(`${API}/api/micro/sampling-points/${point.id}`, {
                isActive: nextStatus
            }, { headers });

            await fetchPoints();
            if (typeof onDataChange === 'function') onDataChange();
        } catch (toggleError) {
            setError(toggleError.response?.data?.error || 'No fue posible actualizar el estado del punto.');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex h-64 items-center justify-center text-slate-400">
                <div className="flex items-center gap-3">
                    <Layers3 className="animate-pulse" size={28} />
                    Cargando configuración de puntos de muestreo...
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div className="flex items-start gap-3">
                    <div className="rounded-2xl bg-gradient-to-br from-cyan-600 via-teal-600 to-emerald-600 p-3 text-white shadow-lg shadow-cyan-200">
                        <MapPinned size={28} />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-slate-900">Configuración de Puntos de Muestreo</h1>
                        <p className="mt-1 text-sm text-slate-500">
                            Cada punto recibe un código de zona automático, único e irrepetible para conservar trazabilidad incluso si luego cambia el nombre o se deshabilita.
                        </p>
                    </div>
                </div>

                <div className="flex flex-wrap gap-2">
                    <button
                        type="button"
                        onClick={fetchPoints}
                        className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                        <RefreshCcw size={16} />
                        Actualizar
                    </button>
                    <button
                        type="button"
                        onClick={openCreateForm}
                        className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
                    >
                        <Plus size={16} />
                        Nuevo punto
                    </button>
                </div>
            </div>

            {error && (
                <div className="flex items-center gap-2 rounded-2xl border border-red-100 bg-red-50 p-3 text-sm text-red-700">
                    <AlertTriangle size={16} />
                    {error}
                </div>
            )}

            <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
                <div className="rounded-2xl border border-slate-100 bg-white px-4 py-4 shadow-sm">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Total puntos</p>
                    <p className="mt-2 text-3xl font-bold text-slate-900">{summary.total}</p>
                </div>
                <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-4 shadow-sm">
                    <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">Activos</p>
                    <p className="mt-2 text-3xl font-bold text-emerald-900">{summary.active}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-100 px-4 py-4 shadow-sm">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-600">Deshabilitados</p>
                    <p className="mt-2 text-3xl font-bold text-slate-800">{summary.inactive}</p>
                </div>
                <div className="rounded-2xl border border-cyan-100 bg-cyan-50 px-4 py-4 shadow-sm">
                    <p className="text-xs font-bold uppercase tracking-wide text-cyan-700">Con historial</p>
                    <p className="mt-2 text-3xl font-bold text-cyan-900">{summary.withHistory}</p>
                </div>
            </div>

            <div className="rounded-3xl border border-slate-100 bg-white shadow-sm overflow-hidden">
                <div className="border-b border-slate-100 bg-gradient-to-r from-slate-50 to-cyan-50 px-5 py-4">
                    <h2 className="font-bold text-slate-900">Directorio maestro de puntos</h2>
                    <p className="mt-1 text-xs text-slate-500">
                        No hay borrado físico. Cuando un punto deja de usarse se deshabilita y conserva su trazabilidad histórica.
                    </p>
                </div>

                <div className="divide-y divide-slate-100">
                    {points.length === 0 ? (
                        <div className="px-6 py-12 text-center text-sm text-slate-500">
                            No hay puntos configurados todavía.
                        </div>
                    ) : (
                        points.map((point) => (
                            <MicroSamplingPointCard
                                key={point.id}
                                point={point}
                                saving={saving}
                                onEdit={openEditForm}
                                onToggleStatus={togglePointStatus}
                            />
                        ))
                    )}
                </div>
            </div>

            {showForm && (
                <MicroSamplingPointFormModal
                    point={editingPoint}
                    saving={saving}
                    onClose={closeForm}
                    onSubmit={handleSubmit}
                />
            )}
        </div>
    );
};

export default MicroSamplingPointsConfig;
