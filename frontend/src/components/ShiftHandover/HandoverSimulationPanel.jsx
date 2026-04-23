import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle, RefreshCw, ShieldCheck, UserCheck } from 'lucide-react';
import api from '../../services/api';

const AREA_LABELS = { PRODUCCION: 'Producción', SIROPES: 'Siropes', EMPAQUE: 'Empaque' };
const SHIFT_LABELS = { MANANA: 'Mañana', TARDE: 'Tarde', NOCHE: 'Noche' };
const AREA_THEMES = {
    PRODUCCION: { color: '#1d4ed8', bg: '#eff6ff', headerBg: '#dbeafe', border: '#93c5fd', soft: '#f8fbff' },
    SIROPES: { color: '#0e7490', bg: '#ecfeff', headerBg: '#cffafe', border: '#67e8f9', soft: '#f6feff' },
    EMPAQUE: { color: '#15803d', bg: '#f0fdf4', headerBg: '#dcfce7', border: '#86efac', soft: '#f8fff9' }
};
const DEFAULT_THEME = { color: '#475569', bg: '#f8fafc', headerBg: '#f1f5f9', border: '#cbd5e1', soft: '#ffffff' };

function emptyForm() {
    return { pin: '', error: '', success: '', loading: false };
}

function isLeaderOrAdmin(user) {
    return user?.role === 'ADMIN' || user?.shiftEmployee?.role === 'LIDER';
}

function findParticipantByUser(participants, user) {
    return (participants || []).find(p =>
        p.userId === user?.id ||
        p.employeeId === user?.shiftEmployee?.id
    );
}

function getOutgoingOps(record) {
    return (record.outgoingParticipants || []).filter(p => p.role !== 'LIDER');
}

function getSignedUserIds(record) {
    return new Set((record.signatures || []).map(s => s.userId));
}

function getAreaChecklists(checklists, area) {
    return (checklists || []).filter(item => item.area === area);
}

export default function HandoverSimulationPanel() {
    const [loading, setLoading] = useState(true);
    const [records, setRecords] = useState([]);
    const [checklists, setChecklists] = useState([]);
    const [operationalDate, setOperationalDate] = useState('');
    const [message, setMessage] = useState('');
    const [forms, setForms] = useState({});

    const resetForms = useCallback((nextRecords) => {
        const next = {};
        (nextRecords || []).forEach(record => {
            next[record.id] = {
                operator: emptyForm(),
                outgoingLeader: emptyForm(),
                incomingLeader: emptyForm(),
                checklistValues: {},
                pendingTasks: '',
                incidents: '',
                observations: ''
            };
        });
        setForms(next);
    }, []);

    const fetchSimulation = useCallback(async () => {
        setLoading(true);
        setMessage('');
        try {
            const res = await api.get('/shift-handover/simulation/tarde-noche');
            const data = res.data || {};
            const nextRecords = data.records || [];
            setRecords(nextRecords);
            setChecklists(data.checklists || []);
            setOperationalDate(data.operationalDate || '');
            setMessage(data.message || '');
            resetForms(nextRecords);
        } catch (e) {
            setMessage(e.response?.data?.error || 'No se pudo cargar el simulacro');
        } finally {
            setLoading(false);
        }
    }, [resetForms]);

    useEffect(() => {
        fetchSimulation();
    }, [fetchSimulation]);

    const updateForm = (recordId, section, changes) => {
        setForms(prev => ({
            ...prev,
            [recordId]: {
                ...prev[recordId],
                [section]: { ...prev[recordId]?.[section], ...changes }
            }
        }));
    };

    const updateText = (recordId, field, value) => {
        setForms(prev => ({
            ...prev,
            [recordId]: { ...prev[recordId], [field]: value }
        }));
    };

    const toggleChecklist = (recordId, checklistId) => {
        setForms(prev => {
            const currentValues = prev[recordId]?.checklistValues || {};
            return {
                ...prev,
                [recordId]: {
                    ...prev[recordId],
                    checklistValues: {
                        ...currentValues,
                        [checklistId]: !currentValues[checklistId]
                    }
                }
            };
        });
    };

    const updateRecord = (recordId, updater) => {
        setRecords(prev => prev.map(record => (
            record.id === recordId ? updater(record) : record
        )));
    };

    const verifyPin = async (pin) => {
        const res = await api.post('/shift-handover/verify-pin', { pin });
        return res.data.user;
    };

    const handleOperatorSign = async (record) => {
        const current = forms[record.id]?.operator || emptyForm();
        if (current.pin.length !== 4) {
            updateForm(record.id, 'operator', { error: 'Ingresa 4 dígitos' });
            return;
        }

        updateForm(record.id, 'operator', { loading: true, error: '', success: '' });
        try {
            const user = await verifyPin(current.pin);
            const outOps = getOutgoingOps(record);
            const participant = findParticipantByUser(outOps, user);
            if (!participant) {
                updateForm(record.id, 'operator', {
                    loading: false,
                    error: `${user.name} no está asignado como operario saliente en ${AREA_LABELS[record.area] || record.area}`
                });
                return;
            }

            const signedUserIds = getSignedUserIds(record);
            if (signedUserIds.has(user.id)) {
                updateForm(record.id, 'operator', {
                    loading: false,
                    error: `${user.name} ya firmó en este simulacro`
                });
                return;
            }

            updateRecord(record.id, oldRecord => {
                const nextSignatures = [
                    ...(oldRecord.signatures || []),
                    {
                        id: `SIM-SIG-${user.id}-${Date.now()}`,
                        userId: user.id,
                        employeeId: participant.employeeId,
                        signedAt: new Date().toISOString(),
                        employee: { id: participant.employeeId, name: participant.name, role: participant.role },
                        user: { id: user.id, name: user.name }
                    }
                ];
                return {
                    ...oldRecord,
                    signatures: nextSignatures,
                    status: 'IN_PROGRESS'
                };
            });

            updateForm(record.id, 'operator', {
                pin: '',
                loading: false,
                error: '',
                success: `${user.name} firmó correctamente`
            });
        } catch (e) {
            updateForm(record.id, 'operator', {
                loading: false,
                error: e.response?.data?.error || 'PIN inválido'
            });
        }
    };

    const handleOutgoingAuthorize = async (record) => {
        const current = forms[record.id]?.outgoingLeader || emptyForm();
        if (current.pin.length !== 4) {
            updateForm(record.id, 'outgoingLeader', { error: 'Ingresa 4 dígitos' });
            return;
        }

        const outOps = getOutgoingOps(record);
        if ((record.signatures || []).length < outOps.length) {
            updateForm(record.id, 'outgoingLeader', { error: 'Todos los operarios deben firmar primero' });
            return;
        }

        updateForm(record.id, 'outgoingLeader', { loading: true, error: '', success: '' });
        try {
            const user = await verifyPin(current.pin);
            if (!isLeaderOrAdmin(user)) {
                updateForm(record.id, 'outgoingLeader', {
                    loading: false,
                    error: 'El PIN debe ser de un líder o de un admin'
                });
                return;
            }

            const checklistValues = forms[record.id]?.checklistValues || {};
            const checklistData = getAreaChecklists(checklists, record.area).map(item => ({
                id: item.id,
                label: item.label,
                fieldType: item.fieldType,
                value: Boolean(checklistValues[item.id])
            }));

            updateRecord(record.id, oldRecord => ({
                ...oldRecord,
                status: 'DELIVERED',
                outgoingLeader: { id: user.id, name: user.name },
                outgoingLeaderAt: new Date().toISOString(),
                checklist: checklistData,
                pendingTasks: forms[record.id]?.pendingTasks || null,
                incidents: forms[record.id]?.incidents || null,
                observations: forms[record.id]?.observations || null
            }));

            updateForm(record.id, 'outgoingLeader', {
                pin: '',
                loading: false,
                error: '',
                success: `${user.name} autorizó la entrega`
            });
        } catch (e) {
            updateForm(record.id, 'outgoingLeader', {
                loading: false,
                error: e.response?.data?.error || 'PIN inválido'
            });
        }
    };

    const handleIncomingAccept = async (record) => {
        const current = forms[record.id]?.incomingLeader || emptyForm();
        if (current.pin.length !== 4) {
            updateForm(record.id, 'incomingLeader', { error: 'Ingresa 4 dígitos' });
            return;
        }
        if (record.status !== 'DELIVERED') {
            updateForm(record.id, 'incomingLeader', { error: 'Primero debe autorizar el líder saliente' });
            return;
        }

        updateForm(record.id, 'incomingLeader', { loading: true, error: '', success: '' });
        try {
            const user = await verifyPin(current.pin);
            if (!isLeaderOrAdmin(user)) {
                updateForm(record.id, 'incomingLeader', {
                    loading: false,
                    error: 'El PIN debe ser de un líder o de un admin'
                });
                return;
            }

            updateRecord(record.id, oldRecord => ({
                ...oldRecord,
                status: 'RECEIVED',
                incomingLeader: { id: user.id, name: user.name },
                incomingLeaderAt: new Date().toISOString()
            }));

            updateForm(record.id, 'incomingLeader', {
                pin: '',
                loading: false,
                error: '',
                success: `${user.name} aceptó el relevo`
            });
        } catch (e) {
            updateForm(record.id, 'incomingLeader', {
                loading: false,
                error: e.response?.data?.error || 'PIN inválido'
            });
        }
    };

    const resetSimulation = () => {
        const nextRecords = records.map(record => ({
            ...record,
            status: 'PENDING',
            signatures: [],
            outgoingLeader: null,
            outgoingLeaderAt: null,
            incomingLeader: null,
            incomingLeaderAt: null,
            checklist: null,
            pendingTasks: null,
            incidents: null,
            observations: null
        }));
        setRecords(nextRecords);
        resetForms(nextRecords);
    };

    const completedCount = useMemo(
        () => records.filter(record => record.status === 'RECEIVED').length,
        [records]
    );

    if (loading) {
        return <div style={{ padding: 60, textAlign: 'center', color: '#94a3b8' }}>Cargando simulacro...</div>;
    }

    return (
        <div style={{ display: 'grid', gap: 18 }}>
            <div style={{
                padding: '16px 18px',
                borderRadius: 14,
                background: '#fffbeb',
                border: '2px solid #fde68a',
                color: '#92400e',
                display: 'flex',
                alignItems: 'flex-start',
                gap: 12
            }}>
                <AlertTriangle size={22} style={{ flexShrink: 0, marginTop: 1 }} />
                <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 900, fontSize: 15, color: '#78350f' }}>
                        Simulacro Tarde → Noche
                    </div>
                    <div style={{ fontSize: 13, lineHeight: 1.5, marginTop: 4 }}>
                        Valida PINes reales y muestra el flujo completo, pero no registra firmas,
                        no cambia estados y no toca el relevo operativo de las 22:00.
                    </div>
                    {operationalDate && (
                        <div style={{ fontSize: 12, fontWeight: 700, marginTop: 6 }}>
                            Fecha operativa: {new Date(`${operationalDate}T12:00:00`).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })}
                        </div>
                    )}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <button onClick={resetSimulation} style={secondaryButtonStyle}>
                        Reiniciar
                    </button>
                    <button onClick={fetchSimulation} style={secondaryButtonStyle}>
                        <RefreshCw size={14} /> Recargar
                    </button>
                </div>
            </div>

            {message && (
                <div style={{
                    padding: 18,
                    borderRadius: 12,
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    color: '#64748b',
                    fontWeight: 700
                }}>
                    {message}
                </div>
            )}

            {records.length > 0 && (
                <div style={{
                    padding: '10px 14px',
                    borderRadius: 12,
                    background: '#f0fdf4',
                    border: '1px solid #bbf7d0',
                    color: '#166534',
                    fontSize: 13,
                    fontWeight: 800
                }}>
                    Avance del simulacro: {completedCount}/{records.length} áreas completadas
                </div>
            )}

            {records.map(record => (
                <SimulationAreaCard
                    key={record.id}
                    record={record}
                    checklists={getAreaChecklists(checklists, record.area)}
                    form={forms[record.id] || {}}
                    onOperatorSign={() => handleOperatorSign(record)}
                    onOutgoingAuthorize={() => handleOutgoingAuthorize(record)}
                    onIncomingAccept={() => handleIncomingAccept(record)}
                    onPinChange={(section, pin) => updateForm(record.id, section, { pin, error: '', success: '' })}
                    onTextChange={(field, value) => updateText(record.id, field, value)}
                    onChecklistToggle={(checklistId) => toggleChecklist(record.id, checklistId)}
                />
            ))}
        </div>
    );
}

function SimulationAreaCard({
    record,
    checklists,
    form,
    onOperatorSign,
    onOutgoingAuthorize,
    onIncomingAccept,
    onPinChange,
    onTextChange,
    onChecklistToggle
}) {
    const outOps = getOutgoingOps(record);
    const signedUserIds = getSignedUserIds(record);
    const allSigned = outOps.length > 0 && (record.signatures || []).length >= outOps.length;
    const delivered = ['DELIVERED', 'RECEIVED'].includes(record.status);
    const received = record.status === 'RECEIVED';
    const theme = AREA_THEMES[record.area] || DEFAULT_THEME;
    const checklistValues = form.checklistValues || {};

    return (
        <div style={{
            border: `2px solid ${theme.border}`,
            borderRadius: 14,
            background: theme.soft,
            overflow: 'hidden',
            boxShadow: `0 10px 28px ${theme.border}33`
        }}>
            <div style={{
                padding: '18px 20px',
                background: received ? '#f0fdf4' : theme.headerBg,
                borderBottom: `2px solid ${theme.border}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                flexWrap: 'wrap'
            }}>
                <div>
                    <div style={{
                        fontSize: 26,
                        fontWeight: 950,
                        color: theme.color,
                        lineHeight: 1.05
                    }}>
                        {AREA_LABELS[record.area] || record.area}
                    </div>
                    <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>
                        {SHIFT_LABELS[record.outgoingShift]} → {SHIFT_LABELS[record.incomingShift]} · Estado real: {record.actualStatus}
                    </div>
                </div>
                <div style={{
                    padding: '6px 12px',
                    borderRadius: 8,
                    background: received ? '#16a34a' : delivered ? theme.color : allSigned ? '#f59e0b' : theme.color,
                    color: '#fff',
                    fontSize: 12,
                    fontWeight: 900
                }}>
                    {received ? 'SIMULACRO RECIBIDO' : delivered ? 'ENTREGADO' : allSigned ? 'LISTO PARA LÍDER' : 'FIRMAS'}
                </div>
            </div>

            <div style={{ padding: 18, display: 'grid', gap: 16 }}>
                <section style={sectionStyle}>
                    <SectionTitle icon={<CheckCircle size={18} color={allSigned ? '#16a34a' : '#f59e0b'} />}>
                        Firmas de operarios salientes ({(record.signatures || []).length}/{outOps.length})
                    </SectionTitle>
                    <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
                        {outOps.map(op => {
                            const signed = signedUserIds.has(op.userId);
                            return (
                                <div key={op.employeeId} style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    gap: 10,
                                    padding: '9px 10px',
                                    borderRadius: 10,
                                    background: signed ? '#f0fdf4' : '#f8fafc',
                                    border: `1px solid ${signed ? '#bbf7d0' : '#e2e8f0'}`
                                }}>
                                    <span style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>{op.name}</span>
                                    <span style={{
                                        fontSize: 11,
                                        fontWeight: 900,
                                        color: signed ? '#16a34a' : '#d97706'
                                    }}>
                                        {signed ? 'Firmado' : 'Pendiente'}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                    {!allSigned && (
                        <PinRow
                            label="PIN del operario saliente"
                            form={form.operator || emptyForm()}
                            buttonLabel="Firmar simulacro"
                            onChange={pin => onPinChange('operator', pin)}
                            onSubmit={onOperatorSign}
                            color="#16a34a"
                        />
                    )}
                </section>

                <section style={sectionStyle}>
                    <SectionTitle icon={<ShieldCheck size={18} color={delivered ? '#2563eb' : '#7c3aed'} />}>
                        Autorización del líder saliente
                    </SectionTitle>
                    {checklists.length > 0 && !delivered && (
                        <div style={{ marginBottom: 12, display: 'grid', gap: 8 }}>
                            {checklists.map(item => (
                                <ChecklistButton
                                    key={item.id}
                                    checked={Boolean(checklistValues[item.id])}
                                    label={item.label}
                                    onClick={() => onChecklistToggle(item.id)}
                                />
                            ))}
                        </div>
                    )}
                    {!delivered ? (
                        <>
                            <textarea
                                value={form.pendingTasks || ''}
                                onChange={e => onTextChange('pendingTasks', e.target.value)}
                                placeholder="Pendientes para el próximo turno (simulacro)"
                                rows={2}
                                style={textareaStyle}
                            />
                            <textarea
                                value={form.incidents || ''}
                                onChange={e => onTextChange('incidents', e.target.value)}
                                placeholder="Novedades o incidencias (simulacro)"
                                rows={2}
                                style={textareaStyle}
                            />
                            <PinRow
                                label="PIN del líder saliente"
                                form={form.outgoingLeader || emptyForm()}
                                buttonLabel="Autorizar"
                                onChange={pin => onPinChange('outgoingLeader', pin)}
                                onSubmit={onOutgoingAuthorize}
                                disabled={!allSigned}
                                color="#7c3aed"
                            />
                        </>
                    ) : (
                        <>
                            <DoneLine text={`${record.outgoingLeader?.name || 'Líder saliente'} autorizó la entrega`} at={record.outgoingLeaderAt} />
                            {Array.isArray(record.checklist) && record.checklist.length > 0 && (
                                <ChecklistSummary items={record.checklist} />
                            )}
                        </>
                    )}
                </section>

                <section style={sectionStyle}>
                    <SectionTitle icon={<UserCheck size={18} color={received ? '#16a34a' : '#0284c7'} />}>
                        Aceptación del líder entrante
                    </SectionTitle>
                    {!received ? (
                        <PinRow
                            label="PIN del líder entrante"
                            form={form.incomingLeader || emptyForm()}
                            buttonLabel="Aceptar relevo"
                            onChange={pin => onPinChange('incomingLeader', pin)}
                            onSubmit={onIncomingAccept}
                            disabled={!delivered}
                            color="#0284c7"
                        />
                    ) : (
                        <DoneLine text={`${record.incomingLeader?.name || 'Líder entrante'} aceptó el relevo`} at={record.incomingLeaderAt} />
                    )}
                </section>
            </div>
        </div>
    );
}

function SectionTitle({ icon, children }) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 900, color: '#0f172a', marginBottom: 10 }}>
            {icon}
            {children}
        </div>
    );
}

function ChecklistButton({ checked, label, onClick }) {
    return (
        <button
            type="button"
            onClick={onClick}
            style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 12px',
                borderRadius: 8,
                border: `2px solid ${checked ? '#86efac' : '#e2e8f0'}`,
                background: checked ? '#f0fdf4' : '#fff',
                cursor: 'pointer',
                textAlign: 'left',
                color: checked ? '#166534' : '#475569',
                fontSize: 13,
                fontWeight: 800
            }}
        >
            <span style={{
                width: 22,
                height: 22,
                borderRadius: 8,
                border: `2px solid ${checked ? '#16a34a' : '#cbd5e1'}`,
                background: checked ? '#16a34a' : '#fff',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 950,
                flexShrink: 0
            }}>
                {checked ? '✓' : ''}
            </span>
            <span>{label}</span>
        </button>
    );
}

function ChecklistSummary({ items }) {
    return (
        <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
            {items.map(item => (
                <div key={item.id} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 10px',
                    borderRadius: 8,
                    background: item.value ? '#f0fdf4' : '#f8fafc',
                    border: `1px solid ${item.value ? '#bbf7d0' : '#e2e8f0'}`,
                    color: item.value ? '#166534' : '#64748b',
                    fontSize: 12,
                    fontWeight: 800
                }}>
                    <span>{item.value ? '✓' : '—'}</span>
                    <span>{item.label}</span>
                </div>
            ))}
        </div>
    );
}

function PinRow({ label, form, buttonLabel, onChange, onSubmit, disabled = false, color }) {
    return (
        <div>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#64748b', marginBottom: 6 }}>
                {label}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
                <input
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    placeholder="PIN"
                    value={form.pin || ''}
                    onChange={e => onChange(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    onKeyDown={e => e.key === 'Enter' && !disabled && onSubmit()}
                    disabled={disabled || form.loading}
                    style={{
                        flex: 1,
                        padding: '11px 14px',
                        borderRadius: 8,
                        border: `2px solid ${form.error ? '#fca5a5' : '#e2e8f0'}`,
                        fontSize: 18,
                        fontWeight: 800,
                        textAlign: 'center',
                        fontFamily: 'monospace',
                        letterSpacing: 4,
                        opacity: disabled ? 0.55 : 1
                    }}
                />
                <button
                    onClick={onSubmit}
                    disabled={disabled || form.loading || (form.pin || '').length !== 4}
                    style={{
                        padding: '11px 16px',
                        borderRadius: 8,
                        border: 'none',
                        background: !disabled && (form.pin || '').length === 4 ? color : '#94a3b8',
                        color: '#fff',
                        fontWeight: 900,
                        cursor: disabled ? 'not-allowed' : 'pointer',
                        opacity: form.loading ? 0.65 : 1
                    }}
                >
                    {form.loading ? '...' : buttonLabel}
                </button>
            </div>
            {form.error && <div style={errorStyle}>{form.error}</div>}
            {form.success && <div style={successStyle}>{form.success}</div>}
        </div>
    );
}

function DoneLine({ text, at }) {
    return (
        <div style={{
            padding: '12px 14px',
            borderRadius: 10,
            background: '#f0fdf4',
            border: '1px solid #bbf7d0',
            color: '#166534',
            fontSize: 13,
            fontWeight: 800
        }}>
            {text}
            {at && (
                <span style={{ color: '#64748b', fontWeight: 600 }}>
                    {' '}a las {new Date(at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                </span>
            )}
        </div>
    );
}

const secondaryButtonStyle = {
    padding: '8px 12px',
    borderRadius: 8,
    border: '1px solid #e2e8f0',
    background: '#fff',
    color: '#475569',
    fontWeight: 800,
    fontSize: 12,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 6
};

const sectionStyle = {
    padding: 14,
    borderRadius: 12,
    border: '1px solid #e2e8f0',
    background: '#fff'
};

const textareaStyle = {
    width: '100%',
    boxSizing: 'border-box',
    padding: '9px 11px',
    borderRadius: 8,
    border: '1px solid #e2e8f0',
    fontSize: 13,
    resize: 'vertical',
    marginBottom: 8
};

const errorStyle = {
    marginTop: 8,
    padding: '8px 10px',
    borderRadius: 8,
    background: '#fef2f2',
    color: '#dc2626',
    fontSize: 12,
    fontWeight: 800
};

const successStyle = {
    marginTop: 8,
    padding: '8px 10px',
    borderRadius: 8,
    background: '#f0fdf4',
    color: '#16a34a',
    fontSize: 12,
    fontWeight: 800
};
