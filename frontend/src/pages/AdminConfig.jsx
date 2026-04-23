import React, { useState, useEffect } from 'react';
import api from '../services/api';
import ProcessTypeManager from '../components/admin/ProcessTypeManager';
import { Card, Tabs } from 'antd';
import { useZebra } from '../context/ZebraContext';

const AdminConfig = () => {
    const [config, setConfig] = useState({
        targetDays: 8,
        minStockDays: 15,
        alertYellow: 12,
        alertRed: 3,
        syrupRatio: 0.70  // 70% del peso final es jarabe
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState(null);

    useEffect(() => {
        fetchConfig();
    }, []);

    const fetchConfig = async () => {
        try {
            const { data } = await api.get('/config');
            if (data) setConfig(data);
        } catch (error) {
            console.error('Error loading config', error);
        } finally {
            setLoading(false);
        }
    };

    const handleChange = (e) => {
        const { name, value } = e.target;
        const floatFields = ['syrupRatio', 'esfera_output_factor'];
        setConfig(prev => ({
            ...prev,
            [name]: floatFields.includes(name) ? parseFloat(value) : (parseInt(value) || 0)
        }));
    };

    const handleSave = async () => {
        setSaving(true);
        setMessage(null);
        try {
            await api.put('/config', config);
            setMessage({ type: 'success', text: 'Configuración actualizada correctamente.' });
        } catch (error) {
            setMessage({ type: 'error', text: 'Error al guardar.' });
        } finally {
            setSaving(false);
        }
    };

    const { zebraStatus, zebraIp, recheckNow, isRechecking } = useZebra();
    const [zebraConfigIp, setZebraConfigIp] = useState('');
    const [zebraLoading, setZebraLoading] = useState(true);
    const [zebraSaving, setZebraSaving] = useState(false);
    const [zebraMsg, setZebraMsg] = useState(null);

    useEffect(() => {
        (async () => {
            try {
                const token = localStorage.getItem('token');
                const res = await fetch('/api/zebra/config', {
                    headers: token ? { Authorization: `Bearer ${token}` } : {},
                });
                if (res.ok) {
                    const data = await res.json();
                    setZebraConfigIp(data.ip || '');
                }
            } catch {}
            setZebraLoading(false);
        })();
    }, []);

    const saveZebraIp = async () => {
        const ip = zebraConfigIp.trim();
        if (!ip || !/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) {
            setZebraMsg({ type: 'error', text: 'IP inválida. Formato: 192.168.0.108' });
            return;
        }
        setZebraSaving(true);
        setZebraMsg(null);
        try {
            const token = localStorage.getItem('token');
            const res = await fetch('/api/zebra/config', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ ip }),
            });
            if (res.ok) {
                setZebraMsg({ type: 'success', text: `IP actualizada a ${ip}. Todos los dispositivos la usarán.` });
                recheckNow();
            } else {
                const err = await res.json().catch(() => ({}));
                setZebraMsg({ type: 'error', text: err.error || 'Error al guardar' });
            }
        } catch {
            setZebraMsg({ type: 'error', text: 'Error de conexión' });
        }
        setZebraSaving(false);
    };

    const [activeTab, setActiveTab] = useState('liquipops');

    const getFieldName = (baseName) => {
        return activeTab === 'geniality' ? `geniality_${baseName}` : baseName;
    };

    const getValue = (baseName) => {
        const key = getFieldName(baseName);
        return config[key] !== undefined ? config[key] : (activeTab === 'geniality' ? '' : '');
    };

    // Defaults for Geniality if missing
    // We can rely on backend fallback, but for UI nicer to show defaults
    const getDisplayValue = (baseName) => {
        const val = getValue(baseName);
        // Fallback display defaults
        if (val === '' || val === undefined) {
            if (baseName === 'targetDays') return 8;
            if (baseName === 'minStockDays') return 15;
            if (baseName === 'alertYellow') return 12;
            if (baseName === 'alertRed') return 3;
            if (baseName === 'syrupRatio') return 1.0;
            if (baseName === 'batchDuration') return activeTab === 'geniality' ? 240 : 90;
            if (baseName === 'shiftBatchTarget') return 5;
        }
        return val;
    };

    const handleCompanyChange = (e) => {
        const { name, value } = e.target;
        setConfig(prev => ({ ...prev, [name]: value }));
    };

    return (
        <div className="bg-white shadow rounded-lg p-6 max-w-2xl mx-auto my-6">
            {/* ── Company Info Section ── */}
            <h2 className="text-xl font-bold mb-4 text-gray-800">🏢 Datos de la Empresa</h2>
            <p className="text-sm text-gray-600 mb-4">Información que aparece en las Órdenes de Compra (PDF).</p>
            <div className="grid grid-cols-1 gap-4 mb-6">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Razón Social</label>
                    <input type="text" name="companyName" value={config.companyName || ''} onChange={handleCompanyChange}
                        placeholder="POPPING BOBA INTERNATIONAL S.A.S."
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">NIT</label>
                        <input type="text" name="companyNit" value={config.companyNit || ''} onChange={handleCompanyChange}
                            placeholder="901.123.456-7"
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">País / Ciudad</label>
                        <input type="text" name="companyAddress" value={config.companyAddress || ''} onChange={handleCompanyChange}
                            placeholder="Colombia"
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500" />
                    </div>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">📄 Tipo de Factura Siigo</label>
                    <p className="text-xs text-gray-500 mb-2">Seleccione el consecutivo de facturación para los pedidos.</p>
                    <select
                        name="siigoDocumentType"
                        value={config.siigoDocumentType || '9314'}
                        onChange={handleCompanyChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 font-medium"
                    >
                        <option value="9314">FV-1 — Factura (Pruebas)</option>
                        <option value="28531">FV-2 — Factura Electrónica (Producción)</option>
                    </select>
                    <p className="text-xs mt-1" style={{ color: (config.siigoDocumentType || '9314') === '28531' ? '#16a34a' : '#d97706' }}>
                        {(config.siigoDocumentType || '9314') === '28531' 
                            ? '✅ Modo Producción — Las facturas serán electrónicas reales'
                            : '⚠️ Modo Pruebas — Las facturas NO son electrónicas'}
                    </p>
                </div>
                <div className="flex justify-end">
                    <button onClick={handleSave} disabled={saving}
                        className="px-4 py-1.5 bg-blue-600 text-white font-medium text-sm rounded-md hover:bg-blue-700 focus:outline-none disabled:opacity-50">
                        {saving ? 'Guardando...' : 'Guardar'}
                    </button>
                </div>
            </div>

            <hr className="mb-6 border-gray-200" />

            {/* ── Zebra Printer Config ── */}
            <h2 className="text-xl font-bold mb-4 text-gray-800">Impresora Zebra ZD230</h2>
            <p className="text-sm text-gray-600 mb-4">IP centralizada de la impresora de etiquetas. Al cambiarla aquí, todos los dispositivos (tablets, PCs) la usarán automáticamente.</p>

            <div className="bg-violet-50 border border-violet-200 rounded-lg p-4 mb-6">
                <div className="flex items-center gap-3 mb-3">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border ${
                        zebraStatus === 'connected' ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                        : zebraStatus === 'checking' ? 'bg-slate-50 border-slate-200 text-slate-400 animate-pulse'
                        : 'bg-red-50 border-red-200 text-red-500'
                    }`}>
                        {zebraStatus === 'connected' ? `Conectada (${zebraIp})` : zebraStatus === 'checking' ? 'Verificando...' : 'No alcanzable'}
                    </span>
                    <button
                        onClick={recheckNow}
                        disabled={isRechecking}
                        className="text-xs text-violet-600 hover:text-violet-800 font-semibold underline disabled:opacity-50"
                    >
                        {isRechecking ? 'Verificando...' : 'Verificar ahora'}
                    </button>
                </div>

                <div className="flex gap-3 items-end">
                    <div className="flex-1">
                        <label className="block text-sm font-medium text-violet-800 mb-1">IP de la Zebra</label>
                        {zebraLoading ? (
                            <p className="text-xs text-gray-400">Cargando...</p>
                        ) : (
                            <input
                                type="text"
                                value={zebraConfigIp}
                                onChange={e => setZebraConfigIp(e.target.value)}
                                placeholder="192.168.0.108"
                                className="w-full px-3 py-2 border border-violet-300 rounded-md focus:outline-none focus:ring-2 focus:ring-violet-400 bg-white text-sm"
                                onKeyDown={e => e.key === 'Enter' && saveZebraIp()}
                            />
                        )}
                    </div>
                    <button
                        onClick={saveZebraIp}
                        disabled={zebraSaving || zebraLoading}
                        className="px-5 py-2 bg-violet-600 text-white font-semibold text-sm rounded-md hover:bg-violet-700 disabled:opacity-50"
                    >
                        {zebraSaving ? 'Guardando...' : 'Aplicar'}
                    </button>
                </div>

                {zebraMsg && (
                    <div className={`mt-3 p-2.5 rounded text-xs font-medium ${zebraMsg.type === 'success' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
                        {zebraMsg.text}
                    </div>
                )}

                <p className="text-xs text-violet-500 mt-3">
                    Si la IP configurada no responde, el sistema buscará automáticamente la impresora en la red 192.168.0.x
                </p>
            </div>

            <hr className="mb-6 border-gray-200" />

            <h2 className="text-xl font-bold mb-4 text-gray-800">Parámetros de Producción</h2>
            <p className="text-sm text-gray-600 mb-6">Define cómo el sistema calcula las sugerencias y alertas.</p>

            <div className="flex space-x-4 mb-6 border-b border-gray-200">
                <button
                    onClick={() => setActiveTab('liquipops')}
                    className={`pb-2 px-4 font-bold text-sm transition-colors border-b-2 ${activeTab === 'liquipops' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                >
                    Liquipops
                </button>
                <button
                    onClick={() => setActiveTab('geniality')}
                    className={`pb-2 px-4 font-bold text-sm transition-colors border-b-2 ${activeTab === 'geniality' ? 'border-purple-600 text-purple-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                >
                    Geniality (Siropes)
                </button>
                <button
                    onClick={() => setActiveTab('processes')}
                    className={`pb-2 px-4 font-bold text-sm transition-colors border-b-2 ${activeTab === 'processes' ? 'border-orange-600 text-orange-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                >
                    Gestión de Procesos
                </button>
                <button
                    onClick={() => setActiveTab('pqrTypes')}
                    className={`pb-2 px-4 font-bold text-sm transition-colors border-b-2 ${activeTab === 'pqrTypes' ? 'border-red-600 text-red-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                >
                    Tipos PQR
                </button>
            </div>

            {loading ? <p>Cargando...</p> : (
                <div className="animate-fadeIn">
                    {activeTab === 'pqrTypes' ? (
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-red-700 mb-1">📋 Tipos de Reporte PQR</label>
                                <p className="text-xs text-gray-500 mb-3">
                                    <strong>Opciones del selector.</strong> Estos tipos aparecen en el formulario PQR (tanto externo como interno). Puede agregar o quitar tipos según las necesidades.
                                </p>
                                <div className="space-y-2 mb-3">
                                    {(config.pqr_report_types || [
                                        { value: 'CALCIFICACION', label: 'Calcificación' },
                                        { value: 'INFLADO', label: 'Inflado' },
                                        { value: 'ELEMENTO_EXTRANO', label: 'Elemento Extraño' },
                                        { value: 'SABOR_DIFERENTE', label: 'Sabor Diferente' },
                                        { value: 'MAL_SELLADO', label: 'Mal Sellado' },
                                        { value: 'MAL_ETIQUETADO', label: 'Mal Etiquetado' },
                                        { value: 'TARRO_VACIO', label: 'Tarro Vacío' },
                                        { value: 'VENCIDO', label: 'Vencido' },
                                        { value: 'CONTAMINADO', label: 'Contaminado' },
                                        { value: 'OTRO', label: 'Otro' }
                                    ]).map((type, idx) => (
                                        <div key={idx} className="flex items-center gap-2">
                                            <span className="flex-1 px-3 py-2 bg-red-50 border border-red-200 rounded-md text-sm text-red-800 font-medium">
                                                {type.label}
                                            </span>
                                            <span className="px-2 py-1 bg-gray-100 rounded text-xs font-mono text-gray-500">
                                                {type.value}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    const current = config.pqr_report_types || [
                                                        { value: 'CALCIFICACION', label: 'Calcificación' },
                                                        { value: 'INFLADO', label: 'Inflado' },
                                                        { value: 'ELEMENTO_EXTRANO', label: 'Elemento Extraño' },
                                                        { value: 'SABOR_DIFERENTE', label: 'Sabor Diferente' },
                                                        { value: 'MAL_SELLADO', label: 'Mal Sellado' },
                                                        { value: 'MAL_ETIQUETADO', label: 'Mal Etiquetado' },
                                                        { value: 'TARRO_VACIO', label: 'Tarro Vacío' },
                                                        { value: 'VENCIDO', label: 'Vencido' },
                                                        { value: 'CONTAMINADO', label: 'Contaminado' },
                                                        { value: 'OTRO', label: 'Otro' }
                                                    ];
                                                    setConfig(prev => ({
                                                        ...prev,
                                                        pqr_report_types: current.filter((_, i) => i !== idx)
                                                    }));
                                                }}
                                                className="px-2 py-1 text-red-600 hover:bg-red-50 rounded text-lg font-bold"
                                                title="Eliminar tipo">
                                                ✕
                                            </button>
                                        </div>
                                    ))}
                                </div>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        id="newPqrType"
                                        placeholder="Nuevo tipo de reporte..."
                                        className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-red-500 text-sm"
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' && e.target.value.trim()) {
                                                const label = e.target.value.trim();
                                                const value = label.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9]/g, '_');
                                                const current = config.pqr_report_types || [
                                                    { value: 'CALCIFICACION', label: 'Calcificación' },
                                                    { value: 'INFLADO', label: 'Inflado' },
                                                    { value: 'ELEMENTO_EXTRANO', label: 'Elemento Extraño' },
                                                    { value: 'SABOR_DIFERENTE', label: 'Sabor Diferente' },
                                                    { value: 'MAL_SELLADO', label: 'Mal Sellado' },
                                                    { value: 'MAL_ETIQUETADO', label: 'Mal Etiquetado' },
                                                    { value: 'TARRO_VACIO', label: 'Tarro Vacío' },
                                                    { value: 'VENCIDO', label: 'Vencido' },
                                                    { value: 'CONTAMINADO', label: 'Contaminado' },
                                                    { value: 'OTRO', label: 'Otro' }
                                                ];
                                                setConfig(prev => ({
                                                    ...prev,
                                                    pqr_report_types: [...current, { value, label }]
                                                }));
                                                e.target.value = '';
                                            }
                                        }}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const input = document.getElementById('newPqrType');
                                            if (input && input.value.trim()) {
                                                const label = input.value.trim();
                                                const value = label.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9]/g, '_');
                                                const current = config.pqr_report_types || [
                                                    { value: 'CALCIFICACION', label: 'Calcificación' },
                                                    { value: 'INFLADO', label: 'Inflado' },
                                                    { value: 'ELEMENTO_EXTRANO', label: 'Elemento Extraño' },
                                                    { value: 'SABOR_DIFERENTE', label: 'Sabor Diferente' },
                                                    { value: 'MAL_SELLADO', label: 'Mal Sellado' },
                                                    { value: 'MAL_ETIQUETADO', label: 'Mal Etiquetado' },
                                                    { value: 'TARRO_VACIO', label: 'Tarro Vacío' },
                                                    { value: 'VENCIDO', label: 'Vencido' },
                                                    { value: 'CONTAMINADO', label: 'Contaminado' },
                                                    { value: 'OTRO', label: 'Otro' }
                                                ];
                                                setConfig(prev => ({
                                                    ...prev,
                                                    pqr_report_types: [...current, { value, label }]
                                                }));
                                                input.value = '';
                                            }
                                        }}
                                        className="px-4 py-2 bg-red-600 text-white font-bold text-sm rounded-md hover:bg-red-700">
                                        + Agregar
                                    </button>
                                </div>
                                <p className="text-xs text-gray-400 mt-2">Presione Enter o "Agregar". Recuerde guardar cambios.</p>
                            </div>
                            <div className="mt-4 pt-4 border-t border-gray-100 flex justify-end">
                                <button
                                    onClick={handleSave}
                                    disabled={saving}
                                    className="px-6 py-2 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 focus:outline-none disabled:opacity-50"
                                >
                                    {saving ? 'Guardando...' : 'Guardar Cambios'}
                                </button>
                            </div>
                            {message && (
                                <div className={`mt-4 p-3 rounded text-sm ${message.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                    {message.text}
                                </div>
                            )}
                        </div>
                    ) : activeTab === 'processes' ? (
                        <ProcessTypeManager />
                    ) : (
                        <div className="grid grid-cols-1 gap-6">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Días Objetivo de Producción</label>
                                <p className="text-xs text-gray-500 mb-2"><strong>¿Para cuántos días producir?</strong> Si vendes 100 unidades/día y configuras 8 días, el sistema te sugerirá producir 800 unidades.</p>
                                <input
                                    type="number"
                                    name={getFieldName('targetDays')}
                                    value={getDisplayValue('targetDays')}
                                    onChange={handleChange}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Días de Stock Mínimo</label>
                                <p className="text-xs text-gray-500 mb-2"><strong>Colchón de seguridad.</strong> Si tienes inventario para menos de estos días, el sistema marca como crítico. Ejemplo: Con 12 días configurados, si solo tienes para 10 días, se activa alerta.</p>
                                <input
                                    type="number"
                                    name={getFieldName('minStockDays')}
                                    value={getDisplayValue('minStockDays')}
                                    onChange={handleChange}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-amber-600 mb-1">Alerta Amarilla (Días)</label>
                                    <p className="text-xs text-gray-500 mb-2"><strong>Precaución.</strong> Cuando el inventario alcance solo para este número de días, el sabor aparecerá en AMARILLO. Ej: 12 días = tienes casi 2 semanas, pero ya debes planear producción.</p>
                                    <input
                                        type="number"
                                        name={getFieldName('alertYellow')}
                                        value={getDisplayValue('alertYellow')}
                                        onChange={handleChange}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-amber-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-red-600 mb-1">Alerta Roja (Días)</label>
                                    <p className="text-xs text-gray-500 mb-2"><strong>¡URGENTE!</strong> Cuando solo quede inventario para este número de días, el sabor aparecerá en ROJO. Ej: 3 días = debes producir HOY para evitar quiebre de stock.</p>
                                    <input
                                        type="number"
                                        name={getFieldName('alertRed')}
                                        value={getDisplayValue('alertRed')}
                                        onChange={handleChange}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-red-500"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-blue-700 mb-1">Duración del Bache (Minutos)</label>
                                <p className="text-xs text-gray-500 mb-2"><strong>Tiempo de Producción.</strong> Tiempo estimado que toma completar un bache completo en la línea de producción. Se usa para calcular la hora de fin automáticamente en el calendario.</p>
                                <input
                                    type="number"
                                    name={getFieldName('batchDuration')}
                                    value={getDisplayValue('batchDuration')}
                                    onChange={handleChange}
                                    className="w-full px-3 py-2 border border-blue-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 font-bold text-blue-900"
                                />
                            </div>

                            {activeTab === 'liquipops' ? (
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-medium text-blue-700 mb-1">Meta de Baches por Turno</label>
                                        <p className="text-xs text-gray-500 mb-2"><strong>KPI de Turno.</strong> Cantidad de baches esferificados que cada turno debe completar. Se usa para medir el cumplimiento del turno y el banner motivacional del operador.</p>
                                        <input
                                            type="number"
                                            min="1"
                                            max="15"
                                            name="shiftBatchTarget"
                                            value={getDisplayValue('shiftBatchTarget')}
                                            onChange={handleChange}
                                            className="w-full px-3 py-2 border border-blue-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 font-bold text-blue-900"
                                        />
                                        <p className="text-xs text-gray-400 mt-1">Actualmente: {getDisplayValue('shiftBatchTarget')} baches por turno</p>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-purple-700 mb-1">% de Jarabe en Producto Final</label>
                                        <p className="text-xs text-gray-500 mb-2"><strong>Rendimiento del jarabe.</strong> Si un tarro pesa 350gr y este valor es 0.70 (70%), significa que solo necesitas 245gr de jarabe del batch. El 30% restante (105gr) se añade después (líquido protector, etc). Con 120kg de jarabe produces MÁS unidades que antes.</p>
                                        <input
                                            type="number"
                                            step="0.01"
                                            min="0"
                                            max="1"
                                            name="syrupRatio"
                                            value={config.syrupRatio !== undefined ? config.syrupRatio : 0.70}
                                            onChange={handleChange}
                                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-purple-500"
                                        />
                                        <p className="text-xs text-gray-400 mt-1">Valor entre 0 y 1 (ej: 0.70 = 70%)</p>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-emerald-700 mb-1">Factor de Rendimiento ESFERAS</label>
                                        <p className="text-xs text-gray-500 mb-2">
                                            <strong>Aporte del Alginato.</strong> Durante la esferificación, el baño de alginato aporta masa a las esferas. Un factor de 1.10 significa que de 2,250g de Compuesto se obtienen 2,250 × 1.10 = 2,475g de esferas. Ajustar con base en estadísticas reales de producción.
                                        </p>
                                        <input
                                            type="number"
                                            step="0.01"
                                            min="1.0"
                                            max="2.0"
                                            name="esfera_output_factor"
                                            value={config.esfera_output_factor !== undefined ? config.esfera_output_factor : 1.1}
                                            onChange={handleChange}
                                            className="w-full px-3 py-2 border border-emerald-300 rounded-md focus:outline-none focus:ring-1 focus:ring-emerald-500 font-bold text-emerald-900"
                                        />
                                        <p className="text-xs text-gray-400 mt-1">Ej: 1.10 → Esferas = Compuesto × 1.10 (alginato aporta ~10%)</p>
                                    </div>

                                    {/* ── Motivos de Pausa - Esferificación ── */}
                                    <div className="mt-4 pt-4 border-t border-gray-200">
                                        <label className="block text-sm font-medium text-amber-700 mb-1">⏸️ Motivos de Pausa — Esferificación</label>
                                        <p className="text-xs text-gray-500 mb-3">
                                            <strong>Opciones de pausa.</strong> Cuando el operario pausa la esferificación, selecciona uno de estos motivos. Puede agregar o eliminar motivos.
                                        </p>
                                        <div className="space-y-2 mb-3">
                                            {(config.esferificacion_pause_reasons || []).map((reason, idx) => (
                                                <div key={idx} className="flex items-center gap-2">
                                                    <span className="flex-1 px-3 py-2 bg-amber-50 border border-amber-200 rounded-md text-sm text-amber-800 font-medium">
                                                        {reason}
                                                    </span>
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setConfig(prev => ({
                                                                ...prev,
                                                                esferificacion_pause_reasons: (prev.esferificacion_pause_reasons || []).filter((_, i) => i !== idx)
                                                            }));
                                                        }}
                                                        className="px-2 py-1 text-red-600 hover:bg-red-50 rounded text-lg font-bold"
                                                        title="Eliminar motivo">
                                                        ✕
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                        <div className="flex gap-2">
                                            <input
                                                type="text"
                                                id="newPauseReason"
                                                placeholder="Nuevo motivo de pausa..."
                                                className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-amber-500 text-sm"
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter' && e.target.value.trim()) {
                                                        setConfig(prev => ({
                                                            ...prev,
                                                            esferificacion_pause_reasons: [...(prev.esferificacion_pause_reasons || []), e.target.value.trim()]
                                                        }));
                                                        e.target.value = '';
                                                    }
                                                }}
                                            />
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    const input = document.getElementById('newPauseReason');
                                                    if (input && input.value.trim()) {
                                                        setConfig(prev => ({
                                                            ...prev,
                                                            esferificacion_pause_reasons: [...(prev.esferificacion_pause_reasons || []), input.value.trim()]
                                                        }));
                                                        input.value = '';
                                                    }
                                                }}
                                                className="px-4 py-2 bg-amber-600 text-white font-bold text-sm rounded-md hover:bg-amber-700">
                                                + Agregar
                                            </button>
                                        </div>
                                        <p className="text-xs text-gray-400 mt-2">Presione Enter o "Agregar". Recuerde guardar cambios.</p>
                                    </div>

                                    {/* ── Zone Validation Toggle ── */}
                                    <div className="mt-4 pt-4 border-t border-gray-200">
                                        <label className="block text-sm font-medium text-indigo-700 mb-1">🏭 Control Zona de Producción</label>
                                        <p className="text-xs text-gray-500 mb-3">
                                            <strong>Bloqueo por stock en zona.</strong> Cuando está activo, no se puede completar PESAJE ni EMPAQUE si no hay suficiente material ingresado a la zona de producción. Desactivar solo para pruebas.
                                        </p>
                                        <div className="flex items-center gap-3">
                                            <button
                                                type="button"
                                                onClick={() => setConfig(prev => ({
                                                    ...prev,
                                                    zone_validation_enabled: !(prev.zone_validation_enabled !== false)
                                                }))}
                                                className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
                                                    config.zone_validation_enabled !== false
                                                        ? 'bg-indigo-600'
                                                        : 'bg-gray-300'
                                                }`}
                                            >
                                                <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform shadow ${
                                                    config.zone_validation_enabled !== false ? 'translate-x-6' : 'translate-x-1'
                                                }`} />
                                            </button>
                                            <span className={`text-sm font-bold ${config.zone_validation_enabled !== false ? 'text-indigo-700' : 'text-gray-400'}`}>
                                                {config.zone_validation_enabled !== false ? '✅ ACTIVO — Producción bloqueada sin stock en zona' : '⚠️ DESACTIVADO — Bypass para pruebas'}
                                            </span>
                                        </div>
                                        <p className="text-xs text-gray-400 mt-2">Recuerde guardar cambios después de modificar.</p>
                                    </div>
                                </div>
                            ) : (
                                <div className="p-4 bg-gray-50 rounded border border-gray-200">
                                    <label className="block text-sm font-bold text-gray-500 mb-1">Rendimiento (Geniality)</label>
                                    <p className="text-sm text-gray-600">Para Siropes Geniality, el rendimiento es del <strong>100%</strong> (Sin crecimiento). 1 Kg de Jarabe = 1 Kg de Producto.</p>
                                </div>
                            )}

                            <div className="mt-4 pt-4 border-t border-gray-100 flex justify-end">
                                <button
                                    onClick={handleSave}
                                    disabled={saving}
                                    className="px-6 py-2 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 focus:outline-none disabled:opacity-50"
                                >
                                    {saving ? 'Guardando...' : 'Guardar Cambios'}
                                </button>
                            </div>
                            {message && (
                                <div className={`mt-4 p-3 rounded text-sm ${message.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                    {message.text}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default AdminConfig;
