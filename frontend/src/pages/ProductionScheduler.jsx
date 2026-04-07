import React, { useState, useEffect, useCallback } from 'react';
import { Calendar, dateFnsLocalizer } from 'react-big-calendar';
import { format, parse, startOfWeek, getDay } from 'date-fns';
import { enUS, es } from 'date-fns/locale';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import withDragAndDrop from 'react-big-calendar/lib/addons/dragAndDrop';
import 'react-big-calendar/lib/addons/dragAndDrop/styles.css';

import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { Loader, AlertTriangle, CheckCircle, Save, Trash2, Info } from 'lucide-react';

const locales = {
    'es': es,
};

const localizer = dateFnsLocalizer({
    format,
    parse,
    startOfWeek,
    getDay,
    locales,
});

const DnDCalendar = withDragAndDrop(Calendar);

const ProductionScheduler = ({ readOnly = false }) => {
    const { user } = useAuth();
    const isAdmin = user?.role === 'ADMIN';
    const [events, setEvents] = useState([]);
    const [suggestions, setSuggestions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [modalData, setModalData] = useState(null); // For configuration modal
    const [isSaving, setIsSaving] = useState(false);

    // Template launcher modal (for the ▶ button)
    const [launchModal, setLaunchModal] = useState(null); // { batchId, batchTitle }
    const [templates, setTemplates] = useState([]);
    const [selectedTemplateId, setSelectedTemplateId] = useState('');
    const [isLaunching, setIsLaunching] = useState(false);
    const [config, setConfig] = useState({ targetDays: 8 });

    // "Already started" warning modal
    const [alreadyStartedModal, setAlreadyStartedModal] = useState(null); // { batchTitle, noteId }

    // Line State: 'liquipops' or 'geniality'
    const [activeLine, setActiveLine] = useState('liquipops');

    // Fetch templates on mount for launch modal
    useEffect(() => {
        api.get('/assembly-templates').then(res => setTemplates(res.data || [])).catch(() => { });
    }, []);

    // Auto-select best template for a batch (most stages wins = master template)
    const handleLaunchBatch = async (batchId, title, flavor, mix, baseWeight) => {
        setIsLaunching(true);
        try {
            // 1. Check if notes already exist for this batch
            const notesBase = activeLine === 'geniality' ? '/geniality/assembly-notes' : '/assembly-notes';
            const execBase = '/assembly-execution'; // Same wizard handles both lines
            const existRes = await api.get(`${notesBase}?batchId=${batchId}`);
            if (existRes.data?.length > 0) {
                const sorted = [...existRes.data].sort((a, b) => (a.stageOrder || 0) - (b.stageOrder || 0));
                const activeNote = sorted.find(n => n.status === 'EXECUTING') || sorted.find(n => n.status === 'PENDING') || sorted[0];
                // Show modal instead of silently redirecting
                setAlreadyStartedModal({
                    batchTitle: title || flavor || 'Bache',
                    noteId: activeNote.id,
                    status: activeNote.status,
                    stageName: activeNote.stageName || activeNote.stageOrder || ''
                });
                setIsLaunching(false);
                return;
            }

            // 2. Auto-select template: use correct endpoint per line
            const templatesEndpoint = activeLine === 'geniality' ? '/geniality/assembly-templates' : '/assembly-templates';
            const templatesRes = await api.get(templatesEndpoint);
            const allTemplates = (templatesRes.data || []).filter(t => t.isActive);
            const flavorKey = (flavor || title || '').toUpperCase().replace('SABOR A ', '').trim(); // e.g. "MANGO BICHE"

            // Each line has its own BATCH template
            const batchTemplateCode = activeLine === 'geniality' ? 'BATCH-GENIALITY' : 'BATCH-LIQUIPOPS';
            const batchTemplate = allTemplates.find(t => t.templateCode === batchTemplateCode);

            if (batchTemplate && flavorKey) {
                // Compute lot count from baseWeight for Geniality
                const BATCH_SIZE = activeLine === 'geniality' ? 100 : 120;
                const lotCount = baseWeight ? Math.max(1, Math.round(baseWeight / BATCH_SIZE)) : 1;

                // 3a. Use quickStart with flavor resolution for BATCH template
                const userId = localStorage.getItem('userId');
                const qsRes = await api.post(`${notesBase}/quick-start`, {
                    templateId: batchTemplate.id,
                    userId,
                    quantity: lotCount,
                    flavorKey,
                    existingBatchId: batchId, // Reuse the scheduler's ProductionBatch
                    outputTargets: (mix || []).filter(m => m.productId).map(m => ({
                        productId: m.productId,
                        plannedUnits: m.plannedUnits || 0,
                        plannedWeightKg: m.plannedWeightKg || 0
                    }))
                });

                if (qsRes.data?.firstNoteId) {
                    // Link batch to the production batch created by quickStart
                    window.location.href = `${execBase}/${qsRes.data.firstNoteId}`;
                } else {
                    alert(`No se generaron notas. Verifica la plantilla ${batchTemplateCode}.`);
                }
                return;
            }

            // 3b. Geniality MUST use its BATCH template — never fall through to flavor matching
            if (activeLine === 'geniality') {
                alert(`Error: No se encontró la plantilla ${batchTemplateCode} o el sabor "${flavorKey}" está vacío. Contacta al administrador.`);
                setIsLaunching(false);
                return;
            }

            // 3b. Fallback (Liquipops only): match by flavor name (old behavior for non-BATCH templates)
            const matching = allTemplates
                .filter(t =>
                    t.templateCode?.toUpperCase().includes(flavorKey) ||
                    t.templateName?.toUpperCase().includes(flavorKey) ||
                    t.product?.name?.toUpperCase().includes(flavorKey)
                )
                .sort((a, b) => (b.totalStages || 0) - (a.totalStages || 0)); // most stages first

            const bestTemplate = matching[0];

            if (!bestTemplate) {
                // No matching template — fall back to picker modal
                setLaunchModal({ batchId, title });
                setIsLaunching(false);
                return;
            }

            // 3c. Generate notes with the auto-selected template
            const genRes = await api.post(`${notesBase}/generate`, {
                batchId,
                templateId: bestTemplate.id
            });

            if (genRes.data?.notes?.length > 0) {
                window.location.href = `${execBase}/${genRes.data.notes[0].id}`;
            } else {
                alert('No se generaron notas. Verifica que la plantilla tiene etapas configuradas.');
            }
        } catch (e) {
            const msg = e.response?.data?.error || e.message;
            alert('Error al iniciar producción: ' + msg);
        } finally {
            setIsLaunching(false);
        }
    };

    // Fallback: manual confirmation when no template auto-matched
    const handleConfirmLaunch = async () => {
        if (!selectedTemplateId) return alert('Selecciona una plantilla primero.');
        setIsLaunching(true);
        try {
            const notesBase = activeLine === 'geniality' ? '/geniality/assembly-notes' : '/assembly-notes';
            const execBase = '/assembly-execution'; // Same wizard handles both lines
            const userId = localStorage.getItem('userId');
            const qsRes = await api.post(`${notesBase}/quick-start`, {
                templateId: selectedTemplateId,
                userId,
                quantity: 1,
                existingBatchId: launchModal.batchId
            });
            if (qsRes.data?.firstNoteId) {
                setLaunchModal(null);
                window.location.href = `${execBase}/${qsRes.data.firstNoteId}`;
            } else {
                alert('No se generaron notas.');
            }
        } catch (e) {
            alert('Error: ' + (e.response?.data?.error || e.message));
        } finally {
            setIsLaunching(false);
        }
    };

    // Helper Functions
    const getProjectedBatches = () => {
        if (!modalData || modalData.readOnly) return null;
        if (modalData.targetBatchCount) return modalData.targetBatchCount;

        const BATCH_SIZE = activeLine === 'geniality' ? 100 : 120;
        const totalKg = modalData.totalSyrupKg || modalData.totalPlannedKg || 0;
        const safeTotalKg = Math.round(totalKg * 100) / 100;
        let num = Math.round(safeTotalKg / BATCH_SIZE);
        if (num === 0) num = 1;
        return num;
    };

    const getTotalBatchesCount = () => {
        if (!modalData) return 1;
        if (!modalData.readOnly) return getProjectedBatches() || 1;

        const match = (modalData.title || '').match(/\[\d+\/(\d+)\]/);
        if (match) return parseInt(match[1]);
        return 1;
    };

    // Fetch Suggestions & Config & Existing Events
    useEffect(() => {
        fetchSuggestions();
        fetchConfig();
        fetchEvents();
    }, [activeLine]); // Refresh when line changes

    const fetchConfig = async () => {
        try {
            const { data } = await api.get('/config');
            if (data) {
                // If Geniality, map specific keys to generic keys for local usage
                if (activeLine === 'geniality') {
                    setConfig({
                        targetDays: data.geniality_targetDays || 8,
                        minStockDays: data.geniality_minStockDays || 15,
                        alertYellow: data.geniality_alertYellow || 12,
                        alertRed: data.geniality_alertRed || 3,
                        syrupRatio: 1.0 // Fixed
                    });
                } else {
                    setConfig(data);
                }
            }
        } catch (e) {
            console.error('Error fetching config', e);
        }
    };

    const fetchEvents = async () => {
        try {
            const schBase = activeLine === 'geniality' ? '/geniality/production' : '/production/liquipops';
            const { data } = await api.get(`${schBase}/schedule?line=${activeLine}`);
            // Convert strings back to Date objects and adjust for timezone
            // Backend stores in UTC, so we need to shift back to local time
            const allEvents = [];

            data.forEach(evt => {
                const start = new Date(evt.start);
                const end = new Date(evt.end);

                // Check if event crosses midnight
                const startDay = start.getDate();
                const endDay = end.getDate();

                if (startDay !== endDay && (end.getTime() - start.getTime()) < 24 * 60 * 60 * 1000) {
                    // Split into two events for calendar rendering
                    const midnight = new Date(start);
                    midnight.setDate(midnight.getDate() + 1);
                    midnight.setHours(0, 0, 0, 0);

                    // First part: start to 23:59:59
                    // We must use 23:59:59 because 00:00:00 (next day) causes RBC to hide it from the current day column
                    const endPart1 = new Date(midnight);
                    endPart1.setSeconds(endPart1.getSeconds() - 1); // 23:59:59

                    allEvents.push({
                        ...evt,
                        id: `${evt.id}-p1`,
                        start: start,
                        end: endPart1,
                        title: evt.title + ' (Parte 1)',
                        originalId: evt.id,
                        allDay: false
                    });

                    // Second part: 00:00:00 to (End - 1 min)
                    // Aggressive buffer: 1 minute time gap to ensure NO collision visual
                    const startPart2 = new Date(midnight); // 00:00:00

                    const endPart2 = new Date(end);
                    endPart2.setMinutes(endPart2.getMinutes() - 1); // Shave off 1 full minute

                    allEvents.push({
                        ...evt,
                        id: `${evt.id}-p2`,
                        start: startPart2,
                        end: endPart2,
                        title: evt.title + ' (Parte 2)',
                        originalId: evt.id,
                        allDay: false
                    });
                } else {
                    // Normal event - doesn't cross midnight
                    allEvents.push({
                        ...evt,
                        start: start,
                        end: end
                    });
                }
            });

            setEvents(allEvents);
        } catch (e) {
            console.error('Error fetching schedule', e);
        }
    };

    const fetchSuggestions = async () => {
        try {
            const sugBase2 = activeLine === 'geniality' ? '/geniality/production' : '/production/liquipops';
            const res = await api.get(`${sugBase2}/suggestions?line=${activeLine}`);
            setSuggestions(res.data);
            setLoading(false);
        } catch (error) {
            console.error(error);
            setLoading(false);
        }
    };

    // ... (Previous DnD logic skipped for brevity, standard functions remain) ...

    const openConfigModal = async (flavor, start, end, isEvent = false) => {
        if (isEvent) {
            setModalData({
                flavor,
                title: flavor,
                scheduledStart: start,
                scheduledEnd: end,
                type: 'EVENT',
                mix: [],
                totalPlannedKg: 0,
                totalSyrupKg: 0,
                readOnly: false
            });
            return;
        }

        try {
            const mixBase = activeLine === 'geniality' ? '/geniality/production' : '/production/liquipops';
            const res = await api.get(`${mixBase}/mix/${flavor}?line=${activeLine}`);

            // CONSTANTS Based on Line
            const BATCH_SIZE = activeLine === 'geniality' ? 100 : 120;
            const DURATION = config.batchDuration || (activeLine === 'geniality' ? 160 : 140);

            // For Geniality: calculate how many lots are needed (capped at 7, large kettle)
            // For Liquipops: always 1 batch at a time
            const totalSyrupKg = res.data.totalSyrupKg || res.data.totalPlannedKg || 0;
            let defaultLots = 1;
            if (activeLine === 'geniality') {
                defaultLots = Math.min(7, Math.max(1, Math.ceil(totalSyrupKg / BATCH_SIZE)));
            }

            const targetWeight = defaultLots * BATCH_SIZE;
            const scaleFactor = totalSyrupKg > 0 ? (targetWeight / totalSyrupKg) : 1;
            const scaledMix = (res.data.mix || []).map(m => {
                let units = Math.round((m.plannedUnits || 0) * scaleFactor);
                const ps = m.packSize || 1;
                // Only re-round to complete boxes when ACTUAL scaling happened (scaleFactor != 1)
                // Backend already provides correctly rounded values
                if (ps > 1 && units > 0 && Math.abs(scaleFactor - 1) > 0.01) {
                    const is350 = activeLine !== 'geniality' && ((m.name || '').includes('350') || (m.name || '').includes('360'));
                    units = Math.ceil(units / ps) * ps;
                    if (is350 && m.contramuestra) units += m.contramuestra;
                }
                return {
                    ...m,
                    plannedUnits: units,
                    plannedWeightKg: units * (m.kgFactor || 0),
                    boxes: ps > 1 ? Math.floor(units / ps) : m.boxes
                };
            });

            // For Geniality: duration scales with lots (base + extra per lot)
            const batchDuration = activeLine === 'geniality'
                ? DURATION + (defaultLots - 1) * 40  // 160min base + 40min per extra lot
                : DURATION;
            const calculatedEndDate = new Date(start.getTime() + batchDuration * 60000);

            // Enrich modal with per-distributor demand + safety stock
            let demandData = {};
            const sugBase = activeLine === 'geniality' ? '/geniality/production' : '/production/liquipops';
            try {
                const sugRes = await api.get(`${sugBase}/suggestions?line=${activeLine}`);
                const sug = (sugRes.data || []).find(s => s.flavor?.toUpperCase() === flavor.toUpperCase());
                if (sug) {
                    demandData = {
                        demandOrderDeficitUnits: sug.orderDeficitUnits || 0,
                        demandBackorderKg: sug.totalBackorderKg || 0,
                        demandInProgressKg: sug.inProgressKg || 0,
                        demandCurrentStockKg: sug.currentStockKg || 0,
                        demandEffectiveStockKg: sug.effectiveStockKg || 0,
                        demandDaysRemaining: sug.daysRemaining || 0,
                        demandStockDetails: sug.stockDetails || [],
                    };
                }
            } catch (e) {
                console.warn('Could not fetch suggestions for demand', e);
            }
            try {
                const demandRes = await api.get(`${sugBase}/demand?flavor=${encodeURIComponent(flavor)}&line=${activeLine}`);
                const demand = demandRes.data || {};
                demandData = {
                    ...demandData,
                    demandDistributors: demand.distributors || [],
                    demandSizeTotals: demand.sizeTotals || {},
                    demandSafetyStock: demand.safetyStock || [],
                };
            } catch (e) {
                console.warn('Could not fetch demand details', e);
            }
            // Calculate already-scheduled pending batch output for this flavor (in kg)
            const scheduledPendingKg = events
                .filter(e => e.flavor && e.flavor.toUpperCase() === flavor.toUpperCase() && e.status === 'PENDING')
                .reduce((acc, e) => acc + (e.baseWeight || 0), 0);

            setModalData({
                ...res.data,
                mix: scaledMix,
                totalPlannedKg: scaledMix.reduce((a, m) => a + (m.plannedWeightKg || 0), 0),
                totalSyrupKg: targetWeight,
                scheduledStart: start,
                scheduledEnd: calculatedEndDate,
                baseWeight: targetWeight,
                targetBatchCount: defaultLots,
                readOnly: false,
                ...demandData,
                demandScheduledPendingKg: scheduledPendingKg,
            });
        } catch (error) {
            alert('Error fetching mix');
        }
    };

    const handleSaveBatch = async () => {
        if (!modalData) return;
        setIsSaving(true);
        try {
            // ============================================
            // 1. EVENT LOGIC (Auxiliary Events like cleaning)
            // ============================================
            if (modalData.type === 'EVENT') {
                // ... (Same event saving logic, omitted for brevity in replace block if possible, but replace_file requires full context block usually)
                // ... (Assume logic is identical for events)
                // Validation: Mandatory Notes
                if (!modalData.notes || modalData.notes.trim() === '') {
                    alert('Las notas son obligatorias para crear un evento.');
                    setIsSaving(false);
                    return;
                }

                const start = new Date(modalData.scheduledStart);
                const end = new Date(modalData.scheduledEnd);
                const durationMs = end.getTime() - start.getTime();

                // 1A. Create the new event
                const auxBase = activeLine === 'geniality' ? '/geniality/production' : '/production/liquipops';
                await api.post(`${auxBase}/schedule`, {
                    flavor: modalData.flavor,
                    scheduledStart: start,
                    scheduledEnd: end,
                    baseWeight: 0,
                    mix: [], // Empty mix
                    status: 'PENDING',
                    notes: modalData.notes // Send notes
                });

                // ... (Shift logic) ...
                const uniqueIdsToShift = new Set();
                const shiftPromises = [];

                events.forEach(ev => {
                    if (new Date(ev.start) < start) return;
                    const realId = ev.originalId || ev.id;
                    if (uniqueIdsToShift.has(realId)) return;
                    uniqueIdsToShift.add(realId);

                    const currentStart = new Date(ev.start);
                    const currentEnd = new Date(ev.end);
                    const newStart = new Date(currentStart.getTime() + durationMs);
                    const newEnd = new Date(currentEnd.getTime() + durationMs);

                    const shiftBase = activeLine === 'geniality' ? '/geniality/production' : '/production/liquipops';
                    shiftPromises.push(api.put(`${shiftBase}/${realId}`, {
                        scheduledStart: newStart,
                        scheduledEnd: newEnd
                    }));
                });

                if (shiftPromises.length > 0) {
                    await Promise.all(shiftPromises);
                }

                setIsSaving(false);
                setModalData(null);
                await fetchEvents(); // Refresh to see changes
                return;
            }

            // DYNAMIC BATCH SIZE
            const BATCH_SIZE = activeLine === 'geniality' ? 100 : 120;
            const DURATION = config.batchDuration || (activeLine === 'geniality' ? 160 : 140);

            let numBatches = modalData.targetBatchCount || 1;
            if (numBatches === 0) numBatches = 1;

            // ═══════════════════════════════════════════════════════
            // GENIALITY: Single batch with N lots (large kettle)
            // ═══════════════════════════════════════════════════════
            if (activeLine === 'geniality') {
                const totalWeight = numBatches * BATCH_SIZE; // e.g. 3 lots × 100kg = 300kg
                const batchDuration = DURATION + (numBatches - 1) * 40;
                let currentStartDate = new Date(modalData.scheduledStart);
                let currentEndDate = new Date(currentStartDate.getTime() + batchDuration * 60000);

                // Collision resolution
                let hasCollision = true, iterations = 0;
                while (hasCollision && iterations < 50) {
                    iterations++; hasCollision = false;
                    for (const ev of events) {
                        if (currentStartDate < new Date(ev.end) && currentEndDate > new Date(ev.start)) {
                            currentStartDate = new Date(ev.end);
                            currentEndDate = new Date(currentStartDate.getTime() + batchDuration * 60000);
                            hasCollision = true; break;
                        }
                    }
                }

                const genBase = activeLine === 'geniality' ? '/geniality/production' : '/production/liquipops';
                const res = await api.post(`${genBase}/schedule`, {
                    flavor: modalData.flavor,
                    scheduledStart: currentStartDate,
                    scheduledEnd: currentEndDate,
                    baseWeight: totalWeight,
                    mix: modalData.mix, // Full mix, not split
                    batchIndex: 1,
                    totalBatches: 1
                });

                setEvents(prev => [...prev, {
                    id: res.data.id,
                    title: `${modalData.flavor} (${totalWeight}kg · ${numBatches} ${numBatches === 1 ? 'lote' : 'lotes'})`,
                    start: new Date(currentStartDate),
                    end: new Date(currentEndDate),
                    flavor: modalData.flavor,
                    mix: modalData.mix,
                    status: 'PENDING',
                    baseWeight: totalWeight
                }]);

                setIsSaving(false);
                setModalData(null);
                await fetchEvents();
                fetchSuggestions();
                return;
            }

            // ═══════════════════════════════════════════════════════
            // LIQUIPOPS: N separate batches (small kettle, 1 lot each)
            // ═══════════════════════════════════════════════════════
            const eventsToAdd = [];
            let currentStartDate = new Date(modalData.scheduledStart);

            for (let i = 0; i < numBatches; i++) {
                let currentEndDate = new Date(currentStartDate.getTime() + DURATION * 60000);

                // Collision Detection & Auto-Resolution
                let hasCollision = true, maxIterations = 50, iterations = 0;
                while (hasCollision && iterations < maxIterations) {
                    iterations++; hasCollision = false;
                    const allEvents = [...events, ...eventsToAdd];
                    for (const ev of allEvents) {
                        if (currentStartDate < new Date(ev.end) && currentEndDate > new Date(ev.start)) {
                            currentStartDate = new Date(ev.end);
                            currentEndDate.setTime(currentStartDate.getTime() + DURATION * 60000);
                            hasCollision = true; break;
                        }
                    }
                }

                if (iterations >= maxIterations) {
                    alert('No se pudo encontrar un espacio libre para este bache.');
                    continue;
                }

                const ratio = 1 / numBatches;
                const scaledMix = modalData.mix.map(item => ({
                    ...item,
                    plannedUnits: Math.round(item.plannedUnits * ratio),
                    plannedWeightKg: item.plannedWeightKg ? (item.plannedWeightKg * ratio) : 0
                }));

                const liqBase = activeLine === 'geniality' ? '/geniality/production' : '/production/liquipops';
                const res = await api.post(`${liqBase}/schedule`, {
                    flavor: modalData.flavor,
                    scheduledStart: currentStartDate,
                    scheduledEnd: currentEndDate,
                    baseWeight: BATCH_SIZE,
                    mix: scaledMix,
                    batchIndex: i + 1,
                    totalBatches: numBatches
                });

                eventsToAdd.push({
                    id: res.data.id,
                    title: `${modalData.flavor} [${i + 1}/${numBatches}] (${BATCH_SIZE}kg)`,
                    start: new Date(currentStartDate),
                    end: new Date(currentEndDate),
                    flavor: modalData.flavor,
                    mix: scaledMix,
                    status: 'PENDING',
                    baseWeight: BATCH_SIZE
                });

                currentStartDate = new Date(currentEndDate);
            }

            setIsSaving(false);
            setModalData(null);

            setEvents(prev => [...prev, ...eventsToAdd]);
            await fetchEvents();
            fetchSuggestions();
        } catch (error) {
            console.error(error);
            setIsSaving(false);
            alert(`Error saving batch: ${error.message || JSON.stringify(error)}`);
        }
    };

    // Helper to highlight Zero stock in Red string
    const formatAvailableSizes = (str) => {
        if (!str || str === 'Sin Stock') return 'N/A';
        const parts = str.split(', ');
        return (
            <span>
                {parts.map((part, i) => {
                    const [label, valStr] = part.split(': ');
                    const val = parseInt(valStr || '0', 10);
                    const isZero = val <= 0;
                    return (
                        <span key={i} className={isZero ? 'text-red-600 font-bold bg-red-50 rounded px-0.5' : ''}>
                            {part}{i < parts.length - 1 ? ', ' : ''}
                        </span>
                    );
                })}
            </span>
        );
    };

    // Status label mapping for calendar events
    const getStatusLabel = (status) => {
        const labels = {
            'STAGE_1_BASE': 'Base',
            'STAGE_2_JARABE': 'Jarabe',
            'STAGE_3_ESFERIFICACION': 'Esferificación',
            'STAGE_4_PRODUCTO_FINAL': 'Prod. Final',
            'LABELING': 'Etiquetado',
            'PENDING': 'Pendiente',
            'COMPLETED': 'Finalizado',
        };
        return labels[status] || 'En Proceso';
    };

    // Color Mapping
    const FLAVOR_COLORS = {
        'MANGO BICHE CON SAL': '#8DB600', // Green Apple
        'MARACUYA': '#EAB308', // Yellow
        'BLUEBERRY': '#3B82F6', // Blue
        'ICE PINK': '#EC4899', // Pink
        'LYCHE': '#F43F5E', // Rose
        'FRESA': '#EF4444', // Red
        'CEREZA': '#B91C1C', // Dark Red
        'CHICLE': '#DB2777', // Pinkish
        'HIERBABUENA': '#10B981', // Emerald
        'UVA': '#8B5CF6', // Purple
        'SANDIA': '#F87171', // Light Red
    };

    const getFlavorColor = (flavor) => {
        if (!flavor) return '#3b82f6'; // Default Blue
        if (FLAVOR_COLORS[flavor]) return FLAVOR_COLORS[flavor];

        // Hash fallback for unknown flavors
        let hash = 0;
        for (let i = 0; i < flavor.length; i++) {
            hash = flavor.charCodeAt(i) + ((hash << 5) - hash);
        }
        const c = (hash & 0x00FFFFFF).toString(16).toUpperCase();
        return '#' + '00000'.substring(0, 6 - c.length) + c;
    };

    // Drag Source Logic (HTML5)
    // We store the 'currently dragged' item in state when drag starts on the sidebar
    const [draggedFlavor, setDraggedFlavor] = useState(null);

    const resolveCollision = (proposedStart, durationMs, ignoreEventId = null) => {
        let currentStart = new Date(proposedStart);
        let iterations = 0;
        const MAX_ITERATIONS = 50;

        while (iterations < MAX_ITERATIONS) {
            const currentEnd = new Date(currentStart.getTime() + durationMs);

            // Check for ANY overlap
            const collisions = events.filter(ev => {
                // Ignore self
                if (ignoreEventId && (ev.id === ignoreEventId || ev.originalId === ignoreEventId)) return false;

                // Check overlap
                const evStart = new Date(ev.start);
                const evEnd = new Date(ev.end);
                return currentStart < evEnd && currentEnd > evStart;
            });

            if (collisions.length === 0) {
                return currentStart; // No collisions
            }

            // Move start to the LATEST end
            const maxEnd = collisions.reduce((max, c) => {
                const eEnd = new Date(c.end);
                return eEnd > max ? eEnd : max;
            }, new Date(0));

            // Safety check
            if (maxEnd <= currentStart) {
                currentStart = new Date(currentStart.getTime() + 60000);
            } else {
                currentStart = maxEnd;
            }
            iterations++;
        }
        return currentStart;
    };

    const handleEventChange = async ({ event, start, end }) => {
        if (start < new Date()) {
            alert('No se puede mover al pasado.');
            return;
        }

        const duration = end.getTime() - start.getTime();
        const realId = event.originalId || event.id;

        // Recursive Resolve
        const validStart = resolveCollision(start, duration, realId);
        const validEnd = new Date(validStart.getTime() + duration);

        if (validStart.getTime() !== start.getTime()) {
            console.log(`Auto-snapping move: ${start.toLocaleTimeString()} -> ${validStart.toLocaleTimeString()}`);
        }

        try {
            const updBase = activeLine === 'geniality' ? '/geniality/production' : '/production/liquipops';
            await api.put(`${updBase}/${realId}`, {
                scheduledStart: validStart,
                scheduledEnd: validEnd
            });
            await fetchEvents();
        } catch (error) {
            console.error("Error moving event", error);
            alert("Error al mover el evento");
        }
    };

    const onDropFromOutside = ({ start, end, allDay }) => {
        if (!draggedFlavor) return;

        if (start < new Date()) {
            alert('No se puede programar en el pasado.');
            return;
        }

        // Determine duration
        let durationMin = 140; // Default Liquipops
        if (activeLine === 'geniality') durationMin = 240; // Geniality default
        if (draggedFlavor.type === 'EVENT') durationMin = draggedFlavor.duration || 60;

        const durationMs = durationMin * 60000;

        // Recursive Resolve
        const validStart = resolveCollision(start, durationMs, null);
        const validEnd = new Date(validStart.getTime() + durationMs);

        if (validStart.getTime() !== start.getTime()) {
            console.log(`Auto-snapping drop: ${start.toLocaleTimeString()} -> ${validStart.toLocaleTimeString()}`);
        }

        openConfigModal(draggedFlavor.flavor, validStart, validEnd, draggedFlavor.type === 'EVENT');
        setDraggedFlavor(null);
    };

    const handleSelectEvent = async (event) => {
        // Detect if it's an Auxiliary Event
        const isAuxEvent = !event.mix || event.mix.length === 0 || event.title.includes('LAVADO') || event.title.includes('MANTENIMIENTO') || event.title.includes('PAUSA');

        if (isAuxEvent) {
            setModalData({
                id: event.id,
                originalId: event.originalId,
                flavor: event.flavor,
                title: event.title,
                scheduledStart: event.start,
                scheduledEnd: event.end,
                type: 'EVENT',
                mix: [],
                totalPlannedKg: 0,
                totalSyrupKg: 0,
                notes: event.notes,
                readOnly: true
            });
            return;
        }

        // Production Batch Logic
        if (!event.mix || !Array.isArray(event.mix)) {
            // Fallback
            setModalData({
                id: event.id,
                originalId: event.originalId,
                flavor: event.flavor || 'Desconocido',
                title: event.title,
                scheduledStart: event.start,
                scheduledEnd: event.end,
                type: 'EVENT',
                mix: [],
                totalPlannedKg: 0,
                totalSyrupKg: 0,
                notes: event.notes,
                readOnly: true
            });
            return;
        }

        try {
            const total = event.mix.reduce((acc, m) => acc + (m.plannedWeightKg || 0), 0);
            const flavor = event.flavor;
            const status = event.status || 'PENDING';

            // Fetch demand data for this flavor (same as when creating new batch)
            let demandData = {};
            const sugBase = activeLine === 'geniality' ? '/geniality/production' : '/production/liquipops';
            try {
                const sugRes = await api.get(`${sugBase}/suggestions?line=${activeLine}`);
                const sug = (sugRes.data || []).find(s => s.flavor?.toUpperCase() === flavor?.toUpperCase());
                if (sug) {
                    demandData = {
                        demandOrderDeficitUnits: sug.orderDeficitUnits || 0,
                        demandBackorderKg: sug.backorderKg || 0,
                        demandEffectiveStockKg: sug.effectiveStockKg || 0,
                        demandDaysRemaining: sug.daysRemaining || 0,
                        demandStockDetails: sug.stockDetails || [],
                    };
                }
            } catch (e) { console.warn('Could not fetch suggestions', e); }
            try {
                const demandRes = await api.get(`${sugBase}/demand?flavor=${encodeURIComponent(flavor)}&line=${activeLine}`);
                const demand = demandRes.data || {};
                demandData = {
                    ...demandData,
                    demandDistributors: demand.distributors || [],
                    demandSizeTotals: demand.sizeTotals || {},
                    demandSafetyStock: demand.safetyStock || [],
                };
            } catch (e) { console.warn('Could not fetch demand', e); }

            const scheduledPendingKg = events
                .filter(e => e.flavor && e.flavor.toUpperCase() === flavor.toUpperCase() && e.status === 'PENDING')
                .reduce((acc, e) => acc + (e.baseWeight || 0), 0);

            setModalData({
                id: event.id,
                originalId: event.originalId,
                flavor,
                title: event.title,
                targetBatchCount: event.totalBatches,
                totalPlannedKg: total,
                totalSyrupKg: event.baseWeight,
                mix: event.mix,
                scheduledStart: event.start,
                scheduledEnd: event.end,
                readOnly: true,
                status,
                ...demandData,
                demandScheduledPendingKg: scheduledPendingKg,
            });
        } catch (error) {
            console.error("Error opening details:", error);
            alert("Ocurrió un error al abrir el detalle.");
        }
    };

    const handleDeleteBatch = async () => {
        if (!modalData?.id) {
            alert("Error: Id de bache no encontrado.");
            return;
        }
        if (!confirm('¿Estás seguro de que deseas eliminar este bache?')) return;

        try {
            // Use originalId if available (for split events), otherwise sanitize string
            const rawId = modalData.originalId || modalData.id;
            const cleanId = String(rawId).split('-p')[0].split(':')[0];

            const delBase = activeLine === 'geniality' ? '/geniality/production' : '/production/liquipops';
            await api.delete(`${delBase}/${cleanId}`);

            // Remove from local state
            setEvents(prev => prev.filter(e => {
                const eClean = String(e.originalId || e.id).split('-p')[0].split(':')[0];
                return eClean !== cleanId;
            }));
            setModalData(null);
            fetchSuggestions();
        } catch (error) {
            console.error("Error deleting batch:", error);
            alert(`Error al eliminar: ${error.message} (${error.response?.status || 'N/A'})`);
        }
    };

    return (
        <div className={`flex bg-gray-50 min-h-screen ${readOnly ? 'flex-col' : ''}`}>
            {/* Sidebar: Suggestions - only visible for ADMIN (not readOnly) */}
            {!readOnly && <div className="w-80 bg-white border-r border-gray-200 p-4 overflow-y-auto fixed left-64 top-16 z-10" style={{ height: 'calc(100vh - 64px)' }}>
                {/* LINE SELECTOR TABS */}
                <div className="flex space-x-2 mb-4 p-1 bg-gray-100 rounded-lg">
                    <button
                        onClick={() => setActiveLine('liquipops')}
                        className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all ${activeLine === 'liquipops'
                            ? 'bg-white text-blue-600 shadow-sm'
                            : 'text-gray-500 hover:text-gray-700'
                            }`}
                    >
                        Liquipops
                    </button>
                    <button
                        onClick={() => setActiveLine('geniality')}
                        className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all ${activeLine === 'geniality'
                            ? 'bg-white text-purple-600 shadow-sm'
                            : 'text-gray-500 hover:text-gray-700'
                            }`}
                    >
                        Geniality
                    </button>
                </div>

                <h2 className="text-lg font-bold text-gray-800 mb-1">
                    {activeLine === 'liquipops' ? 'Sugerencias Liquipops' : 'Sugerencias Siropes'}
                </h2>

                {/* Rest of JSX ... */}
                <div className="text-xs text-gray-500 mb-1">baches para cubrir <span className="font-bold text-blue-600">{config.targetDays} días</span> de venta</div>
                <div className="text-[10px] text-gray-400 mb-2 border-b pb-2">Arrastra al calendario para programar</div>

                {/* Auxiliary Events Section - Always Visible at Top */}
                <div className="mb-4 pb-4 border-b border-gray-100">
                    <h3 className="text-xs font-bold text-gray-500 mb-2 uppercase tracking-wide">Eventos Auxiliares</h3>
                    <div className="grid grid-cols-2 gap-2">
                        {[
                            { name: 'LAVADO', duration: 60, color: 'bg-teal-50 border-teal-200 text-teal-700' },
                            { name: 'PAUSA ACTIVA', duration: 15, color: 'bg-indigo-50 border-indigo-200 text-indigo-700' },
                            { name: 'MANTENIMIENTO', duration: 120, color: 'bg-gray-50 border-gray-200 text-gray-700' },
                            { name: 'REUNIÓN', duration: 60, color: 'bg-purple-50 border-purple-200 text-purple-700' }
                        ].map(evt => (
                            <div
                                key={evt.name}
                                draggable
                                onDragStart={() => setDraggedFlavor({ ...evt, type: 'EVENT', flavor: evt.name })}
                                className={`p-2 text-[10px] font-bold text-center border rounded cursor-grab active:cursor-grabbing hover:shadow transition-all ${evt.color}`}
                            >
                                {evt.name}
                            </div>
                        ))}
                    </div>
                </div>

                {loading ? (
                    <div className="flex justify-center py-10"><Loader className="animate-spin text-blue-500" /></div>
                ) : (
                    <div className="space-y-3 pb-20">
                        {suggestions.map((item) => {
                            const isScheduled = events.some(e => e.flavor === item.flavor && e.status === 'PENDING');
                            const scheduledKg = events
                                .filter(e => e.flavor === item.flavor && (e.status === 'PENDING' || e.status?.startsWith('STAGE')))
                                .reduce((acc, e) => acc + (e.baseWeight || 0), 0);
                            const details = item.stockDetails || [];

                            return (
                                <div
                                    key={item.flavor}
                                    draggable
                                    onDragStart={() => setDraggedFlavor(item)}
                                    className={`rounded-lg border shadow-sm cursor-grab active:cursor-grabbing hover:shadow-md transition-all overflow-hidden
                                    ${isScheduled ? 'ring-2 ring-blue-200' : ''}
                                    ${item.status === 'RED' ? 'border-red-300 bg-red-50/50' :
                                            item.status === 'YELLOW' ? 'border-yellow-300 bg-yellow-50/50' :
                                                'border-green-300 bg-green-50/30'}`}
                                >
                                    {/* Header */}
                                    <div className={`px-3 py-2 flex justify-between items-center
                                        ${item.status === 'RED' ? 'bg-red-100' :
                                            item.status === 'YELLOW' ? 'bg-yellow-100' : 'bg-green-100'}`}
                                    >
                                        <span className="font-black text-gray-800 text-sm tracking-wide">{item.flavor}</span>
                                        <div className="flex gap-1">
                                            {isScheduled && (
                                                <span className="bg-blue-500 text-white text-[9px] px-1.5 py-0.5 rounded font-bold">✓ PROG</span>
                                            )}
                                            {item.totalBackorderKg > 0 && (
                                                <span className="bg-red-600 text-white text-[9px] px-1.5 py-0.5 rounded font-bold animate-pulse" style={{ animationDuration: '3s' }}>BACKORDER</span>
                                            )}
                                        </div>
                                    </div>

                                    {/* Per-Size Table */}
                                    <div className="px-2 py-1.5">
                                        <table className="w-full text-[10px]">
                                            <thead>
                                                <tr className="text-gray-500">
                                                    <th className="text-left py-0.5 font-semibold">Ref.</th>
                                                    <th className="text-center py-0.5 font-semibold">Stock</th>
                                                    <th className="text-center py-0.5 font-semibold text-blue-600">Prog.</th>
                                                    <th className="text-center py-0.5 font-semibold">Pedidos</th>
                                                    <th className="text-right py-0.5 font-semibold">Estado</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {details.map((d, i) => {
                                                    const effective = d.units + (d.scheduledUnits || 0);
                                                    const pending = d.deficitUnits || 0;
                                                    const covered = effective >= pending;
                                                    return (
                                                        <tr key={i} className="border-t border-gray-100">
                                                            <td className="py-0.5 font-bold text-gray-700">{d.label}</td>
                                                            <td className={`text-center py-0.5 font-bold ${d.units <= 0 ? 'text-red-600' : 'text-gray-700'}`}>{d.units}</td>
                                                            <td className={`text-center py-0.5 font-bold ${d.scheduledUnits > 0 ? 'text-blue-600' : 'text-gray-300'}`}>
                                                                {d.scheduledUnits > 0 ? `+${d.scheduledUnits}` : '-'}
                                                            </td>
                                                            <td className={`text-center py-0.5 font-bold ${pending > 0 ? 'text-orange-600' : 'text-gray-300'}`}>
                                                                {pending > 0 ? pending : '-'}
                                                            </td>
                                                            <td className="text-right py-0.5">
                                                                {covered ? (
                                                                    <span className="text-green-600 font-bold">✓</span>
                                                                ) : (
                                                                    <span className="text-red-600 font-bold">-{pending - effective}</span>
                                                                )}
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>

                                    {/* Footer summary */}
                                    <div className="px-3 py-1.5 bg-gray-50 border-t border-gray-100 flex justify-between items-center text-[10px]">
                                        <span className="text-gray-500">
                                            {scheduledKg > 0 ? (
                                                <span className="text-blue-600 font-bold">📋 {scheduledKg}kg prog.</span>
                                            ) : (
                                                <span className="text-blue-600 font-bold">{item.suggestedAction}</span>
                                            )}
                                        </span>
                                        <span className={item.daysRemaining < 8 ? 'text-red-500 font-bold' : 'text-gray-400 font-semibold'}>
                                            {item.daysRemaining > 900 ? '∞' : item.daysRemaining} días
                                        </span>
                                    </div>
                                </div>
                            );
                        })}
                        {suggestions.length === 0 && !loading && (
                            <div className="text-center text-sm text-gray-400 mt-10">Todo está cubierto 👍</div>
                        )}
                    </div>
                )}
            </div>}

            {/* Calendar Area */}
            <div className="flex-1 p-4 flex flex-col" style={readOnly ? {} : { marginLeft: '320px' }}>
                {/* Toolbar — only for admin */}
                {!readOnly && (
                    <div className="flex justify-end mb-2">
                        <button
                            onClick={async () => {
                                if (!confirm(`¿Borrar TODAS las programaciones pendientes de ${activeLine === 'geniality' ? 'Geniality' : 'Liquipops'}? Esta acción no se puede deshacer.`)) return;
                                try {
                                    const delAllBase = activeLine === 'geniality' ? '/geniality/production' : '/production/liquipops';
                                    const res = await api.delete(`${delAllBase}/all?line=${activeLine}`);
                                    alert(`✅ ${res.data.deleted} programaciones borradas.`);
                                    await fetchEvents();
                                } catch (e) {
                                    alert('Error al borrar: ' + (e.response?.data?.error || e.message));
                                }
                            }}
                            className="flex items-center gap-2 px-3 py-1.5 bg-red-50 border border-red-200 text-red-600 text-xs font-bold rounded-lg hover:bg-red-100 transition-all"
                        >
                            <Trash2 className="w-3.5 h-3.5" /> Borrar Todas
                        </button>
                    </div>
                )}
                {/* Line selector tabs for readOnly mode (operators) */}
                {readOnly && (
                    <div className="flex items-center gap-3 mb-3">
                        <div className="flex p-1 bg-gray-100 rounded-lg">
                            <button
                                onClick={() => setActiveLine('liquipops')}
                                className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all ${activeLine === 'liquipops'
                                    ? 'bg-white text-blue-600 shadow-sm'
                                    : 'text-gray-500 hover:text-gray-700'
                                    }`}
                            >
                                Liquipops
                            </button>
                            <button
                                onClick={() => setActiveLine('geniality')}
                                className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all ${activeLine === 'geniality'
                                    ? 'bg-white text-purple-600 shadow-sm'
                                    : 'text-gray-500 hover:text-gray-700'
                                    }`}
                            >
                                Geniality
                            </button>
                        </div>
                        <span className="text-sm text-gray-400">Vista de producción programada</span>
                    </div>
                )}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4" style={{ width: '100%' }}>
                    {readOnly ? (
                        <Calendar
                            localizer={localizer}
                            events={events}
                            startAccessor="start"
                            endAccessor="end"
                            defaultView="week"
                            views={['week', 'day']}
                            min={new Date(new Date().setHours(0, 0, 0, 0))}
                            max={new Date(new Date().setHours(23, 59, 59))}
                            step={20}
                            timeslots={3}
                            scrollToTime={new Date(new Date().setHours(8, 0, 0, 0))}
                            formats={{
                                timeGutterFormat: (date, culture, localizer) =>
                                    localizer.format(date, 'HH:mm', culture),
                            }}
                            culture='es'
                            style={{ height: readOnly ? 'calc(100vh - 180px)' : '1200px' }}
                            onSelectEvent={handleSelectEvent}
                            components={{
                                event: ({ event }) => {
                                    const isAuxEvent = !event.mix || event.mix.length === 0 || event.title.includes('LAVADO') || event.title.includes('MANTENIMIENTO') || event.title.includes('PAUSA');
                                    const isCompleted = event.status === 'COMPLETED';
                                    const isInProgress = event.status && event.status !== 'PENDING' && !isCompleted;
                                    const statusLabel = getStatusLabel(event.status);
                                    return (
                                        <div className="flex justify-between items-center h-full px-1.5 overflow-hidden" title={event.title}>
                                            <div className="flex-1 min-w-0">
                                                <div className="font-bold truncate" style={{ fontSize: '11px' }}>{event.title}</div>
                                                {!isAuxEvent && (
                                                    <div className="text-[10px] truncate" style={{ opacity: 0.95 }}>
                                                        {isCompleted ? '🏁 Finalizado' : isInProgress ? (
                                                            <span className="flex items-center gap-0.5">
                                                                <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#34d399', boxShadow: '0 0 6px #34d399', animation: 'pulse 1.5s ease-in-out infinite' }} />
                                                                {` ${statusLabel}`}
                                                            </span>
                                                        ) : `⏸ ${event.mix?.length || 0} ingredientes`}
                                                    </div>
                                                )}
                                            </div>
                                            {!isAuxEvent && !isCompleted && (
                                                <button
                                                    className="ml-1.5 w-7 h-7 flex items-center justify-center rounded-md shadow-sm shrink-0 z-10 transition-all hover:scale-110"
                                                    style={{
                                                        background: isInProgress ? 'rgba(16, 185, 129, 0.95)' : 'rgba(255,255,255,0.9)',
                                                        color: isInProgress ? 'white' : '#2563eb',
                                                        fontSize: '14px',
                                                        fontWeight: 'bold'
                                                    }}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        const cleanId = String(event.originalId || event.id).split('-p')[0];
                                                        handleLaunchBatch(cleanId, event.title, event.flavor, event.mix, event.baseWeight);
                                                    }}
                                                    title={isInProgress ? 'Ya iniciado — ver en PLC' : 'Iniciar Producción'}
                                                    disabled={isLaunching}
                                                >
                                                    {isLaunching ? '⏳' : isInProgress ? '⚡' : '▶'}
                                                </button>
                                            )}
                                        </div>
                                    );
                                }
                            }}
                            eventPropGetter={(event) => {
                                const isCompleted = event.status === 'COMPLETED';
                                const isPending = event.status === 'PENDING';
                                const isInProgress = !isCompleted && !isPending && event.status;

                                let bgColor, border = 'none', opacity = 1, extraStyles = {};
                                if (isCompleted) {
                                    bgColor = 'linear-gradient(135deg, #059669, #047857)';
                                    border = '2px solid #34d399';
                                    opacity = 0.7;
                                } else if (isInProgress) {
                                    bgColor = `linear-gradient(135deg, ${getFlavorColor(event.flavor)}, ${getFlavorColor(event.flavor)}dd)`;
                                    border = '3px solid #34d399';
                                    extraStyles = {
                                        boxShadow: '0 0 12px rgba(52, 211, 153, 0.4), inset 0 0 0 1px rgba(255,255,255,0.2)',
                                        animation: 'calendarPulse 2.5s ease-in-out infinite',
                                    };
                                } else {
                                    bgColor = getFlavorColor(event.flavor);
                                    opacity = 0.85;
                                }

                                return {
                                    style: {
                                        background: bgColor,
                                        borderRadius: '6px',
                                        border,
                                        color: 'white',
                                        fontSize: '12px',
                                        padding: '0px',
                                        opacity,
                                        ...extraStyles
                                    }
                                };
                            }}
                        />
                    ) : (
                        <DnDCalendar
                            localizer={localizer}
                            events={events}
                            startAccessor="start"
                            endAccessor="end"
                            defaultView="week"
                            views={['week', 'day']}
                            // FIX: Explicitly set min/max to current day start/end
                            min={new Date(new Date().setHours(0, 0, 0, 0))}
                            max={new Date(new Date().setHours(23, 59, 59))}
                            step={20}
                            timeslots={3} // 3 slots of 20 mins = 1 hour
                            scrollToTime={new Date(new Date().setHours(8, 0, 0, 0))}
                            formats={{
                                timeGutterFormat: (date, culture, localizer) =>
                                    localizer.format(date, 'HH:mm', culture),
                            }}
                            culture='es'
                            resizable
                            style={{ height: '1200px' }} // Adjusted: 1200px = 50px/hour (Compact)
                            onEventDrop={handleEventChange}
                            onEventResize={handleEventChange}
                            onSelectEvent={handleSelectEvent}
                            droppable={true}
                            onDropFromOutside={onDropFromOutside}
                            dragFromOutsideItem={() => ({
                                title: draggedFlavor?.flavor,
                                allDay: false,
                                status: 'PREVIEW',
                                isDragging: true
                            })}
                            components={{
                                event: ({ event }) => {
                                    const isAuxEvent = !event.mix || event.mix.length === 0 || event.title.includes('LAVADO') || event.title.includes('MANTENIMIENTO') || event.title.includes('PAUSA');
                                    const isCompleted = event.status === 'COMPLETED';
                                    const isInProgress = event.status && event.status !== 'PENDING' && !isCompleted;
                                    const statusLabel = getStatusLabel(event.status);

                                    return (
                                        <div className="flex justify-between items-center h-full px-1.5 overflow-hidden" title={event.title}>
                                            <div className="flex-1 min-w-0">
                                                <div className="font-bold truncate" style={{ fontSize: '11px' }}>{event.title}</div>
                                                {!isAuxEvent && (
                                                    <div className="text-[10px] truncate" style={{ opacity: 0.95 }}>
                                                        {isCompleted ? '🏁 Finalizado' : isInProgress ? (
                                                            <span className="flex items-center gap-0.5">
                                                                <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#34d399', boxShadow: '0 0 6px #34d399', animation: 'pulse 1.5s ease-in-out infinite' }} />
                                                                {` ${statusLabel}`}
                                                            </span>
                                                        ) : `⏸ ${event.mix?.length || 0} ingredientes`}
                                                    </div>
                                                )}
                                            </div>

                                            {!isAuxEvent && !isCompleted && (
                                                <button
                                                    className="ml-1.5 w-7 h-7 flex items-center justify-center rounded-md shadow-sm shrink-0 z-10 transition-all hover:scale-110"
                                                    style={{
                                                        background: isInProgress ? 'rgba(16, 185, 129, 0.95)' : 'rgba(255,255,255,0.9)',
                                                        color: isInProgress ? 'white' : '#2563eb',
                                                        fontSize: '14px',
                                                        fontWeight: 'bold'
                                                    }}
                                                    onMouseDown={(e) => e.stopPropagation()}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        const cleanId = String(event.originalId || event.id).split('-p')[0];
                                                        handleLaunchBatch(cleanId, event.title, event.flavor, event.mix, event.baseWeight);
                                                    }}
                                                    title={isInProgress ? 'Ya iniciado — ver en PLC' : 'Iniciar Producción'}
                                                    disabled={isLaunching}
                                                >
                                                    {isLaunching ? '⏳' : isInProgress ? '⚡' : '▶'}
                                                </button>
                                            )}
                                        </div>
                                    );
                                }
                            }}
                            eventPropGetter={(event) => {
                                const isCompleted = event.status === 'COMPLETED';
                                const isPending = event.status === 'PENDING';
                                const isInProgress = !isCompleted && !isPending && event.status;
                                let bgColor, border = 'none', opacity = 1, extraStyles = {};

                                if (event.status === 'PREVIEW' || event.isDragging) {
                                    bgColor = '#10b981';
                                } else if (isCompleted) {
                                    bgColor = 'linear-gradient(135deg, #059669, #047857)';
                                    border = '2px solid #34d399';
                                    opacity = 0.7;
                                } else if (isInProgress) {
                                    bgColor = `linear-gradient(135deg, ${getFlavorColor(event.flavor)}, ${getFlavorColor(event.flavor)}dd)`;
                                    border = '3px solid #34d399';
                                    extraStyles = {
                                        boxShadow: '0 0 12px rgba(52, 211, 153, 0.4), inset 0 0 0 1px rgba(255,255,255,0.2)',
                                        animation: 'calendarPulse 2.5s ease-in-out infinite',
                                    };
                                } else {
                                    bgColor = getFlavorColor(event.flavor);
                                    opacity = 0.85;
                                }

                                return {
                                    style: {
                                        background: bgColor,
                                        borderRadius: '6px',
                                        border,
                                        color: 'white',
                                        fontSize: '12px',
                                        padding: '0px',
                                        opacity,
                                        ...extraStyles
                                    }
                                };
                            }}
                        />
                    )}
                </div>
            </div>

            {/* Config Modal */}
            {
                modalData && (
                    <div className="fixed inset-0 bg-black/50 z-[9999] flex items-center justify-center p-4">
                        <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
                                <h3 className="text-xl font-bold text-gray-800">
                                    {modalData.readOnly ? 'Detalle de Bache Programado' : 'Programar Bache'}: <span className="text-blue-600">{modalData.title || modalData.flavor}</span>
                                </h3>
                                <button onClick={() => setModalData(null)} className="text-gray-400 hover:text-gray-600">✕</button>
                            </div>

                            <div className="p-6 space-y-6">
                                <div className="p-6 space-y-6">
                                    {modalData.type === 'EVENT' ? (
                                        /* SIMPLIFIED UI FOR AUX EVENTS */
                                        <div className="space-y-4">
                                            <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                                                <label className="block text-sm font-bold text-gray-700 mb-1">Duración (minutos)</label>
                                                <input
                                                    type="number"
                                                    className={`w-full p-2 border rounded font-bold text-lg ${modalData.readOnly ? 'bg-gray-100 text-gray-500' : 'bg-white border-blue-300 text-gray-800'}`}
                                                    value={Math.round((modalData.scheduledEnd - modalData.scheduledStart) / 60000)}
                                                    disabled={modalData.readOnly}
                                                    onChange={(e) => {
                                                        const mins = parseInt(e.target.value) || 15;
                                                        setModalData(prev => ({
                                                            ...prev,
                                                            scheduledEnd: new Date(prev.scheduledStart.getTime() + mins * 60000)
                                                        }));
                                                    }}
                                                />
                                                <p className="text-xs text-gray-500 mt-2">
                                                    Horario: {modalData.scheduledStart.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - {modalData.scheduledEnd.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                </p>
                                            </div>

                                            {/* Mandatory Notes Field */}
                                            <div className="p-4 bg-yellow-50 rounded-lg border border-yellow-200">
                                                <label className="block text-sm font-bold text-gray-700 mb-1">Notas / Instrucciones <span className="text-red-500">*</span></label>
                                                <textarea
                                                    className={`w-full p-2 border rounded text-sm ${modalData.readOnly ? 'bg-gray-100 text-gray-500' : 'bg-white border-yellow-300 text-gray-800'}`}
                                                    rows="3"
                                                    placeholder="Escribe aquí las instrucciones obligatorias..."
                                                    value={modalData.notes || ''}
                                                    disabled={modalData.readOnly}
                                                    onChange={(e) => setModalData(prev => ({ ...prev, notes: e.target.value }))}
                                                />
                                            </div>
                                        </div>
                                    ) : (
                                        /* EXISTING UI FOR PRODUCTION BATCHES */
                                        <>
                                            {/* Demand Context Banner */}
                                            {(modalData.demandOrderDeficitUnits > 0 || modalData.demandBackorderKg > 0 || (modalData.demandDistributors?.length > 0)) && (() => {
                                                const sizeKeys = Object.keys(modalData.demandSizeTotals || {}).sort((a, b) => (parseFloat(a) || 0) - (parseFloat(b) || 0));
                                                return (
                                                <div className="mb-4 p-3 rounded-lg border bg-gradient-to-r from-orange-50 to-amber-50 border-orange-200">
                                                    <div className="text-xs font-bold text-orange-700 uppercase tracking-wide mb-2 flex items-center gap-1">📦 Demanda de Distribuidores</div>
                                                    {/* Summary cards */}
                                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center mb-3">
                                                        <div className="bg-white/70 rounded-md px-2 py-1.5 border border-orange-100">
                                                            <div className="text-[10px] text-gray-500">Pedidos pend.</div>
                                                            <div className="text-sm font-bold text-orange-700">{modalData.demandOrderDeficitUnits} uds</div>
                                                        </div>
                                                        <div className="bg-white/70 rounded-md px-2 py-1.5 border border-orange-100">
                                                            <div className="text-[10px] text-gray-500">Déficit total</div>
                                                            <div className="text-sm font-bold text-red-600">{modalData.demandBackorderKg} kg</div>
                                                        </div>
                                                        <div className="bg-white/70 rounded-md px-2 py-1.5 border border-blue-100">
                                                            <div className="text-[10px] text-gray-500">Ya programado</div>
                                                            <div className="text-sm font-bold text-blue-600">{modalData.demandScheduledPendingKg} kg</div>
                                                        </div>
                                                        <div className={`bg-white/70 rounded-md px-2 py-1.5 border ${(modalData.demandBackorderKg - modalData.demandScheduledPendingKg) > 0 ? 'border-red-200' : 'border-green-200'}`}>
                                                            <div className="text-[10px] text-gray-500">Falta producir</div>
                                                            <div className={`text-sm font-bold ${(modalData.demandBackorderKg - modalData.demandScheduledPendingKg) > 0 ? 'text-red-600' : 'text-green-600'}`}>
                                                                {Math.max(0, modalData.demandBackorderKg - modalData.demandScheduledPendingKg)} kg
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {/* Per-distributor table */}
                                                    {modalData.demandDistributors?.length > 0 && sizeKeys.length > 0 && (
                                                        <div className="mt-1 pt-2 border-t border-orange-200/50">
                                                            <div className="text-[10px] font-bold text-gray-500 mb-1">Pedidos por distribuidor:</div>
                                                            <div className="overflow-x-auto">
                                                                <table className="w-full text-[10px] border-collapse">
                                                                    <thead>
                                                                        <tr className="bg-orange-100/50">
                                                                            <th className="text-left py-1 px-2 font-bold text-gray-600 border-b border-orange-200">Distribuidor</th>
                                                                            {sizeKeys.map(s => (
                                                                                <th key={s} className="text-center py-1 px-2 font-bold text-gray-600 border-b border-orange-200">{s}</th>
                                                                            ))}
                                                                            <th className="text-center py-1 px-2 font-bold text-gray-600 border-b border-orange-200">Total</th>
                                                                        </tr>
                                                                    </thead>
                                                                    <tbody>
                                                                        {modalData.demandDistributors.map((d, i) => (
                                                                            <tr key={i} className={i % 2 === 0 ? 'bg-white/60' : 'bg-white/30'}>
                                                                                <td className="py-1 px-2 font-semibold text-gray-700 border-b border-gray-100 whitespace-nowrap">{d.distributorName}</td>
                                                                                {sizeKeys.map(s => (
                                                                                    <td key={s} className={`text-center py-1 px-2 border-b border-gray-100 ${d.sizes[s] ? 'font-bold text-orange-700' : 'text-gray-300'}`}>
                                                                                        {d.sizes[s] || '-'}
                                                                                    </td>
                                                                                ))}
                                                                                <td className="text-center py-1 px-2 font-bold text-red-600 border-b border-gray-100">{d.totalUnits}</td>
                                                                            </tr>
                                                                        ))}
                                                                        {/* Totals row */}
                                                                        <tr className="bg-orange-100/80 font-bold">
                                                                            <td className="py-1 px-2 text-gray-700">TOTAL</td>
                                                                            {sizeKeys.map(s => (
                                                                                <td key={s} className="text-center py-1 px-2 text-orange-800">{modalData.demandSizeTotals[s] || 0}</td>
                                                                            ))}
                                                                            <td className="text-center py-1 px-2 text-red-700">{modalData.demandOrderDeficitUnits}</td>
                                                                        </tr>
                                                                    </tbody>
                                                                </table>
                                                            </div>
                                                        </div>
                                                    )}

                                                    {/* Safety Stock - 7 days */}
                                                    {modalData.demandSafetyStock?.length > 0 && (
                                                        <div className="mt-2 pt-2 border-t border-orange-200/50">
                                                            <div className="text-[10px] font-bold text-gray-500 mb-1">📊 Stock de seguridad (7 días):</div>
                                                            <div className="overflow-x-auto">
                                                                <table className="w-full text-[10px] border-collapse">
                                                                    <thead>
                                                                        <tr className="bg-blue-50">
                                                                            <th className="text-left py-1 px-2 font-bold text-gray-600 border-b border-blue-200">Tamaño</th>
                                                                            <th className="text-center py-1 px-2 font-bold text-gray-600 border-b border-blue-200">Vel/día</th>
                                                                            <th className="text-center py-1 px-2 font-bold text-gray-600 border-b border-blue-200">Need 7d</th>
                                                                            <th className="text-center py-1 px-2 font-bold text-gray-600 border-b border-blue-200">Stock</th>
                                                                            <th className="text-center py-1 px-2 font-bold text-green-600 border-b border-blue-200">Prog.</th>
                                                                            <th className="text-center py-1 px-2 font-bold text-gray-600 border-b border-blue-200">Déficit</th>
                                                                        </tr>
                                                                    </thead>
                                                                    <tbody>
                                                                        {modalData.demandSafetyStock.map((s, i) => (
                                                                            <tr key={i} className={i % 2 === 0 ? 'bg-white/60' : 'bg-white/30'}>
                                                                                <td className="py-1 px-2 font-semibold text-gray-700 border-b border-gray-100">{s.sizeLabel}</td>
                                                                                <td className="text-center py-1 px-2 border-b border-gray-100 text-gray-600">{s.dailyVelocity}</td>
                                                                                <td className="text-center py-1 px-2 border-b border-gray-100 font-bold text-blue-700">{s.need7d}</td>
                                                                                <td className={`text-center py-1 px-2 border-b border-gray-100 font-bold ${s.currentStock <= 0 ? 'text-red-600' : 'text-gray-700'}`}>{s.currentStock}</td>
                                                                                <td className={`text-center py-1 px-2 border-b border-gray-100 font-bold ${s.scheduled > 0 ? 'text-green-600' : 'text-gray-400'}`}>{s.scheduled > 0 ? `+${s.scheduled}` : '-'}</td>
                                                                                <td className={`text-center py-1 px-2 border-b border-gray-100 font-bold ${s.deficit > 0 ? 'text-red-600' : 'text-green-600'}`}>{s.deficit > 0 ? `-${s.deficit}` : '✓'}</td>
                                                                            </tr>
                                                                        ))}
                                                                    </tbody>
                                                                </table>
                                                            </div>
                                                        </div>
                                                    )}

                                                    {modalData.demandInProgressKg > 0 && (
                                                        <div className="text-[10px] text-green-600 mt-1.5 font-semibold">🏭 {modalData.demandInProgressKg} kg en producción activa</div>
                                                    )}
                                                </div>
                                                );
                                            })()}

                                            {/* Stats */}
                                            <div className="flex gap-4 mb-4">
                                                <div className="flex-1 bg-blue-50 p-3 rounded-lg border border-blue-100">
                                                    <div className="text-xs text-blue-500 font-bold uppercase">
                                                        {activeLine === 'geniality' ? 'Peso Total Marmita' : 'Jarabe Necesario'}
                                                    </div>
                                                    <div className="text-2xl font-bold text-blue-700">{Math.round(modalData.totalSyrupKg || modalData.totalPlannedKg)} Kg</div>
                                                    {!modalData.readOnly && (
                                                        <div className="flex items-center gap-2 mt-2">
                                                            <span className="text-xs text-blue-500 font-bold">
                                                                {activeLine === 'geniality' ? 'Lotes en Marmita:' : 'Baches a Generar:'}
                                                            </span>
                                                            <input
                                                                type="number"
                                                                min="1"
                                                                max={activeLine === 'geniality' ? 7 : 5}
                                                                className="w-16 p-1 text-center text-sm border border-blue-300 rounded text-blue-700 font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                                value={modalData.targetBatchCount || getProjectedBatches()}
                                                                onChange={(e) => {
                                                                    const maxVal = activeLine === 'geniality' ? 7 : 5;
                                                                    const newVal = Math.min(maxVal, Math.max(1, parseInt(e.target.value) || 1));

                                                                    setModalData(prev => {
                                                                        const currentVal = prev.targetBatchCount || getProjectedBatches() || 1;
                                                                        if (currentVal === 0) return { ...prev, targetBatchCount: newVal };

                                                                        const ratio = newVal / currentVal;

                                                                        const updatedMix = prev.mix.map(m => {
                                                                            const factor = m.kgFactor || parseFloat(m.sizeLabel) || 0;
                                                                            const newUnits = Math.round((m.plannedUnits || 0) * ratio);
                                                                            return {
                                                                                ...m,
                                                                                plannedUnits: newUnits,
                                                                                plannedWeightKg: newUnits * factor
                                                                            };
                                                                        });

                                                                        const newTotalPlannedKg = updatedMix.reduce((acc, m) => acc + (m.plannedWeightKg || 0), 0);
                                                                        const BATCH_SIZE = activeLine === 'geniality' ? 100 : 120;
                                                                        const newTotalSyrupKg = newVal * BATCH_SIZE;

                                                                        // For Geniality: update duration based on lots
                                                                        let newEnd = prev.scheduledEnd;
                                                                        if (activeLine === 'geniality') {
                                                                            const baseDuration = 160;
                                                                            const totalDuration = baseDuration + (newVal - 1) * 40;
                                                                            newEnd = new Date(new Date(prev.scheduledStart).getTime() + totalDuration * 60000);
                                                                        }

                                                                        return {
                                                                            ...prev,
                                                                            targetBatchCount: newVal,
                                                                            mix: updatedMix,
                                                                            totalPlannedKg: newTotalPlannedKg,
                                                                            totalSyrupKg: newTotalSyrupKg,
                                                                            baseWeight: newTotalSyrupKg,
                                                                            scheduledEnd: newEnd
                                                                        };
                                                                    });
                                                                }}
                                                            />
                                                            {activeLine === 'geniality' && (
                                                                <span className="text-[10px] text-blue-400 font-semibold">máx 7</span>
                                                            )}
                                                        </div>
                                                    )}
                                                    {/* Geniality: Capacity bar */}
                                                    {activeLine === 'geniality' && !modalData.readOnly && (
                                                        <div className="mt-2">
                                                            <div className="flex justify-between text-[10px] text-blue-500 font-semibold mb-0.5">
                                                                <span>Capacidad Marmita</span>
                                                                <span>{Math.round(modalData.totalSyrupKg || 0)}/700 kg</span>
                                                            </div>
                                                            <div className="h-2 bg-blue-100 rounded-full overflow-hidden">
                                                                <div
                                                                    className="h-full rounded-full transition-all duration-300"
                                                                    style={{
                                                                        width: `${Math.min(100, ((modalData.totalSyrupKg || 0) / 700) * 100)}%`,
                                                                        background: (modalData.totalSyrupKg || 0) > 700 ? '#ef4444' : 'linear-gradient(90deg, #3b82f6, #06b6d4)'
                                                                    }}
                                                                />
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                                {/* Capacity Check */}
                                                <div className={`flex-1 p-3 rounded-lg border ${(() => {
                                                    const BATCH_SIZE = activeLine === 'geniality' ? 100 : 120;
                                                    const total = modalData.totalSyrupKg || modalData.totalPlannedKg || 0;
                                                    if (activeLine === 'geniality') {
                                                        // For geniality: optimal if within kettle capacity
                                                        return total <= 700 ? 'bg-green-50 border-green-100' : 'bg-red-50 border-red-100';
                                                    }
                                                    const remainder = total % BATCH_SIZE;
                                                    const isOptimal = total >= (BATCH_SIZE * 0.95) && (remainder < 2 || remainder > (BATCH_SIZE - 2));
                                                    return isOptimal ? 'bg-green-50 border-green-100' : 'bg-orange-50 border-orange-100';
                                                })()}`}>
                                                    <div className="text-xs font-bold uppercase text-gray-500">
                                                        {activeLine === 'geniality' ? 'Marmita Grande' : 'Estado Capacidad'}
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        {(() => {
                                                            const BATCH_SIZE = activeLine === 'geniality' ? 100 : 120;
                                                            const total = modalData.totalSyrupKg || modalData.totalPlannedKg || 0;

                                                            if (activeLine === 'geniality') {
                                                                const lots = modalData.targetBatchCount || 1;
                                                                return total <= 700
                                                                    ? <><CheckCircle className="w-5 h-5 text-green-600" /><span className="text-green-700 font-bold">{lots} {lots === 1 ? 'lote' : 'lotes'} · {Math.round(total)}kg</span></>
                                                                    : <><AlertTriangle className="w-5 h-5 text-red-600" /><span className="text-red-700 font-bold">Excede 700kg</span></>;
                                                            }

                                                            const remainder = total % BATCH_SIZE;
                                                            const isOptimal = total >= (BATCH_SIZE * 0.95) && (remainder < 2 || remainder > (BATCH_SIZE - 2));
                                                            return isOptimal
                                                                ? <><CheckCircle className="w-5 h-5 text-green-600" /><span className="text-green-700 font-bold">Óptimo (x{BATCH_SIZE})</span></>
                                                                : <><AlertTriangle className="w-5 h-5 text-orange-600" /><span className="text-orange-700 font-bold">No es Múltiplo de {BATCH_SIZE}</span></>;
                                                        })()}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Manufacturing Mix Bar */}
                                            <div>
                                                <h4 className="text-sm font-bold text-gray-700 mb-2">Mix de Fabricación Sugerido</h4>
                                                <div className="flex h-10 w-full rounded-lg overflow-hidden border border-gray-200 shadow-sm">
                                                    {modalData.mix.map((item, idx) => {
                                                        // Robust Weight Calculation: Prefer calculated kg, fallback to Units * Factor
                                                        const getWeight = (m) => parseFloat(m.plannedWeightKg) || (parseFloat(m.plannedUnits || 0) * (parseFloat(m.kgFactor || parseFloat(m.sizeLabel)) || 0));

                                                        const totalWeight = modalData.mix.reduce((acc, m) => acc + getWeight(m), 0) || 1;
                                                        const itemWeight = getWeight(item);
                                                        const percentage = (itemWeight / totalWeight) * 100;
                                                        // Colors
                                                        const colors = ['bg-blue-500', 'bg-pink-500', 'bg-purple-500', 'bg-yellow-500'];
                                                        return (
                                                            <div
                                                                key={item.productId}
                                                                className={`${colors[idx % colors.length]} flex items-center justify-center text-xs font-bold text-white whitespace-nowrap overflow-hidden transition-all hover:opacity-90`}
                                                                style={{ width: `${percentage}%` }}
                                                                title={`${item.name}: ${percentage.toFixed(1)}%`}
                                                            >
                                                                {percentage > 5 && item.sizeLabel}
                                                            </div>
                                                        )
                                                    })
                                                    }
                                                </div>
                                            </div>

                                            {/* Detailed Inputs */}
                                            <div>
                                                <h4 className="text-sm font-bold text-gray-700 mb-2">Detalle de Unidades</h4>
                                                <div className="space-y-3">
                                                    {modalData.mix.map((item) => {
                                                        const totalBatches = getTotalBatchesCount();
                                                        const totalTarget = item.plannedUnits * totalBatches;

                                                        return (
                                                            <div key={item.productId} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200">
                                                                <div className="flex-1">
                                                                    <div className="text-sm font-bold text-gray-800">{item.name}</div>
                                                                    <div className="text-xs text-gray-500">{item.sku}</div>
                                                                    {item.packSize > 1 && (
                                                                        <div className="text-xs mt-0.5" style={{ color: '#7c3aed' }}>
                                                                            📦 {item.boxes || Math.ceil(item.plannedUnits / item.packSize)} cajas × {item.packSize} uds
                                                                            {item.orderDemandUnits > 0 && <span className="ml-2 text-orange-600">🔥 Pedidos: {item.orderDemandUnits}</span>}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                                <div className="flex items-center gap-2">
                                                                    <input
                                                                        type="number"
                                                                        className={`w-20 p-2 text-right border rounded-md font-mono font-bold ${modalData.readOnly && modalData.status !== 'PENDING' ? 'bg-gray-100 text-gray-500' : 'bg-white text-gray-800 border-blue-200'}`}
                                                                        value={item.plannedUnits}
                                                                        onChange={(e) => {
                                                                            const newUnits = parseInt(e.target.value) || 0;
                                                                            setModalData(prev => {
                                                                                const updatedMix = prev.mix.map(m => {
                                                                                    if (m.productId === item.productId) {
                                                                                        // Derive kgFactor: stored value > compute from weight/units > parse label
                                                                                        const factor = m.kgFactor
                                                                                            || (m.plannedUnits > 0 ? Math.round((m.plannedWeightKg / m.plannedUnits) * 1000) / 1000 : 0)
                                                                                            || parseFloat(m.sizeLabel) || 0;
                                                                                        return {
                                                                                            ...m,
                                                                                            plannedUnits: newUnits,
                                                                                            plannedWeightKg: Math.round(newUnits * factor * 100) / 100,
                                                                                            kgFactor: factor // persist for future edits
                                                                                        };
                                                                                    }
                                                                                    return m;
                                                                                });

                                                                                const newTotalPlannedKg = updatedMix.reduce((acc, m) => acc + (m.plannedWeightKg || 0), 0);
                                                                                const ratio = config.syrupRatio || 0.70;
                                                                                const newTotalSyrupKg = newTotalPlannedKg * ratio;

                                                                                return {
                                                                                    ...prev,
                                                                                    mix: updatedMix,
                                                                                    totalPlannedKg: newTotalPlannedKg,
                                                                                    totalSyrupKg: Math.round(newTotalSyrupKg),
                                                                                    _edited: true
                                                                                };
                                                                            });
                                                                        }}
                                                                        disabled={modalData.readOnly && modalData.status !== 'PENDING'}
                                                                    />
                                                                    <div className="text-sm text-gray-600 w-32">
                                                                        Unidades
                                                                        {modalData.readOnly && (
                                                                            <div className="text-[10px] text-blue-600 font-bold">
                                                                                (Meta Total: {totalTarget})
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>

                                        </>
                                    )}
                                </div>

                                {/* Actions */}
                                <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                                    <button
                                        onClick={() => setModalData(null)}
                                        className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
                                    >
                                        {modalData.readOnly ? 'Cerrar' : 'Cancelar'}
                                    </button>
                                    {modalData.readOnly && (!readOnly || isAdmin) && (
                                        <>
                                            <button
                                                onClick={handleDeleteBatch}
                                                className="px-4 py-2 bg-red-100 text-red-600 font-bold rounded-lg hover:bg-red-200 flex items-center gap-2"
                                            >
                                                <Trash2 className="w-4 h-4" /> Eliminar
                                            </button>
                                            {modalData._edited && modalData.status === 'PENDING' && (
                                                <button
                                                    onClick={async () => {
                                                        try {
                                                            const realId = String(modalData.originalId || modalData.id).split('-p')[0].split(':')[0];
                                                            const updBase = activeLine === 'geniality' ? '/geniality/production' : '/production/liquipops';
                                                            await api.put(`${updBase}/${realId}`, {
                                                                mix: modalData.mix.map(m => ({
                                                                    productId: m.productId,
                                                                    plannedUnits: m.plannedUnits,
                                                                    plannedWeightKg: m.plannedWeightKg
                                                                }))
                                                            });
                                                            alert('✅ Mix actualizado correctamente');
                                                            setModalData(null);
                                                            await fetchEvents();
                                                        } catch (err) {
                                                            console.error(err);
                                                            alert('❌ Error al guardar: ' + (err.response?.data?.error || err.message));
                                                        }
                                                    }}
                                                    className="px-4 py-2 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 shadow-sm flex items-center gap-2"
                                                >
                                                    <Save className="w-4 h-4" /> Guardar Cambios
                                                </button>
                                            )}
                                        </>
                                    )}
                                    {modalData.readOnly && readOnly && modalData.type !== 'EVENT' && (
                                        <button
                                            onClick={() => {
                                                const cleanId = String(modalData.originalId || modalData.id).split('-p')[0];
                                                handleLaunchBatch(cleanId, modalData.title, modalData.flavor, modalData.mix, modalData.baseWeight);
                                            }}
                                            disabled={isLaunching}
                                            className="px-5 py-2 bg-green-600 text-white font-bold rounded-lg hover:bg-green-700 shadow-sm flex items-center gap-2 disabled:opacity-50"
                                        >
                                            {isLaunching ? '⏳ Iniciando...' : '🚀 Iniciar Producción'}
                                        </button>
                                    )}
                                    {!modalData.readOnly && (
                                        <button
                                            onClick={handleSaveBatch}
                                            disabled={isSaving}
                                            className="px-4 py-2 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 shadow-sm flex items-center gap-2"
                                        >
                                            {isSaving && <Loader className="animate-spin w-4 h-4" />}
                                            <Save className="w-4 h-4" /> Confirmar Programación
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* ===== TEMPLATE PICKER MODAL (▶ Launch) ===== */}
            {launchModal && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6">
                        <h2 className="text-lg font-bold text-gray-800 mb-1">Iniciar Producción</h2>
                        <p className="text-sm text-gray-500 mb-4 font-mono bg-gray-50 rounded px-2 py-1 truncate">{launchModal.title}</p>

                        <label className="block text-sm font-semibold text-gray-700 mb-2">Selecciona la Plantilla de Producción</label>

                        {(launchModal.filteredTemplates || templates).length === 0 ? (
                            <p className="text-sm text-red-500">No hay plantillas activas. Crea una en el menú de Plantillas.</p>
                        ) : (
                            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                                {(launchModal.filteredTemplates || templates).map(t => (
                                    <label
                                        key={t.id}
                                        className={`flex items-start gap-3 p-3 border-2 rounded-xl cursor-pointer transition-all ${selectedTemplateId === t.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-blue-300'}`}
                                    >
                                        <input
                                            type="radio"
                                            name="template"
                                            value={t.id}
                                            checked={selectedTemplateId === t.id}
                                            onChange={() => setSelectedTemplateId(t.id)}
                                            className="mt-0.5"
                                        />
                                        <div>
                                            <div className="font-semibold text-gray-800 text-sm">{t.templateName}</div>
                                            <div className="text-xs text-gray-400">{t.templateCode} · {t.totalStages} etapas · v{t.version}</div>
                                            {t.product && <div className="text-xs text-blue-500">{t.product?.name}</div>}
                                        </div>
                                    </label>
                                ))}
                            </div>
                        )}

                        <div className="flex justify-end gap-3 mt-5">
                            <button
                                onClick={() => setLaunchModal(null)}
                                disabled={isLaunching}
                                className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleConfirmLaunch}
                                disabled={!selectedTemplateId || isLaunching}
                                className="px-5 py-2 text-sm font-bold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                            >
                                {isLaunching ? '⏳ Generando...' : '▶ Iniciar Producción'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ===== ALREADY STARTED MODAL ===== */}
            {alreadyStartedModal && (
                <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
                        {/* Header with gradient */}
                        <div style={{ background: 'linear-gradient(135deg, #059669, #10b981)' }} className="px-6 py-5 text-white">
                            <div className="flex items-center gap-3">
                                <div className="w-12 h-12 bg-white/20 backdrop-blur rounded-xl flex items-center justify-center">
                                    <Info className="w-7 h-7" />
                                </div>
                                <div>
                                    <h2 className="text-lg font-bold">Bache Ya Iniciado</h2>
                                    <p className="text-sm text-emerald-100 opacity-90">Este bache ya tiene producción en curso</p>
                                </div>
                            </div>
                        </div>

                        {/* Body */}
                        <div className="p-6 space-y-4">
                            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
                                <div className="text-sm font-bold text-emerald-800 mb-1">🏭 {alreadyStartedModal.batchTitle}</div>
                                <div className="text-xs text-emerald-600">
                                    Estado: <span className="font-bold">{getStatusLabel(alreadyStartedModal.status)}</span>
                                    {alreadyStartedModal.stageName && ` · Etapa: ${alreadyStartedModal.stageName}`}
                                </div>
                            </div>

                            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                                <p className="text-sm text-blue-800 leading-relaxed">
                                    <span className="font-bold">Ve a la sección del módulo Operador PLC</span> para continuar con la ejecución de este bache.
                                </p>
                                <p className="text-xs text-blue-500 mt-2">
                                    Sidebar → Producción → Operador (PLC)
                                </p>
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="px-6 pb-6 flex gap-3">
                            <button
                                onClick={() => setAlreadyStartedModal(null)}
                                className="flex-1 px-4 py-2.5 text-sm font-semibold text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50 transition-all"
                            >
                                Entendido
                            </button>
                            <button
                                onClick={() => {
                                    window.location.href = `/assembly-execution/${alreadyStartedModal.noteId}`;
                                }}
                                className="flex-1 px-4 py-2.5 text-sm font-bold text-white rounded-xl hover:opacity-90 transition-all flex items-center justify-center gap-2"
                                style={{ background: 'linear-gradient(135deg, #059669, #10b981)' }}
                            >
                                ⚡ Ir a Producción
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Pulse animation styles */}
            <style>{`
                @keyframes calendarPulse {
                    0%, 100% { box-shadow: 0 0 8px rgba(52, 211, 153, 0.3), inset 0 0 0 1px rgba(255,255,255,0.2); }
                    50% { box-shadow: 0 0 20px rgba(52, 211, 153, 0.6), inset 0 0 0 1px rgba(255,255,255,0.4); }
                }
            `}</style>
        </div>
    );
};

export default ProductionScheduler;
