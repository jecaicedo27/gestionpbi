/*
=============================================================================
⚠️ IMPORTANTE: COMPONENTE CORE DE LIQUIPOPS ⚠️
=============================================================================
Este archivo (ProductionScheduler.jsx) maneja el Programador de Producción.
Aunque tiene botones/pestañas para "Geniality", su estructura matemática 
y lógica aritmética interna está ESTRICTAMENTE optimizada para LIQUIPOPS 
(Ej: Cálculos de múltiplos de 120kg, coeficientes predeterminados en 0.70, etc).

CUIDADO AL MODIFICAR: Cualquier cambio de escalado o de fracciones hecho aquí 
afectará drásticamente la capacidad matemática del modelo productivo de Liquipops. 
=============================================================================
*/
import React, { useState, useEffect, useCallback } from 'react';
import { Calendar, dateFnsLocalizer } from 'react-big-calendar';
import { format, parse, startOfWeek, getDay, addDays } from 'date-fns';
import { enUS, es } from 'date-fns/locale';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import withDragAndDrop from 'react-big-calendar/lib/addons/dragAndDrop';
import 'react-big-calendar/lib/addons/dragAndDrop/styles.css';
import TimeGrid from 'react-big-calendar/lib/TimeGrid';

import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { Loader, AlertTriangle, CheckCircle, CheckSquare, Save, Trash2, Info, Clock } from 'lucide-react';

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

// Custom 3-day view: yesterday, today, tomorrow
class ThreeDayView extends React.Component {
    render() {
        const { date, localizer, min, max, scrollToTime, enableAutoScroll = true, ...props } = this.props;
        const start = addDays(date, -1);
        const range = [start, addDays(start, 1), addDays(start, 2)];
        return <TimeGrid {...props} range={range} eventOffset={15} localizer={localizer}
            min={min || localizer.startOf(new Date(), 'day')}
            max={max || localizer.endOf(new Date(), 'day')}
            scrollToTime={scrollToTime || localizer.startOf(new Date(), 'day')}
            enableAutoScroll={enableAutoScroll} />;
    }
}
ThreeDayView.range = (date) => {
    const start = addDays(date, -1);
    return [start, addDays(start, 1), addDays(start, 2)];
};
ThreeDayView.navigate = (date, action) => {
    switch (action) {
        case 'PREV': return addDays(date, -3);
        case 'NEXT': return addDays(date, 3);
        default: return date;
    }
};
ThreeDayView.title = (date, { localizer }) => {
    const start = addDays(date, -1);
    const end = addDays(date, 1);
    return localizer.format({ start, end }, 'dayRangeHeaderFormat');
};

const ProductionScheduler = ({ readOnly = false }) => {
    const { user } = useAuth();
    const isAdmin = user?.role === 'ADMIN';
    const isViewOnly = user?.role === 'DISTRIBUIDOR';
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
    const [pendingWashModal, setPendingWashModal] = useState(null); // { washTitle }

    // Line State: 'liquipops' or 'geniality'
    const [activeLine, setActiveLine] = useState('liquipops');

    // Ingredient lot counts for Geniality sidebar
    const [ingredientLots, setIngredientLots] = useState({});

    // Multi-select for bulk delete
    const [bulkSelectMode, setBulkSelectMode] = useState(false);
    const [selectedBatchIds, setSelectedBatchIds] = useState(new Set());
    const [isDeletingBulk, setIsDeletingBulk] = useState(false);

    // Fetch templates on mount for launch modal
    useEffect(() => {
        api.get('/assembly-templates').then(res => setTemplates(res.data || [])).catch(() => { });
    }, []);

    // Auto-select best template for a batch (most stages wins = master template)
    const handleLaunchIngredient = async (batchId, templateCode, baseWeight) => {
        setIsLaunching(true);
        try {
            const notesRes = await api.get(`/assembly-notes?batchId=${batchId}`);
            if (notesRes.data?.length > 0) {
                const sorted = [...notesRes.data].sort((a, b) => (a.stageOrder || 0) - (b.stageOrder || 0));
                const activeNote = sorted.find(n => n.status === 'EXECUTING') || sorted.find(n => n.status === 'PENDING') || sorted[0];
                setAlreadyStartedModal({
                    batchTitle: templateCode,
                    noteId: activeNote.id,
                    status: activeNote.status,
                    stageName: activeNote.stageName || activeNote.stageOrder || '',
                    execBase: '/assembly-execution',
                });
                setIsLaunching(false);
                return;
            }
            const templatesRes = await api.get('/assembly-templates?all=true');
            const tmpl = (templatesRes.data || []).find(t => t.isActive && t.templateCode === templateCode);
            if (!tmpl) {
                alert(`Template ${templateCode} no encontrado. Verifica que exista y esté activo.`);
                setIsLaunching(false);
                return;
            }
            const lotCount = baseWeight ? Math.max(1, Math.round(baseWeight / 100)) : 1;
            const userId = localStorage.getItem('userId');
            const res = await api.post('/assembly-notes/quick-start', {
                templateId: tmpl.id,
                userId,
                quantity: lotCount,
                existingBatchId: batchId,
            });
            if (res.data?.firstNoteId) {
                window.location.href = `/assembly-execution/${res.data.firstNoteId}`;
            } else {
                alert(`No se generaron notas para ${templateCode}.`);
            }
        } catch (err) {
            console.error(err);
            alert('Error al iniciar ingrediente: ' + (err.response?.data?.error || err.message));
        }
        setIsLaunching(false);
    };

    const handleLaunchBatch = async (batchId, title, flavor, mix, baseWeight) => {
        setIsLaunching(true);
        try {
            const sortedEvents = [...events].sort((a, b) => new Date(a.start) - new Date(b.start));
            const cleanBatchId = String(batchId).split('-p')[0];
            const batchIdx = sortedEvents.findIndex(e => {
                const eId = String(e.originalId || e.id).split('-p')[0];
                return eId === cleanBatchId;
            });
            // Aux-event restriction removed: operators need to start the next base
            // while spherification is still running (can't do water change yet).
            // 1. Check if notes already exist for this batch
            const notesBase = activeLine === 'geniality' ? '/geniality/assembly-notes' : '/assembly-notes';
            const execBase = activeLine === 'geniality' ? '/geniality/assembly-execution' : '/assembly-execution';
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
            // ESCARCHADOR has its own umbrella template (no saborización step)
            const isEscarchador = flavorKey.includes('ESCARCHADOR');
            const isLiquimon = flavorKey.includes('LIQUIMON');
            const batchTemplateCode = activeLine === 'geniality'
                ? (isEscarchador ? 'BATCH-ESCARCHADOR' : isLiquimon ? 'BATCH-LIQUIMON' : 'BATCH-GENIALITY')
                : 'BATCH-LIQUIPOPS';
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
            const execBase = activeLine === 'geniality' ? '/geniality/assembly-execution' : '/assembly-execution';
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
                    const startPart2 = new Date(midnight); // 00:00:00
                    const endPart2 = new Date(end);
                    endPart2.setMinutes(endPart2.getMinutes() - 1);

                    const part2DurationMin = (endPart2.getTime() - startPart2.getTime()) / 60000;
                    if (part2DurationMin >= 30) {
                        allEvents.push({
                            ...evt,
                            id: `${evt.id}-p2`,
                            start: startPart2,
                            end: endPart2,
                            title: evt.title + ' (Parte 2)',
                            originalId: evt.id,
                            allDay: false
                        });
                    }
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

        // ── Ingredient shortcut: no mix fetch, use draggedFlavor data directly ──
        if (draggedFlavor?.type === 'INGREDIENT') {
            const lots = draggedFlavor.lots || 1;
            const baseWeight = lots * 100;
            setModalData({
                flavor: draggedFlavor.flavor,
                isIngredient: true,
                templateCode: draggedFlavor.templateCode,
                templateName: draggedFlavor.templateName,
                scheduledStart: start,
                scheduledEnd: end,
                baseWeight,
                totalPlannedKg: baseWeight,
                totalSyrupKg: baseWeight,
                targetBatchCount: lots,
                mix: [{
                    productId: draggedFlavor.ingredientProductId,
                    sku: draggedFlavor.ingredientSku,
                    name: draggedFlavor.ingredientName || draggedFlavor.templateName,
                    plannedUnits: lots,
                    plannedWeightKg: baseWeight,
                    kgFactor: 1,
                    packSize: 1,
                }],
                readOnly: false,
            });
            return;
        }

        try {
            const mixBase = activeLine === 'geniality' ? '/geniality/production' : '/production/liquipops';
            const res = await api.get(`${mixBase}/mix/${flavor}?line=${activeLine}`);

            // CONSTANTS Based on Line
            const BATCH_SIZE = activeLine === 'geniality' ? 100 : 120;
            const DURATION = activeLine === 'geniality' ? (config.geniality_batchDuration || 240) : (config.batchDuration || 90);

            // === LIQUIPOPS: Use pre-calculated batch suggestions (skip scaling) ===
            if (res.data.suggestedBatches && res.data.suggestedBatches.length > 0) {
                const totalBatches = res.data.suggestedBatches.length;
                const totalDuration = totalBatches * DURATION;
                const calculatedEndDate = new Date(start.getTime() + totalDuration * 60000);

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
                } catch (e) { console.warn('Could not fetch suggestions for demand', e); }
                try {
                    const demandRes = await api.get(`${sugBase}/demand?flavor=${encodeURIComponent(flavor)}&line=${activeLine}`);
                    const demand = demandRes.data || {};
                    demandData = { ...demandData, demandDistributors: demand.distributors || [], demandSizeTotals: demand.sizeTotals || {}, demandSafetyStock: demand.safetyStock || [] };
                } catch (e) { console.warn('Could not fetch demand details', e); }

                const scheduledPendingKg = events
                    .filter(e => e.flavor && e.flavor.toUpperCase() === flavor.toUpperCase() && e.status === 'PENDING')
                    .reduce((acc, e) => acc + (e.baseWeight || 0), 0);

                setModalData({
                    ...res.data,
                    suggestedBatches: res.data.suggestedBatches,
                    scheduledStart: start,
                    scheduledEnd: calculatedEndDate,
                    baseWeight: totalBatches * BATCH_SIZE,
                    targetBatchCount: totalBatches,
                    readOnly: false,
                    ...demandData,
                    demandScheduledPendingKg: scheduledPendingKg,
                });
                return;
            }

            // === LIQUIPOPS: Use pre-calculated batch suggestions (skip scaling) ===
            if (res.data.suggestedBatches && res.data.suggestedBatches.length > 0) {
                const totalBatches = res.data.suggestedBatches.length;
                const totalDuration = totalBatches * DURATION;
                const calculatedEndDate = new Date(start.getTime() + totalDuration * 60000);

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
                } catch (e) { console.warn('Could not fetch suggestions for demand', e); }
                try {
                    const demandRes = await api.get(`${sugBase}/demand?flavor=${encodeURIComponent(flavor)}&line=${activeLine}`);
                    const demand = demandRes.data || {};
                    demandData = { ...demandData, demandDistributors: demand.distributors || [], demandSizeTotals: demand.sizeTotals || {}, demandSafetyStock: demand.safetyStock || [] };
                } catch (e) { console.warn('Could not fetch demand details', e); }

                const scheduledPendingKg = events
                    .filter(e => e.flavor && e.flavor.toUpperCase() === flavor.toUpperCase() && e.status === 'PENDING')
                    .reduce((acc, e) => acc + (e.baseWeight || 0), 0);

                setModalData({
                    ...res.data,
                    suggestedBatches: res.data.suggestedBatches,
                    scheduledStart: start,
                    scheduledEnd: calculatedEndDate,
                    baseWeight: totalBatches * BATCH_SIZE,
                    targetBatchCount: totalBatches,
                    readOnly: false,
                    ...demandData,
                    demandScheduledPendingKg: scheduledPendingKg,
                });
                return;
            }

            // For Geniality: calculate how many lots are needed (capped at 7, large kettle)
            // For Liquipops: always 1 batch at a time
            const totalSyrupKg = res.data.totalSyrupKg || res.data.totalPlannedKg || 0;
            let defaultLots = 1;
            if (activeLine === 'geniality') {
                defaultLots = Math.min(7, Math.max(1, Math.ceil(totalSyrupKg / BATCH_SIZE)));
            }

            const targetWeight = defaultLots * BATCH_SIZE;
            const scaleFactor = totalSyrupKg > 0 ? (targetWeight / totalSyrupKg) : 1;
            const SYRUP_RATIO = activeLine === 'geniality' ? 1.0 : (config.syrupRatio || 0.70);

            // First pass: scaled units (pack-rounded for Geniality, targeting exact capacity)
            let currentSyrupAssigned = 0;
            let scaledMix = (res.data.mix || []).map(m => {
                let units = Math.round((m.plannedUnits || 0) * scaleFactor);
                // For Liquipops, include contramuestra if applicable
                const is350 = activeLine !== 'geniality' && ((m.name || '').includes('350') || (m.name || '').includes('360'));
                if (is350 && m.contramuestra && units > 0) units += m.contramuestra;

                // Round to packSize multiples
                const ps = m.packSize || 1;
                if (ps > 1) units = Math.round(units / ps) * ps;

                if (is350 && units > 81) units = 80 + (m.contramuestra || 1);

                currentSyrupAssigned += (units * (m.kgFactor || 0) * SYRUP_RATIO);
                return { ...m, plannedUnits: units, is350 };
            });

            // Second pass: adjust to hit target weight (add/remove whole packs)
            if (scaledMix.length > 0 && Math.abs(currentSyrupAssigned - targetWeight) > 0.5) {
                scaledMix.sort((a, b) => (a.kgFactor || 0) - (b.kgFactor || 0));
                let diff = targetWeight - currentSyrupAssigned;
                let iterations = 0;
                while (Math.abs(diff) > 0.5 && iterations < 200) {
                    iterations++;
                    if (diff > 0) {
                        const tgt = scaledMix.find(m => {
                            const ps = m.packSize || 1;
                            if (m.is350 && m.plannedUnits + ps > 81) return false;
                            return (ps * (m.kgFactor || 0) * SYRUP_RATIO) <= diff + 0.5;
                        });
                        if (tgt) {
                            const ps = tgt.packSize || 1;
                            tgt.plannedUnits += ps;
                            diff -= (ps * (tgt.kgFactor || 0) * SYRUP_RATIO);
                        } else break;
                    } else {
                        const sortedDesc = [...scaledMix].sort((a,b) => (b.kgFactor || 0) - (a.kgFactor || 0));
                        const tgt = sortedDesc.find(m => {
                            const ps = m.packSize || 1;
                            return m.plannedUnits >= ps * 2 && (ps * (m.kgFactor || 0) * SYRUP_RATIO) <= Math.abs(diff) + 0.5;
                        });
                        if (tgt) {
                            const ps = tgt.packSize || 1;
                            tgt.plannedUnits -= ps;
                            diff += (ps * (tgt.kgFactor || 0) * SYRUP_RATIO);
                        } else break;
                    }
                }
            }

            // Clean up and restore properties
            scaledMix = scaledMix.map(m => {
                const ps = m.packSize || 1;
                return {
                    ...m,
                    plannedUnits: m.plannedUnits,
                    plannedWeightKg: m.plannedUnits * (m.kgFactor || 0),
                    boxes: ps > 1 ? Math.floor(m.plannedUnits / ps) : m.boxes
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

            const realTotalKg = scaledMix.reduce((a, m) => a + (m.plannedWeightKg || 0), 0);
            const realLots = activeLine === 'geniality' ? Math.max(1, Math.round(realTotalKg / BATCH_SIZE)) : defaultLots;

            setModalData({
                ...res.data,
                mix: scaledMix,
                totalPlannedKg: realTotalKg,
                totalSyrupKg: realTotalKg,
                scheduledStart: start,
                scheduledEnd: calculatedEndDate,
                baseWeight: realTotalKg,
                targetBatchCount: realLots,
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
            const DURATION = activeLine === 'geniality' ? (config.geniality_batchDuration || 240) : (config.batchDuration || 90);

            let numBatches = modalData.targetBatchCount || 1;
            if (numBatches === 0) numBatches = 1;

            // ═══════════════════════════════════════════════════════
            // INGREDIENT: Simple single batch (GLUCOSA, FRUCTOSA)
            // ═══════════════════════════════════════════════════════
            if (modalData.isIngredient) {
                const totalWeight = Math.round((modalData.totalSyrupKg || modalData.totalPlannedKg || 0) * 100) / 100;
                let currentStartDate = new Date(modalData.scheduledStart);
                let currentEndDate = new Date(modalData.scheduledEnd);
                const batchDuration = (currentEndDate - currentStartDate) / 60000;

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

                const genBase = '/geniality/production';
                const res = await api.post(`${genBase}/schedule`, {
                    flavor: modalData.flavor,
                    scheduledStart: currentStartDate,
                    scheduledEnd: currentEndDate,
                    baseWeight: totalWeight,
                    mix: modalData.mix,
                    batchIndex: 1,
                    totalBatches: 1
                });

                const lots = modalData.targetBatchCount || 1;
                setEvents(prev => [...prev, {
                    id: res.data.id,
                    title: `${modalData.templateName || modalData.flavor} (${lots} ${lots === 1 ? 'lote' : 'lotes'})`,
                    start: new Date(currentStartDate),
                    end: new Date(currentEndDate),
                    flavor: modalData.flavor,
                    mix: modalData.mix,
                    status: 'PENDING',
                    baseWeight: totalWeight,
                    templateCode: modalData.templateCode,
                }]);

                setIsSaving(false);
                setModalData(null);
                await fetchEvents();
                fetchSuggestions();
                return;
            }

            // ═══════════════════════════════════════════════════════
            // GENIALITY: Single batch with N lots (large kettle)
            // ═══════════════════════════════════════════════════════
            if (activeLine === 'geniality') {
                const totalWeight = Math.round((modalData.totalSyrupKg || modalData.totalPlannedKg || 0) * 100) / 100;
                const exactLots = totalWeight / BATCH_SIZE;
                const batchDuration = DURATION;
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
                    title: `${modalData.flavor} (${totalWeight}kg · ${Number.isInteger(exactLots) ? exactLots : exactLots.toFixed(1)} ${exactLots === 1 ? 'lote' : 'lotes'})`,
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
            // LIQUIPOPS: Batch creation (with auto water change every 2 batches)
            // ═══════════════════════════════════════════════════════
            const WATER_CHANGE_DURATION = 30; // minutes
            const eventsToAdd = [];
            let currentStartDate = new Date(modalData.scheduledStart);

            // Count consecutive production batches before this drop (since last water change)
            // Only count batches within the same production session (max 3h gap)
            const sortedPrior = [...events]
                .filter(ev => ev.end && new Date(ev.end) <= currentStartDate)
                .sort((a, b) => new Date(b.end) - new Date(a.end));
            let priorBatchCount = 0;
            let refTime = new Date(currentStartDate);
            const MAX_SESSION_GAP = 3 * 60 * 60 * 1000;
            for (const ev of sortedPrior) {
                const isWaterChange = (ev.title || '').includes('CAMBIO DE AGUA');
                if (isWaterChange) break;
                const isPremix = !ev.flavor;
                if (isPremix) continue;
                const isAux = !ev.mix || ev.mix.length === 0;
                if (isAux) continue;
                const evEnd = new Date(ev.end);
                if (refTime - evEnd > MAX_SESSION_GAP) break;
                priorBatchCount++;
                refTime = new Date(ev.start);
            }

            // Use suggestedBatches if available (labeling-optimized batches)
            const batchPlan = modalData.suggestedBatches && modalData.suggestedBatches.length > 0
                ? modalData.suggestedBatches.map((b, i) => ({ mix: b.mix, label: b.label, index: i + 1, total: modalData.suggestedBatches.length }))
                : Array.from({ length: numBatches }, (_, i) => {
                    const ratio = 1 / numBatches;
                    return {
                        mix: modalData.mix.map(item => ({ ...item, plannedUnits: Math.round(item.plannedUnits * ratio), plannedWeightKg: item.plannedWeightKg ? (item.plannedWeightKg * ratio) : 0 })),
                        label: '',
                        index: i + 1,
                        total: numBatches
                    };
                });

            let batchesSinceWater = priorBatchCount;
            let batchesCreatedThisSession = 0;
            const liqBase = activeLine === 'geniality' ? '/geniality/production' : '/production/liquipops';

            for (const batch of batchPlan) {
                // Insert CAMBIO DE AGUA if 2 batches have passed — but never before the first batch of this session
                if (batchesSinceWater >= 2 && batchesCreatedThisSession > 0) {
                    const wcStart = new Date(currentStartDate);
                    const wcEnd = new Date(wcStart.getTime() + WATER_CHANGE_DURATION * 60000);

                    const wcRes = await api.post(`${liqBase}/schedule`, {
                        flavor: 'CAMBIO DE AGUA',
                        scheduledStart: wcStart,
                        scheduledEnd: wcEnd,
                        baseWeight: 0,
                        mix: [],
                        notes: 'Cambio de agua automático (cada 2 baches)'
                    });

                    eventsToAdd.push({
                        id: wcRes.data.id,
                        title: 'CAMBIO DE AGUA',
                        start: new Date(wcStart),
                        end: new Date(wcEnd),
                        flavor: 'CAMBIO DE AGUA',
                        mix: [],
                        status: 'PENDING',
                        baseWeight: 0
                    });

                    currentStartDate = new Date(wcEnd);
                    batchesSinceWater = 0;
                }

                let currentEndDate = new Date(currentStartDate.getTime() + DURATION * 60000);

                // Backend handles overlap detection and auto-adjustment
                const res = await api.post(`${liqBase}/schedule`, {
                    flavor: modalData.flavor,
                    scheduledStart: currentStartDate,
                    scheduledEnd: currentEndDate,
                    baseWeight: BATCH_SIZE,
                    mix: batch.mix,
                    batchIndex: batch.index,
                    totalBatches: batch.total
                });

                const batchLabel = batch.label ? ` ${batch.label}` : '';
                // Use server-adjusted times (backend may have shifted to avoid overlap)
                const serverStart = new Date(res.data.scheduledStart || currentStartDate);
                const serverEnd = new Date(res.data.scheduledEnd || currentEndDate);
                eventsToAdd.push({
                    id: res.data.id,
                    title: `${modalData.flavor} [${batch.index}/${batch.total}]${batchLabel} (${BATCH_SIZE}kg)`,
                    start: serverStart,
                    end: serverEnd,
                    flavor: modalData.flavor,
                    mix: batch.mix,
                    status: 'PENDING',
                    baseWeight: BATCH_SIZE
                });

                currentStartDate = new Date(serverEnd);
                batchesSinceWater++;
                batchesCreatedThisSession++;
            }

            // Final water change — leave clean water for next session
            if (batchesCreatedThisSession > 0 && batchesSinceWater > 0) {
                const wcStart = new Date(currentStartDate);
                const wcEnd = new Date(wcStart.getTime() + WATER_CHANGE_DURATION * 60000);
                const wcRes = await api.post(`${liqBase}/schedule`, {
                    flavor: 'CAMBIO DE AGUA',
                    scheduledStart: wcStart, scheduledEnd: wcEnd,
                    baseWeight: 0, mix: [],
                    notes: 'Cambio de agua final (limpieza)'
                });
                eventsToAdd.push({
                    id: wcRes.data.id, title: 'CAMBIO DE AGUA',
                    start: new Date(wcStart), end: new Date(wcEnd),
                    flavor: 'CAMBIO DE AGUA', mix: [], status: 'PENDING', baseWeight: 0
                });
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
        'CAMBIO DE AGUA': '#06B6D4', // Cyan
        'GLUCOSA': '#F59E0B', // Amber
        'FRUCTOSA': '#D97706', // Amber-dark
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
        let durationMin = activeLine === 'geniality' ? (config.geniality_batchDuration || 240) : (config.batchDuration || 90);
        if (draggedFlavor.type === 'EVENT') durationMin = draggedFlavor.duration || 60;
        if (draggedFlavor.type === 'INGREDIENT') durationMin = config.geniality_batchDuration || 240;

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
        if (bulkSelectMode) {
            toggleBatchSelection(event.originalId || event.id);
            return;
        }
        // Detect if it's an Auxiliary Event
        const isAuxEvent = !event.mix || event.mix.length === 0 || event.title.includes('LAVADO') || event.title.includes('MANTENIMIENTO') || event.title.includes('PAUSA') || event.title.includes('CAMBIO DE AGUA');

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

    const handleAuxAction = async (batchId, action) => {
        try {
            if (action === 'start') {
                const sortedEvts = [...events].sort((a, b) => new Date(a.start) - new Date(b.start));
                const cleanId = String(batchId).split('-p')[0];
                const idx = sortedEvts.findIndex(e => String(e.originalId || e.id).split('-p')[0] === cleanId);
            }
            const auxBase = activeLine === 'geniality' ? '/geniality/production' : '/production/liquipops';
            const res = await api.patch(`${auxBase}/${batchId}/aux-action`, { action });
            setEvents(prev => prev.map(e => {
                const eClean = String(e.originalId || e.id).split('-p')[0].split(':')[0];
                if (eClean === batchId) {
                    return {
                        ...e,
                        status: res.data.status,
                        startedAt: res.data.startedAt,
                        completedAt: res.data.completedAt,
                    };
                }
                return e;
            }));
            if (action === 'start') {
                fetchEvents();
            }
        } catch (error) {
            console.error('Error aux action:', error);
            alert(`Error: ${error.response?.data?.error || error.message}`);
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

    const toggleBatchSelection = (eventId) => {
        const cleanId = String(eventId).split('-p')[0].split(':')[0];
        setSelectedBatchIds(prev => {
            const next = new Set(prev);
            if (next.has(cleanId)) next.delete(cleanId); else next.add(cleanId);
            return next;
        });
    };

    const handleBulkDelete = async () => {
        if (selectedBatchIds.size === 0) return;
        if (!confirm(`¿Eliminar ${selectedBatchIds.size} evento(s) seleccionados?`)) return;
        setIsDeletingBulk(true);
        const delBase = activeLine === 'geniality' ? '/geniality/production' : '/production/liquipops';
        let deleted = 0;
        for (const id of selectedBatchIds) {
            try {
                await api.delete(`${delBase}/${id}`);
                deleted++;
            } catch (e) { console.warn('Error deleting', id, e.message); }
        }
        setEvents(prev => prev.filter(e => {
            const eClean = String(e.originalId || e.id).split('-p')[0].split(':')[0];
            return !selectedBatchIds.has(eClean);
        }));
        setSelectedBatchIds(new Set());
        setBulkSelectMode(false);
        setIsDeletingBulk(false);
        fetchSuggestions();
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
                            { name: 'CAMBIO DE AGUA', duration: 30, color: 'bg-cyan-50 border-cyan-200 text-cyan-700' },
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

                {/* Insumos Intermedios — only in Geniality */}
                {activeLine === 'geniality' && (() => {
                    const ingredients = suggestions.filter(s => s.isIngredient);
                    if (ingredients.length === 0) return null;
                    return (
                        <div className="mb-4 pb-4 border-b border-gray-100">
                            <h3 className="text-xs font-bold text-gray-500 mb-2 uppercase tracking-wide">Insumos Intermedios</h3>
                            <div className="space-y-2">
                                {ingredients.map(ing => {
                                    const isScheduled = events.some(e => e.flavor === ing.flavor && (e.status === 'PENDING' || e.status?.startsWith('STAGE')));
                                    const lots = ingredientLots[ing.flavor] || 1;
                                    return (
                                        <div
                                            key={ing.flavor}
                                            draggable
                                            onDragStart={() => setDraggedFlavor({ ...ing, type: 'INGREDIENT', lots })}
                                            className={`rounded-lg border shadow-sm cursor-grab active:cursor-grabbing hover:shadow-md transition-all overflow-hidden
                                                ${isScheduled ? 'ring-2 ring-blue-200' : ''}
                                                ${ing.status === 'RED' ? 'border-red-300 bg-red-50' :
                                                    ing.status === 'YELLOW' ? 'border-yellow-300 bg-yellow-50' :
                                                        'border-green-300 bg-green-50'}`}
                                        >
                                            <div className={`px-3 py-2 flex justify-between items-center ${
                                                ing.status === 'RED' ? 'bg-red-100' :
                                                ing.status === 'YELLOW' ? 'bg-yellow-100' : 'bg-green-100'}`}
                                            >
                                                <span className="font-black text-sm text-gray-800">{ing.templateName || ing.flavor}</span>
                                                <div className="flex gap-1">
                                                    {isScheduled && <span className="bg-blue-500 text-white text-[9px] px-1.5 py-0.5 rounded font-bold">PROG</span>}
                                                </div>
                                            </div>
                                            <div className="px-3 py-2">
                                                <div className="text-[10px] text-gray-500 mb-1">{ing.templateCode}</div>
                                                <div className="text-xs text-gray-600 mb-2">
                                                    Stock: <span className={`font-bold ${ing.status === 'RED' ? 'text-red-600' : ing.status === 'YELLOW' ? 'text-yellow-600' : 'text-green-600'}`}>
                                                        {ing.currentStockKg} kg
                                                    </span>
                                                    <span className="text-gray-400 ml-1">({ing.currentStockG?.toLocaleString()}g)</span>
                                                </div>
                                                {ing.inProgressKg > 0 && (
                                                    <div className="text-[10px] text-blue-600 font-bold mb-2">En progreso: +{ing.inProgressKg} kg</div>
                                                )}
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[10px] font-bold text-gray-500 uppercase">Lotes:</span>
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); setIngredientLots(prev => ({ ...prev, [ing.flavor]: Math.max(1, (prev[ing.flavor] || 1) - 1) })); }}
                                                        className="w-6 h-6 rounded border border-gray-300 bg-gray-50 text-gray-600 font-bold text-sm flex items-center justify-center hover:bg-gray-100"
                                                    >-</button>
                                                    <input
                                                        type="number" min="1" max="10"
                                                        value={lots}
                                                        onClick={(e) => e.stopPropagation()}
                                                        onChange={(e) => {
                                                            const v = Math.max(1, Math.min(10, parseInt(e.target.value) || 1));
                                                            setIngredientLots(prev => ({ ...prev, [ing.flavor]: v }));
                                                        }}
                                                        className="w-10 text-center text-sm font-bold border-2 border-gray-200 rounded py-0.5 focus:border-amber-400 outline-none"
                                                    />
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); setIngredientLots(prev => ({ ...prev, [ing.flavor]: Math.min(10, (prev[ing.flavor] || 1) + 1) })); }}
                                                        className="w-6 h-6 rounded border border-gray-300 bg-gray-50 text-gray-600 font-bold text-sm flex items-center justify-center hover:bg-gray-100"
                                                    >+</button>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })()}

                {loading ? (
                    <div className="flex justify-center py-10"><Loader className="animate-spin text-blue-500" /></div>
                ) : (
                    <div className="space-y-3 pb-20">
                        {suggestions.filter(s => !s.isIngredient).map((item) => {
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
                                                    <th className="text-center py-0.5 font-semibold">Estado</th>
                                                    <th className="text-right py-0.5 font-semibold">Seg.</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {details.map((d, i) => {
                                                    const effective = d.units + (d.scheduledUnits || 0);
                                                    const pending = d.deficitUnits || 0;
                                                    const covered = effective >= pending;
                                                    const safetyRemaining = effective - pending;
                                                    const vel = d.dailyVelocity || 0;
                                                    const safetyDays = vel > 0 ? Math.round((safetyRemaining / vel) * 10) / 10 : (safetyRemaining > 0 ? 999 : 0);
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
                                                            <td className="text-center py-0.5">
                                                                {covered ? (
                                                                    <span className="text-green-600 font-bold">✓</span>
                                                                ) : (
                                                                    <span className="text-red-600 font-bold">-{pending - effective}</span>
                                                                )}
                                                            </td>
                                                            <td className={`text-right py-0.5 ${safetyDays >= 7 ? 'text-green-600' : safetyDays >= 0 ? 'text-orange-500' : 'text-red-600'}`}>
                                                                {vel > 0 ? (
                                                                    <div className="leading-tight">
                                                                        <div className="font-bold">{safetyRemaining}</div>
                                                                        <div className="text-[8px]">{safetyDays}d</div>
                                                                    </div>
                                                                ) : '-'}
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
                    <div className="flex justify-end gap-2 mb-2">
                        <button
                            onClick={async () => {
                                const hourStr = prompt('¿Desde qué hora recorrer los baches pendientes?\n(formato 24h, ej: 14 para 2PM)', new Date().getHours().toString());
                                if (!hourStr) return;
                                const hour = parseInt(hourStr);
                                if (isNaN(hour) || hour < 0 || hour > 23) { alert('Hora inválida'); return; }
                                try {
                                    const res = await api.post(`/production/liquipops/${activeLine}/reschedule-shift`, { shiftStartHour: hour });
                                    if (res.data.rescheduled === 0) {
                                        alert(res.data.message || 'No hay baches pendientes para recorrer.');
                                    } else {
                                        const effTime = new Date(res.data.effectiveStart).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
                                        alert(`✅ ${res.data.rescheduled} baches recorridos.\nInicio efectivo: ${effTime}${res.data.runningBatch ? `\n(Bache en curso: ${res.data.runningBatch})` : ''}`);
                                    }
                                    await fetchEvents();
                                } catch (e) {
                                    alert('Error: ' + (e.response?.data?.error || e.message));
                                }
                            }}
                            className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 border border-amber-200 text-amber-700 text-xs font-bold rounded-lg hover:bg-amber-100 transition-all"
                        >
                            <Clock className="w-3.5 h-3.5" /> Recorrer Turno
                        </button>
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
                        <button
                            onClick={() => { setBulkSelectMode(!bulkSelectMode); setSelectedBatchIds(new Set()); }}
                            className={`flex items-center gap-2 px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${bulkSelectMode ? 'bg-purple-600 text-white' : 'bg-purple-50 border border-purple-200 text-purple-600 hover:bg-purple-100'}`}
                        >
                            <CheckSquare className="w-3.5 h-3.5" /> {bulkSelectMode ? 'Cancelar selección' : 'Seleccionar'}
                        </button>
                    </div>
                )}
                {bulkSelectMode && (
                    <div className="flex items-center gap-3 px-4 py-2 bg-purple-50 border-b border-purple-200">
                        <span className="text-sm font-bold text-purple-700">
                            {selectedBatchIds.size} seleccionado(s)
                        </span>
                        <button
                            onClick={() => {
                                const allIds = new Set();
                                events.forEach(e => { allIds.add(String(e.originalId || e.id).split('-p')[0].split(':')[0]); });
                                setSelectedBatchIds(allIds);
                            }}
                            className="px-2 py-1 text-xs font-bold text-purple-600 bg-white border border-purple-300 rounded hover:bg-purple-100"
                        >
                            Seleccionar todos
                        </button>
                        <button
                            onClick={handleBulkDelete}
                            disabled={selectedBatchIds.size === 0 || isDeletingBulk}
                            className="px-3 py-1 text-xs font-bold text-white bg-red-500 rounded hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                        >
                            <Trash2 className="w-3 h-3" /> {isDeletingBulk ? 'Eliminando...' : `Eliminar (${selectedBatchIds.size})`}
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
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 overflow-x-auto" style={{ width: '100%' }}>
                  <div style={{ minWidth: '2450px' }}>
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
                            step={15}
                            timeslots={4}
                            scrollToTime={new Date(new Date().setHours(8, 0, 0, 0))}
                            formats={{
                                timeGutterFormat: (date, culture, localizer) =>
                                    localizer.format(date, 'HH:mm', culture),
                            }}
                            culture='es'
                            dayLayoutAlgorithm="no-overlap"
                            messages={{ week: 'Semana', day: 'Día', today: 'Hoy', previous: 'Ant.', next: 'Sig.' }}
                            style={{ height: readOnly ? 'calc(100vh - 140px)' : '1600px' }}
                            onSelectEvent={handleSelectEvent}
                            components={{
                                event: ({ event }) => {
                                    const isAuxEvent = !event.mix || event.mix.length === 0 || event.title.includes('LAVADO') || event.title.includes('MANTENIMIENTO') || event.title.includes('PAUSA') || event.title.includes('CAMBIO DE AGUA');
                                    const isCompleted = event.status === 'COMPLETED';
                                    const isInProgress = event.status && event.status !== 'PENDING' && !isCompleted;
                                    const statusLabel = getStatusLabel(event.status);
                                    const auxStarted = isAuxEvent && isInProgress;
                                    const auxPending = isAuxEvent && !isInProgress && !isCompleted;
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
                                                {!isAuxEvent && event.startedAt && (
                                                    <div className="text-[9px] truncate" style={{ opacity: 0.85 }}>
                                                        Inicio: {new Date(event.startedAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: true })}
                                                    </div>
                                                )}
                                                {!isAuxEvent && !isCompleted && event.mix?.length > 0 && (() => {
                                                    const sizes = event.mix.filter(m => m.plannedUnits > 0);
                                                    if (sizes.length === 0) return null;
                                                    const toGR = (label) => { const kg = parseFloat(label); return kg && kg < 10 ? `${Math.round(kg * 1000)}g` : label; };
                                                    return (
                                                        <div className="text-[10px] font-bold leading-tight truncate" style={{ opacity: 0.95, letterSpacing: '0.3px' }}>
                                                            {sizes.map((m, i) => <span key={i}>{i > 0 && ' · '}{toGR(m.sizeLabel)}:{m.plannedUnits}</span>)}
                                                        </div>
                                                    );
                                                })()}
                                                {isAuxEvent && isCompleted && (
                                                    <div className="text-[10px] truncate" style={{ opacity: 0.9 }}>Finalizado</div>
                                                )}
                                            </div>
                                            {!isViewOnly && isAuxEvent && !isCompleted && (
                                                <button
                                                    className="ml-1 w-5 h-5 flex items-center justify-center rounded shrink-0 z-10 transition-all hover:scale-110"
                                                    style={{
                                                        background: auxStarted ? 'rgba(239, 68, 68, 0.95)' : 'rgba(255,255,255,0.9)',
                                                        color: auxStarted ? 'white' : '#06B6D4',
                                                        fontSize: '10px', fontWeight: 'bold'
                                                    }}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        const cleanId = String(event.originalId || event.id).split('-p')[0];
                                                        handleAuxAction(cleanId, auxStarted ? 'finish' : 'start');
                                                    }}
                                                    title={auxStarted ? 'Finalizar lavado' : 'Iniciar lavado'}
                                                >
                                                    {auxStarted ? '⏹' : '▶'}
                                                </button>
                                            )}
                                            {!isViewOnly && !isAuxEvent && !isCompleted && (
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
                                                        if (event.templateCode) {
                                                            handleLaunchIngredient(cleanId, event.templateCode, event.baseWeight);
                                                        } else {
                                                            handleLaunchBatch(cleanId, event.title, event.flavor, event.mix, event.baseWeight);
                                                        }
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
                                const eClean = String(event.originalId || event.id).split('-p')[0].split(':')[0];
                                const isSelected = bulkSelectMode && selectedBatchIds.has(eClean);

                                let bgColor, border = 'none', opacity = 1, extraStyles = {};
                                if (isSelected) {
                                    bgColor = 'linear-gradient(135deg, #7c3aed, #6d28d9)';
                                    border = '3px solid #fbbf24';
                                    extraStyles = { boxShadow: '0 0 12px rgba(251, 191, 36, 0.6)' };
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
                                    bgColor = bulkSelectMode ? getFlavorColor(event.flavor) + 'aa' : getFlavorColor(event.flavor);
                                    opacity = 0.85;
                                }

                                return {
                                    style: {
                                        background: bgColor,
                                        borderRadius: '8px',
                                        border: border !== 'none' ? border : '2px solid rgba(255,255,255,0.7)',
                                        color: 'white',
                                        fontSize: '12px',
                                        padding: '0px',
                                        opacity,
                                        cursor: bulkSelectMode ? 'pointer' : undefined,
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
                            step={15}
                            timeslots={4}
                            scrollToTime={new Date(new Date().setHours(8, 0, 0, 0))}
                            formats={{
                                timeGutterFormat: (date, culture, localizer) =>
                                    localizer.format(date, 'HH:mm', culture),
                            }}
                            culture='es'
                            dayLayoutAlgorithm="no-overlap"
                            messages={{ week: 'Semana', day: 'Día', today: 'Hoy', previous: 'Ant.', next: 'Sig.' }}
                            resizable
                            style={{ height: '2600px' }}
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
                                    const isAuxEvent = !event.mix || event.mix.length === 0 || event.title.includes('LAVADO') || event.title.includes('MANTENIMIENTO') || event.title.includes('PAUSA') || event.title.includes('CAMBIO DE AGUA');
                                    const isCompleted = event.status === 'COMPLETED';
                                    const isInProgress = event.status && event.status !== 'PENDING' && !isCompleted;
                                    const statusLabel = getStatusLabel(event.status);

                                    const auxStarted = isAuxEvent && isInProgress;
                                    const auxPending = isAuxEvent && !isInProgress && !isCompleted;
                                    return (
                                        <div className="relative h-full px-2 py-1.5 overflow-hidden" title={event.title}>
                                            {isAuxEvent && !isCompleted && (
                                                <button
                                                    className="absolute flex items-center justify-center rounded z-10 transition-all hover:scale-110"
                                                    style={{
                                                        top: 2, right: 4, width: 20, height: 20,
                                                        background: auxStarted ? 'rgba(239, 68, 68, 0.95)' : 'rgba(255,255,255,0.95)',
                                                        color: auxStarted ? 'white' : '#06B6D4',
                                                        fontSize: '10px', fontWeight: 'bold'
                                                    }}
                                                    onMouseDown={(e) => e.stopPropagation()}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        const cleanId = String(event.originalId || event.id).split('-p')[0];
                                                        handleAuxAction(cleanId, auxStarted ? 'finish' : 'start');
                                                    }}
                                                    title={auxStarted ? 'Finalizar lavado' : 'Iniciar lavado'}
                                                >
                                                    {auxStarted ? '⏹' : '▶'}
                                                </button>
                                            )}
                                            {!isAuxEvent && !isCompleted && (
                                                <button
                                                    className="absolute flex items-center justify-center rounded-lg z-10 transition-all hover:scale-110"
                                                    style={{
                                                        top: 4, right: 4, width: 30, height: 30,
                                                        background: isInProgress ? 'rgba(16, 185, 129, 0.95)' : 'rgba(255,255,255,0.95)',
                                                        color: isInProgress ? 'white' : '#2563eb',
                                                        fontSize: '15px', fontWeight: 'bold'
                                                    }}
                                                    onMouseDown={(e) => e.stopPropagation()}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        const cleanId = String(event.originalId || event.id).split('-p')[0];
                                                        if (event.templateCode) {
                                                            handleLaunchIngredient(cleanId, event.templateCode, event.baseWeight);
                                                        } else {
                                                            handleLaunchBatch(cleanId, event.title, event.flavor, event.mix, event.baseWeight);
                                                        }
                                                    }}
                                                    title={isInProgress ? 'Ya iniciado — ver en PLC' : 'Iniciar Producción'}
                                                    disabled={isLaunching}
                                                >
                                                    {isLaunching ? '⏳' : isInProgress ? '⚡' : '▶'}
                                                </button>
                                            )}
                                            <div className="font-bold pr-9" style={{ fontSize: '12px', lineHeight: 1.3 }}>{event.title}</div>
                                            {!isAuxEvent && (
                                                <div className="text-[10px] mt-1" style={{ opacity: 0.9 }}>
                                                    {isCompleted ? '🏁 Finalizado' : isInProgress ? (
                                                        <span className="flex items-center gap-0.5">
                                                            <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#34d399', boxShadow: '0 0 6px #34d399', animation: 'pulse 1.5s ease-in-out infinite' }} />
                                                            {` ${statusLabel}`}
                                                        </span>
                                                    ) : `⏸ ${event.mix?.length || 0} ingredientes`}
                                                </div>
                                            )}
                                            {!isAuxEvent && event.startedAt && (
                                                <div className="text-[10px] mt-0.5" style={{ opacity: 0.85 }}>
                                                    Inicio: {new Date(event.startedAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: true })}
                                                </div>
                                            )}
                                            {!isAuxEvent && !isCompleted && event.mix?.length > 0 && (() => {
                                                const sizes = event.mix.filter(m => m.plannedUnits > 0);
                                                if (sizes.length === 0) return null;
                                                const toGR = (label) => { const kg = parseFloat(label); return kg && kg < 10 ? `${Math.round(kg * 1000)}g` : label; };
                                                return (
                                                    <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
                                                        {sizes.map((m, i) => (
                                                            <span key={i} className="text-[11px] font-black" style={{ opacity: 0.95 }}>
                                                                {toGR(m.sizeLabel)}: {m.plannedUnits}
                                                            </span>
                                                        ))}
                                                    </div>
                                                );
                                            })()}
                                            {isAuxEvent && isCompleted && (
                                                <div className="text-[10px] mt-1" style={{ opacity: 0.9 }}>Finalizado</div>
                                            )}
                                        </div>
                                    );
                                }
                            }}
                            eventPropGetter={(event) => {
                                const isCompleted = event.status === 'COMPLETED';
                                const isPending = event.status === 'PENDING';
                                const isInProgress = !isCompleted && !isPending && event.status;
                                const eClean = String(event.originalId || event.id).split('-p')[0].split(':')[0];
                                const isSelected = bulkSelectMode && selectedBatchIds.has(eClean);
                                let bgColor, border = 'none', opacity = 1, extraStyles = {};

                                if (isSelected) {
                                    bgColor = 'linear-gradient(135deg, #7c3aed, #6d28d9)';
                                    border = '3px solid #fbbf24';
                                    extraStyles = { boxShadow: '0 0 12px rgba(251, 191, 36, 0.6)' };
                                } else if (event.status === 'PREVIEW' || event.isDragging) {
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
                                    bgColor = bulkSelectMode ? getFlavorColor(event.flavor) + 'aa' : getFlavorColor(event.flavor);
                                    opacity = 0.85;
                                }

                                return {
                                    style: {
                                        background: bgColor,
                                        borderRadius: '8px',
                                        border: border !== 'none' ? border : '2px solid rgba(255,255,255,0.7)',
                                        color: 'white',
                                        fontSize: '12px',
                                        padding: '0px',
                                        opacity,
                                        cursor: bulkSelectMode ? 'pointer' : undefined,
                                        ...extraStyles
                                    }
                                };
                            }}
                        />
                    )}
                  </div>
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
                                                    {!modalData.readOnly && !modalData.suggestedBatches && (
                                                        <div className="flex items-center gap-2 mt-2">
                                                            <span className="text-xs text-blue-500 font-bold">
                                                                {activeLine === 'geniality' ? 'Lotes en Marmita:' : 'Baches a Generar:'}
                                                            </span>
                                                            <input
                                                                type="number"
                                                                min="1"
                                                                max={activeLine === 'geniality' ? 7 : 5}
                                                                className="w-16 p-1 text-center text-sm border border-blue-300 rounded text-blue-700 font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                                value={activeLine === 'geniality'
                                                                    ? (() => { const v = (modalData.totalSyrupKg || 0) / 100; return Number.isInteger(v) ? v : parseFloat(v.toFixed(2)); })()
                                                                    : (modalData.targetBatchCount || getProjectedBatches())}
                                                                onChange={(e) => {
                                                                    const maxVal = activeLine === 'geniality' ? 7 : 5;
                                                                    const newVal = activeLine === 'geniality'
                                                                        ? Math.min(maxVal, Math.max(0.1, parseFloat(e.target.value) || 0.1))
                                                                        : Math.min(maxVal, Math.max(1, parseInt(e.target.value) || 1));

                                                                    setModalData(prev => {
                                                                        if (activeLine === 'geniality') {
                                                                            const newTotalSyrupKg = Math.round(newVal * 100);
                                                                            const ratio = newTotalSyrupKg / (prev.totalSyrupKg || 1);
                                                                            const updatedMix = prev.mix.map(m => {
                                                                                const factor = m.kgFactor || parseFloat(m.sizeLabel) || 0;
                                                                                let newUnits = Math.round((m.plannedUnits || 0) * ratio);
                                                                                const ps = m.packSize || 1;
                                                                                if (ps > 1) newUnits = Math.max(ps, Math.round(newUnits / ps) * ps);
                                                                                return { ...m, plannedUnits: newUnits, plannedWeightKg: Math.round(newUnits * factor * 100) / 100, boxes: ps > 1 ? Math.floor(newUnits / ps) : m.boxes };
                                                                            });
                                                                            const newTotalPlannedKg = updatedMix.reduce((acc, m) => acc + (m.plannedWeightKg || 0), 0);
                                                                            const baseDuration = config.geniality_batchDuration || 240;
                                                                            const totalDuration = baseDuration + (newVal - 1) * 40;
                                                                            const newEnd = new Date(new Date(prev.scheduledStart).getTime() + totalDuration * 60000);

                                                                            return { ...prev, targetBatchCount: newVal, mix: updatedMix, totalPlannedKg: newTotalPlannedKg, totalSyrupKg: newTotalSyrupKg, baseWeight: newTotalSyrupKg, scheduledEnd: newEnd };
                                                                        } else {
                                                                            const currentVal = prev.targetBatchCount || getProjectedBatches() || 1;
                                                                            if (currentVal === 0) return { ...prev, targetBatchCount: newVal };

                                                                            const ratio = newVal / currentVal;

                                                                            const updatedMix = prev.mix.map(m => {
                                                                                const rawSize = parseFloat(m.sizeLabel) || 0;
                                                                                const factor = m.kgFactor || (rawSize >= 100 ? rawSize / 1000 : rawSize) || 0;
                                                                                const newUnits = Math.round((m.plannedUnits || 0) * ratio);
                                                                                return {
                                                                                    ...m,
                                                                                    plannedUnits: newUnits,
                                                                                    plannedWeightKg: newUnits * factor
                                                                                };
                                                                            });

                                                                            const newTotalPlannedKg = updatedMix.reduce((acc, m) => acc + (m.plannedWeightKg || 0), 0);
                                                                            const BATCH_SIZE = 120;
                                                                            const newTotalSyrupKg = newVal * BATCH_SIZE;

                                                                            let newEnd = prev.scheduledEnd;

                                                                            return {
                                                                                ...prev,
                                                                                targetBatchCount: newVal,
                                                                                mix: updatedMix,
                                                                                totalPlannedKg: newTotalPlannedKg,
                                                                                totalSyrupKg: newTotalSyrupKg,
                                                                                baseWeight: newTotalSyrupKg,
                                                                                scheduledEnd: newEnd
                                                                            };
                                                                        }
                                                                    });
                                                                }}
                                                            />
                                                            {activeLine === 'geniality' && (
                                                                <span className="text-[10px] text-blue-400 font-semibold">máx 7</span>
                                                            )}
                                                        </div>
                                                    )}
                                                    {!modalData.readOnly && modalData.suggestedBatches && (
                                                        <div className="flex items-center gap-2 mt-2">
                                                            <span className="text-xs text-blue-500 font-bold">Baches Sugeridos:</span>
                                                            <span className="text-sm font-bold text-blue-700">{modalData.suggestedBatches.length}</span>
                                                            <span className="text-[10px] text-blue-400">(optimizado por rotulado)</span>
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
                                                                const BATCH_SIZE_G = 100;
                                                                const realLots = total / BATCH_SIZE_G;
                                                                const lotsDisplay = Number.isInteger(realLots) ? realLots : realLots.toFixed(2);
                                                                return total <= 700
                                                                    ? <><CheckCircle className="w-5 h-5 text-green-600" /><span className="text-green-700 font-bold">{lotsDisplay} {realLots === 1 ? 'lote' : 'lotes'} · {Math.round(total)}kg</span></>
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

                                            {modalData.suggestedBatches && modalData.suggestedBatches.length > 0 ? (
                                                /* ═══ BATCH GROUPS VIEW (Liquipops labeling-optimized) ═══ */
                                                <div>
                                                    <div className="flex items-center justify-between mb-3">
                                                        <h4 className="text-sm font-bold text-gray-700">
                                                            Plan de Baches por Rotulado
                                                            <span className="ml-2 text-[10px] font-normal text-purple-500">📦 {modalData.suggestedBatches.length} baches · pack cerrado · 1 contramuestra/bache</span>
                                                        </h4>
                                                        <div className="flex gap-1">
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    const batches = [...modalData.suggestedBatches];
                                                                    const typeA = batches.filter(b => b.type === 'MEDIUM');
                                                                    const typeB = batches.filter(b => b.type !== 'MEDIUM');
                                                                    const reordered = [...typeB, ...typeA].map((b, i) => ({ ...b, batchIndex: i + 1 }));
                                                                    setModalData(prev => ({ ...prev, suggestedBatches: reordered }));
                                                                }}
                                                                className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 rounded hover:bg-amber-100 transition-colors"
                                                            >
                                                                &#8645; Invertir orden
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    const batches = [...modalData.suggestedBatches];
                                                                    const typeA = batches.filter(b => b.type === 'MEDIUM');
                                                                    const typeB = batches.filter(b => b.type !== 'MEDIUM');
                                                                    const mixed = [];
                                                                    const maxLen = Math.max(typeA.length, typeB.length);
                                                                    for (let i = 0; i < maxLen; i++) {
                                                                        if (i < typeB.length) mixed.push(typeB[i]);
                                                                        if (i < typeA.length) mixed.push(typeA[i]);
                                                                    }
                                                                    setModalData(prev => ({ ...prev, suggestedBatches: mixed.map((b, i) => ({ ...b, batchIndex: i + 1 })) }));
                                                                }}
                                                                className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200 rounded hover:bg-purple-100 transition-colors"
                                                            >
                                                                &#8596; Mezclar
                                                            </button>
                                                        </div>
                                                    </div>
                                                    {(() => {
                                                        const BATCH_SIZE_DISPLAY = activeLine === 'geniality' ? 100 : 120;
                                                        const groups = [];
                                                        modalData.suggestedBatches.forEach(batch => {
                                                            const key = batch.mix.map(m => `${m.productId}:${m.plannedUnits}`).join('|');
                                                            const last = groups[groups.length - 1];
                                                            if (last && last.key === key) { last.count++; last.indices.push(batch.batchIndex); }
                                                            else groups.push({ key, batch, count: 1, indices: [batch.batchIndex] });
                                                        });
                                                        return groups.map((group, gi) => (
                                                            <div key={gi} className="bg-gray-50 rounded-lg p-3 border border-gray-200 mb-3">
                                                                <div className="flex items-center justify-between mb-2">
                                                                    <div className="text-sm font-bold text-gray-700">
                                                                        {group.count > 1
                                                                            ? `Baches ${group.indices[0]}-${group.indices[group.indices.length - 1]}`
                                                                            : `Bache ${group.indices[0]}`
                                                                        }: {group.batch.label}
                                                                    </div>
                                                                    <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-bold">
                                                                        {group.count}&times; {BATCH_SIZE_DISPLAY}kg
                                                                    </span>
                                                                </div>
                                                                <div className="space-y-1">
                                                                    {group.batch.mix.map(item => (
                                                                        <div key={item.productId} className="flex items-center justify-between py-1.5 px-2 bg-white rounded border border-gray-100">
                                                                            <div>
                                                                                <div className="text-sm font-medium text-gray-800">{item.sizeLabel}</div>
                                                                                <div className="text-[10px] text-gray-500">{item.sku}</div>
                                                                            </div>
                                                                            <div className="text-right">
                                                                                <div className="text-sm font-bold text-gray-800">{item.plannedUnits} uds</div>
                                                                                {item.packSize > 1 && (
                                                                                    <div className="text-[10px] text-purple-600">
                                                                                        {item.boxes} cajas &times; {item.packSize}
                                                                                        {item.contramuestra > 0 && <span className="text-emerald-600 ml-1">+ {item.contramuestra} CM</span>}
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        ));
                                                    })()}
                                                    {/* Totals summary */}
                                                    <div className="bg-blue-50 rounded-lg p-3 border border-blue-100 mt-2">
                                                        <div className="text-xs font-bold text-blue-700 uppercase mb-1">Totales</div>
                                                        {(modalData.mix || []).map(item => (
                                                            <div key={item.productId} className="flex justify-between text-sm text-blue-800 py-0.5">
                                                                <span>{item.name}</span>
                                                                <span className="font-bold">
                                                                    {item.plannedUnits} uds
                                                                    {item.packSize > 1 && ` (${item.boxes} cajas)`}
                                                                    {item.contramuestra > 0 && ` + ${item.contramuestra} CM`}
                                                                </span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            ) : (
                                                /* ═══ EXISTING SINGLE-MIX VIEW (Geniality / fallback) ═══ */
                                                <>
                                            {/* Manufacturing Mix Bar */}
                                            <div>
                                                <h4 className="text-sm font-bold text-gray-700 mb-2">Mix de Fabricación Sugerido
                                                    <span className="ml-2 text-[10px] font-normal text-purple-500">📦 Cantidades por pack cerrado</span>
                                                </h4>
                                                <div className="flex h-10 w-full rounded-lg overflow-hidden border border-gray-200 shadow-sm">
                                                    {modalData.mix.map((item, idx) => {
                                                        const getWeight = (m) => { const rawSize = parseFloat(m.sizeLabel) || 0; const f = m.kgFactor || (rawSize >= 100 ? rawSize / 1000 : rawSize) || 0; return parseFloat(m.plannedWeightKg) || (parseFloat(m.plannedUnits || 0) * f); };
                                                        const totalWeight = modalData.mix.reduce((acc, m) => acc + getWeight(m), 0) || 1;
                                                        const itemWeight = getWeight(item);
                                                        const percentage = (itemWeight / totalWeight) * 100;
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
                                                    })}
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
                                                                            {item.contramuestra > 0 && <span className="ml-1 text-emerald-600">+ {item.contramuestra} contramuestra</span>}
                                                                            {item.orderDemandUnits > 0 && <span className="ml-2 text-orange-600">🔥 Pedidos: {item.orderDemandUnits}</span>}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                                <div className="flex items-center gap-2">
                                                                    <input
                                                                        type="number"
                                                                        step={1}
                                                                        min={0}
                                                                        className={`w-20 p-2 text-right border rounded-md font-mono font-bold ${modalData.readOnly && modalData.status !== 'PENDING' ? 'bg-gray-100 text-gray-500' : 'bg-white text-gray-800 border-blue-200'}`}
                                                                        value={item.plannedUnits}
                                                                        onChange={(e) => {
                                                                            const newUnits = parseInt(e.target.value) || 0;
                                                                            setModalData(prev => {
                                                                                const updatedMix = prev.mix.map(m => {
                                                                                    if (m.productId === item.productId) {
                                                                                        const rawSize = parseFloat(m.sizeLabel) || 0;
                                                                                        const factor = m.kgFactor
                                                                                            || (m.plannedUnits > 0 ? Math.round((m.plannedWeightKg / m.plannedUnits) * 1000) / 1000 : 0)
                                                                                            || (rawSize >= 100 ? rawSize / 1000 : rawSize) || 0;
                                                                                        const mps = m.packSize || 1;
                                                                                        return { ...m, plannedUnits: newUnits, plannedWeightKg: Math.round(newUnits * factor * 100) / 100, boxes: mps > 1 ? Math.floor(newUnits / mps) : null, kgFactor: factor };
                                                                                    }
                                                                                    return m;
                                                                                });
                                                                                const newTotalPlannedKg = updatedMix.reduce((acc, m) => acc + (m.plannedWeightKg || 0), 0);
                                                                                if (activeLine === 'geniality') {
                                                                                    return { ...prev, mix: updatedMix, totalPlannedKg: newTotalPlannedKg, totalSyrupKg: newTotalPlannedKg, baseWeight: newTotalPlannedKg, _edited: true };
                                                                                }
                                                                                const ratio = config.syrupRatio || 0.70;
                                                                                return { ...prev, mix: updatedMix, totalPlannedKg: newTotalPlannedKg, totalSyrupKg: Math.round(newTotalPlannedKg * ratio), _edited: true };
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
                                    {modalData.readOnly && readOnly && !isViewOnly && modalData.type !== 'EVENT' && (
                                        <button
                                            onClick={() => {
                                                const cleanId = String(modalData.originalId || modalData.id).split('-p')[0];
                                                if (modalData.templateCode) {
                                                    handleLaunchIngredient(cleanId, modalData.templateCode, modalData.baseWeight);
                                                } else {
                                                    handleLaunchBatch(cleanId, modalData.title, modalData.flavor, modalData.mix, modalData.baseWeight);
                                                }
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
                                    window.location.href = `${activeLine === 'geniality' ? '/geniality/assembly-execution' : '/assembly-execution'}/${alreadyStartedModal.noteId}`;
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

            {/* ===== PENDING WASH MODAL ===== */}
            {pendingWashModal && (
                <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
                        <div style={{ background: 'linear-gradient(135deg, #0891b2, #06b6d4)' }} className="px-6 py-5 text-white">
                            <div className="flex items-center gap-3">
                                <div className="w-12 h-12 bg-white/20 backdrop-blur rounded-xl flex items-center justify-center text-2xl">
                                    🚿
                                </div>
                                <div>
                                    <h2 className="text-lg font-bold">Lavado Pendiente</h2>
                                    <p className="text-sm text-cyan-100 opacity-90">Debes finalizar el lavado antes de continuar</p>
                                </div>
                            </div>
                        </div>
                        <div className="p-6 space-y-4">
                            <div className="bg-cyan-50 border border-cyan-200 rounded-xl p-4">
                                <div className="text-sm font-bold text-cyan-800 mb-1">
                                    {pendingWashModal.isWashBlock ? '⏳ Bache en proceso' : '🧼 Lavado pendiente'}
                                </div>
                                <div className="text-xs text-cyan-600">
                                    {pendingWashModal.isWashBlock ? pendingWashModal.washTitle : 'Este evento aún no ha sido finalizado'}
                                </div>
                            </div>
                            {!pendingWashModal.isWashBlock && (
                                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                                    <p className="text-sm text-amber-800 leading-relaxed">
                                        Presiona el botón <span className="font-bold">▶ Iniciar</span> en el cambio de agua y luego <span className="font-bold">⏹ Finalizar</span> antes de iniciar el siguiente bache.
                                    </p>
                                </div>
                            )}
                        </div>
                        <div className="px-6 pb-6">
                            <button
                                onClick={() => setPendingWashModal(null)}
                                className="w-full px-4 py-2.5 text-sm font-bold text-white rounded-xl hover:opacity-90 transition-all"
                                style={{ background: 'linear-gradient(135deg, #0891b2, #06b6d4)' }}
                            >
                                Entendido
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
