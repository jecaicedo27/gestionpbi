import React, { useState } from 'react';
import { AlertTriangle, Plus } from 'lucide-react';
import InternalPQRForm from '../../components/PQR/InternalPQRForm';
import { useNavigate } from 'react-router-dom';

const InternalPQRCreate = () => {
    const [showForm, setShowForm] = useState(true);
    const navigate = useNavigate();

    const handleSuccess = () => {
        navigate('/internal-pqr/manage');
    };

    const handleClose = () => {
        navigate('/internal-pqr/manage');
    };

    return (
        <div className="p-6">
            <div className="flex items-center gap-2 mb-6">
                <AlertTriangle size={22} className="text-orange-600" />
                <h1 className="text-2xl font-bold text-gray-900">Nuevo PQR Interno</h1>
            </div>
            <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 mb-6 max-w-2xl">
                <p className="text-sm text-orange-800">
                    <strong>¿Cuándo usar un PQR Interno?</strong> Cuando un producto fabricado en planta presenta defectos
                    (deterioro en bodega, mal sellado, producto vencido, etc.) y se requiere un ajuste de inventario.
                    <strong> No se genera nota crédito ni devolución.</strong>
                </p>
            </div>

            {showForm && (
                <InternalPQRForm
                    onClose={handleClose}
                    onSuccess={handleSuccess}
                />
            )}
        </div>
    );
};

export default InternalPQRCreate;
