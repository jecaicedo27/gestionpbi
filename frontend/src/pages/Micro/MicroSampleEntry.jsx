import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '../../context/AuthContext';
import { X, FlaskConical, Upload, Save, Info, FileText, ExternalLink, Eye, Pencil } from 'lucide-react';

const API = import.meta.env.VITE_API_URL;

const MicroSampleEntry = ({ preselectedPoint, existingSampleId, onClose, onSuccess }) => {
    const { token } = useAuth();
    const headers = { Authorization: `Bearer ${token}` };

    const isEditMode = !!existingSampleId;

    const [points, setPoints] = useState([]);
    const [params, setParams] = useState([]);
    const [loading, setLoading] = useState(false);
    const [fetchingData, setFetchingData] = useState(false);
    const [error, setError] = useState('');
    const [successMsg, setSuccessMsg] = useState('');

    // Form State
    const [samplingPointId, setSamplingPointId] = useState(preselectedPoint?.pointId || '');
    const [takenAt, setTakenAt] = useState(preselectedPoint?.date || new Date().toISOString().split('T')[0]);
    const [lotNumber, setLotNumber] = useState('');
    const [batchCode, setBatchCode] = useState('');
    const [sampleDescription, setSampleDescription] = useState('');
    const [lab, setLab] = useState('');
    const [reportNumber, setReportNumber] = useState('');
    const [notes, setNotes] = useState('');
    const [reportFile, setReportFile] = useState(null);
    const [existingReportUrl, setExistingReportUrl] = useState('');
    const [sampleNumber, setSampleNumber] = useState('');
    const [results, setResults] = useState([]);

    useEffect(() => {
        const fetchConfig = async () => {
            setFetchingData(true);
            try {
                const [pRes, parRes] = await Promise.all([
                    axios.get(`${API}/api/micro/sampling-points`, { headers }),
                    axios.get(`${API}/api/micro/parameters`, { headers })
                ]);
                setPoints(pRes.data);
                const allParams = parRes.data;
                setParams(allParams);

                if (isEditMode) {
                    // Fetch existing sample data
                    const sampleRes = await axios.get(`${API}/api/micro/samples/${existingSampleId}`, { headers });
                    const sample = sampleRes.data;

                    // Populate form fields
                    setSamplingPointId(sample.samplingPointId);
                    setTakenAt(new Date(sample.takenAt).toISOString().split('T')[0]);
                    setLotNumber(sample.lotNumber || '');
                    setBatchCode(sample.batchCode || '');
                    setSampleDescription(sample.sampleDescription || '');
                    setLab(sample.lab || '');
                    setReportNumber(sample.reportNumber || '');
                    setNotes(sample.notes || '');
                    setExistingReportUrl(sample.reportUrl || '');
                    setSampleNumber(sample.sampleNumber || '');

                    // Merge existing results with all parameters
                    const mergedResults = allParams.map(p => {
                        const existing = sample.results.find(r => r.parameterId === p.id);
                        return {
                            parameterId: p.id,
                            parameterCode: p.code,
                            parameterName: p.name,
                            unit: p.unit,
                            specMin: p.specMin,
                            specMax: p.specMax,
                            specText: p.specText,
                            value: existing?.value !== null && existing?.value !== undefined ? String(existing.value) : '',
                            valueText: existing?.valueText || '',
                            isDetected: existing?.isDetected ?? null,
                            isCompliant: existing?.isCompliant ?? null,
                            notes: existing?.notes || ''
                        };
                    });
                    setResults(mergedResults);
                } else {
                    // Initialize empty results for all params (create mode)
                    setResults(allParams.map(p => ({
                        parameterId: p.id,
                        parameterCode: p.code,
                        parameterName: p.name,
                        unit: p.unit,
                        specMin: p.specMin,
                        specMax: p.specMax,
                        specText: p.specText,
                        value: '',
                        valueText: '',
                        isDetected: null,
                        notes: ''
                    })));
                }
            } catch (err) {
                setError('Error cargando configuración');
            } finally {
                setFetchingData(false);
            }
        };
        fetchConfig();
    }, []);

    const handleSubmit = async () => {
        if (!isEditMode && !samplingPointId) { alert('Seleccione un punto de muestreo'); return; }

        const filledResults = results.filter(r =>
            r.value !== '' || r.valueText !== '' || r.isDetected !== null
        );

        if (!isEditMode && filledResults.length === 0) {
            if (!confirm('No ingresó ningún resultado. ¿Desea crear la muestra sin resultados (pendiente)?')) return;
        }

        setLoading(true);
        setError('');
        setSuccessMsg('');
        try {
            const formData = new FormData();

            if (isEditMode) {
                // Edit mode — PATCH
                if (lab) formData.append('lab', lab);
                if (reportNumber) formData.append('reportNumber', reportNumber);
                if (notes) formData.append('notes', notes);
                if (reportFile) formData.append('report', reportFile);

                if (filledResults.length > 0) {
                    formData.append('results', JSON.stringify(filledResults.map(r => ({
                        parameterId: r.parameterId,
                        value: r.value !== '' ? parseFloat(r.value) : null,
                        valueText: r.valueText || null,
                        isDetected: r.isDetected,
                        notes: r.notes || null
                    }))));
                }

                await axios.patch(`${API}/api/micro/samples/${existingSampleId}/results`, formData, {
                    headers: { ...headers, 'Content-Type': 'multipart/form-data' }
                });
                setSuccessMsg('✓ Muestra actualizada correctamente');
                setTimeout(() => onSuccess(), 800);
            } else {
                // Create mode — POST
                formData.append('samplingPointId', samplingPointId);
                formData.append('takenAt', new Date(takenAt).toISOString());
                if (lotNumber) formData.append('lotNumber', lotNumber);
                if (batchCode) formData.append('batchCode', batchCode);
                if (sampleDescription) formData.append('sampleDescription', sampleDescription);
                if (lab) formData.append('lab', lab);
                if (reportNumber) formData.append('reportNumber', reportNumber);
                if (notes) formData.append('notes', notes);
                if (reportFile) formData.append('report', reportFile);

                if (filledResults.length > 0) {
                    formData.append('results', JSON.stringify(filledResults.map(r => ({
                        parameterId: r.parameterId,
                        value: r.value !== '' ? parseFloat(r.value) : null,
                        valueText: r.valueText || null,
                        isDetected: r.isDetected,
                        notes: r.notes || null
                    }))));
                }

                await axios.post(`${API}/api/micro/samples`, formData, {
                    headers: { ...headers, 'Content-Type': 'multipart/form-data' }
                });
                onSuccess();
            }
        } catch (err) {
            setError(err.response?.data?.error || 'Error al guardar muestra');
        } finally {
            setLoading(false);
        }
    };

    const updateResult = (index, field, value) => {
        setResults(prev => {
            const updated = [...prev];
            updated[index] = { ...updated[index], [field]: value };
            return updated;
        });
    };

    const isQualitative = (r) => r.specText === 'Ausente';

    if (fetchingData) return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl p-8 flex flex-col items-center gap-3">
                <FlaskConical className="animate-pulse text-teal-600" size={32} />
                <p className="text-gray-600 text-sm font-medium">Cargando datos de la muestra...</p>
            </div>
        </div>
    );

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] overflow-hidden flex flex-col">
                {/* Header */}
                <div className={`px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gradient-to-r ${isEditMode ? 'from-blue-600 to-indigo-700' : 'from-teal-600 to-emerald-700'}`}>
                    <div className="flex items-center gap-3 text-white">
                        <div className="p-2 bg-white/20 rounded-lg">
                            {isEditMode ? <Eye size={22} /> : <FlaskConical size={22} />}
                        </div>
                        <div>
                            <h2 className="text-lg font-bold">
                                {isEditMode ? 'Ver / Editar Muestra' : 'Registrar Muestra Microbiológica'}
                            </h2>
                            <p className={`text-xs ${isEditMode ? 'text-blue-100' : 'text-teal-100'}`}>
                                {isEditMode && sampleNumber
                                    ? `${sampleNumber} — Revise y corrija los datos si es necesario`
                                    : preselectedPoint
                                        ? `${preselectedPoint.code} — ${preselectedPoint.pointName}`
                                        : 'Ingrese datos de la muestra y resultados del laboratorio'}
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} className={`p-2 rounded-full hover:bg-white/10 ${isEditMode ? 'text-blue-100 hover:text-white' : 'text-teal-100 hover:text-white'}`}><X size={22} /></button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    {error && (
                        <div className="bg-red-50 text-red-700 p-3 rounded-xl border border-red-100 text-sm flex items-center gap-2">
                            <Info size={16} /> {error}
                        </div>
                    )}
                    {successMsg && (
                        <div className="bg-green-50 text-green-700 p-3 rounded-xl border border-green-100 text-sm flex items-center gap-2">
                            <Info size={16} /> {successMsg}
                        </div>
                    )}

                    {/* Sample Info */}
                    <div className="bg-gray-50 rounded-xl p-5 border border-gray-100">
                        <h3 className="font-bold text-gray-700 text-sm uppercase tracking-wider mb-4">Información de la Muestra</h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            <div>
                                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Punto de Muestreo *</label>
                                <select value={samplingPointId} onChange={e => setSamplingPointId(e.target.value)}
                                    disabled={isEditMode}
                                    className={`w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm focus:ring-2 focus:ring-teal-400 focus:border-teal-400 outline-none appearance-auto ${isEditMode ? 'bg-gray-100 cursor-not-allowed opacity-75' : 'cursor-pointer'}`}>
                                    <option value="">Seleccionar...</option>
                                    {points.map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Fecha de Toma</label>
                                <input type="date" value={takenAt} onChange={e => setTakenAt(e.target.value)}
                                    disabled={isEditMode}
                                    className={`w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm focus:ring-2 focus:ring-teal-400 focus:border-teal-400 outline-none ${isEditMode ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`} />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Lote</label>
                                <input type="text" value={lotNumber} onChange={e => setLotNumber(e.target.value)} placeholder="Ej: L260126"
                                    disabled={isEditMode}
                                    className={`w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm focus:ring-2 focus:ring-teal-400 focus:border-teal-400 outline-none ${isEditMode ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`} />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Código de Batch</label>
                                <input type="text" value={batchCode} onChange={e => setBatchCode(e.target.value)} placeholder="Opcional"
                                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm focus:ring-2 focus:ring-teal-400 focus:border-teal-400 outline-none" />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Laboratorio</label>
                                <select value={lab} onChange={e => setLab(e.target.value)}
                                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm focus:ring-2 focus:ring-teal-400 focus:border-teal-400 outline-none appearance-auto cursor-pointer">
                                    <option value="">Seleccionar...</option>
                                    <option value="Biotrends">Biotrends Laboratorios</option>
                                    <option value="Confía Control">Confía Control S.A.S</option>
                                    <option value="UniNacional">Universidad Nacional</option>
                                    <option value="Otro">Otro</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">N° Informe</label>
                                <input type="text" value={reportNumber} onChange={e => setReportNumber(e.target.value)} placeholder="Ej: M-26-27561-0"
                                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm focus:ring-2 focus:ring-teal-400 focus:border-teal-400 outline-none" />
                            </div>
                        </div>
                        <div className="mt-4">
                            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Descripción de Muestra</label>
                            <input type="text" value={sampleDescription} onChange={e => setSampleDescription(e.target.value)}
                                placeholder="Ej: Alginato post-pasteurización, tanque 1"
                                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm focus:ring-2 focus:ring-teal-400 focus:border-teal-400 outline-none" />
                        </div>
                    </div>

                    {/* Results Entry */}
                    <div className="bg-white rounded-xl border border-teal-100 overflow-hidden">
                        <div className="bg-teal-50 px-5 py-3 border-b border-teal-100">
                            <h3 className="font-bold text-teal-800 text-sm flex items-center gap-2">
                                <FlaskConical size={16} /> Resultados Microbiológicos
                            </h3>
                            <p className="text-xs text-teal-600 mt-0.5">
                                {isEditMode
                                    ? 'Revise los resultados actuales. Puede modificar los valores para corregir.'
                                    : 'Complete solo los parámetros analizados. Los campos vacíos se ignoran.'}
                            </p>
                        </div>
                        <div className="divide-y divide-gray-50">
                            {results.map((r, i) => (
                                <div key={r.parameterId} className={`px-5 py-3 hover:bg-gray-50/50 ${isEditMode && (r.value !== '' || r.isDetected !== null) ? 'bg-blue-50/30' : ''}`}>
                                    <div className="flex items-center gap-4">
                                        <div className="w-48 shrink-0">
                                            <p className="text-sm font-bold text-gray-800">{r.parameterName}</p>
                                            <p className="text-[10px] text-gray-400">{r.unit}
                                                {r.specMax && <span className="ml-1">• m:{r.specMin} M:{r.specMax}</span>}
                                                {r.specText && <span className="ml-1">• {r.specText}</span>}
                                            </p>
                                        </div>
                                        {isQualitative(r) ? (
                                            <div className="flex items-center gap-3">
                                                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                                                    <input type="radio" name={`detect_${i}`} checked={r.isDetected === false}
                                                        onChange={() => updateResult(i, 'isDetected', false)}
                                                        className="text-green-600 focus:ring-green-400" />
                                                    <span className="text-green-700 font-medium">Ausente ✓</span>
                                                </label>
                                                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                                                    <input type="radio" name={`detect_${i}`} checked={r.isDetected === true}
                                                        onChange={() => updateResult(i, 'isDetected', true)}
                                                        className="text-red-600 focus:ring-red-400" />
                                                    <span className="text-red-700 font-medium">Detectado ✗</span>
                                                </label>
                                            </div>
                                        ) : (
                                            <div className="flex items-center gap-3 flex-1">
                                                <input type="number" value={r.value}
                                                    onChange={e => updateResult(i, 'value', e.target.value)}
                                                    placeholder="Valor numérico"
                                                    className={`w-36 rounded-lg border px-3 py-1.5 text-sm focus:ring-2 outline-none ${r.value !== '' && r.specMax && parseFloat(r.value) > r.specMax
                                                        ? 'border-red-300 bg-red-50 focus:ring-red-400 text-red-800 font-bold'
                                                        : 'border-gray-200 focus:ring-teal-400'
                                                        }`} />
                                                <input type="text" value={r.valueText}
                                                    onChange={e => updateResult(i, 'valueText', e.target.value)}
                                                    placeholder="Texto (ej: <10)"
                                                    className="w-28 rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:ring-2 focus:ring-teal-400 outline-none" />
                                                {r.value !== '' && r.specMax && (
                                                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${parseFloat(r.value) <= r.specMin ? 'bg-green-100 text-green-700' :
                                                        parseFloat(r.value) <= r.specMax ? 'bg-amber-100 text-amber-700' :
                                                            'bg-red-100 text-red-700'
                                                        }`}>
                                                        {parseFloat(r.value) <= r.specMin ? '✓ Aceptable' :
                                                            parseFloat(r.value) <= r.specMax ? '⚠ Marginal' : '✗ No Conforme'}
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* PDF Upload + Notes */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                            <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">Informe PDF (Laboratorio)</label>

                            {/* Show existing report link if available */}
                            {existingReportUrl && (
                                <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded-xl">
                                    <p className="text-xs font-semibold text-blue-700 mb-1.5 flex items-center gap-1.5">
                                        <FileText size={14} /> Documento actual:
                                    </p>
                                    <a href={`${API}${existingReportUrl}`}
                                        target="_blank" rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition-colors shadow-sm">
                                        <ExternalLink size={12} /> Ver PDF del Laboratorio
                                    </a>
                                </div>
                            )}

                            <div className={`border-2 rounded-xl p-3 transition-all ${reportFile ? 'border-teal-400 bg-teal-50/50' : 'border-dashed border-gray-300'}`}>
                                <p className="text-xs text-gray-500 mb-1.5">
                                    {existingReportUrl ? 'Subir nuevo PDF (reemplaza el actual):' : 'Seleccionar archivo:'}
                                </p>
                                <input type="file" accept="application/pdf" onChange={e => setReportFile(e.target.files[0])}
                                    className="block w-full text-xs text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-teal-600 file:text-white hover:file:bg-teal-700 cursor-pointer" />
                                {reportFile && <p className="text-xs text-teal-700 mt-1 flex items-center gap-1"><FileText size={12} />{reportFile.name}</p>}
                            </div>
                        </div>
                        <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                            <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">Notas / Observaciones</label>
                            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows="3"
                                placeholder="Observaciones relevantes de la muestra..."
                                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm focus:ring-2 focus:ring-teal-400 focus:border-teal-400 outline-none resize-none" />
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="p-5 border-t border-gray-100 flex justify-end gap-3">
                    <button onClick={onClose} disabled={loading}
                        className="px-5 py-2.5 border border-gray-200 rounded-xl text-gray-600 font-medium hover:bg-gray-50">Cancelar</button>
                    <button onClick={handleSubmit} disabled={loading || (!isEditMode && !samplingPointId)}
                        className={`px-6 py-2.5 text-white rounded-xl font-medium shadow-lg disabled:opacity-50 flex items-center gap-2 ${isEditMode
                            ? 'bg-gradient-to-r from-blue-600 to-indigo-600 shadow-blue-200'
                            : 'bg-gradient-to-r from-teal-600 to-emerald-600 shadow-teal-200'
                            }`}>
                        {loading ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : isEditMode ? <Pencil size={16} /> : <Save size={16} />}
                        {loading ? 'Guardando...' : isEditMode ? 'Guardar Cambios' : 'Registrar Muestra'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default MicroSampleEntry;
