import React, { useState, useEffect, useCallback } from 'react';
import QRCode from 'qrcode';
import { Printer, Package, RefreshCw, Bluetooth, BluetoothOff, Wifi, WifiOff, PackagePlus, Trash2, Factory } from 'lucide-react';
import printer from '../../../services/bluetoothPrinter';
import { buildLotLabel } from '../../../services/tsplLabelBuilder';
import { buildLotLabelZPL, toInitials } from '../../../services/zplLabelBuilder';
import { generateQrDataUrl, buildQrPayloadLocal } from '../../../services/qrService';
import { useZebra } from '../../../context/ZebraContext';
import { useAuth } from '../../../context/AuthContext';
import api from '../../../services/api';


/**
 * MarcadoCajasStep
 *
 * Auto-fills product/lot/expiry from the assembly note.
 * Calculates units-per-box from the CAJA item in note.items.
 * Generates QR on mount and sends TSPL labels via Bluetooth.
 * Calls onMarcadoChange so the wizard can save the box data on SIGUIENTE.
 */
const MarcadoCajasStep = ({ stepData, onMarcadoChange, allBatchNotes = [], carriots = [], activeCarritoId }) => {
    const noteData = stepData;

    // ── Derive data from note ────────────────────────────────────────────────
    let product = noteData.product || {};
    const batchNumber = noteData.productionBatch?.batchNumber || noteData.noteNumber || '';

    // Geniality: Override display name using the flavor from the Cart!
    if (activeCarritoId) {
        const activeCart = carriots.find(c => c.id === activeCarritoId);
        if (activeCart) {
            const anyConteoNote = allBatchNotes.find(n => n.processType?.code === 'CONTEO');
            const conteoData = anyConteoNote?.processParameters?.conteo || {};
            const conteoEntry = Object.values(conteoData).find(entry => entry.productId === activeCart.productId);
            if (conteoEntry) {
                product = {
                    ...product,
                    id: conteoEntry.productId,
                    name: conteoEntry.productName || product.name,
                };
            }
        }
    }

    // Units-per-box: use product's packSize/packPerBox, then fallback to CAJA item, then 1
    const cajaItem = (noteData.items || []).find(i =>
        i.component?.name?.toUpperCase().includes('CAJA')
    );
    const defaultUnitsPerBox = product.packSize
        || product.packPerBox
        || (cajaItem?.plannedQuantity ? Math.round(1 / cajaItem.plannedQuantity) : 1);

    // Total units: from output targets (final products) or targetQuantity (intermediate)
    const outputTargets = noteData.productionBatch?.outputTargets || [];
    const stageName = (noteData.stageName || '').toLowerCase();
    const nums = (stageName.match(/\d{3,}/g) || []);
    const matchedTarget = outputTargets.find(t =>
        nums.some(n => (t.product?.name || '').toLowerCase().includes(n))
    ) || (outputTargets.length === 1 ? outputTargets[0] : null);

    // Detect if this is a weight-based intermediate product (BASE, COMPUESTO, etc.)
    const isWeightBasedOverride = activeCarritoId ? false : !(matchedTarget?.plannedUnits || matchedTarget?.actualUnits);
    const isWeightBased = isWeightBasedOverride;
    const isEnsamble = noteData.processType?.code === 'ENSAMBLE';
    const totalTarros = (() => {
        if (isEnsamble && matchedTarget?.plannedUnits) return matchedTarget.plannedUnits;
        if (noteData.targetQuantity && (isWeightBased || noteData.targetQuantity < 50000)) return noteData.targetQuantity;
        if (matchedTarget?.plannedUnits) return matchedTarget.plannedUnits;
        if (isWeightBased && noteData.items?.length > 0) {
            const weightUnits = ['g', 'kg', 'gramo', 'gramos'];
            const total = noteData.items.reduce((sum, item) => {
                if (!weightUnits.includes(item.unit)) return sum;
                const qty = item.plannedQuantity || 0;
                return sum + ((item.unit === 'kg') ? qty * 1000 : qty);
            }, 0);
            if (total > 0) return Math.round(total);
        }
        return noteData.targetQuantity || 0;
    })();

    // Extract Empaque data if exists (to separate approved vs defective)
    // The wizard may pass stale processParameters (before empaque PATCH saved).
    // Fetch fresh data from API on mount to ensure accurate counts.
    const [freshEmpaque, setFreshEmpaque] = useState(null);
    useEffect(() => {
        const token = localStorage.getItem('token');
        fetch(`/api/assembly-notes/${noteData.id}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        })
        .then(r => r.json())
        .then(data => {
            if (data?.processParameters?.empaque) {
                setFreshEmpaque(data.processParameters.empaque);
            }
        })
        .catch(() => {}); // fallback to stale data
    }, [noteData.id]);

    const ownEmpaque = freshEmpaque || noteData.processParameters?.empaque || null;
    const externalEmpaqueNote = !ownEmpaque
        ? allBatchNotes.find(n => n.processType?.code === 'EMPAQUE' && n.productId === product.id && n.status === 'COMPLETED')
        : null;
    const empaqueData = ownEmpaque || externalEmpaqueNote?.processParameters?.empaque || {};

    // ── FASE 5: Prefer relational fields from BatchOutputTarget when available ──
    // Falls back to JSON processParameters for historical data not covered by backfill.
    const relationalApproved  = (matchedTarget?.approvedUnits  > 0) ? matchedTarget.approvedUnits  : null;
    const relationalDefective = (matchedTarget?.defectiveUnits > 0) ? matchedTarget.defectiveUnits : null;
    const relationalActual    = (matchedTarget?.actualUnits    > 0) ? matchedTarget.actualUnits    : null;

    // Filter relevant carriots using the explicit prop. 
    // IMPORTANT: Only use UN-INGESTED carriots so we only pack/print labels for the delta (current cart), 
    // instead of accumulating historically and duplicating labels.
    const receivedCarriots = activeCarritoId
        ? carriots.filter(c => c.id === activeCarritoId)
        : carriots.filter(c => c.receivedAt && !c.ingestedAt && c.productId === product.id);
    const receivedQtyFromCarriots = receivedCarriots.reduce((s, c) => s + (Number(c.qty) || 0), 0);
    const defectiveTarros = relationalDefective ?? (empaqueData.defective_qty ?? 0);

    // Real Fabricado: carritos (Delta) > relationalActual (Fase 5) > JSON conteo_qty > fallback
    let receivedTarros = relationalActual;
    const hasCarriots = carriots.length > 0;
    
    if (hasCarriots) {
        receivedTarros = receivedQtyFromCarriots;
    } else if (receivedTarros == null) {
        receivedTarros = empaqueData.conteo_qty ?? empaqueData.received_qty ?? totalTarros;
    }

    const approvedTarros = Math.max(0, receivedTarros - defectiveTarros);

    // Programadas
    const anyConteoNote = allBatchNotes.find(n => n.processType?.code === 'CONTEO');
    const conteoData = anyConteoNote?.processParameters?.conteo || {};
    const conteoEntry = Object.values(conteoData).find(entry => entry.productId === product.id);
    const plannedTarros = conteoEntry?.planned ?? totalTarros;

    const metaLabel = isWeightBased ? 'gramos' : 'unidades';

    // Expiry: use persisted expiresAt from batch, fallback to fabrication + 9 months
    const expiryDate = (() => {
        // Check batch-level expiresAt
        if (noteData.productionBatch?.expiresAt) {
            return new Date(noteData.productionBatch.expiresAt).toISOString().split('T')[0];
        }
        // Fallback: 9 months from fabrication (batch creation)
        const fabDate = noteData.productionBatch?.createdAt
            ? new Date(noteData.productionBatch.createdAt)
            : new Date();
        fabDate.setMonth(fabDate.getMonth() + 9);
        return fabDate.toISOString().split('T')[0];
    })();

    // Maquila box size: 6 para Liquipops, igual que regular para Geniality (12 unds/caja)
    const isGeniality = /sirope|geniality/i.test(product.name || '');
    const MAQUILA_UNITS_PER_BOX = isGeniality ? defaultUnitsPerBox : 6;

    // ── Contramuestra: solo para LIQUIPOPS 350g (cualquier sabor) ──
    const isLiquipops350 = /liquipops/i.test(product.name || '') && /350/i.test(product.name || '');
    const savedMarcado = noteData.processParameters?.marcado_cajas || {};
    const savedDestino = ['liquipops', 'maquila', 'mixto'].includes(savedMarcado.destino)
        ? savedMarcado.destino
        : null;
    const initialContramuestraQty = Number(savedMarcado.contramuestra_qty);
    const initialContramuestra = Number.isFinite(initialContramuestraQty)
        ? initialContramuestraQty
        : (isLiquipops350 ? 1 : 0);
    const initialMaquilaQtyValue = Number(savedMarcado.maquila_qty);
    const initialMaquilaQty = Number.isFinite(initialMaquilaQtyValue) ? initialMaquilaQtyValue : 0;
    const initialPackableUnits = Math.max(0, approvedTarros - initialContramuestra - initialMaquilaQty);
    const initialIsCarritoDone = hasCarriots && receivedQtyFromCarriots === 0 && initialPackableUnits === 0;
    const inferredDestino = savedDestino
        || (initialMaquilaQty > 0 ? (initialPackableUnits > 0 ? 'mixto' : 'maquila') : null)
        || (!isWeightBased && !initialIsCarritoDone ? 'liquipops' : null);
    const savedUnitsPerBox = Number(savedMarcado.unidades_por_caja);
    const initialUnitsPerBox = Number.isFinite(savedUnitsPerBox) && savedUnitsPerBox > 0
        ? savedUnitsPerBox
        : (inferredDestino === 'maquila' ? MAQUILA_UNITS_PER_BOX : defaultUnitsPerBox);
    const savedFullBoxes = Number(savedMarcado.cajas_llenas);
    const savedPartialUnits = Number(savedMarcado.unidades_sueltas);
    const initialFullBoxes = Number.isFinite(savedFullBoxes) && savedFullBoxes >= 0
        ? savedFullBoxes
        : (initialUnitsPerBox > 0 ? Math.floor(initialPackableUnits / initialUnitsPerBox) : 0);
    const initialPartialUnits = Number.isFinite(savedPartialUnits) && savedPartialUnits >= 0
        ? savedPartialUnits
        : (initialUnitsPerBox > 0 ? Math.round(initialPackableUnits % initialUnitsPerBox) : 0);
    const initialPrinted = savedMarcado.etiquetas_impresas === true;

    // ── Local state ──────────────────────────────────────────────────────────

    // ── Destino obligatorio ──
    const [destino, setDestino] = useState(inferredDestino); // null | 'liquipops' | 'maquila' | 'mixto'
    const [unitsPerBox, setUnitsPerBox] = useState(initialUnitsPerBox);
    const [contramuestraQty, setContramuestraQty] = useState(initialContramuestra);

    // ── Maquila / Marca Blanca ──
    const [maquilaQty, setMaquilaQty] = useState(initialMaquilaQty);

    // When destino changes, auto-set maquila qty, box sizes, and reset pending box answer
    useEffect(() => {
        if (destino === 'liquipops') {
            setMaquilaQty(0);
            setUnitsPerBox(defaultUnitsPerBox);
        } else if (destino === 'maquila') {
            setMaquilaQty(approvedTarros - contramuestraQty);
            setUnitsPerBox(MAQUILA_UNITS_PER_BOX);
        } else if (destino === 'mixto') {
            setUnitsPerBox(defaultUnitsPerBox);
        }
        setPendingAnswer(null);
        setPendingCurrentUnits('');
        setPendingConfirmed(false);
    }, [destino]); // eslint-disable-line

    // packableUnits = units for regular Liquipops line (excludes contramuestra and maquila)
    const maquilaNum = Number(maquilaQty) || 0;
    const packableUnits = Math.max(0, approvedTarros - contramuestraQty - maquilaNum);

    // ── Pending Box (Caja Pendiente) ──────────────────────────────────────
    const [pendingBox, setPendingBox] = useState(null);  // from DB
    const [pendingBoxLoading, setPendingBoxLoading] = useState(false);
    const [pendingAnswer, setPendingAnswer] = useState(null); // null | 'yes' | 'no'
    const [pendingCurrentUnits, setPendingCurrentUnits] = useState(''); // uds found in the box
    const [pendingConfirmed, setPendingConfirmed] = useState(false);

    // Box size for pending box follows destino
    const pendingBoxSize = destino === 'maquila' ? MAQUILA_UNITS_PER_BOX : defaultUnitsPerBox;
    const pendingNeeds = (pendingAnswer === 'yes' && pendingConfirmed && pendingCurrentUnits !== '')
        ? Math.max(0, pendingBoxSize - Number(pendingCurrentUnits)) : 0;
    const pendingFillQty = (!isWeightBased && destino && pendingNeeds > 0)
        ? Math.min(pendingNeeds, destino === 'maquila' ? maquilaNum : packableUnits) : 0;
    // Remaining units for NEW boxes after filling pending
    const newBoxUnits = packableUnits - pendingFillQty;
    // Auto-calc new boxes from remaining
    const autoFullBoxes = unitsPerBox > 0 ? Math.floor(newBoxUnits / unitsPerBox) : 0;
    const autoPartialUnits = unitsPerBox > 0 ? Math.round(newBoxUnits % unitsPerBox) : 0;

    // Maquila box distribution (uses its own box size, subtract pending fill for maquila)
    const maquilaBoxSize = destino === 'maquila' ? unitsPerBox : MAQUILA_UNITS_PER_BOX;
    const maquilaNewUnits = destino === 'maquila' ? Math.max(0, maquilaNum - pendingFillQty) : maquilaNum;
    const maquilaFullBoxes = maquilaNewUnits > 0 && maquilaBoxSize > 0 ? Math.floor(maquilaNewUnits / maquilaBoxSize) : 0;
    const maquilaPartialUnits = maquilaNewUnits > 0 && maquilaBoxSize > 0 ? Math.round(maquilaNewUnits % maquilaBoxSize) : 0;
    const maquilaLabelCount = maquilaFullBoxes + (maquilaPartialUnits > 0 ? 1 : 0);

    // Regular Liquipops box distribution
    const regularBoxSize = destino === 'maquila' ? 0 : (unitsPerBox || defaultUnitsPerBox);
    const defaultFullBoxes = regularBoxSize > 0 ? Math.floor(packableUnits / regularBoxSize) : 0;
    const defaultPartialUnits = regularBoxSize > 0 ? Math.round(packableUnits % regularBoxSize) : 0;

    const [fullBoxes, setFullBoxes] = useState(initialFullBoxes);
    const [partialUnits, setPartialUnits] = useState(initialPartialUnits);

    // Defective labels: default = 1 label per defective unit (each unit needs its own NO CONFORME sticker)
    const [defectiveBoxes, setDefectiveBoxes] = useState(defectiveTarros > 0 ? defectiveTarros : 0);

    const [qrDataUrl, setQrDataUrl] = useState('');
    const [printed, setPrinted] = useState(initialPrinted);
    const [printing, setPrinting] = useState(false);
    const [labelCopies, setLabelCopies] = useState(1);

    // Printer mode: 'bluetooth' (SAT) or 'network' (Zebra)
    const [mode, setMode] = useState(() => localStorage.getItem('label_printer_mode') || 'bluetooth');
    useEffect(() => { localStorage.setItem('label_printer_mode', mode); }, [mode]);

    // Bluetooth state
    const [printerConnected, setPrinterConnected] = useState(printer.isConnected());
    const [printerName, setPrinterName] = useState(printer.getDeviceName() || '');

    // Zebra state from global context (no local polling needed)
    const { zebraStatus, zebraIp, printZPL } = useZebra();
    const { user } = useAuth();
    const userInitials = toInitials(user?.name);


    const totalIngested = isWeightBased
        ? packableUnits
        : destino === 'maquila'
            ? maquilaNum
            : (Number(fullBoxes) * Number(unitsPerBox)) + Number(partialUnits) + pendingFillQty;
    // Valid if: destino selected AND (regular packing is correct, OR nothing to pack but special labels exist)
    const hasSpecialLabels = Number(contramuestraQty) > 0 || Number(defectiveBoxes) > 0 || maquilaLabelCount > 0;
    const isCarritoDone = hasCarriots && receivedQtyFromCarriots === 0 && packableUnits === 0;
    const destinoSelected = destino !== null || isWeightBased || isCarritoDone;
    const pendingBoxResolved = isWeightBased
        || !destino
        || pendingAnswer === 'no'
        || (pendingAnswer === 'yes' && pendingConfirmed);
    const distributionValid = destinoSelected && (
        (totalIngested > 0 && (destino === 'maquila' ? true : totalIngested <= packableUnits))
        || (totalIngested === 0 && packableUnits === 0 && hasSpecialLabels)
        || isCarritoDone
    );
    const isValid = distributionValid && pendingBoxResolved;
    const invalidReason = !destinoSelected
        ? 'Selecciona el destino de esta producción'
        : !pendingBoxResolved
            ? 'Confirma si hay una caja pendiente'
            : 'Ajusta la distribución de cajas';
    // Total labels = new full + partial + defective + contramuestra + pending + maquila
    const totalBoxesToPrint = (isWeightBased
        ? Number(labelCopies) + Number(defectiveBoxes)
        : Number(fullBoxes) + (Number(partialUnits) > 0 ? 1 : 0) + Number(defectiveBoxes) + (pendingFillQty > 0 ? 1 : 0))
        + Number(contramuestraQty)
        + maquilaLabelCount;

    // Listen for printer state changes
    useEffect(() => {
        if (mode !== 'bluetooth') return;
        const unsub = printer.onStateChange(({ connected, name }) => {
            setPrinterConnected(connected);
            if (name) setPrinterName(name);
        });
        printer.tryAutoReconnect().then(r => {
            if (r) { setPrinterConnected(true); setPrinterName(r.name || ''); }
        });
        return unsub;
    }, [mode]);


    // Notify wizard whenever boxes data changes
    useEffect(() => {
        onMarcadoChange?.({
            unidadesPorCaja: Number(unitsPerBox),
            cajasLlenas: Number(fullBoxes),
            unidadesSueltas: Number(partialUnits),
            totalCajas: totalBoxesToPrint,
            ingestTotal: destino === 'maquila' ? maquilaNum : totalIngested,
            contramuestraQty: Number(contramuestraQty),
            maquilaQty: maquilaNum,
            maquilaBoxSize,
            destino,
            pendingBoxFill: pendingFillQty,
            pendingBox: pendingAnswer === 'yes' && pendingConfirmed
                ? (pendingBox || { id: null, boxSize: pendingBoxSize, currentQty: Number(pendingCurrentUnits) || 0 })
                : null,
            pendingBoxOriginal: pendingBox,
            newPartialUnits: Number(partialUnits),
            invalidReason,
            isValid,
            printed
        });
    }, [unitsPerBox, fullBoxes, partialUnits, totalIngested, totalBoxesToPrint, invalidReason, isValid, contramuestraQty, maquilaNum, maquilaBoxSize, destino, pendingFillQty, pendingAnswer, pendingConfirmed, pendingBox, printed, onMarcadoChange]);

    // ── Fix: recalculate when freshEmpaque arrives (async fetch corrects stale initial state) ──
    // On first mount, approvedTarros/defectiveTarros come from stale processParameters (or fallback to totalTarros).
    // Once the fresh fetch resolves, we need to re-sync fullBoxes/partialUnits/defectiveBoxes.
    const freshEmpaqueInitRef = React.useRef(false);
    useEffect(() => {
        if (!freshEmpaque || freshEmpaqueInitRef.current || isWeightBased) return;
        freshEmpaqueInitRef.current = true;
        // Recalculate from fresh data (pendingFillQty uses packableUnits which already updated)
        const newApproved  = approvedTarros;
        const newDefective = defectiveTarros;
        const newPackable  = Math.max(0, newApproved - (isLiquipops350 ? 1 : 0));
        const fill = (pendingAnswer === 'yes' && pendingConfirmed && destino && destino !== 'maquila')
            ? Math.max(0, Math.min(pendingNeeds, newPackable)) : 0;
        const rem  = newPackable - fill;
        if (defaultUnitsPerBox > 0) {
            setFullBoxes(Math.floor(rem / defaultUnitsPerBox));
            setPartialUnits(Math.round(rem % defaultUnitsPerBox));
        }
        setDefectiveBoxes(newDefective > 0 ? newDefective : 0);
    }, [freshEmpaque]); // eslint-disable-line

    // Auto-correct box distribution when totalIngested exceeds packableUnits
    // Runs reactively whenever packableUnits or pendingFillQty change (fixes timing issues
    // when empaqueData loads async or pending box fetch resolves after initial state)
    const lastAutoCorrectRef = React.useRef('');
    useEffect(() => {
        if (packableUnits < 0 || unitsPerBox <= 0) return;
        const currentTotal = (Number(fullBoxes) * Number(unitsPerBox)) + Number(partialUnits) + pendingFillQty;
        if (currentTotal > packableUnits) {
            const remaining = Math.max(0, packableUnits - pendingFillQty);
            const defFull = Math.floor(remaining / unitsPerBox);
            const defPartial = Math.round(remaining % unitsPerBox);
            // Avoid infinite loop: only set if values actually changed
            const key = `${defFull}-${defPartial}`;
            if (lastAutoCorrectRef.current !== key) {
                lastAutoCorrectRef.current = key;
                setFullBoxes(defFull);
                setPartialUnits(defPartial);
            }
        }
    }, [packableUnits, pendingFillQty, unitsPerBox]); // eslint-disable-line

    // ── Fetch pending box for this product on mount ──────────────────────
    useEffect(() => {
        if (!product.id || !defaultUnitsPerBox || isWeightBased) return;
        setPendingBoxLoading(true);
        api.get(`/finished-lots/pending-box/${product.id}`, { params: { boxSize: defaultUnitsPerBox } })
            .then(res => {
                if (res.data && res.data.currentQty > 0) {
                    setPendingBox(res.data);
                }
            })
            .catch(err => console.warn('[MarcadoCajas] No pending box:', err.message))
            .finally(() => setPendingBoxLoading(false));
    }, [product.id, defaultUnitsPerBox]);

    // Recalculate box distribution when pending answer changes
    useEffect(() => {
        if (isWeightBased || (destino !== 'liquipops' && destino !== 'mixto')) return;
        const boxSz = unitsPerBox || defaultUnitsPerBox;
        if (boxSz <= 0) return;
        const fill = (pendingAnswer === 'yes' && pendingConfirmed && pendingCurrentUnits !== '')
            ? Math.min(Math.max(0, pendingBoxSize - Number(pendingCurrentUnits)), packableUnits) : 0;
        const rem = Math.max(0, packableUnits - fill);
        setFullBoxes(Math.floor(rem / boxSz));
        setPartialUnits(Math.round(rem % boxSz));
    }, [pendingAnswer, pendingConfirmed, pendingCurrentUnits]); // eslint-disable-line


    // ── QR generation (centralized via qrService) ────────────────────────────────────────
    const generateQR = useCallback(async () => {
        try {
            const { dataUrl } = await generateQrDataUrl(product.id, {
                lotNumber: batchNumber,
                quantity: unitsPerBox,
                expiresAt: expiryDate,
            });
            setQrDataUrl(dataUrl);
        } catch (e) {
            // Fallback to local generation if API fails
            console.warn('QR API fallback:', e);
            const { qrString } = buildQrPayloadLocal(product, batchNumber, unitsPerBox, expiryDate);
            try {
                const url = await QRCode.toDataURL(qrString, {
                    width: 400, margin: 2,
                    color: { dark: '#000000', light: '#FFFFFF' }
                });
                setQrDataUrl(url);
            } catch (e2) { console.error('QR fallback error:', e2); }
        }
    }, [product.id, product.sku, product.barcode, batchNumber, unitsPerBox, expiryDate]);

    useEffect(() => { generateQR(); }, [generateQR]);

    // ── Bluetooth connect ────────────────────────────────────────────────────
    const handleConnectPrinter = async () => {
        try {
            if (printerConnected) {
                const r = await printer.reconnect();
                if (r) { setPrinterConnected(true); setPrinterName(r.name || ''); }
            } else {
                const r = await printer.connect();
                if (r) { setPrinterConnected(true); setPrinterName(r.name || ''); }
            }
        } catch (err) {
            console.error('Printer connect error:', err);
        }
    };

    // Send ZPL via global ZebraContext
    const sendToZebra = async (zpl) => {
        const result = await printZPL(zpl);
        if (!result.ok) throw new Error(result.error || 'Error al imprimir en Zebra');
    };

    // ── Print (Dual Mode) ──────────────────────────────────────────────────
    const handlePrint = async () => {
        const isReady = mode === 'bluetooth' ? printerConnected : zebraStatus === 'connected';
        if (!isReady || !isValid) return;

        setPrinting(true);
        try {
            const baseData = {
                productName: product.name || '',
                sku: product.sku || '',
                barcode: product.barcode || '',
                lotNumber: batchNumber,
                unit: isWeightBased ? 'gramo' : 'und',
                receivedAt: noteData.productionBatch?.createdAt || new Date().toISOString(),
                expiresAt: expiryDate ? new Date(expiryDate).toISOString() : null,
                printedBy: userInitials,
            };

            const copies = Number(labelCopies) || 1;
            const nFull = isWeightBased ? copies : (Number(fullBoxes) || 0);
            const hasPartial = Number(partialUnits) > 0 && !isWeightBased;
            
            const nDefective = Number(defectiveBoxes) || 0;
            const defPerBox = nDefective > 0 ? Math.ceil(defectiveTarros / nDefective) : 0;
            const delay = mode === 'bluetooth' ? 1500 : 300;

            if (mode === 'bluetooth') {
                // ── PENDING BOX label (completing previous partial box) ──
                if (pendingFillQty > 0) {
                    // Use pendingFillQty (units FROM THIS LOT) not boxSize (total box).
                    // This ensures label quantities = exact production output.
                    const label = buildLotLabel({ ...baseData, quantity: pendingFillQty, statusText: 'CAJA COMPLETADA' }, 1);
                    await printer.sendTSPL(label);
                    await new Promise(r => setTimeout(r, delay));
                }
                for (let i = 0; i < nFull; i++) {
                    const label = buildLotLabel({ ...baseData, quantity: isWeightBased ? approvedTarros : Number(unitsPerBox) }, 1);
                    await printer.sendTSPL(label);
                    if (i < nFull - 1 || hasPartial || nDefective > 0) await new Promise(r => setTimeout(r, delay));
                }
                if (hasPartial) {
                    const label = buildLotLabel({ ...baseData, quantity: Number(partialUnits) }, 1);
                    await printer.sendTSPL(label);
                    if (nDefective > 0) await new Promise(r => setTimeout(r, delay));
                }
                for (let i = 0; i < nDefective; i++) {
                    const qty = (i === nDefective - 1 && defectiveTarros > 0) ? defectiveTarros - (defPerBox * i) : defPerBox;
                    const label = buildLotLabel({ ...baseData, quantity: qty, statusText: 'OUTLET - PUBLICIDAD' }, 1);
                    await printer.sendTSPL(label);
                    if (i < nDefective - 1 || contramuestraQty > 0) await new Promise(r => setTimeout(r, delay));
                }
                // ── CONTRAMUESTRA labels (LIQUIPOPS 350g only) ──
                for (let i = 0; i < contramuestraQty; i++) {
                    const label = buildLotLabel({ ...baseData, quantity: 1, statusText: 'CONTRAMUESTRA' }, 1);
                    await printer.sendTSPL(label);
                    if (i < contramuestraQty - 1 || maquilaNum > 0) await new Promise(r => setTimeout(r, delay));
                }
                // ── MAQUILA labels ──
                for (let i = 0; i < maquilaFullBoxes; i++) {
                    const label = buildLotLabel({ ...baseData, quantity: maquilaBoxSize, statusText: '' }, 1, { maquila: true });
                    await printer.sendTSPL(label);
                    if (i < maquilaFullBoxes - 1 || maquilaPartialUnits > 0) await new Promise(r => setTimeout(r, delay));
                }
                if (maquilaPartialUnits > 0) {
                    const label = buildLotLabel({ ...baseData, quantity: maquilaPartialUnits, statusText: '' }, 1, { maquila: true });
                    await printer.sendTSPL(label);
                }
            } else {
                // Zebra Mode (ZPL via WiFi)
                // FIX: Use ^PQ{N} for identical labels instead of N separate ZPL jobs.
                // Sending separate jobs causes backfeed/reposition cycles that skip labels.

                // ── PENDING BOX label (completing previous partial box) ──
                if (pendingFillQty > 0) {
                    // Use pendingFillQty (units FROM THIS LOT) not boxSize (total box).
                    // This ensures label quantities = exact production output.
                    const label = buildLotLabelZPL({ ...baseData, quantity: pendingFillQty, statusText: 'CAJA COMPLETADA' }, 1);
                    await sendToZebra(label);
                    if (nFull > 0 || hasPartial || nDefective > 0) await new Promise(r => setTimeout(r, delay));
                }
                // ── FULL BOXES: single job with ^PQ{nFull} ──
                if (nFull > 0) {
                    const label = buildLotLabelZPL({ ...baseData, quantity: isWeightBased ? approvedTarros : Number(unitsPerBox) }, nFull);
                    await sendToZebra(label);
                    if (hasPartial || nDefective > 0 || contramuestraQty > 0 || maquilaNum > 0) await new Promise(r => setTimeout(r, delay));
                }
                // ── PARTIAL BOX: single label ──
                if (hasPartial) {
                    const label = buildLotLabelZPL({ ...baseData, quantity: Number(partialUnits) }, 1);
                    await sendToZebra(label);
                    if (nDefective > 0 || contramuestraQty > 0 || maquilaNum > 0) await new Promise(r => setTimeout(r, delay));
                }
                // ── DEFECTIVE: ^PQ{nDefective} labels, each with per-label qty ──
                if (nDefective > 0) {
                    const label = buildLotLabelZPL({ ...baseData, quantity: defPerBox, statusText: 'OUTLET - PUBLICIDAD' }, nDefective);
                    await sendToZebra(label);
                    if (contramuestraQty > 0 || maquilaNum > 0) await new Promise(r => setTimeout(r, delay));
                }
                // ── CONTRAMUESTRA labels ──
                if (contramuestraQty > 0) {
                    const label = buildLotLabelZPL({ ...baseData, quantity: 1, statusText: 'CONTRAMUESTRA' }, contramuestraQty);
                    await sendToZebra(label);
                    if (maquilaNum > 0) await new Promise(r => setTimeout(r, delay));
                }
                // ── MAQUILA labels: batch full boxes ──
                if (maquilaFullBoxes > 0) {
                    const label = buildLotLabelZPL({ ...baseData, quantity: maquilaBoxSize, statusText: '' }, maquilaFullBoxes, { maquila: true });
                    await sendToZebra(label);
                    if (maquilaPartialUnits > 0) await new Promise(r => setTimeout(r, delay));
                }
                if (maquilaPartialUnits > 0) {
                    const label = buildLotLabelZPL({ ...baseData, quantity: maquilaPartialUnits, statusText: '' }, 1, { maquila: true });
                    await sendToZebra(label);
                }
            }

            // ── PERSISTIR ETIQUETAS EN BD ──
            // El flag `setPrinted(true)` solo vivía en memoria; al recargar se
            // perdía. Ahora persistimos cada etiqueta en `package_labels` con
            // `printedAt` para auditoría y para que la UI sobreviva F5.
            try {
                const labels = [];
                let seqCounter = 1;
                const totalCount =
                    (pendingFillQty > 0 ? 1 : 0) + nFull + (hasPartial ? 1 : 0) +
                    nDefective + contramuestraQty + maquilaFullBoxes + (maquilaPartialUnits > 0 ? 1 : 0);
                const pushLabel = (qty, statusText, opts = {}) => {
                    labels.push({
                        productId: product.id,
                        lotNumber: batchNumber,
                        zone: 'PRODUCCION',
                        quantity: qty,
                        unit: isWeightBased ? 'gramo' : 'und',
                        packLabel: opts.packLabel || statusText || null,
                        packContainerType: opts.packContainerType || null,
                        sequence: seqCounter++,
                        totalPackages: totalCount,
                    });
                };
                if (pendingFillQty > 0) pushLabel(pendingFillQty, 'CAJA COMPLETADA');
                for (let i = 0; i < nFull; i++) pushLabel(isWeightBased ? approvedTarros : Number(unitsPerBox), 'COMPLETA');
                if (hasPartial) pushLabel(Number(partialUnits), 'PARCIAL');
                for (let i = 0; i < nDefective; i++) {
                    const qty = (i === nDefective - 1 && defectiveTarros > 0) ? defectiveTarros - (defPerBox * i) : defPerBox;
                    pushLabel(qty, 'OUTLET - PUBLICIDAD');
                }
                for (let i = 0; i < contramuestraQty; i++) pushLabel(1, 'CONTRAMUESTRA');
                for (let i = 0; i < maquilaFullBoxes; i++) pushLabel(maquilaBoxSize, 'MAQUILA');
                if (maquilaPartialUnits > 0) pushLabel(maquilaPartialUnits, 'MAQUILA');

                if (labels.length > 0) {
                    const url = window.location.pathname.includes('/geniality/')
                        ? `/geniality/assembly-notes/${noteData.id}/package-labels`
                        : `/assembly-notes/${noteData.id}/package-labels`;
                    await api.post(url, { labels });
                    console.log(`[MarcadoCajas] ✓ ${labels.length} etiquetas persistidas en BD`);
                }
            } catch (persistErr) {
                console.error('[MarcadoCajas] FALLO persistencia de etiquetas:', persistErr);
                // Encolar para reintento background
                try {
                    const queue = JSON.parse(localStorage.getItem('package_labels_retry_queue') || '[]');
                    queue.push({ noteId: noteData.id, labels, ts: Date.now() });
                    localStorage.setItem('package_labels_retry_queue', JSON.stringify(queue));
                    alert('⚠️ Etiquetas IMPRESAS pero NO guardadas en BD. Se reintentará automáticamente. Avisa al admin si persiste.');
                } catch {}
            }

            setPrinted(true);
        } catch (err) {
            console.error('Print error:', err);
            if (mode === 'bluetooth' && (err.message?.includes('NetworkError') || err.message?.includes('disconnected'))) {
                setPrinterConnected(false);
            } else if (mode === 'network') {
                console.warn('[MarcadoCajas] Zebra print failed:', err.message);
            }
            alert('Error al imprimir: ' + err.message);
        } finally {
            setPrinting(false);
        }
    };

    // ── Render ────────────────────────────────────────────────────────────────
    const flavor = (product.name || '').replace(/LIQUIPOPS SABOR A?\s*/i, '').replace(/X\s*\d+/i, '').trim();
    const size = (product.name || '').match(/\d{3,4}\s*GR/i)?.[0] || '';
    const formattedExpiry = new Date(expiryDate).toLocaleDateString('es-CO');

    return (
        <div className="flex flex-col h-full max-w-4xl mx-auto pt-2 pb-24 px-4">
            {/* Header */}
            <div className="flex items-center gap-2 mb-3">
                <div className="h-8 w-8 rounded-full bg-orange-500 text-white flex items-center justify-center font-bold text-base shadow">
                    📦
                </div>
                <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                    Rotulado de Cajas
                </div>
            </div>

            {/* Card */}
            <div className="bg-white rounded-2xl shadow-lg border-2 border-orange-400 overflow-hidden flex-1 flex flex-col animate-in slide-in-from-right-8 duration-300">
                <div className="bg-gradient-to-r from-orange-500 to-amber-400 py-2 px-4 text-center">
                    <span className="text-white font-extrabold text-sm uppercase tracking-widest">
                        📦 Rotulado de Cajas
                    </span>
                </div>

                <div className="flex-1 flex flex-col lg:flex-row gap-4 p-4">
                    {/* Left: data + controls */}
                    <div className="flex-1 space-y-2">
                        <h2 className="text-base font-black text-slate-800">{product.name}</h2>

                        {/* Summary cards — full production breakdown */}
                        <div className={`grid ${isLiquipops350 ? 'grid-cols-5' : 'grid-cols-4'} gap-2 mb-4`}>
                            {/* Programadas */}
                            <div className="bg-slate-50 rounded-2xl p-3 text-center border border-slate-200">
                                <div className="text-[10px] text-slate-500 font-bold uppercase mb-1 leading-tight">📋 Programadas</div>
                                <div className="text-2xl font-black text-slate-700">{Number(plannedTarros).toLocaleString('es-CO')}</div>
                                <div className="text-xs text-slate-400 mt-0.5">{metaLabel}</div>
                            </div>
                            {/* Real Fabricado */}
                            <div className="bg-indigo-50 rounded-2xl p-3 text-center border border-indigo-200">
                                <div className="text-[10px] text-indigo-500 font-bold uppercase mb-1 leading-tight">🏭 Real Fabricado</div>
                                <div className="text-2xl font-black text-indigo-700">{Number(receivedTarros).toLocaleString('es-CO')}</div>
                                <div className="text-xs text-indigo-400 mt-0.5">
                                    {receivedTarros > plannedTarros
                                        ? <span className="text-emerald-600 font-bold">+{receivedTarros - plannedTarros} extra</span>
                                        : receivedTarros < plannedTarros
                                        ? <span className="text-amber-600 font-bold">-{plannedTarros - receivedTarros} faltante</span>
                                        : metaLabel}
                                </div>
                            </div>
                            {/* Empacado (para venta — excluye contramuestra) */}
                            <div className="bg-orange-50 rounded-2xl p-3 text-center border border-orange-200">
                                <div className="text-[10px] text-orange-500 font-bold uppercase mb-1 leading-tight">✅ Empacado</div>
                                <div className="text-2xl font-black text-orange-700">{Number(packableUnits).toLocaleString('es-CO')}</div>
                                <div className="text-xs text-orange-400 mt-0.5">para venta</div>
                            </div>
                            {/* En Mal Estado */}
                            <div className={`rounded-2xl p-3 text-center border ${defectiveTarros > 0 ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-100'}`}>
                                <div className={`text-[10px] font-bold uppercase mb-1 leading-tight ${defectiveTarros > 0 ? 'text-red-500' : 'text-slate-400'}`}>⚠️ En Mal Estado</div>
                                <div className={`text-2xl font-black ${defectiveTarros > 0 ? 'text-red-700' : 'text-slate-400'}`}>{Number(defectiveTarros).toLocaleString('es-CO')}</div>
                                <div className={`text-xs mt-0.5 ${defectiveTarros > 0 ? 'text-red-400' : 'text-slate-300'}`}>
                                    {defectiveTarros > 0 ? `${Math.round((defectiveTarros / receivedTarros) * 100)}% merma` : 'sin defectos'}
                                </div>
                            </div>
                            {/* Contramuestra (solo 350g) */}
                            {isLiquipops350 && (
                                <div className="bg-purple-50 rounded-2xl p-3 text-center border border-purple-200">
                                    <div className="text-[10px] text-purple-500 font-bold uppercase mb-1 leading-tight">🧪 Contramuestra</div>
                                    <div className="text-2xl font-black text-purple-700">{contramuestraQty}</div>
                                    <div className="text-xs text-purple-400 mt-0.5">vida útil</div>
                                </div>
                            )}
                        </div>

                        {/* Carrito Done Banner */}
                        {isCarritoDone && (
                            <div className="bg-emerald-50 rounded-2xl p-4 border-2 border-emerald-300 mb-3 animate-in fade-in">
                                <div className="flex items-start gap-3">
                                    <span className="text-xl">✅</span>
                                    <div>
                                        <div className="text-sm font-bold text-emerald-800 uppercase tracking-wider mb-1">
                                            Carritos Completados
                                        </div>
                                        <div className="text-xs text-emerald-700">
                                            Las etiquetas ya fueron impresas durante la recepción individual de cada carrito. Puedes presionar <strong>"Etiquetas Listas"</strong> para continuar al cierre del lote.
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* ── SELECTOR DE DESTINO (obligatorio) ── */}
                        {!isWeightBased && !isCarritoDone && (
                            <div className={`rounded-2xl p-4 mb-3 border-2 ${!destino ? 'bg-amber-50 border-amber-400 animate-pulse' : 'bg-slate-50 border-slate-200'}`}>
                                <div className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-3">
                                    {!destino ? '👇 Selecciona el destino de esta producción' : 'Destino de producción'}
                                </div>
                                <div className="grid grid-cols-3 gap-2">
                                    <button
                                        onClick={() => setDestino('liquipops')}
                                        className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 transition-all font-bold text-sm ${destino === 'liquipops' ? 'bg-orange-500 text-white border-orange-500 shadow-lg scale-105' : 'bg-white text-slate-600 border-slate-200 hover:border-orange-300 hover:bg-orange-50'}`}
                                    >
                                        <Package size={20} />
                                        <span>Liquipops</span>
                                        <span className={`text-[10px] font-normal ${destino === 'liquipops' ? 'text-orange-100' : 'text-slate-400'}`}>Cajas de {defaultUnitsPerBox}</span>
                                    </button>
                                    <button
                                        onClick={() => setDestino('maquila')}
                                        className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 transition-all font-bold text-sm ${destino === 'maquila' ? 'bg-teal-500 text-white border-teal-500 shadow-lg scale-105' : 'bg-white text-slate-600 border-slate-200 hover:border-teal-300 hover:bg-teal-50'}`}
                                    >
                                        <Factory size={20} />
                                        <span>Maquila</span>
                                        <span className={`text-[10px] font-normal ${destino === 'maquila' ? 'text-teal-100' : 'text-slate-400'}`}>Cajas de {MAQUILA_UNITS_PER_BOX}</span>
                                    </button>
                                    <button
                                        onClick={() => setDestino('mixto')}
                                        className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 transition-all font-bold text-sm ${destino === 'mixto' ? 'bg-violet-500 text-white border-violet-500 shadow-lg scale-105' : 'bg-white text-slate-600 border-slate-200 hover:border-violet-300 hover:bg-violet-50'}`}
                                    >
                                        <Package size={20} />
                                        <span>Mixto</span>
                                        <span className={`text-[10px] font-normal ${destino === 'mixto' ? 'text-violet-100' : 'text-slate-400'}`}>Ambas líneas</span>
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* ── MIXTO: input de maquila qty ── */}
                        {destino === 'mixto' && (
                            <div className="bg-violet-50 rounded-2xl p-4 border-2 border-violet-300 mb-3">
                                <div className="flex items-center gap-4">
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2 mb-1">
                                            <Factory size={14} className="text-violet-600" />
                                            <span className="text-xs font-bold text-violet-600 uppercase tracking-wider">Unidades para Maquila</span>
                                        </div>
                                        <div className="text-[10px] text-violet-500">
                                            Cajas de {MAQUILA_UNITS_PER_BOX} uds. El resto ({packableUnits} uds) va a Liquipops en cajas de {defaultUnitsPerBox}.
                                        </div>
                                    </div>
                                    <div className="w-32">
                                        <label className="text-[10px] font-bold text-violet-400 uppercase">Cant. Uds</label>
                                        <input type="number" min="0" max={approvedTarros - contramuestraQty}
                                            className="w-full mt-1 px-3 py-2 rounded-xl border-2 border-violet-300 bg-white font-bold text-center text-violet-700 text-lg focus:outline-none focus:border-violet-500 transition-colors"
                                            value={maquilaQty === '' ? '' : maquilaQty}
                                            onChange={e => {
                                                const val = e.target.value === '' ? '' : Math.min(Number(e.target.value), approvedTarros - contramuestraQty);
                                                setMaquilaQty(val);
                                                if (val !== '' && defaultUnitsPerBox > 0) {
                                                    const newPack = Math.max(0, approvedTarros - contramuestraQty - Number(val));
                                                    const fill = (pendingAnswer === 'yes' && pendingConfirmed)
                                                        ? Math.max(0, Math.min(pendingNeeds, newPack)) : 0;
                                                    const rem = newPack - fill;
                                                    setFullBoxes(Math.floor(rem / defaultUnitsPerBox));
                                                    setPartialUnits(Math.round(rem % defaultUnitsPerBox));
                                                }
                                            }} />
                                    </div>
                                </div>
                                {maquilaNum > 0 && (
                                    <div className="mt-2 pt-2 border-t border-violet-200 grid grid-cols-2 gap-3 text-[11px]">
                                        <div className="bg-teal-50 rounded-xl p-2 border border-teal-200">
                                            <span className="font-bold text-teal-700">MAQUILA:</span>{' '}
                                            <span className="text-teal-600">
                                                {maquilaFullBoxes > 0 ? `${maquilaFullBoxes} caja${maquilaFullBoxes > 1 ? 's' : ''} x ${MAQUILA_UNITS_PER_BOX}` : ''}
                                                {maquilaFullBoxes > 0 && maquilaPartialUnits > 0 ? ' + ' : ''}
                                                {maquilaPartialUnits > 0 ? `${maquilaPartialUnits} sueltas` : ''}
                                                {' '}= <strong>{maquilaLabelCount} etiq.</strong>
                                            </span>
                                        </div>
                                        <div className="bg-orange-50 rounded-xl p-2 border border-orange-200">
                                            <span className="font-bold text-orange-700">LIQUIPOPS:</span>{' '}
                                            <span className="text-orange-600">
                                                {fullBoxes > 0 ? `${fullBoxes} caja${fullBoxes > 1 ? 's' : ''} x ${defaultUnitsPerBox}` : ''}
                                                {fullBoxes > 0 && partialUnits > 0 ? ' + ' : ''}
                                                {partialUnits > 0 ? `${partialUnits} sueltas` : ''}
                                                {pendingFillQty > 0 ? ` + ${pendingFillQty} caja pend.` : ''}
                                            </span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Cant. a Empacar — inline row */}
                        {destino && (
                        <div className={`rounded-2xl px-4 py-2.5 mb-3 flex items-center justify-between border-2 ${isValid ? 'bg-emerald-50 border-emerald-300' : 'bg-red-50 border-red-300'}`}>
                            <div className={`text-xs font-bold uppercase tracking-wider ${isValid ? 'text-emerald-600' : 'text-red-500'}`}>Cant. a Empacar (en etiquetas)</div>
                            <div className="flex items-baseline gap-1.5">
                                <span className={`text-2xl font-black ${isValid ? 'text-emerald-700' : 'text-red-600'}`}>
                                    {destino === 'maquila' ? maquilaNum : totalIngested}
                                    {destino === 'mixto' && maquilaNum > 0 ? ` + ${maquilaNum}` : ''}
                                </span>
                                <span className={`text-xs ${isValid ? 'text-emerald-500' : 'text-red-400'}`}>
                                    → {totalBoxesToPrint} etiqueta{totalBoxesToPrint !== 1 ? 's' : ''}
                                </span>
                            </div>
                        </div>
                        )}

                        {/* ── PREGUNTA CAJA PENDIENTE (obligatoria antes de imprimir) ── */}
                        {!isWeightBased && destino && pendingAnswer === null && (
                            <div className="rounded-2xl p-4 mb-3 border-2 bg-amber-50 border-amber-400 animate-in fade-in">
                                <div className="text-sm font-bold text-amber-800 text-center mb-1">
                                    ¿Hay alguna caja abierta pendiente por llenar?
                                </div>
                                {pendingBox && (
                                    <div className="text-[10px] text-amber-600 text-center mb-3">
                                        El sistema registra una caja del lote {pendingBox.entries?.[0]?.lot || '—'} con {pendingBox.currentQty} uds
                                    </div>
                                )}
                                {!pendingBox && (
                                    <div className="text-[10px] text-amber-500 text-center mb-3">
                                        El sistema no registra cajas pendientes, pero verifica físicamente
                                    </div>
                                )}
                                <div className="grid grid-cols-2 gap-3">
                                    <button
                                        onClick={() => setPendingAnswer('yes')}
                                        className="flex flex-col items-center gap-1 p-3 rounded-xl border-2 border-amber-300 bg-white hover:bg-blue-50 hover:border-blue-400 transition-all font-bold text-sm text-slate-700"
                                    >
                                        <PackagePlus size={22} className="text-blue-500" />
                                        <span>Sí, hay una caja</span>
                                    </button>
                                    <button
                                        onClick={() => setPendingAnswer('no')}
                                        className="flex flex-col items-center gap-1 p-3 rounded-xl border-2 border-amber-300 bg-white hover:bg-green-50 hover:border-green-400 transition-all font-bold text-sm text-slate-700"
                                    >
                                        <Package size={22} className="text-green-500" />
                                        <span>No, todas cerradas</span>
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Si respondió SÍ — pedir cuántas uds tiene la caja */}
                        {!isWeightBased && destino && pendingAnswer === 'yes' && !pendingConfirmed && (
                            <div className="rounded-2xl p-4 mb-3 border-2 bg-blue-50 border-blue-400 animate-in fade-in">
                                <div className="text-sm font-bold text-blue-800 text-center mb-3">
                                    ¿Cuántas uds tiene la caja actualmente?
                                </div>
                                <div className="flex items-center justify-center gap-3 mb-3">
                                    <input
                                        type="number" min="0" max={pendingBoxSize - 1}
                                        placeholder="Ej: 18"
                                        autoFocus
                                        className="w-32 px-3 py-3 rounded-xl border-2 border-blue-400 bg-white font-black text-center text-2xl text-blue-700 focus:outline-none focus:border-blue-600 transition-colors"
                                        value={pendingCurrentUnits}
                                        onFocus={e => e.target.select()}
                                        onChange={e => {
                                            const raw = e.target.value;
                                            if (raw === '') { setPendingCurrentUnits(''); return; }
                                            setPendingCurrentUnits(Math.min(Math.max(0, parseInt(raw, 10) || 0), pendingBoxSize - 1));
                                        }}
                                    />
                                    <span className="text-lg text-blue-400 font-bold">/ {pendingBoxSize}</span>
                                </div>
                                {pendingCurrentUnits !== '' && (
                                    <div className="text-center text-sm text-blue-700 font-semibold mb-3">
                                        Faltan <strong className="text-blue-900">{pendingBoxSize - Number(pendingCurrentUnits)}</strong> uds para completar la caja
                                    </div>
                                )}
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => { setPendingAnswer(null); setPendingCurrentUnits(''); }}
                                        className="flex-1 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-50 transition-all"
                                    >
                                        Volver
                                    </button>
                                    <button
                                        onClick={() => setPendingConfirmed(true)}
                                        disabled={pendingCurrentUnits === ''}
                                        className={`flex-[2] py-2.5 text-white text-sm font-bold rounded-xl transition-all ${pendingCurrentUnits === '' ? 'bg-slate-300 cursor-not-allowed' : 'bg-blue-500 hover:bg-blue-600'}`}
                                    >
                                        {pendingCurrentUnits === '' ? 'Ingresa la cantidad' : `Confirmar: se tomarán ${Math.min(pendingBoxSize - Number(pendingCurrentUnits), packableUnits)} uds`}
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Resumen confirmado de caja pendiente */}
                        {!isWeightBased && destino && pendingAnswer === 'yes' && pendingConfirmed && (
                            <div className="rounded-xl px-3 py-2 mb-2 bg-blue-50 border border-blue-200 flex items-center justify-between animate-in fade-in">
                                <span className="text-xs text-blue-700 font-semibold">
                                    📦 Caja pendiente: {pendingCurrentUnits}/{pendingBoxSize} uds — se tomarán <strong>{pendingFillQty}</strong> de este lote
                                </span>
                                <button onClick={() => { setPendingConfirmed(false); setPendingAnswer(null); setPendingCurrentUnits(''); }} className="text-blue-500 hover:text-blue-700 text-[10px] font-bold underline">Cambiar</button>
                            </div>
                        )}

                        {/* Resumen: no hay cajas pendientes */}
                        {!isWeightBased && destino && pendingAnswer === 'no' && (
                            <div className="rounded-xl px-3 py-2 mb-2 bg-green-50 border border-green-200 flex items-center justify-between">
                                <span className="text-xs text-green-700 font-semibold">✅ Sin cajas pendientes — todas las unidades van a cajas nuevas</span>
                                <button onClick={() => setPendingAnswer(null)} className="text-green-500 hover:text-green-700 text-[10px] font-bold underline">Cambiar</button>
                            </div>
                        )}

                        {/* Box Config — only for liquipops or mixto (regular portion) */}
                        {!isWeightBased && (destino === 'liquipops' || destino === 'mixto') && (
                            <div className="bg-orange-50 rounded-xl p-3 border border-orange-200 mb-2">
                                <div className="text-xs font-bold text-orange-600 uppercase tracking-wider mb-3">
                                    Distribución Liquipops — Cajas de {defaultUnitsPerBox}
                                </div>
                                <div className="flex gap-3">
                                    <div className="flex-1">
                                        <label className="text-[10px] font-bold text-slate-400 uppercase">Cajas Completas</label>
                                        <input type="number" min="0"
                                            className="w-full mt-1 px-3 py-2 rounded-xl border-2 border-orange-200 font-bold text-center focus:outline-none focus:border-orange-400 transition-colors"
                                            value={fullBoxes === '' ? '' : fullBoxes}
                                            onChange={e => setFullBoxes(e.target.value === '' ? '' : Number(e.target.value))} />
                                    </div>
                                    <div className="flex-1">
                                        <label className="text-[10px] font-bold text-slate-400 uppercase">Uds por Caja</label>
                                        <input type="number" min="1"
                                            className="w-full mt-1 px-3 py-2 rounded-xl border-2 border-orange-200 font-bold text-center focus:outline-none focus:border-orange-400 transition-colors"
                                            value={unitsPerBox === '' ? '' : unitsPerBox}
                                            onChange={e => setUnitsPerBox(e.target.value === '' ? '' : Number(e.target.value))} />
                                    </div>
                                    <div className="flex-1">
                                        <label className="text-[10px] font-bold text-slate-400 uppercase">Uds Sueltas</label>
                                        <input type="number" min="0"
                                            className="w-full mt-1 px-3 py-2 rounded-xl border-2 border-orange-200 font-bold text-center focus:outline-none focus:border-orange-400 transition-colors"
                                            value={partialUnits === '' ? '' : partialUnits}
                                            onChange={e => setPartialUnits(e.target.value === '' ? '' : Number(e.target.value))} />
                                    </div>
                                </div>
                                {totalIngested > packableUnits && (
                                    <div className="mt-3 text-xs font-bold text-red-500 bg-red-50 p-2.5 rounded-xl border border-red-100 flex items-center gap-2">
                                        <span className="text-base">⚠️</span> Bloqueo: El empaque ({totalIngested}) no puede superar lo disponible ({packableUnits}).
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Box Config — maquila full (all units) */}
                        {!isWeightBased && destino === 'maquila' && (
                            <div className="bg-teal-50 rounded-xl p-3 border border-teal-200 mb-2">
                                <div className="text-xs font-bold text-teal-600 uppercase tracking-wider mb-3">
                                    Distribución Maquila — Cajas de {MAQUILA_UNITS_PER_BOX}
                                </div>
                                <div className="flex gap-3">
                                    <div className="flex-1">
                                        <label className="text-[10px] font-bold text-slate-400 uppercase">Cajas Completas</label>
                                        <div className="w-full mt-1 px-3 py-2 rounded-xl border-2 border-teal-200 bg-teal-100 font-bold text-center text-teal-700">{maquilaFullBoxes}</div>
                                    </div>
                                    <div className="flex-1">
                                        <label className="text-[10px] font-bold text-slate-400 uppercase">Uds por Caja</label>
                                        <div className="w-full mt-1 px-3 py-2 rounded-xl border-2 border-teal-200 bg-teal-100 font-bold text-center text-teal-700">{MAQUILA_UNITS_PER_BOX}</div>
                                    </div>
                                    <div className="flex-1">
                                        <label className="text-[10px] font-bold text-slate-400 uppercase">Uds Sueltas</label>
                                        <div className="w-full mt-1 px-3 py-2 rounded-xl border-2 border-teal-200 bg-teal-100 font-bold text-center text-teal-700">{maquilaPartialUnits}</div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Defective Box Config */}
                        {defectiveTarros > 0 && destino && (
                            <div className="bg-red-50 rounded-2xl p-4 border border-red-200 mb-4 flex items-center gap-4">
                                <div className="flex-1">
                                    <div className="text-xs font-bold text-red-600 uppercase tracking-wider mb-1">Rotulado Outlet / Publicidad</div>
                                    <div className="text-[10px] text-red-500">Se imprimirán etiquetas exclusivas de merma.</div>
                                </div>
                                <div className="w-32">
                                    <label className="text-[10px] font-bold text-red-400 uppercase">Cant. Etiquetas</label>
                                    <input type="number" min="0"
                                        className="w-full mt-1 px-3 py-2 rounded-xl border-2 border-red-200 bg-white font-bold text-center text-red-600 focus:outline-none focus:border-red-400 transition-colors"
                                        value={defectiveBoxes === '' ? '' : defectiveBoxes}
                                        onChange={e => setDefectiveBoxes(e.target.value === '' ? '' : Number(e.target.value))} />
                                </div>
                            </div>
                        )}

                        {/* Contramuestra Config (solo LIQUIPOPS 350g) */}
                        {isLiquipops350 && destino && (
                            <div className="bg-purple-50 rounded-2xl p-4 border border-purple-200 mb-4 flex items-center gap-4">
                                <div className="flex-1">
                                    <div className="text-xs font-bold text-purple-600 uppercase tracking-wider mb-1">Contramuestra</div>
                                    <div className="text-[10px] text-purple-500">Etiqueta marcada "CONTRAMUESTRA" para retención de calidad.</div>
                                </div>
                                <div className="w-32">
                                    <label className="text-[10px] font-bold text-purple-400 uppercase">Cant. Etiquetas</label>
                                    <input type="number" min="0" max="3"
                                        className="w-full mt-1 px-3 py-2 rounded-xl border-2 border-purple-200 bg-white font-bold text-center text-purple-600 focus:outline-none focus:border-purple-400 transition-colors"
                                        value={contramuestraQty === '' ? '' : contramuestraQty}
                                        onChange={e => setContramuestraQty(e.target.value === '' ? '' : Number(e.target.value))} />
                                </div>
                            </div>
                        )}

                        {/* ── SECCIÓN DE IMPRESIÓN ──────────────────────────────── */}

                        {/* Printer selector + status — fila compacta */}
                        <div className="flex items-center gap-2 mb-3">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider shrink-0">Impresora:</span>
                            <button
                                onClick={() => setMode('bluetooth')}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all border ${mode === 'bluetooth' ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}
                            >
                                <Bluetooth size={11} /> SAT AF330
                            </button>
                            <button
                                onClick={() => setMode('network')}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all border ${mode === 'network' ? 'bg-orange-500 text-white border-orange-500 shadow-sm' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}
                            >
                                <Wifi size={11} /> Zebra WiFi
                            </button>
                            {/* Status dot — inline */}
                            {(() => {
                                const isReady = mode === 'bluetooth' ? printerConnected : zebraStatus === 'connected';
                                return (
                                    <span className={`flex items-center gap-1 ml-auto text-xs font-semibold shrink-0 ${isReady ? 'text-emerald-600' : 'text-slate-400'}`}>
                                        <span className={`w-2 h-2 rounded-full ${isReady ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`} />
                                        {isReady ? 'Lista' : 'No conectada'}
                                    </span>
                                );
                            })()}
                        </div>

                        {/* Botón de conectar — solo si no está lista */}
                        {mode === 'bluetooth' && !printerConnected && (
                            <button
                                onClick={handleConnectPrinter}
                                className="w-full py-2 mb-3 bg-indigo-500 hover:bg-indigo-600 text-white text-sm font-bold rounded-xl transition-all flex items-center justify-center gap-2"
                            >
                                <Bluetooth size={15} /> Conectar SAT AF330
                            </button>
                        )}
                        {mode === 'network' && zebraStatus !== 'connected' && (
                            <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-orange-50 border border-orange-200 rounded-xl text-xs text-orange-700 font-semibold">
                                <WifiOff size={14} />
                                {zebraStatus === 'unreachable' ? 'Zebra no alcanzable — verifica que esté encendida y en red' : 'Verificando Zebra...'}
                            </div>
                        )}

                        {/* Resumen de lo que se va a imprimir — espeja exactamente handlePrint */}
                        {distributionValid && (() => {
                            // Replicar la misma lógica de handlePrint para que los chips
                            // muestren exactamente lo que saldrá de la impresora
                            const nFull = isWeightBased ? Number(labelCopies) : (Number(fullBoxes) || 0);
                            const hasPartial = Number(partialUnits) > 0 && !isWeightBased;
                            const nDef = Number(defectiveBoxes) || 0;
                            const defCantPerLabel = nDef > 0 ? Math.ceil(defectiveTarros / nDef) : 0;
                            const fullCant = isWeightBased ? Number(approvedTarros) : Number(unitsPerBox);
                            return (
                                <div className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 mb-3">
                                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                                        Lo que se va a imprimir
                                    </div>
                                    <div className="flex flex-col gap-1.5 mb-2">
                                        {/* Caja completada (pending box from previous lot) */}
                                        {pendingFillQty > 0 && pendingAnswer === 'yes' && (
                                            <div className="flex items-center gap-2">
                                                <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-xs font-bold min-w-[80px] text-center">
                                                    1 etiqueta
                                                </span>
                                                <span className="text-xs text-slate-500">→</span>
                                                <span className="text-xs font-bold text-slate-700">
                                                    <span className="font-black text-blue-600">CANT: {pendingFillQty}</span>
                                                    <span className="text-slate-400 font-normal ml-1">
                                                        uds — 📦 CAJA COMPLETADA
                                                        <span className="text-blue-400 ml-1">(+{pendingCurrentUnits} lote ant. = {pendingBoxSize} total)</span>
                                                    </span>
                                                </span>
                                            </div>
                                        )}
                                        {/* Cajas completas / copias gramaje */}
                                        {nFull > 0 && (
                                            <div className="flex items-center gap-2">
                                                <span className="bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full text-xs font-bold min-w-[80px] text-center">
                                                    {nFull} etiqueta{nFull > 1 ? 's' : ''}
                                                </span>
                                                <span className="text-xs text-slate-500">→</span>
                                                <span className="text-xs font-bold text-slate-700">
                                                    <span className="font-black text-orange-600">CANT: {fullCant.toLocaleString('es-CO')}</span>
                                                    <span className="text-slate-400 font-normal ml-1">
                                                        {isWeightBased ? 'g (granel)' : `uds${nFull > 1 ? ' c/u' : ''}`}
                                                    </span>
                                                </span>
                                            </div>
                                        )}
                                        {/* Caja suelta */}
                                        {hasPartial && (
                                            <div className="flex items-center gap-2">
                                                <span className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full text-xs font-bold min-w-[80px] text-center">
                                                    1 etiqueta
                                                </span>
                                                <span className="text-xs text-slate-500">→</span>
                                                <span className="text-xs font-bold text-slate-700">
                                                    <span className="font-black text-amber-600">CANT: {Number(partialUnits)}</span>
                                                    <span className="text-slate-400 font-normal ml-1">uds (caja incompleta)</span>
                                                </span>
                                            </div>
                                        )}
                                        {/* No Conforme */}
                                        {nDef > 0 && (
                                            <div className="flex items-center gap-2">
                                                <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded-full text-xs font-bold min-w-[80px] text-center">
                                                    {nDef} etiqueta{nDef > 1 ? 's' : ''}
                                                </span>
                                                <span className="text-xs text-slate-500">→</span>
                                                <span className="text-xs font-bold text-slate-700">
                                                    <span className="font-black text-red-600">CANT: {defCantPerLabel}</span>
                                                    <span className="text-slate-400 font-normal ml-1">uds — 🏷️ OUTLET - PUBLICIDAD</span>
                                                </span>
                                            </div>
                                        )}
                                        {/* Contramuestra (solo LIQUIPOPS 350g) */}
                                        {contramuestraQty > 0 && (
                                            <div className="flex items-center gap-2">
                                                <span className="bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full text-xs font-bold min-w-[80px] text-center">
                                                    {contramuestraQty} etiqueta{contramuestraQty > 1 ? 's' : ''}
                                                </span>
                                                <span className="text-xs text-slate-500">→</span>
                                                <span className="text-xs font-bold text-slate-700">
                                                    <span className="font-black text-purple-600">CANT: 1</span>
                                                    <span className="text-slate-400 font-normal ml-1">ud — 🧪 CONTRAMUESTRA</span>
                                                </span>
                                            </div>
                                        )}
                                        {/* Maquila */}
                                        {maquilaLabelCount > 0 && (
                                            <div className="flex items-center gap-2">
                                                <span className="bg-teal-100 text-teal-700 px-2 py-0.5 rounded-full text-xs font-bold min-w-[80px] text-center">
                                                    {maquilaLabelCount} etiqueta{maquilaLabelCount > 1 ? 's' : ''}
                                                </span>
                                                <span className="text-xs text-slate-500">→</span>
                                                <span className="text-xs font-bold text-slate-700">
                                                    <span className="font-black text-teal-600">
                                                        CANT: {maquilaFullBoxes > 0 ? `${maquilaFullBoxes}×${maquilaBoxSize}` : ''}{maquilaFullBoxes > 0 && maquilaPartialUnits > 0 ? '+' : ''}{maquilaPartialUnits > 0 ? maquilaPartialUnits : ''}
                                                    </span>
                                                    <span className="text-slate-400 font-normal ml-1">uds — 🏭 MAQUILA</span>
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex items-center justify-end border-t border-slate-200 pt-1.5">
                                        <span className="bg-slate-700 text-white px-2.5 py-0.5 rounded-full text-xs font-bold">
                                            = {totalBoxesToPrint} etiqueta{totalBoxesToPrint !== 1 ? 's' : ''} en total
                                        </span>
                                    </div>
                                    {/* Copias — solo para productos con peso (gramos) */}
                                    {isWeightBased && (
                                        <div className="flex items-center gap-2 mt-2 pt-2 border-t border-slate-200">
                                            <span className="text-xs text-slate-500 flex-1">Copias del rótulo</span>
                                            <button onClick={() => setLabelCopies(prev => Math.max(1, prev - 1))}
                                                className="w-7 h-7 rounded-lg bg-white border-2 border-slate-200 text-slate-600 font-bold flex items-center justify-center hover:bg-slate-100">−</button>
                                            <span className="w-8 text-center font-black text-slate-700 text-sm">{labelCopies}</span>
                                            <button onClick={() => setLabelCopies(prev => Math.min(100, prev + 1))}
                                                className="w-7 h-7 rounded-lg bg-white border-2 border-slate-200 text-slate-600 font-bold flex items-center justify-center hover:bg-slate-100">+</button>
                                        </div>
                                    )}
                                </div>
                            );
                        })()}

                        {/* ═══ BOTÓN PRINCIPAL DE IMPRESIÓN ═══ */}
                        {(() => {
                            const isReady = mode === 'bluetooth' ? printerConnected : zebraStatus === 'connected';
                            const canPrint = isReady && isValid && !printing;
                            return (
                                <button
                                    onClick={handlePrint}
                                    disabled={!canPrint}
                                    className={`w-full flex items-center justify-center gap-3 py-4 px-4 font-black rounded-2xl shadow-lg transition-all text-lg active:scale-95
                                        ${canPrint
                                            ? printed
                                                ? 'bg-emerald-500 hover:bg-emerald-600 text-white'
                                                : 'bg-orange-500 hover:bg-orange-600 text-white'
                                            : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                                        }
                                        ${printing ? 'opacity-60' : ''}`}
                                >
                                    {printing ? (
                                        <><RefreshCw size={20} className="animate-spin" /> Enviando a impresora...</>
                                    ) : printed ? (
                                        <>✅ Reimprimir {totalBoxesToPrint} Etiqueta{totalBoxesToPrint > 1 ? 's' : ''}</>
                                    ) : !isValid ? (
                                        <>❌ {invalidReason}</>
                                    ) : !isReady ? (
                                        <>🔌 Conecta la impresora primero</>
                                    ) : (
                                        <><Printer size={22} /> Imprimir {totalBoxesToPrint} Etiqueta{totalBoxesToPrint > 1 ? 's' : ''}</>
                                    )}
                                </button>
                            );
                        })()}

                        {printed && isValid && (
                            <div className="text-center text-emerald-600 font-bold text-sm mt-2 animate-pulse">
                                ✅ Etiquetas enviadas — presiona <span className="underline">ETIQUETAS LISTAS ✓</span> para continuar
                            </div>
                        )}
                    </div>

                    {/* Right: QR preview */}
                    <div className="flex flex-col items-center justify-center gap-4 lg:w-72">
                        {qrDataUrl ? (
                            <div className="border-2 border-dashed border-slate-300 rounded-2xl p-4 bg-slate-50"
                                style={{ width: 260, height: 208 }}>
                                {/* Mini label preview */}
                                <div className="flex flex-col h-full">
                                    <div className="font-bold text-center uppercase text-xs mb-1 text-slate-600">
                                        POPPING BOBA INT&apos;L
                                    </div>
                                    <div className="flex gap-2 flex-1">
                                        <img src={qrDataUrl} alt="QR" style={{ width: 100, height: 100 }}
                                            className="object-contain flex-shrink-0" />
                                        <div className="flex-1 flex flex-col text-xs">
                                            <div className="font-bold text-slate-800">{product.sku}</div>
                                            <div className="text-slate-600">Lote: <b>{batchNumber}</b></div>
                                            <div className="text-slate-500 text-xs">Vence: {formattedExpiry}</div>
                                            <div className="mt-2 border-2 border-black px-2 py-0.5 text-xs font-bold inline-block w-fit">
                                            CANT: {isWeightBased ? `${Number(totalTarros).toLocaleString('es-CO')} g` : unitsPerBox}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="font-bold text-center text-xs mt-1 uppercase text-slate-700">
                                        {flavor} {size}
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="flex items-center justify-center w-64 h-52 rounded-2xl bg-slate-100">
                                <Package size={48} className="text-slate-300" />
                            </div>
                        )}
                        <p className="text-xs text-slate-400 text-center">
                            Vista previa 80mm × 50mm
                        </p>
                        <button
                            onClick={generateQR}
                            className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-xl text-sm text-slate-500 transition-all"
                        >
                            <RefreshCw size={16} /> Regenerar QR
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default MarcadoCajasStep;
