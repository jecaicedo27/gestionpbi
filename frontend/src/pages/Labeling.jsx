import React, { useState, useEffect, useCallback } from 'react';
import { Search, Bluetooth, BluetoothOff, Printer, TestTube, Package, Hash, Calendar, Truck, Copy, CheckCircle2, AlertTriangle, Wifi, WifiOff, Download, ChevronDown, ChevronUp, Settings } from 'lucide-react';
import api from '../services/api';
import printer from '../services/bluetoothPrinter';
import { buildLotLabel, buildTestLabel } from '../services/tsplLabelBuilder';
import { buildLotLabelZPL, buildTestLabelZPL, toInitials } from '../services/zplLabelBuilder';
import { useZebra } from '../context/ZebraContext';
import { useAuth } from '../context/AuthContext';


const Labeling = () => {
    // ── Printer mode: 'bluetooth' (SAT) or 'network' (Zebra) ──
    const [mode, setMode] = useState(() => localStorage.getItem('label_printer_mode') || 'bluetooth');

    // ── Bluetooth (SAT) state ──
    const [printerConnected, setPrinterConnected] = useState(printer.isConnected());
    const [printerName, setPrinterName] = useState(printer.getDeviceName() || '');
    const [connecting, setConnecting] = useState(false);
    const [printing, setPrinting] = useState(false);
    const [printMsg, setPrintMsg] = useState(null);

    const { user } = useAuth();
    // Zebra state from global context
    const { zebraStatus, zebraIp, printZPL, recheckNow, isRechecking, configIp, relayIp, updateConfig } = useZebra();
    const [showZebraSettings, setShowZebraSettings] = useState(false);
    const [editIp, setEditIp] = useState(configIp);
    const [editRelay, setEditRelay] = useState(relayIp);


    // ── Lots ──
    const [searchQuery, setSearchQuery] = useState('');
    const [allLots, setAllLots] = useState([]);
    const [lotsLoading, setLotsLoading] = useState(false);
    const [selectedLot, setSelectedLot] = useState(null);
    const [copies, setCopies] = useState(1);

    // Persist mode
    useEffect(() => { localStorage.setItem('label_printer_mode', mode); }, [mode]);

    // ── Listen for Bluetooth state changes + auto-reconnect ──
    useEffect(() => {
        if (mode !== 'bluetooth') return;
        const unsub = printer.onStateChange(({ connected, name }) => {
            setPrinterConnected(connected);
            setPrinterName(name || '');
        });
        printer.tryAutoReconnect().then(result => {
            if (result) {
                setPrinterConnected(true);
                setPrinterName(result.name || '');
            }
        });
        return unsub;
    }, [mode]);

    const checkZebraRelay = async () => {
        setZebraChecking(true);
        await recheckNow();
        setZebraChecking(false);
    };




    // ── Load lots ──
    useEffect(() => {
        (async () => {
            setLotsLoading(true);
            try {
                const res = await api.get('/inventory/lots', { params: { status: 'AVAILABLE,LOW_STOCK' } });
                setAllLots(res.data || []);
            } catch (e) {
                console.error('Error loading lots:', e);
            } finally {
                setLotsLoading(false);
            }
        })();
    }, []);

    // ── Client-side filter ──
    const lots = searchQuery.trim().length > 0
        ? allLots.filter(l => {
            const q = searchQuery.toLowerCase();
            return (l.siigoProductName || '').toLowerCase().includes(q)
                || (l.siigoProductCode || '').toLowerCase().includes(q)
                || (l.lotNumber || '').toLowerCase().includes(q)
                || (l.product?.name || '').toLowerCase().includes(q)
                || (l.product?.sku || '').toLowerCase().includes(q);
        })
        : allLots;

    // ── Bluetooth connect/reconnect/disconnect ──
    const handleConnect = async () => {
        setConnecting(true);
        try {
            const result = await printer.connect();
            setPrinterConnected(true);
            setPrinterName(result.name);
            showMsg('success', `Conectada: ${result.name}`);
        } catch (err) {
            showMsg('error', err.message || 'Error al conectar');
        } finally {
            setConnecting(false);
        }
    };

    const handleReconnect = async () => {
        setConnecting(true);
        try {
            const result = await printer.reconnect();
            if (result) {
                setPrinterConnected(true);
                setPrinterName(result.name);
                showMsg('success', `Reconectada: ${result.name}`);
            } else {
                showMsg('error', 'No se pudo reconectar — use Conectar');
            }
        } catch (err) {
            showMsg('error', 'Reconexión fallida — use Conectar');
        } finally {
            setConnecting(false);
        }
    };

    const handleDisconnect = () => {
        printer.disconnect();
        setPrinterConnected(false);
        setPrinterName('');
    };


    // Send ZPL via global ZebraContext
    const sendToZebra = async (zpl) => {
        const result = await printZPL(zpl);
        if (!result.ok) throw new Error(result.error || 'Error de impresión');
    };


    const handleTestPrint = async () => {
        setPrinting(true);
        try {
            if (mode === 'bluetooth') {
                await printer.sendTSPL(buildTestLabel());
            } else {
                await sendToZebra(buildTestLabelZPL());
            }
            showMsg('success', 'Etiqueta de prueba enviada');
        } catch (err) {
            showMsg('error', err.message || 'Error al imprimir');
        } finally {
            setPrinting(false);
        }
    };

    const handlePrint = async () => {
        if (!selectedLot) return;
        setPrinting(true);
        try {
            const data = {
                productName: selectedLot.siigoProductName || selectedLot.product?.name || '',
                sku: selectedLot.siigoProductCode || selectedLot.product?.sku || '',
                lotNumber: selectedLot.lotNumber,
                quantity: selectedLot.currentQuantity,
                unit: selectedLot.unit || 'gramo',
                supplier: selectedLot.purchaseOrderItem?.purchaseOrder?.supplierName || '',
                receivedAt: selectedLot.receivedAt,
                expiresAt: selectedLot.expiresAt,
                orderNumber: selectedLot.purchaseOrderItem?.purchaseOrder?.orderNumber || '',
                printedBy: toInitials(user?.name),
            };
            if (mode === 'bluetooth') {
                await printer.sendTSPL(buildLotLabel(data, copies));
            } else {
                await sendToZebra(buildLotLabelZPL(data, copies));
            }
            showMsg('success', `${copies} etiqueta(s) enviada(s)`);
        } catch (err) {
            showMsg('error', err.message || 'Error al imprimir');
        } finally {
            setPrinting(false);
        }
    };

    const showMsg = (type, text) => {
        setPrintMsg({ type, text });
        setTimeout(() => setPrintMsg(null), 3500);
    };

    // ── Format helpers ──
    const fmtQty = (qty, unit) => {
        if (!qty) return '-';
        if (unit === 'gramo' || unit === 'g') return `${(qty / 1000).toFixed(1)} kg`;
        return `${qty.toLocaleString('es-CO')} ${unit || 'und'}`;
    };
    const fmtDate = (d) => d ? new Date(d).toLocaleDateString('es-CO') : 'N/A';

    const isBluetoothSupported = printer.isSupported();
    const isPrinterReady = mode === 'bluetooth' ? printerConnected : zebraStatus === 'connected';

    return (
        <div style={{ maxWidth: 960, margin: '0 auto', padding: '16px 12px' }}>
            {/* ── Header + Mode Toggle ── */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <div style={{ width: 44, height: 44, borderRadius: 12, background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Printer size={24} color="#fff" />
                </div>
                <div style={{ flex: 1 }}>
                    <h1 style={{ fontSize: '1.3rem', fontWeight: 800, color: '#1e293b', margin: 0 }}>Impresión de Etiquetas</h1>
                    <p style={{ fontSize: '0.8rem', color: '#94a3b8', margin: 0 }}>
                        {mode === 'bluetooth' ? 'SAT AF 330 — Bluetooth — 80×50mm' : 'Zebra ZD230t — WiFi — 80×50mm'}
                    </p>
                </div>
            </div>

            {/* ── Mode Toggle ── */}
            <div style={{
                display: 'flex', gap: 4, padding: 4, borderRadius: 12,
                background: '#f1f5f9', marginBottom: 16,
            }}>
                <button
                    onClick={() => setMode('bluetooth')}
                    style={{
                        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                        padding: '10px 16px', borderRadius: 10, border: 'none',
                        background: mode === 'bluetooth' ? 'white' : 'transparent',
                        boxShadow: mode === 'bluetooth' ? '0 1px 4px rgba(0,0,0,0.1)' : 'none',
                        color: mode === 'bluetooth' ? '#6366f1' : '#94a3b8',
                        fontWeight: 700, fontSize: '0.88rem', cursor: 'pointer',
                        transition: 'all 0.15s',
                    }}>
                    <Bluetooth size={18} /> SAT AF330 (Bluetooth)
                </button>
                <button
                    onClick={() => setMode('network')}
                    style={{
                        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                        padding: '10px 16px', borderRadius: 10, border: 'none',
                        background: mode === 'network' ? 'white' : 'transparent',
                        boxShadow: mode === 'network' ? '0 1px 4px rgba(0,0,0,0.1)' : 'none',
                        color: mode === 'network' ? '#059669' : '#94a3b8',
                        fontWeight: 700, fontSize: '0.88rem', cursor: 'pointer',
                        transition: 'all 0.15s',
                    }}>
                    <Wifi size={18} /> Zebra ZD230 (WiFi)
                </button>
            </div>

            {mode === 'network' && (
                <div style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 12px', borderRadius: 10, background: '#ecfdf5',
                    border: '1px solid #6ee7b7', marginBottom: 16,
                }}>
                    <Wifi size={14} color="#059669" />
                    <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#065f46' }}>
                        🌐 Impresión directa vía WiFi — sin PC intermediaria ({zebraIp || '192.168.0.126'})
                    </span>
                </div>
            )}

            {/* ── Status Bar ── */}
            {mode === 'bluetooth' ? (
                /* Bluetooth status bar */
                <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10,
                    padding: '12px 16px', borderRadius: 14, marginBottom: 20,
                    background: printerConnected ? 'linear-gradient(135deg, #ecfdf5, #d1fae5)' : '#f8fafc',
                    border: `1.5px solid ${printerConnected ? '#6ee7b7' : '#e2e8f0'}`,
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        {printerConnected ? <Bluetooth size={20} color="#059669" /> : <BluetoothOff size={20} color="#94a3b8" />}
                        <div>
                            <div style={{ fontWeight: 700, fontSize: '0.88rem', color: printerConnected ? '#065f46' : '#64748b' }}>
                                {printerConnected ? `🟢 ${printerName}` : '🔴 Impresora no conectada'}
                            </div>
                            {!isBluetoothSupported && (
                                <div style={{ fontSize: '0.72rem', color: '#ef4444', marginTop: 2 }}>
                                    ⚠️ Web Bluetooth no disponible — use Chrome en Android
                                </div>
                            )}
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                        {printerConnected ? (
                            <>
                                <button onClick={handleTestPrint} disabled={printing}
                                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 10, border: '1px solid #d1d5db', background: '#fff', fontSize: '0.8rem', fontWeight: 600, color: '#6366f1', cursor: 'pointer' }}>
                                    <TestTube size={14} /> Test
                                </button>
                                <button onClick={handleDisconnect}
                                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 10, border: '1px solid #fca5a5', background: '#fef2f2', fontSize: '0.8rem', fontWeight: 600, color: '#dc2626', cursor: 'pointer' }}>
                                    <WifiOff size={14} /> Desconectar
                                </button>
                            </>
                        ) : (
                            <div style={{ display: 'flex', gap: 8 }}>
                                <button onClick={handleReconnect} disabled={connecting || !isBluetoothSupported}
                                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 10, border: '1.5px solid #6366f1', background: '#eef2ff', fontSize: '0.82rem', fontWeight: 700, color: '#6366f1', cursor: isBluetoothSupported ? 'pointer' : 'not-allowed', opacity: connecting ? 0.7 : 1 }}>
                                    <Wifi size={14} /> {connecting ? '...' : 'Reconectar'}
                                </button>
                                <button onClick={handleConnect} disabled={connecting || !isBluetoothSupported}
                                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 10, border: 'none', background: isBluetoothSupported ? 'linear-gradient(135deg, #6366f1, #8b5cf6)' : '#d1d5db', fontSize: '0.82rem', fontWeight: 700, color: '#fff', cursor: isBluetoothSupported ? 'pointer' : 'not-allowed', opacity: connecting ? 0.7 : 1 }}>
                                    <Bluetooth size={14} /> Conectar
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            ) : (
                <div style={{
                    padding: '12px 16px', borderRadius: 14, marginBottom: 20,
                    background: zebraStatus === 'connected' ? 'linear-gradient(135deg, #ecfdf5, #d1fae5)'
                        : zebraStatus === 'checking' ? '#f0f9ff'
                        : '#fef2f2',
                    border: `1.5px solid ${zebraStatus === 'connected' ? '#6ee7b7' : zebraStatus === 'checking' ? '#bae6fd' : '#fca5a5'}`,
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <Wifi size={20} color={zebraStatus === 'connected' ? '#059669' : zebraStatus === 'checking' ? '#0284c7' : '#94a3b8'} />
                            <div>
                                <div style={{ fontWeight: 700, fontSize: '0.88rem', color: zebraStatus === 'connected' ? '#065f46' : zebraStatus === 'checking' ? '#0369a1' : '#64748b' }}>
                                    {zebraStatus === 'connected' && `🟢 Zebra ZD230 — ${zebraIp}`}
                                    {zebraStatus === 'checking' && '⏳ Verificando impresora...'}
                                    {zebraStatus === 'unreachable' && '🔴 Impresora no alcanzable'}
                                    {!zebraStatus && '⏳ Verificando...'}
                                </div>
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                            <button onClick={recheckNow} disabled={isRechecking}
                                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 10, border: '1px solid #d1d5db', background: '#fff', fontSize: '0.8rem', fontWeight: 600, color: '#059669', cursor: 'pointer', opacity: isRechecking ? 0.6 : 1 }}>
                                <Wifi size={14} className={isRechecking ? 'animate-pulse' : ''} /> {isRechecking ? '...' : 'Verificar'}
                            </button>
                            <button onClick={() => setShowZebraSettings(!showZebraSettings)}
                                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 10, border: '1px solid #d1d5db', background: showZebraSettings ? '#f3f4f6' : '#fff', fontSize: '0.8rem', fontWeight: 600, color: '#4b5563', cursor: 'pointer' }}>
                                <Settings size={14} />
                            </button>
                            {zebraStatus === 'connected' && (
                                <button onClick={handleTestPrint} disabled={printing}
                                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 10, border: '1px solid #d1d5db', background: '#fff', fontSize: '0.8rem', fontWeight: 600, color: '#6366f1', cursor: 'pointer' }}>
                                    <TestTube size={14} /> Test
                                </button>
                            )}
                        </div>
                    </div>

                    {showZebraSettings && (
                        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column', gap: 10 }}>
                            <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#374151' }}>Ajustes de Conexión (Tablet)</div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                                <div>
                                    <label style={{ fontSize: '0.7rem', color: '#6b7280', display: 'block', marginBottom: 4 }}>IP de la Impresora</label>
                                    <input value={editIp} onChange={e => setEditIp(e.target.value)} 
                                        style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: '0.8rem' }} />
                                </div>
                                <div>
                                    <label style={{ fontSize: '0.7rem', color: '#6b7280', display: 'block', marginBottom: 4 }}>IP del Relay (Opcional)</label>
                                    <input value={editRelay} onChange={e => setEditRelay(e.target.value)} placeholder="Ej: 192.168.0.100"
                                        style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: '0.8rem' }} />
                                </div>
                            </div>
                            <button onClick={() => { updateConfig(editIp, editRelay); setShowZebraSettings(false); recheckNow(); }}
                                style={{ width: '100%', padding: '8px', background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 8, fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer' }}>
                                Guardar y Reconectar
                            </button>
                        </div>
                    )}
                    {zebraStatus === 'unreachable' && (
                        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #fecaca', display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <div style={{ fontSize: '0.8rem', color: '#991b1b', fontWeight: 600 }}>
                                {window.innerWidth < 1024 ? "Configuración para Tablet/Celular:" : "Para usar esta impresora necesitas abrir la App Zebra Relay en este PC:"}
                            </div>
                            {window.innerWidth < 1024 ? (
                                <div style={{ fontSize: '0.78rem', color: '#b91c1c', background: '#fff', padding: '10px', borderRadius: 8, border: '1px solid #fecaca' }}>
                                    1. Entra a "Configuración del sitio" o "Permisos" (icono de candado arriba).<br/>
                                    2. Cambia <strong>"Contenido no seguro"</strong> a <strong>Permitir</strong>.<br/>
                                    3. Actualiza la página.<br/><br/>
                                    <button 
                                        onClick={() => {
                                            recheckNow();
                                            // PNA Wakeup: Opening the printer page in a new tab often 'trusts' the IP for the session.
                                            window.open(`http://${configIp || '192.168.0.126'}/index.html`, 'zebra_pna_wake', 'width=300,height=300');
                                        }}
                                        disabled={isRechecking}
                                        style={{ width: '100%', padding: '12px', background: isRechecking ? '#9ca3af' : '#dc2626', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 800, fontSize: '0.9rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                                    >
                                        {isRechecking ? (
                                            <>
                                                <div className="animate-spin" style={{ width: 14, height: 14, border: '2px solid #fff', borderTopColor: 'transparent', borderRadius: '50%' }}></div>
                                                CONECTANDO...
                                            </>
                                        ) : "DESPERTAR CONEXIÓN (CLICK AQUÍ)"}
                                    </button>
                                </div>
                            ) : (
                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                    <a href="/downloads/zebra/iniciar-zebra.bat" target="_blank" download
                                        style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px', borderRadius: 8, background: '#fee2e2', border: '1px solid #fca5a5', textDecoration: 'none', color: '#b91c1c', fontSize: '0.8rem', fontWeight: 700 }}>
                                        <Download size={14} /> Descargar e Iniciar
                                    </a>
                                    <a href="/downloads/zebra/instalar-inicio.bat" target="_blank" download
                                        style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px', borderRadius: 8, border: '1px dashed #fca5a5', textDecoration: 'none', color: '#b91c1c', fontSize: '0.8rem', fontWeight: 600 }}>
                                        Instalar al arrancar
                                    </a>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}



            {printMsg && (
                <div style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderRadius: 10, marginBottom: 16,
                    background: printMsg.type === 'success' ? '#ecfdf5' : '#fef2f2',
                    border: `1px solid ${printMsg.type === 'success' ? '#6ee7b7' : '#fca5a5'}`,
                    color: printMsg.type === 'success' ? '#065f46' : '#991b1b',
                    fontSize: '0.85rem', fontWeight: 600,
                }}>
                    {printMsg.type === 'success' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
                    {printMsg.text}
                </div>
            )}

            {/* ── Main Content: Search + Preview ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                {/* ── Left: Lot Search ── */}
                <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
                    <div style={{ padding: '12px 16px', borderBottom: '1px solid #f1f5f9', background: '#f8fafc' }}>
                        <div style={{ position: 'relative' }}>
                            <Search size={16} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                            <input
                                type="text"
                                placeholder="Buscar lote, SKU o producto..."
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                style={{
                                    width: '100%', padding: '8px 10px 8px 34px', borderRadius: 10,
                                    border: '1.5px solid #e2e8f0', fontSize: '0.85rem', outline: 'none',
                                    boxSizing: 'border-box',
                                }}
                            />
                        </div>
                    </div>
                    <div style={{ maxHeight: 420, overflowY: 'auto' }}>
                        {lotsLoading ? (
                            <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: '0.85rem' }}>Cargando...</div>
                        ) : lots.length === 0 ? (
                            <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: '0.85rem' }}>Sin lotes disponibles</div>
                        ) : (
                            lots.map(lot => (
                                <div
                                    key={lot.id}
                                    onClick={() => setSelectedLot(lot)}
                                    style={{
                                        padding: '10px 16px', borderBottom: '1px solid #f1f5f9', cursor: 'pointer',
                                        transition: 'background 0.15s',
                                        background: selectedLot?.id === lot.id ? '#eef2ff' : 'transparent',
                                        borderLeft: selectedLot?.id === lot.id ? '3px solid #6366f1' : '3px solid transparent',
                                    }}
                                >
                                    <div style={{ fontWeight: 600, fontSize: '0.82rem', color: '#1e293b' }}>
                                        {lot.siigoProductName || lot.product?.name || 'N/A'}
                                    </div>
                                    <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                                        <span style={{ fontSize: '0.72rem', padding: '2px 6px', borderRadius: 6, background: '#dbeafe', color: '#1e40af', fontWeight: 600 }}>
                                            {lot.siigoProductCode || lot.product?.sku}
                                        </span>
                                        <span style={{ fontSize: '0.72rem', padding: '2px 6px', borderRadius: 6, background: '#f0fdf4', color: '#166534', fontWeight: 600 }}>
                                            Lote: {lot.lotNumber}
                                        </span>
                                        <span style={{ fontSize: '0.72rem', color: '#64748b' }}>
                                            {fmtQty(lot.currentQuantity, lot.unit)}
                                        </span>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* ── Right: Label Preview + Print ── */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {/* Preview card (simulates 80×50mm label) */}
                    <div style={{
                        background: '#fff', borderRadius: 14, border: '2px dashed #cbd5e1', padding: 0,
                        aspectRatio: '80/50', display: 'flex', flexDirection: 'column', overflow: 'hidden',
                    }}>
                        {selectedLot ? (
                            <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'space-between' }}>
                                {/* Header */}
                                <div style={{ textAlign: 'center', fontSize: '0.6rem', color: '#94a3b8', letterSpacing: 1, fontWeight: 600, textTransform: 'uppercase' }}>
                                    Popping Boba International S.A.S.
                                </div>
                                <hr style={{ border: '0.5px solid #e2e8f0', margin: '4px 0' }} />

                                {/* Product name */}
                                <div style={{ fontWeight: 800, fontSize: '0.9rem', color: '#1e293b', lineHeight: 1.2 }}>
                                    {selectedLot.siigoProductName || selectedLot.product?.name || 'N/A'}
                                </div>

                                {/* SKU + Lote */}
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                                    <span style={{ fontSize: '0.72rem', color: '#475569' }}>
                                        <strong>SKU:</strong> {selectedLot.siigoProductCode || selectedLot.product?.sku}
                                    </span>
                                    <span style={{ fontSize: '0.72rem', color: '#475569' }}>
                                        <strong>Lote:</strong> {selectedLot.lotNumber}
                                    </span>
                                </div>

                                <hr style={{ border: '0.5px solid #f1f5f9', margin: '4px 0' }} />

                                {/* Quantity */}
                                <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#1e293b' }}>
                                    Cant: {fmtQty(selectedLot.currentQuantity, selectedLot.unit)}
                                </div>

                                {/* Dates */}
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', color: '#64748b' }}>
                                    <span>Recep: {fmtDate(selectedLot.receivedAt)}</span>
                                    <span>Vence: {fmtDate(selectedLot.expiresAt)}</span>
                                </div>

                                {/* Footer */}
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 4 }}>
                                    <div style={{ fontSize: '0.6rem', color: '#94a3b8' }}>
                                        {new Date().toLocaleDateString('es-CO')}
                                    </div>
                                    <div style={{
                                        width: 44, height: 44, border: '1px solid #cbd5e1', borderRadius: 4,
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        fontSize: '0.5rem', color: '#94a3b8', fontWeight: 600,
                                    }}>
                                        QR
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94a3b8', fontSize: '0.85rem' }}>
                                <div style={{ textAlign: 'center' }}>
                                    <Package size={32} style={{ marginBottom: 8, opacity: 0.4 }} />
                                    <div>Selecciona un lote para ver la vista previa</div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Copies + Print button */}
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <label style={{ fontSize: '0.82rem', fontWeight: 600, color: '#475569' }}>Copias:</label>
                            <input
                                type="number"
                                min={1}
                                max={20}
                                value={copies}
                                onChange={e => setCopies(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
                                style={{
                                    width: 56, padding: '6px 8px', borderRadius: 8, border: '1.5px solid #e2e8f0',
                                    fontSize: '0.85rem', textAlign: 'center', fontWeight: 600,
                                }}
                            />
                        </div>
                        <button
                            onClick={handlePrint}
                            disabled={!isPrinterReady || !selectedLot || printing}
                            style={{
                                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                                padding: '10px 16px', borderRadius: 10, border: 'none',
                                background: isPrinterReady && selectedLot ? 'linear-gradient(135deg, #059669, #10b981)' : '#e2e8f0',
                                color: isPrinterReady && selectedLot ? '#fff' : '#94a3b8',
                                fontSize: '0.9rem', fontWeight: 700, cursor: isPrinterReady && selectedLot ? 'pointer' : 'not-allowed',
                                opacity: printing ? 0.7 : 1,
                                transition: 'all 0.2s',
                            }}
                        >
                            <Printer size={18} />
                            {printing ? 'Imprimiendo...' : `Imprimir ${copies > 1 ? `(${copies})` : ''}`}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Labeling;
